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
import { DEFAULT_SHIFT_PATTERNS, LEAVE_HOURS_PER_DAY } from '../utils/constants';
import * as local from '../utils/store';
import * as gas from './client';
import type { ExpenseContext } from './client';

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
  if (!USE_GAS) return local.getStaff(staffId());
  const res = await gas.getMyProfile(token());
  return res.success ? (res.data ?? null) : null;
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
  if (!USE_GAS) {
    local.addOvertime({
      id: local.genId('ot'), staffId: staffId(), date: record.date || '', kind: record.kind || 'overtime',
      appliedHours: record.appliedHours || 0, reason: record.reason || '',
      status: 'applied', disposition: '', resultHours: 0, note: '',
    });
    return;
  }
  const res = await gas.addMyOvertime(record, token());
  if (!res.success) throw new Error(res.error || '時間外申請に失敗しました');
}

export async function getMyLeave(): Promise<LeaveRecord[]> {
  if (!USE_GAS) return local.listLeave(staffId());
  return unwrap(await gas.getMyLeave(token()), []);
}
export async function addMyLeaveRequest(record: Partial<LeaveRecord>): Promise<void> {
  if (!USE_GAS) {
    local.addLeave({
      id: local.genId('lv'), staffId: staffId(), kind: 'use', date: record.date || '',
      days: record.days || 0, hours: record.hours || 0, status: 'requested', note: record.note || '',
    });
    return;
  }
  const res = await gas.addMyLeaveRequest(record, token());
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
  if (!USE_GAS) { local.setStaffPassword(sid, password); return; }
  const res = await gas.setStaffPassword(sid, password, token());
  if (!res.success) throw new Error(res.error || 'パスワードの設定に失敗しました');
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
  if (!USE_GAS) return local.listExpenseCategories();
  const res = await gas.getExpenseCategories(token());
  // GAS が空なら フロントの既定費目にフォールバック
  return res.success && res.data && res.data.length ? res.data : local.listExpenseCategories();
}
export async function saveExpenseCategories(categories: ExpenseCategory[]): Promise<void> {
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
export async function addMyExpense(record: Partial<Expense>): Promise<void> {
  if (!USE_GAS) {
    local.addExpense({
      id: local.genId('ex'), fiscalYear: Number(record.fiscalYear) || 0, staffId: staffId(),
      date: record.date || '', project: record.project || '', categoryId: record.categoryId || '',
      amount: Number(record.amount) || 0, description: record.description || '',
      status: 'requested', note: '',
    });
    return;
  }
  const res = await gas.addMyExpense(record, token());
  if (!res.success) throw new Error(res.error || '経費申請に失敗しました');
}

// === 職員 ===
export async function listStaff(): Promise<Staff[]> {
  if (!USE_GAS) return local.listStaff();
  const staff = unwrap(await gas.getStaff(token()), []);
  return staff.slice().sort((a, b) => (a.lastKana || '').localeCompare(b.lastKana || '', 'ja'));
}

export async function getStaff(id: string): Promise<Staff | null> {
  if (!USE_GAS) return local.getStaff(id);
  const staff = await listStaff();
  return staff.find(s => s.id === id) ?? null;
}

export async function upsertStaff(staff: Staff): Promise<Staff> {
  if (!USE_GAS) return local.upsertStaff(staff);
  const res = await gas.upsertStaff(staff, token());
  if (!res.success) throw new Error(res.error || '職員情報の保存に失敗しました');
  return res.data ?? staff;
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
export async function listShiftPatterns(): Promise<ShiftPattern[]> {
  if (!USE_GAS) return local.listShiftPatterns();
  const list = unwrap(await gas.getShiftPatterns(token()), [] as ShiftPattern[]);
  const use = list.length ? list : DEFAULT_SHIFT_PATTERNS;
  return use.slice().sort((a, b) => a.order - b.order);
}

export async function saveShiftPatterns(patterns: ShiftPattern[]): Promise<void> {
  if (!USE_GAS) { local.saveShiftPatterns(patterns); return; }
  const res = await gas.saveShiftPatterns(patterns, token());
  if (!res.success) throw new Error(res.error || 'シフト区分の保存に失敗しました');
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
