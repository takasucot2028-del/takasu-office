// ============================================
// 統一データアクセス層
// VITE_GAS_URL が設定されていれば GAS Web App（データ共有）、
// 未設定ならば localStorage（デモモード）に切り替える。
// 全関数は Promise を返す（非同期統一）。
// ページはこの層だけを参照し、バックエンドの差異を意識しない。
// ============================================
import type {
  Staff, AttendanceRecord, LeaveRecord,
  ShiftPattern, AvailabilityRecord, ConfirmedShift, WorkLocation,
  OvertimeRecord, CompLeaveUse, DocumentItem,
  ExpenseCategory, Budget, Expense,
} from '../types';
import { DEFAULT_SHIFT_PATTERNS, LEAVE_HOURS_PER_DAY, currentFiscalYear } from '../utils/constants';
import * as local from '../utils/store';
import * as gas from './client';
import type { ExpenseContext, TodayWork, PendingSummary } from './client';
export type { TodayWork, PendingSummary } from './client';

const USE_GAS = !!import.meta.env.VITE_GAS_URL;

/** GAS を使う構成かどうか（UI表示の切り替え用） */
export const usingGas = USE_GAS;

// セッションのトークン（GAS の各APIに付与する）
function token(): string {
  return sessionStorage.getItem('tof_token') || '';
}
// ログイン中の従業員ID（デモモードで自分用データの対象に使う）
function staffId(): string {
  return sessionStorage.getItem('tof_staffId') || '';
}

// 基礎データ（あまり変わらないもの）の短期キャッシュ。画面遷移のたびの再取得を防ぐ。
const _cache = new Map<string, { t: number; v: unknown }>();
const CACHE_TTL = 60000; // 60秒（メモリ内の再取得抑制）
// 端末(localStorage)にも保存して、再読込・再訪問時に「前回値を即表示→裏で最新化」する対象キー
const PERSIST_KEYS = new Set(['staff', 'patterns', 'categories']);
const PERSIST_PREFIX = 'tof_cache_';
function persistRead(key: string): { t: number; v: unknown } | null {
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o.t === 'number' ? o : null;
  } catch { return null; }
}
function persistWrite(key: string, entry: { t: number; v: unknown }) {
  try { localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(entry)); } catch { /* 容量超過等は無視 */ }
}
function persistClear() {
  try {
    PERSIST_KEYS.forEach(k => localStorage.removeItem(PERSIST_PREFIX + k));
    Object.keys(localStorage).filter(k => k.startsWith('tof_dash_') || k.startsWith('tof_acct_')).forEach(k => localStorage.removeItem(k));
  } catch { /* noop */ }
}

// 背景で最新化した結果、内容が変わったときに画面へ知らせる仕組み。
// （保存値を即表示したあと最新が届いても再描画されない問題を防ぐ）
const _refreshListeners = new Set<(key: string) => void>();
/** 基礎データ（職員・区分・費目）が裏で更新されたら通知を受け取る。戻り値で解除する。 */
export function onDataRefresh(fn: (key: string) => void): () => void {
  _refreshListeners.add(fn);
  return () => { _refreshListeners.delete(fn); };
}
function notifyRefresh(key: string) { _refreshListeners.forEach(fn => { try { fn(key); } catch { /* noop */ } }); }

// stale-while-revalidate な memo。永続キーは保存値があれば即返し、裏で最新化する。
async function memo<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const c = _cache.get(key);
  if (c && Date.now() - c.t < CACHE_TTL) return c.v as T;
  if (PERSIST_KEYS.has(key)) {
    const p = persistRead(key);
    if (p) { void loader().then(v => cacheSet(key, v)).catch(() => {}); return p.v as T; }
  }
  const v = await loader();
  cacheSet(key, v);
  return v;
}
function invalidate(...keys: string[]) {
  keys.forEach(k => {
    _cache.delete(k);
    if (PERSIST_KEYS.has(k)) { try { localStorage.removeItem(PERSIST_PREFIX + k); } catch { /* noop */ } }
  });
}
function cacheSet(key: string, v: unknown) {
  const prev = _cache.get(key) ?? (PERSIST_KEYS.has(key) ? persistRead(key) : null);
  const entry = { t: Date.now(), v };
  _cache.set(key, entry);
  if (PERSIST_KEYS.has(key)) persistWrite(key, entry);
  // 内容が変わったときだけ画面へ通知する（同じ内容での無駄な再描画を避ける）
  if (prev && JSON.stringify(prev.v) !== JSON.stringify(v)) notifyRefresh(key);
}
function cacheFresh(key: string): boolean { const c = _cache.get(key); return !!c && Date.now() - c.t < CACHE_TTL; }
/** キャッシュ全消去（ログイン/ログアウト時に呼ぶ。端末保存分も消す） */
export function clearDataCache() { _cache.clear(); persistClear(); }

// ApiResponse から data を取り出す。失敗時は fallback を返す。
function unwrap<T>(res: { success: boolean; data?: T; error?: string }, fallback: T): T {
  if (res.success && res.data !== undefined) return res.data;
  if (!res.success) console.error('API エラー:', res.error);
  return fallback;
}

// === 純粋ヘルパー（バックエンド非依存） ===
export const genId = local.genId;
export const todayStr = local.todayStr;

export interface LeaveBalance {
  grantedHours: number; usedHours: number; balanceHours: number;
  grantedDays: number; usedDays: number; balanceDays: number;
}

/** 有給の残数を時間換算で計算（1日=7.5時間）。日数・時間の両方を返す */
export function computeLeaveBalance(records: LeaveRecord[]): LeaveBalance {
  const hpd = LEAVE_HOURS_PER_DAY;
  const toHours = (r: LeaveRecord) => (r.days || 0) * hpd + (r.hours || 0);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const approved = (r: LeaveRecord) => !r.status || r.status === 'approved'; // 旧データ（空）は承認扱い
  const grantedHours = records.filter(r => r.kind === 'grant' && approved(r)).reduce((s, r) => s + toHours(r), 0);
  const usedHours = records.filter(r => r.kind === 'use' && approved(r)).reduce((s, r) => s + toHours(r), 0);
  const balanceHours = grantedHours - usedHours;
  return {
    grantedHours: r1(grantedHours), usedHours: r1(usedHours), balanceHours: r1(balanceHours),
    grantedDays: r1(grantedHours / hpd), usedDays: r1(usedHours / hpd), balanceDays: r1(balanceHours / hpd),
  };
}

// === 認証 ===
export interface LoginResult { success: boolean; token?: string; error?: string }

export async function adminLogin(email: string, password: string): Promise<LoginResult> {
  if (!USE_GAS) {
    const ok = local.verifyAdmin(email, password);
    return ok
      ? { success: true, token: `demo-${Date.now()}` }
      : { success: false, error: 'メールアドレスまたはパスワードが正しくありません' };
  }
  const res = await gas.adminLogin(email, password);
  return { success: res.success, token: res.token, error: res.error };
}

export async function changeAdminPassword(oldPassword: string, newPassword: string): Promise<void> {
  if (!USE_GAS) { local.changeAdminPassword(oldPassword, newPassword); return; }
  const res = await gas.changePassword(token(), oldPassword, newPassword);
  if (!res.success) throw new Error(res.error || 'パスワードの変更に失敗しました');
}

// === 従業員ログイン・自分用 ===
export interface StaffLoginResult { success: boolean; token?: string; staffId?: string; staff?: Staff; error?: string }

export async function staffLogin(employeeNumber: string, password: string): Promise<StaffLoginResult> {
  if (!USE_GAS) {
    const s = local.verifyStaffLogin(employeeNumber, password);
    return s ? { success: true, token: `demo-${Date.now()}`, staffId: s.id, staff: s }
             : { success: false, error: '職員番号またはパスワードが正しくありません' };
  }
  const res = await gas.staffLogin(employeeNumber, password);
  // GAS は職員情報を staff キーで返す（data ではない）。両対応で取り出す。
  const s = ((res as unknown as { staff?: Staff }).staff) ?? res.data;
  return { success: res.success, token: res.token, staffId: s?.id, staff: s, error: res.error };
}

export async function getMyProfile(): Promise<Staff | null> {
  return memo('myProfile', async () => {
    if (!USE_GAS) return local.getStaff(staffId());
    const res = await gas.getMyProfile(token());
    return res.success ? (res.data ?? null) : null;
  });
}

export async function getMyAttendance(month: string): Promise<AttendanceRecord[]> {
  if (!USE_GAS) return local.listAttendance(staffId(), month);
  return unwrap(await gas.getMyAttendance(month, token()), []);
}

export async function punch(punchType: 'in' | 'out'): Promise<{ date: string; time: string; punchType: string }> {
  if (!USE_GAS) return local.punchLocal(staffId(), punchType);
  const res = await gas.punch(punchType, token());
  if (!res.success || !res.data) throw new Error(res.error || '打刻に失敗しました');
  return res.data;
}

// 従業員が当日の休憩を時刻（開始〜終了）で保存する。休憩分＝終了−開始 を計算し、実働に反映される。
export async function setMyBreak(breakStart: string, breakEnd: string): Promise<{ date: string; breakMinutes: number; breakStart: string; breakEnd: string }> {
  if (!USE_GAS) return local.setMyBreakLocal(staffId(), breakStart, breakEnd);
  const res = await gas.setMyBreak(breakStart, breakEnd, token());
  if (!res.success || !res.data) throw new Error(res.error || '休憩時間の保存に失敗しました');
  return res.data;
}

export async function getMyAvailability(month: string): Promise<AvailabilityRecord[]> {
  if (!USE_GAS) return local.listAvailabilityByMonth(month).filter(r => r.staffId === staffId());
  return unwrap(await gas.getMyAvailability(month, token()), []);
}
export async function saveMyAvailability(month: string, records: AvailabilityRecord[]): Promise<void> {
  if (!USE_GAS) { local.saveMonthAvailability(month, [staffId()], records); return; }
  const res = await gas.saveMyAvailability(month, records, token());
  if (!res.success) throw new Error(res.error || '希望の保存に失敗しました');
}

export async function getMyOvertime(): Promise<OvertimeRecord[]> {
  if (!USE_GAS) return local.listOvertimeByStaff(staffId());
  return unwrap(await gas.getMyOvertime(token()), []);
}
export async function addMyOvertime(record: Partial<OvertimeRecord>): Promise<void> {
  const rec: Partial<OvertimeRecord> = { id: local.genId('ot'), ...record }; // クライアント採番（リトライ冪等化）
  if (!USE_GAS) {
    local.addOvertime({
      id: rec.id!, staffId: staffId(), date: rec.date || '', kind: rec.kind || 'overtime',
      appliedHours: rec.appliedHours || 0, reason: rec.reason || '',
      startTime: rec.startTime || '', endTime: rec.endTime || '',
      status: 'applied', disposition: '', resultHours: 0, note: '',
    });
    return;
  }
  const res = await gas.addMyOvertime(rec, token());
  if (!res.success) throw new Error(res.error || '時間外申請に失敗しました');
}

export async function getMyLeave(): Promise<LeaveRecord[]> {
  if (!USE_GAS) return local.listLeave(staffId());
  return unwrap(await gas.getMyLeave(token()), []);
}
export async function addMyLeaveRequest(record: Partial<LeaveRecord>): Promise<void> {
  const rec: Partial<LeaveRecord> = { id: local.genId('lv'), ...record }; // クライアント採番（リトライ冪等化）
  if (!USE_GAS) {
    local.addLeave({
      id: rec.id!, staffId: staffId(), kind: 'use', date: rec.date || '',
      days: rec.days || 0, hours: rec.hours || 0, status: 'requested', note: rec.note || '',
      startTime: rec.startTime || '', endTime: rec.endTime || '',
    });
    return;
  }
  const res = await gas.addMyLeaveRequest(rec, token());
  if (!res.success) throw new Error(res.error || '休暇申請に失敗しました');
}

export async function changeStaffPassword(oldPassword: string, newPassword: string): Promise<void> {
  if (!USE_GAS) { local.staffChangePasswordLocal(staffId(), oldPassword, newPassword); return; }
  const res = await gas.staffChangePassword(token(), oldPassword, newPassword);
  if (!res.success) throw new Error(res.error || 'パスワードの変更に失敗しました');
}

// === 文書管理（閲覧は事務局・従業員の両方、登録/削除は事務局） ===
export async function listDocuments(): Promise<DocumentItem[]> {
  if (!USE_GAS) return local.listDocuments();
  return unwrap(await gas.getDocuments(token()), []);
}
export async function saveDocument(doc: DocumentItem): Promise<void> {
  if (!USE_GAS) { local.upsertDocument(doc); return; }
  const res = await gas.saveDocument(doc, token());
  if (!res.success) throw new Error(res.error || '文書の保存に失敗しました');
}
export async function deleteDocument(id: string): Promise<void> {
  if (!USE_GAS) { local.deleteDocument(id); return; }
  const res = await gas.deleteDocument(id, token());
  if (!res.success) throw new Error(res.error || '文書の削除に失敗しました');
}

// === 管理者：従業員パスワード発行・休暇承認 ===
export async function setStaffPassword(sid: string, password: string): Promise<void> {
  if (!USE_GAS) { local.setStaffPassword(sid, password); invalidate('staff'); return; }
  const res = await gas.setStaffPassword(sid, password, token());
  if (!res.success) throw new Error(res.error || 'パスワードの設定に失敗しました');
  // hasPassword フラグだけキャッシュ上で更新（名簿の再取得は不要）
  const cur = readStaffCache();
  if (cur) writeStaffCache(cur.map(s => s.id === sid ? { ...s, hasPassword: true } : s));
}
export async function setLeaveStatus(id: string, status: LeaveRecord['status']): Promise<void> {
  if (!USE_GAS) { local.setLeaveStatus(id, status); return; }
  const res = await gas.setLeaveStatus(id, status, token());
  if (!res.success) throw new Error(res.error || '状態の更新に失敗しました');
}

// === 会計管理 ===
export type { ExpenseContext } from './client';

/** 承認済み経費の (事業+費目) 合計を引く */
export function usedOf(expenses: Expense[], project: string, categoryId: string): number {
  return expenses
    .filter(e => e.status === 'approved' && e.project === project && e.categoryId === categoryId)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  return memo('categories', async () => {
    if (!USE_GAS) return local.listExpenseCategories();
    const res = await gas.getExpenseCategories(token());
    // GAS が空なら フロントの既定費目にフォールバック
    return res.success && res.data && res.data.length ? res.data : local.listExpenseCategories();
  });
}
export async function saveExpenseCategories(categories: ExpenseCategory[]): Promise<void> {
  invalidate('categories');
  if (!USE_GAS) { local.saveExpenseCategories(categories); return; }
  const res = await gas.saveExpenseCategories(categories, token());
  if (!res.success) throw new Error(res.error || '費目の保存に失敗しました');
}

export async function listBudgets(fiscalYear: number): Promise<Budget[]> {
  if (!USE_GAS) return local.listBudgets(fiscalYear);
  return unwrap(await gas.getBudgets(fiscalYear, token()), []);
}
export async function saveBudgets(fiscalYear: number, records: Budget[]): Promise<void> {
  if (!USE_GAS) { local.saveBudgets(fiscalYear, records); return; }
  const res = await gas.saveBudgets(fiscalYear, records, token());
  if (!res.success) throw new Error(res.error || '予算の保存に失敗しました');
}

export async function listExpenses(fiscalYear: number): Promise<Expense[]> {
  if (!USE_GAS) return local.listExpenses(fiscalYear);
  return unwrap(await gas.getExpenses(fiscalYear, token()), []);
}
export async function addExpense(record: Expense): Promise<void> {
  if (!USE_GAS) { local.addExpense(record); return; }
  const res = await gas.addExpense(record, token());
  if (!res.success) throw new Error(res.error || '経費の登録に失敗しました');
}
export async function setExpenseStatus(id: string, status: Expense['status']): Promise<void> {
  if (!USE_GAS) { local.setExpenseStatus(id, status); return; }
  const res = await gas.setExpenseStatus(id, status, token());
  if (!res.success) throw new Error(res.error || '状態の更新に失敗しました');
}
export async function deleteExpense(id: string): Promise<void> {
  if (!USE_GAS) { local.deleteExpense(id); return; }
  const res = await gas.deleteExpense(id, token());
  if (!res.success) throw new Error(res.error || '経費の削除に失敗しました');
}

// 従業員：経費申請フォーム用（年度の事業/費目と残額）
export async function getExpenseContext(fiscalYear: number): Promise<ExpenseContext> {
  if (!USE_GAS) {
    const cats = local.listExpenseCategories();
    const budgets = local.listBudgets(fiscalYear);
    const expenses = local.listExpenses(fiscalYear);
    const lines = budgets.map(b => {
      const used = usedOf(expenses, b.project, b.categoryId);
      return { project: b.project, categoryId: b.categoryId, budget: b.amount, used, remaining: b.amount - used };
    });
    return { categories: cats, lines };
  }
  const res = await gas.getExpenseContext(fiscalYear, token());
  const data = res.success && res.data ? res.data : { categories: [], lines: [] };
  // 費目マスタ未保存で空のときはフロントの既定費目名にフォールバック（IDのまま表示されるのを防ぐ）
  if (!data.categories || data.categories.length === 0) data.categories = local.listExpenseCategories();
  return data;
}
export async function listMyExpenses(): Promise<Expense[]> {
  if (!USE_GAS) return local.listMyExpenses(staffId());
  return unwrap(await gas.getMyExpenses(token()), []);
}
export async function addMyExpense(record: Partial<Expense>): Promise<Expense> {
  const rec: Partial<Expense> = { id: local.genId('ex'), ...record }; // クライアント採番（リトライ冪等化）
  const full: Expense = {
    id: rec.id!, fiscalYear: Number(rec.fiscalYear) || 0, staffId: staffId(),
    date: rec.date || '', project: rec.project || '', categoryId: rec.categoryId || '',
    amount: Number(rec.amount) || 0, description: rec.description || '',
    status: 'requested', note: '',
  };
  if (!USE_GAS) { local.addExpense(full); return full; }
  const res = await gas.addMyExpense(rec, token());
  if (!res.success) throw new Error(res.error || '経費申請に失敗しました');
  return full;
}

// === 職員 ===
export async function listStaff(): Promise<Staff[]> {
  return memo('staff', async () => {
    if (!USE_GAS) return local.listStaff();
    const staff = unwrap(await gas.getStaff(token()), []);
    return staff.slice().sort((a, b) => (a.lastKana || '').localeCompare(b.lastKana || '', 'ja'));
  });
}

export async function getStaff(id: string): Promise<Staff | null> {
  if (!USE_GAS) return local.getStaff(id);
  const staff = await listStaff();
  return staff.find(s => s.id === id) ?? null;
}

// 職員キャッシュの読み書き（メモリ→端末保存の順に参照）。編集後に丸ごと再取得せず即時反映するため。
function readStaffCache(): Staff[] | null {
  return (_cache.get('staff')?.v as Staff[] | undefined)
    ?? (persistRead('staff')?.v as Staff[] | undefined)
    ?? null;
}
function writeStaffCache(list: Staff[]) {
  const sorted = list.slice().sort((a, b) => (a.lastKana || '').localeCompare(b.lastKana || '', 'ja'));
  cacheSet('staff', sorted); // メモリ＋端末保存を更新
}

export async function upsertStaff(staff: Staff): Promise<Staff> {
  if (!USE_GAS) { const r = local.upsertStaff(staff); invalidate('staff'); return r; }
  const res = await gas.upsertStaff(staff, token());
  if (!res.success) throw new Error(res.error || '職員情報の保存に失敗しました');
  const saved = res.data ?? staff;
  // 保存内容でキャッシュを更新（次の職員名簿表示をGAS応答待ちなしで即時・正確に）
  const cur = readStaffCache();
  if (cur) {
    const prev = cur.find(s => s.id === saved.id);
    const merged: Staff = prev ? { ...prev, ...saved } : saved; // hasPassword 等は既存を保持
    writeStaffCache([...cur.filter(s => s.id !== saved.id), merged]);
  } else {
    invalidate('staff');
  }
  return saved;
}

// === 勤怠 ===
export async function listAttendance(staffId: string, month: string): Promise<AttendanceRecord[]> {
  if (!USE_GAS) return local.listAttendance(staffId, month);
  return unwrap(await gas.getAttendance(staffId, month, token()), []);
}

export async function saveMonthAttendance(
  staffId: string, month: string, records: AttendanceRecord[]
): Promise<void> {
  if (!USE_GAS) { local.saveMonthAttendance(staffId, month, records); return; }
  const res = await gas.saveMonthAttendance(staffId, month, records, token());
  if (!res.success) throw new Error(res.error || '勤怠の保存に失敗しました');
}

// === シフト区分マスタ ===
/**
 * 取得したシフト区分を確定する。
 * 保存処理中などで一時的に空が返ることがあるため、空のときは既存の値を優先し、
 * それも無い場合だけ既定値を使う（登録済みの区分が既定値に置き換わるのを防ぐ）。
 */
function resolvePatterns(list: ShiftPattern[]): ShiftPattern[] {
  if (list.length) return list.slice().sort((a, b) => a.order - b.order);
  const kept = (_cache.get('patterns')?.v ?? persistRead('patterns')?.v) as ShiftPattern[] | undefined;
  if (kept && kept.length) return kept;
  return DEFAULT_SHIFT_PATTERNS.slice().sort((a, b) => a.order - b.order);
}

export async function listShiftPatterns(): Promise<ShiftPattern[]> {
  return memo('patterns', async () => {
    if (!USE_GAS) return local.listShiftPatterns();
    return resolvePatterns(unwrap(await gas.getShiftPatterns(token()), [] as ShiftPattern[]));
  });
}

export async function saveShiftPatterns(patterns: ShiftPattern[]): Promise<void> {
  if (!USE_GAS) { invalidate('patterns'); local.saveShiftPatterns(patterns); return; }
  const res = await gas.saveShiftPatterns(patterns, token());
  if (!res.success) throw new Error(res.error || 'シフト区分の保存に失敗しました');
  // 保存が成功してからキャッシュを更新する（保存中の読み取りで古い値が入るのを防ぐ）
  cacheSet('patterns', patterns.slice().sort((a, b) => a.order - b.order));
}

// === シフト希望（○×） ===
export async function listAvailabilityByMonth(month: string): Promise<AvailabilityRecord[]> {
  if (!USE_GAS) return local.listAvailabilityByMonth(month);
  return unwrap(await gas.getAvailabilityMonth(month, token()), []);
}

export async function saveMonthAvailability(
  month: string, staffIds: string[], records: AvailabilityRecord[]
): Promise<void> {
  if (!USE_GAS) { local.saveMonthAvailability(month, staffIds, records); return; }
  const res = await gas.saveMonthAvailability(month, staffIds, records, token());
  if (!res.success) throw new Error(res.error || '希望の保存に失敗しました');
}

// === 確定シフト ===
export async function listConfirmedByMonth(month: string): Promise<ConfirmedShift[]> {
  if (!USE_GAS) return local.listConfirmedByMonth(month);
  return unwrap(await gas.getConfirmedMonth(month, token()), []);
}

export async function listConfirmedByDate(date: string): Promise<ConfirmedShift[]> {
  if (!USE_GAS) return local.listConfirmedByDate(date);
  const month = date.slice(0, 7);
  const all = unwrap(await gas.getConfirmedMonth(month, token()), []);
  return all.filter(r => r.date === date);
}

export async function saveMonthConfirmed(
  month: string, location: WorkLocation, records: ConfirmedShift[]
): Promise<void> {
  if (!USE_GAS) { local.saveMonthConfirmed(month, location, records); return; }
  const res = await gas.saveMonthConfirmed(month, location, records, token());
  if (!res.success) throw new Error(res.error || '確定シフトの保存に失敗しました');
}

// === 時間外・休日勤務 ===
export async function listOvertimeByMonth(month: string): Promise<OvertimeRecord[]> {
  if (!USE_GAS) return local.listOvertimeByMonth(month);
  return unwrap(await gas.getOvertimeMonth(month, token()), []);
}

export async function listOvertimeByStaff(staffId: string): Promise<OvertimeRecord[]> {
  if (!USE_GAS) return local.listOvertimeByStaff(staffId);
  return unwrap(await gas.getOvertimeByStaff(staffId, token()), []);
}

export async function saveMonthOvertime(
  staffId: string, month: string, records: OvertimeRecord[]
): Promise<void> {
  if (!USE_GAS) { local.saveMonthOvertime(staffId, month, records); return; }
  const res = await gas.saveMonthOvertime(staffId, month, records, token());
  if (!res.success) throw new Error(res.error || '時間外の保存に失敗しました');
}

// === 代休取得（消化） ===
export async function listCompUse(staffId: string): Promise<CompLeaveUse[]> {
  if (!USE_GAS) return local.listCompUse(staffId);
  return unwrap(await gas.getCompUse(staffId, token()), []);
}

export async function addCompUse(record: CompLeaveUse): Promise<void> {
  if (!USE_GAS) { local.addCompUse(record); return; }
  const res = await gas.addCompUse(record, token());
  if (!res.success) throw new Error(res.error || '代休取得の記録に失敗しました');
}

export async function deleteCompUse(id: string): Promise<void> {
  if (!USE_GAS) { local.deleteCompUse(id); return; }
  const res = await gas.deleteCompUse(id, token());
  if (!res.success) throw new Error(res.error || '代休取得の削除に失敗しました');
}

// === 本日の休暇（有給取得・代休取得） ===
export interface DayAbsences { leave: LeaveRecord[]; comp: CompLeaveUse[] }

export async function listAbsencesByDate(date: string): Promise<DayAbsences> {
  if (!USE_GAS) return local.listAbsencesByDate(date);
  const res = await gas.getAbsencesByDate(date, token());
  return res.success && res.data ? res.data : { leave: [], comp: [] };
}

// === 有給休暇 ===
export async function listLeave(staffId: string): Promise<LeaveRecord[]> {
  if (!USE_GAS) return local.listLeave(staffId);
  return unwrap(await gas.getLeave(staffId, token()), []);
}

export async function addLeave(record: LeaveRecord): Promise<void> {
  if (!USE_GAS) { local.addLeave(record); return; }
  const res = await gas.addLeave(record, token());
  if (!res.success) throw new Error(res.error || '有給記録の追加に失敗しました');
}

export async function deleteLeave(id: string): Promise<void> {
  if (!USE_GAS) { local.deleteLeave(id); return; }
  const res = await gas.deleteLeave(id, token());
  if (!res.success) throw new Error(res.error || '有給記録の削除に失敗しました');
}

// ============================================================
// バッチ複合ローダー：画面ごとにGASへの往復を1回に集約する。
// 基礎データ(staff/patterns/categories)はキャッシュを使い、
// 画面固有のデータを1回のバッチでまとめて取得する。
// ============================================================
type SubRes<T> = { success: boolean; data?: T; error?: string };
// バッチ実行。GASがバッチ未対応（旧デプロイ）や失敗時は null を返し、呼び出し側が個別取得にフォールバックする。
async function batchCall(requests: Record<string, unknown>[]): Promise<SubRes<unknown>[] | null> {
  const res = await gas.batch(requests, token());
  return (res.success && Array.isArray(res.data)) ? (res.data as SubRes<unknown>[]) : null;
}

// --- 基礎データ（職員・区分・費目）を1リクエストで取得しキャッシュに載せる ---
// 多くの管理画面が開いた直後に必要とするため、ログイン時に先読みしておく。
export interface ReferenceData { staff: Staff[]; patterns: ShiftPattern[]; categories: ExpenseCategory[] }
function refFromCache(): ReferenceData | null {
  if (cacheFresh('staff') && cacheFresh('patterns') && cacheFresh('categories')) {
    return {
      staff: _cache.get('staff')!.v as Staff[],
      patterns: _cache.get('patterns')!.v as ShiftPattern[],
      categories: _cache.get('categories')!.v as ExpenseCategory[],
    };
  }
  return null;
}
// 端末保存（多少古くてもよい）から基礎データを復元。再読込直後の即表示に使う。
function refFromPersist(): ReferenceData | null {
  const s = persistRead('staff'), p = persistRead('patterns'), c = persistRead('categories');
  if (s && p && c) return { staff: s.v as Staff[], patterns: p.v as ShiftPattern[], categories: c.v as ExpenseCategory[] };
  return null;
}
let _refInflight: Promise<ReferenceData> | null = null;
function loadReference(): Promise<ReferenceData> {
  if (_refInflight) return _refInflight;      // 同時呼び出しは1リクエストに集約
  _refInflight = (async (): Promise<ReferenceData> => {
    try {
      if (!USE_GAS) {
        return { staff: await listStaff(), patterns: await listShiftPatterns(), categories: await listExpenseCategories() };
      }
      const r = await batchCall([{ action: 'getStaff' }, { action: 'getShiftPatterns' }, { action: 'getExpenseCategories' }]);
      if (r) {
        const staff = unwrap(r[0] as SubRes<Staff[]>, [])
          .slice().sort((a, b) => (a.lastKana || '').localeCompare(b.lastKana || '', 'ja'));
        const patList = unwrap(r[1] as SubRes<ShiftPattern[]>, []);
        const patterns = resolvePatterns(patList);
        const catList = unwrap(r[2] as SubRes<ExpenseCategory[]>, []);
        const categories = catList.length ? catList : local.listExpenseCategories();
        cacheSet('staff', staff); cacheSet('patterns', patterns); cacheSet('categories', categories);
        return { staff, patterns, categories };
      }
      // バッチ未対応時は個別取得（各memoが個別にキャッシュ）
      const [staff, patterns, categories] = await Promise.all([listStaff(), listShiftPatterns(), listExpenseCategories()]);
      return { staff, patterns, categories };
    } finally { _refInflight = null; }
  })();
  return _refInflight;
}
export async function getReference(): Promise<ReferenceData> {
  const cached = refFromCache();
  if (cached) return cached;                  // メモリ内が新しければ即返す
  const persisted = refFromPersist();
  if (persisted) {                            // 端末保存があれば即表示し、裏で最新化
    void loadReference().catch(() => {});
    return persisted;
  }
  return loadReference();                     // 初回のみ取得を待つ
}

// --- ダッシュボード ---
export interface DashboardData { staff: Staff[]; patterns: ShiftPattern[]; confirmed: ConfirmedShift[]; absences: DayAbsences; pending: PendingSummary }
// 当日分のダッシュボードを端末保存し、再訪問時にまず即表示（stale-while-revalidate）する。
// 日付をキーにするので「別の日の内容」が出ることはない。
function dashKey(date: string): string { return `tof_dash_${date}`; }
export function getDashboardCached(date: string): DashboardData | null {
  try { const raw = localStorage.getItem(dashKey(date)); return raw ? JSON.parse(raw) as DashboardData : null; } catch { return null; }
}
function persistDash(date: string, data: DashboardData) {
  try {
    Object.keys(localStorage).filter(k => k.startsWith('tof_dash_') && k !== dashKey(date)).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(dashKey(date), JSON.stringify(data));
  } catch { /* 容量超過等は無視 */ }
}
const EMPTY_PENDING: PendingSummary = { expenses: 0, overtime: 0, leave: 0 };
/** デモ用：未承認件数をlocalStorageから数える */
function localPending(): PendingSummary {
  return {
    expenses: local.listExpenses(currentFiscalYear()).filter(e => e.status === 'requested').length,
    overtime: local.listOvertimeByMonth(todayStr().slice(0, 7)).filter(r => r.status === 'applied').length,
    leave: local.listAllLeave().filter(r => r.status === 'requested').length,
  };
}
export async function getDashboardData(date: string): Promise<DashboardData> {
  const month = date.slice(0, 7);
  if (!USE_GAS) {
    const [staff, patterns] = await Promise.all([listStaff(), listShiftPatterns()]);
    return {
      staff, patterns, confirmed: local.listConfirmedByDate(date), absences: local.listAbsencesByDate(date),
      pending: localPending(),
    };
  }
  // 基礎データ（職員・区分・費目）が未キャッシュなら確定・休暇と一緒に1バッチで取得し、
  // キャッシュも温める。メモリ／端末保存にあれば確定・休暇だけを1バッチで取得する。
  const memCached = refFromCache();
  const cached = memCached || refFromPersist();
  if (cached && !memCached) void loadReference().catch(() => {}); // 保存値を使うので裏で最新化
  const reqs: Record<string, unknown>[] = cached
    ? [{ action: 'getConfirmedMonth', month }, { action: 'getAbsencesByDate', date }, { action: 'getPendingSummary' }]
    : [
        { action: 'getStaff' }, { action: 'getShiftPatterns' }, { action: 'getExpenseCategories' },
        { action: 'getConfirmedMonth', month }, { action: 'getAbsencesByDate', date }, { action: 'getPendingSummary' },
      ];
  const r = await batchCall(reqs);
  if (r) {
    let staff: Staff[], patterns: ShiftPattern[], base: number;
    if (cached) {
      staff = cached.staff; patterns = cached.patterns; base = 0;
    } else {
      staff = unwrap(r[0] as SubRes<Staff[]>, []).slice().sort((a, b) => (a.lastKana || '').localeCompare(b.lastKana || '', 'ja'));
      const patList = unwrap(r[1] as SubRes<ShiftPattern[]>, []);
      patterns = resolvePatterns(patList);
      const catList = unwrap(r[2] as SubRes<ExpenseCategory[]>, []);
      cacheSet('staff', staff); cacheSet('patterns', patterns);
      cacheSet('categories', catList.length ? catList : local.listExpenseCategories());
      base = 3;
    }
    const confirmed = unwrap(r[base] as SubRes<ConfirmedShift[]>, []).filter(x => x.date === date);
    const absences = unwrap(r[base + 1] as SubRes<DayAbsences>, { leave: [], comp: [] });
    const pending = unwrap(r[base + 2] as SubRes<PendingSummary>, EMPTY_PENDING);
    const result = { staff, patterns, confirmed, absences, pending };
    persistDash(date, result);
    return result;
  }
  // フォールバック（旧GAS: バッチ未対応）
  const [staff, patterns] = await Promise.all([listStaff(), listShiftPatterns()]);
  const [conf, absences] = await Promise.all([listConfirmedByDate(date), listAbsencesByDate(date)]);
  return { staff, patterns, confirmed: conf, absences, pending: EMPTY_PENDING };
}

// --- シフト表 ---
export interface ShiftMonthData { availability: AvailabilityRecord[]; confirmed: ConfirmedShift[] }
export async function getShiftMonthData(month: string): Promise<ShiftMonthData> {
  if (!USE_GAS) return { availability: local.listAvailabilityByMonth(month), confirmed: local.listConfirmedByMonth(month) };
  const r = await batchCall([{ action: 'getAvailabilityMonth', month }, { action: 'getConfirmedMonth', month }]);
  if (r) return { availability: unwrap(r[0] as SubRes<AvailabilityRecord[]>, []), confirmed: unwrap(r[1] as SubRes<ConfirmedShift[]>, []) };
  const [availability, confirmed] = await Promise.all([listAvailabilityByMonth(month), listConfirmedByMonth(month)]);
  return { availability, confirmed };
}

// --- 時間外（職員×月） ---
export interface OvertimeMonthData {
  overtime: OvertimeRecord[]; compUse: CompLeaveUse[]; attendance: AttendanceRecord[]; confirmed: ConfirmedShift[];
}
export async function getOvertimeMonthData(sid: string, month: string): Promise<OvertimeMonthData> {
  if (!USE_GAS) {
    return {
      overtime: local.listOvertimeByStaff(sid), compUse: local.listCompUse(sid),
      attendance: local.listAttendance(sid, month), confirmed: local.listConfirmedByMonth(month),
    };
  }
  const r = await batchCall([
    { action: 'getOvertimeByStaff', staffId: sid }, { action: 'getCompUse', staffId: sid },
    { action: 'getAttendance', staffId: sid, month }, { action: 'getConfirmedMonth', month },
  ]);
  if (r) {
    return {
      overtime: unwrap(r[0] as SubRes<OvertimeRecord[]>, []), compUse: unwrap(r[1] as SubRes<CompLeaveUse[]>, []),
      attendance: unwrap(r[2] as SubRes<AttendanceRecord[]>, []), confirmed: unwrap(r[3] as SubRes<ConfirmedShift[]>, []),
    };
  }
  const [overtime, compUse, attendance, confirmed] = await Promise.all([
    listOvertimeByStaff(sid), listCompUse(sid), listAttendance(sid, month), listConfirmedByMonth(month),
  ]);
  return { overtime, compUse, attendance, confirmed };
}

// --- 会計（年度） ---
export interface AccountingData { budgets: Budget[]; expenses: Expense[] }
// 年度ごとに端末保存し、再訪問時にまず即表示（stale-while-revalidate）する。
function acctKey(fy: number): string { return `tof_acct_${fy}`; }
export function getAccountingCached(fiscalYear: number): AccountingData | null {
  try { const raw = localStorage.getItem(acctKey(fiscalYear)); return raw ? JSON.parse(raw) as AccountingData : null; } catch { return null; }
}
function persistAcct(fy: number, data: AccountingData) {
  try {
    Object.keys(localStorage).filter(k => k.startsWith('tof_acct_') && k !== acctKey(fy)).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(acctKey(fy), JSON.stringify(data));
  } catch { /* 容量超過等は無視 */ }
}
export async function getAccountingData(fiscalYear: number): Promise<AccountingData> {
  if (!USE_GAS) return { budgets: local.listBudgets(fiscalYear), expenses: local.listExpenses(fiscalYear) };
  const r = await batchCall([{ action: 'getBudgets', fiscalYear }, { action: 'getExpenses', fiscalYear }]);
  if (r) {
    const result = { budgets: unwrap(r[0] as SubRes<Budget[]>, []), expenses: unwrap(r[1] as SubRes<Expense[]>, []) };
    persistAcct(fiscalYear, result);
    return result;
  }
  const [budgets, expenses] = await Promise.all([listBudgets(fiscalYear), listExpenses(fiscalYear)]);
  return { budgets, expenses };
}

// --- 本日の勤務・休暇（従業員も閲覧可。氏名・時間のみ、個人情報は含まない） ---
const EMPTY_TODAY: TodayWork = { shifts: [], leave: [], comp: [] };
export async function getTodayWork(date: string): Promise<TodayWork> {
  if (!USE_GAS) {
    const nameOf = new Map(local.listStaff().map(s => [s.id, `${s.lastName} ${s.firstName}`]));
    const patMap = new Map(local.listShiftPatterns().map(p => [p.id, p]));
    const shifts = local.listConfirmedByDate(date).map(r => {
      const p = patMap.get(r.patternId);
      return {
        location: r.location, staffName: nameOf.get(r.staffId) || '(不明)',
        patternName: p?.name || '', startTime: p?.startTime || '', endTime: p?.endTime || '', order: p?.order ?? 99,
      };
    });
    const abs = local.listAbsencesByDate(date);
    const leave = abs.leave.map(r => ({ staffName: nameOf.get(r.staffId) || '(不明)', days: r.days, hours: r.hours, note: r.note }));
    const comp = abs.comp.map(r => ({ staffName: nameOf.get(r.staffId) || '(不明)', hours: r.hours, note: r.note }));
    return { shifts, leave, comp };
  }
  return unwrap(await gas.getTodayWork(date, token()), EMPTY_TODAY);
}

// --- 従業員ホーム ---
// プロフィール・勤怠・文書・本日の勤務を1リクエスト(バッチ)でまとめて取得する。
export interface StaffHomeData { staff: Staff | null; attendance: AttendanceRecord[]; documents: DocumentItem[]; today: TodayWork }
export async function getStaffHomeData(month: string): Promise<StaffHomeData> {
  const date = todayStr();
  if (!USE_GAS) {
    return {
      staff: local.getStaff(staffId()), attendance: local.listAttendance(staffId(), month),
      documents: local.listDocuments(), today: await getTodayWork(date),
    };
  }
  const r = await batchCall([
    { action: 'getMyProfile' }, { action: 'getMyAttendance', month }, { action: 'getDocuments' }, { action: 'getTodayWork', date },
  ]);
  if (r) {
    const staff = unwrap(r[0] as SubRes<Staff | null>, null);
    if (staff) cacheSet('myProfile', staff); // 他画面の getMyProfile もキャッシュから即返せるようにする
    return {
      staff,
      attendance: unwrap(r[1] as SubRes<AttendanceRecord[]>, []),
      documents: unwrap(r[2] as SubRes<DocumentItem[]>, []),
      today: unwrap(r[3] as SubRes<TodayWork>, EMPTY_TODAY),
    };
  }
  const [staff, attendance, documents, today] = await Promise.all([getMyProfile(), getMyAttendance(month), listDocuments(), getTodayWork(date)]);
  return { staff, attendance, documents, today };
}
