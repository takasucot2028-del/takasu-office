// デモ用localStorageデータストア（将来はGAS APIに差し替える）
import type {
  Staff, AttendanceRecord, LeaveRecord, WorkLocation,
  ShiftPattern, AvailabilityRecord, ConfirmedShift,
  OvertimeRecord, CompLeaveUse, DocumentItem,
  ExpenseCategory, Budget, Expense, RequestStatus, ShiftChange,
} from '../types';
import { ADMIN_EMAIL, ADMIN_PASSWORD, DEFAULT_SHIFT_PATTERNS, DEFAULT_EXPENSE_CATEGORIES, breakMinutesBetween } from './constants';

const KEY_STAFF = 'tof_staff';
const KEY_ATTENDANCE = 'tof_attendance';
const KEY_LEAVE = 'tof_leave';
const KEY_SHIFT_PATTERNS = 'tof_shift_patterns';
const KEY_AVAILABILITY = 'tof_availability';
const KEY_CONFIRMED = 'tof_confirmed';
const KEY_OVERTIME = 'tof_overtime';
const KEY_COMP_USE = 'tof_comp_use';
const KEY_DOCUMENTS = 'tof_documents';
const KEY_EXP_CATEGORIES = 'tof_exp_categories';
const KEY_BUDGETS = 'tof_budgets';
const KEY_EXPENSES = 'tof_expenses';
const KEY_SEEDED = 'tof_seeded';

function load<T>(key: string): T[] {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T[]) : [];
  } catch {
    return [];
  }
}

function save<T>(key: string, items: T[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

export function genId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** ローカル時刻での今日（YYYY-MM-DD）。toISOStringはUTCのため日本では日付がずれることがある */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- 認証 ----

const KEY_ADMIN_PW = 'tof_admin_pw'; // デモモードで変更後のパスワードを保持（平文・デモ専用）

function currentAdminPassword(): string {
  return localStorage.getItem(KEY_ADMIN_PW) || ADMIN_PASSWORD;
}

export function verifyAdmin(email: string, password: string): boolean {
  return email === ADMIN_EMAIL && password === currentAdminPassword();
}

/** デモモードのパスワード変更（現在のパスワード照合が必須） */
export function changeAdminPassword(oldPassword: string, newPassword: string): void {
  if (oldPassword !== currentAdminPassword()) {
    throw new Error('現在のパスワードが正しくありません');
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error('新しいパスワードは6文字以上で入力してください');
  }
  localStorage.setItem(KEY_ADMIN_PW, newPassword);
}

// ---- 職員 ----

export function listStaff(): Staff[] {
  seedDemo();
  const pw = staffPwMap();
  return load<Staff>(KEY_STAFF)
    .map(s => ({ ...s, hasPassword: !!pw[s.id] }))
    .sort((a, b) => a.lastKana.localeCompare(b.lastKana, 'ja'));
}

export function getStaff(id: string): Staff | null {
  return listStaff().find(s => s.id === id) ?? null;
}

export function upsertStaff(staff: Staff): Staff {
  const all = load<Staff>(KEY_STAFF);
  const now = new Date().toISOString();
  const idx = all.findIndex(s => s.id === staff.id);
  const next = { ...staff, updatedAt: now };
  if (idx >= 0) {
    all[idx] = next;
  } else {
    next.createdAt = now;
    all.push(next);
  }
  save(KEY_STAFF, all);
  return next;
}

// ---- 勤怠 ----

/** month: 'YYYY-MM' */
export function listAttendance(staffId: string, month: string): AttendanceRecord[] {
  return load<AttendanceRecord>(KEY_ATTENDANCE).filter(
    r => r.staffId === staffId && r.date.startsWith(month)
  );
}

/** 指定職員・指定月の勤怠を丸ごと差し替える */
export function saveMonthAttendance(staffId: string, month: string, records: AttendanceRecord[]) {
  const others = load<AttendanceRecord>(KEY_ATTENDANCE).filter(
    r => !(r.staffId === staffId && r.date.startsWith(month))
  );
  save(KEY_ATTENDANCE, [...others, ...records]);
}

// ---- シフト区分マスタ ----

export function listShiftPatterns(): ShiftPattern[] {
  const saved = load<ShiftPattern>(KEY_SHIFT_PATTERNS);
  const list = saved.length ? saved : DEFAULT_SHIFT_PATTERNS;
  return list.slice().sort((a, b) => a.order - b.order);
}

export function saveShiftPatterns(patterns: ShiftPattern[]) {
  save(KEY_SHIFT_PATTERNS, patterns);
}

// ---- シフト希望（○×・人単位） ----

/** month: 'YYYY-MM' */
export function listAvailabilityByMonth(month: string): AvailabilityRecord[] {
  return load<AvailabilityRecord>(KEY_AVAILABILITY).filter(r => r.date.startsWith(month));
}

/** 指定職員群・指定月の希望を丸ごと差し替える（表に出ている職員のみ更新） */
export function saveMonthAvailability(month: string, staffIds: string[], records: AvailabilityRecord[]) {
  const ids = new Set(staffIds);
  const others = load<AvailabilityRecord>(KEY_AVAILABILITY).filter(
    r => !(r.date.startsWith(month) && ids.has(r.staffId))
  );
  save(KEY_AVAILABILITY, [...others, ...records]);
}

// ---- 確定シフト（職員×日×勤務場所） ----

export function listConfirmedByMonth(month: string): ConfirmedShift[] {
  return load<ConfirmedShift>(KEY_CONFIRMED).filter(r => r.date.startsWith(month));
}

export function listConfirmedByDate(date: string): ConfirmedShift[] {
  return load<ConfirmedShift>(KEY_CONFIRMED).filter(r => r.date === date);
}

/** 指定勤務場所・指定月の確定シフトを丸ごと差し替える */
export function saveMonthConfirmed(month: string, location: WorkLocation, records: ConfirmedShift[]) {
  const all = load<ConfirmedShift>(KEY_CONFIRMED);
  const isTarget = (r: ConfirmedShift) => r.date.startsWith(month) && r.location === location;
  const others = all.filter(r => !isTarget(r));
  recordShiftChanges(location, all.filter(isTarget), records); // 変更を履歴に残す
  save(KEY_CONFIRMED, [...others, ...records]);
}

// ---- シフト変更履歴（従業員への通知） ----
const KEY_SHIFT_CHANGES = 'tof_shift_changes';

/** 確定シフトの置き換え前後を比較し、職員ごとの変更を履歴に追加する */
export function recordShiftChanges(
  location: WorkLocation,
  oldList: ConfirmedShift[],
  newList: ConfirmedShift[]
) {
  const patName = new Map(listShiftPatterns().map(p => [p.id, p.name]));
  const label = (ids: string[]) => (ids.length ? ids.map(id => patName.get(id) || id).join(' ') : 'なし');
  const group = (list: ConfirmedShift[]) => {
    const m = new Map<string, string[]>();
    for (const r of list) {
      const key = `${r.staffId}|${r.date}`;
      m.set(key, [...(m.get(key) || []), r.patternId].sort());
    }
    return m;
  };
  const before = group(oldList), after = group(newList);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const d = new Date();
  const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const added: ShiftChange[] = [];
  for (const k of keys) {
    const b = before.get(k) || [], a = after.get(k) || [];
    if (b.join(',') === a.join(',')) continue;
    const [staffId, date] = k.split('|');
    added.push({ id: genId('sc'), staffId, date, location, before: label(b), after: label(a), changedAt: now, readAt: '' });
  }
  if (added.length) save(KEY_SHIFT_CHANGES, [...load<ShiftChange>(KEY_SHIFT_CHANGES), ...added]);
}

/** 自分の未確認のシフト変更（新しい順） */
export function listMyShiftChanges(staffId: string): ShiftChange[] {
  return load<ShiftChange>(KEY_SHIFT_CHANGES)
    .filter(r => r.staffId === staffId && !r.readAt)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}

/** 自分のシフト変更をすべて確認済みにする */
export function markShiftChangesReadLocal(staffId: string) {
  const d = new Date();
  const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  save(KEY_SHIFT_CHANGES, load<ShiftChange>(KEY_SHIFT_CHANGES).map(r => (r.staffId === staffId && !r.readAt ? { ...r, readAt: now } : r)));
}

// ---- 従業員ログイン（デモ。パスワードは平文でlocalStorage・デモ専用） ----
const KEY_STAFF_PW = 'tof_staff_pw';
function staffPwMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY_STAFF_PW) || '{}'); } catch { return {}; }
}
export function setStaffPassword(staffId: string, password: string) {
  if (!password || password.length < 4) throw new Error('パスワードは4文字以上で入力してください');
  const m = staffPwMap(); m[staffId] = password; localStorage.setItem(KEY_STAFF_PW, JSON.stringify(m));
}
export function staffHasPassword(staffId: string): boolean {
  return !!staffPwMap()[staffId];
}
export function verifyStaffLogin(employeeNumber: string, password: string): Staff | null {
  const num = (employeeNumber || '').trim();
  const staff = listStaff().find(s => (s.employeeNumber || '').trim() === num && s.status !== 'retired');
  if (!staff) return null;
  if (staffPwMap()[staff.id] !== password) return null;
  return staff;
}
export function staffChangePasswordLocal(staffId: string, oldPw: string, newPw: string) {
  const m = staffPwMap();
  if (m[staffId] !== oldPw) throw new Error('現在のパスワードが正しくありません');
  if (!newPw || newPw.length < 4) throw new Error('パスワードは4文字以上で入力してください');
  m[staffId] = newPw; localStorage.setItem(KEY_STAFF_PW, JSON.stringify(m));
}

// 打刻（出勤=in / 退勤=out）
export function punchLocal(staffId: string, type: 'in' | 'out'): { date: string; time: string; punchType: 'in' | 'out' } {
  const date = todayStr();
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const all = load<AttendanceRecord>(KEY_ATTENDANCE);
  let rec = all.find(r => r.staffId === staffId && r.date === date);
  if (!rec) {
    rec = { id: `${staffId}_${date}`, staffId, date, dayType: 'work', startTime: type === 'in' ? time : '', endTime: type === 'out' ? time : '', breakMinutes: 0, note: '' };
    all.push(rec);
  } else {
    if (type === 'in') rec.startTime = time; else rec.endTime = time;
    rec.dayType = 'work';
  }
  save(KEY_ATTENDANCE, all);
  return { date, time, punchType: type };
}

// 従業員が当日の休憩を時刻（開始〜終了）で入力・保存する
export function setMyBreakLocal(staffId: string, breakStart: string, breakEnd: string): { date: string; breakMinutes: number; breakStart: string; breakEnd: string } {
  const date = todayStr();
  const mins = breakMinutesBetween(breakStart, breakEnd);
  const all = load<AttendanceRecord>(KEY_ATTENDANCE);
  let rec = all.find(r => r.staffId === staffId && r.date === date);
  if (!rec) {
    rec = { id: `${staffId}_${date}`, staffId, date, dayType: 'work', startTime: '', endTime: '', breakMinutes: mins, breakStart, breakEnd, note: '' };
    all.push(rec);
  } else {
    rec.breakMinutes = mins; rec.breakStart = breakStart; rec.breakEnd = breakEnd;
  }
  save(KEY_ATTENDANCE, all);
  return { date, breakMinutes: mins, breakStart, breakEnd };
}

// ---- 時間外・休日勤務 ----

/** 1件追加（従業員の時間外申請用） */
export function addOvertime(record: OvertimeRecord) {
  const all = load<OvertimeRecord>(KEY_OVERTIME);
  all.push(record);
  save(KEY_OVERTIME, all);
}

export function listOvertimeByMonth(month: string): OvertimeRecord[] {
  return load<OvertimeRecord>(KEY_OVERTIME).filter(r => r.date.startsWith(month));
}

export function listOvertimeFiscalYear(fiscalYear: number): OvertimeRecord[] {
  const from = `${fiscalYear}-04-01`, to = `${fiscalYear + 1}-03-31`;
  return load<OvertimeRecord>(KEY_OVERTIME).filter(r => r.date >= from && r.date <= to);
}

export function listOvertimeByStaff(staffId: string): OvertimeRecord[] {
  return load<OvertimeRecord>(KEY_OVERTIME).filter(r => r.staffId === staffId);
}

/** 指定職員・指定月の時間外を丸ごと差し替える */
export function saveMonthOvertime(staffId: string, month: string, records: OvertimeRecord[]) {
  const others = load<OvertimeRecord>(KEY_OVERTIME).filter(
    r => !(r.staffId === staffId && r.date.startsWith(month))
  );
  save(KEY_OVERTIME, [...others, ...records]);
}

/** 指定日の休暇（有給取得・代休取得）を全職員分まとめて返す */
export function listAbsencesByDate(date: string): { leave: LeaveRecord[]; comp: CompLeaveUse[] } {
  const leave = load<LeaveRecord>(KEY_LEAVE).filter(r => r.date === date && r.kind === 'use');
  const comp = load<CompLeaveUse>(KEY_COMP_USE).filter(r => r.date === date);
  return { leave, comp };
}

// ---- 代休取得（消化） ----

export function listCompUse(staffId: string): CompLeaveUse[] {
  return load<CompLeaveUse>(KEY_COMP_USE)
    .filter(r => r.staffId === staffId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function addCompUse(record: CompLeaveUse) {
  const all = load<CompLeaveUse>(KEY_COMP_USE);
  all.push(record);
  save(KEY_COMP_USE, all);
}

export function deleteCompUse(id: string) {
  save(KEY_COMP_USE, load<CompLeaveUse>(KEY_COMP_USE).filter(r => r.id !== id));
}

// ---- 文書管理 ----

export function listDocuments(): DocumentItem[] {
  seedDemo();
  return load<DocumentItem>(KEY_DOCUMENTS).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function upsertDocument(doc: DocumentItem): DocumentItem {
  const all = load<DocumentItem>(KEY_DOCUMENTS);
  const now = new Date().toISOString();
  const idx = all.findIndex(d => d.id === doc.id);
  const next = { ...doc, updatedAt: now };
  if (idx >= 0) { all[idx] = { ...next, createdAt: all[idx].createdAt }; }
  else { next.createdAt = now; all.push(next); }
  save(KEY_DOCUMENTS, all);
  return next;
}

export function deleteDocument(id: string) {
  save(KEY_DOCUMENTS, load<DocumentItem>(KEY_DOCUMENTS).filter(d => d.id !== id));
}

// ---- 有給休暇 ----

/** 全職員の有給記録（未承認件数の集計に使う） */
export function listAllLeave(): LeaveRecord[] {
  return load<LeaveRecord>(KEY_LEAVE);
}

export function listLeave(staffId: string): LeaveRecord[] {
  return load<LeaveRecord>(KEY_LEAVE)
    .filter(r => r.staffId === staffId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function addLeave(record: LeaveRecord) {
  const all = load<LeaveRecord>(KEY_LEAVE);
  all.push(record);
  save(KEY_LEAVE, all);
}

export function deleteLeave(id: string) {
  save(KEY_LEAVE, load<LeaveRecord>(KEY_LEAVE).filter(r => r.id !== id));
}

/** 休暇申請の状態を更新（承認/却下） */
export function setLeaveStatus(id: string, status: LeaveRecord['status']) {
  const all = load<LeaveRecord>(KEY_LEAVE);
  const r = all.find(x => x.id === id);
  if (r) { r.status = status; save(KEY_LEAVE, all); }
}

/** 残日数 = 付与合計 - 取得合計 */
export function leaveBalance(staffId: string): { granted: number; used: number; balance: number } {
  const records = listLeave(staffId);
  const granted = records.filter(r => r.kind === 'grant').reduce((s, r) => s + r.days, 0);
  const used = records.filter(r => r.kind === 'use').reduce((s, r) => s + r.days, 0);
  return { granted, used, balance: granted - used };
}

// ---- 会計：費目マスタ ----
export function listExpenseCategories(): ExpenseCategory[] {
  const saved = load<ExpenseCategory>(KEY_EXP_CATEGORIES);
  return (saved.length ? saved : DEFAULT_EXPENSE_CATEGORIES).slice().sort((a, b) => a.order - b.order);
}
export function saveExpenseCategories(cats: ExpenseCategory[]) {
  save(KEY_EXP_CATEGORIES, cats);
}

// ---- 会計：予算（年度×事業×費目） ----
export function listBudgets(fiscalYear: number): Budget[] {
  return load<Budget>(KEY_BUDGETS).filter(b => Number(b.fiscalYear) === fiscalYear);
}
/** 指定年度の予算を丸ごと置換 */
export function saveBudgets(fiscalYear: number, records: Budget[]) {
  const others = load<Budget>(KEY_BUDGETS).filter(b => Number(b.fiscalYear) !== fiscalYear);
  save(KEY_BUDGETS, [...others, ...records]);
}

// ---- 会計：経費 ----
export function listExpenses(fiscalYear: number): Expense[] {
  return load<Expense>(KEY_EXPENSES)
    .filter(e => Number(e.fiscalYear) === fiscalYear)
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function listMyExpenses(staffId: string): Expense[] {
  return load<Expense>(KEY_EXPENSES)
    .filter(e => e.staffId === staffId)
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function addExpense(record: Expense) {
  const all = load<Expense>(KEY_EXPENSES);
  all.push(record);
  save(KEY_EXPENSES, all);
}
export function setExpenseStatus(id: string, status: RequestStatus) {
  const all = load<Expense>(KEY_EXPENSES);
  const r = all.find(x => x.id === id);
  if (r) { r.status = status; save(KEY_EXPENSES, all); }
}
export function deleteExpense(id: string) {
  save(KEY_EXPENSES, load<Expense>(KEY_EXPENSES).filter(e => e.id !== id));
}

// ---- デモデータ ----

function seedDemo() {
  const seeded = localStorage.getItem(KEY_SEEDED);
  if (seeded === '7') return;
  if (seeded) {
    // 既存データに不足フィールドを補う（勤務場所・時給・職員番号・月間上限）
    const locDefaults: Record<string, WorkLocation> = { stf001: 'sotai', stf002: 'sotai', stf003: 'kaiyo' };
    const migrated = load<Staff>(KEY_STAFF).map(s => ({
      ...s,
      workLocation: s.workLocation ?? locDefaults[s.id] ?? '',
      hourlyWage: typeof s.hourlyWage === 'number' ? s.hourlyWage : 0,
      monthlyHourLimit: typeof s.monthlyHourLimit === 'number' ? s.monthlyHourLimit : 0,
      employeeNumber: s.employeeNumber ?? '',
    }));
    save(KEY_STAFF, migrated);
    localStorage.setItem(KEY_SEEDED, '7');
    return;
  }
  const now = new Date().toISOString();
  const demo: Staff[] = [
    {
      id: 'stf001', employeeNumber: '1001',
      lastName: '高須', firstName: '太郎', lastKana: 'タカス', firstKana: 'タロウ',
      birthDate: '1975-04-10',
      employmentType: 'fulltime', workLocation: 'sotai', position: '事務局長',
      hireDate: '2015-04-01', retireDate: '', status: 'active',
      phone: '0166-87-1111', email: 'taro@takasu-sc.jp',
      address: '北海道上川郡鷹栖町南1条2丁目', qualifications: 'スポーツ指導員',
      hourlyWage: 1500, monthlyHourLimit: 0, childNursingChildren: 2, weeklyWorkDays: 5, note: '', createdAt: now, updatedAt: now,
    },
    {
      id: 'stf002', employeeNumber: '1002',
      lastName: '鈴木', firstName: '花子', lastKana: 'スズキ', firstKana: 'ハナコ',
      birthDate: '1988-09-22',
      employmentType: 'parttime', workLocation: 'sotai', position: '事務員',
      hireDate: '2020-06-01', retireDate: '', status: 'active',
      phone: '0166-87-2222', email: 'hanako@takasu-sc.jp',
      address: '北海道上川郡鷹栖町北3条4丁目', qualifications: '簿記2級',
      hourlyWage: 1100, monthlyHourLimit: 88, childNursingChildren: 0, weeklyWorkDays: 4, note: '週4日勤務', createdAt: now, updatedAt: now,
    },
    {
      id: 'stf003', employeeNumber: '1003',
      lastName: '佐藤', firstName: '健', lastKana: 'サトウ', firstKana: 'ケン',
      birthDate: '1992-01-15',
      employmentType: 'instructor', workLocation: 'kaiyo', position: '水泳教室 指導員',
      hireDate: '2022-04-01', retireDate: '', status: 'active',
      phone: '090-1234-5678', email: 'ken@example.com',
      address: '北海道旭川市', qualifications: '水泳指導員資格',
      hourlyWage: 1200, monthlyHourLimit: 0, childNursingChildren: 0, weeklyWorkDays: 2, note: '', createdAt: now, updatedAt: now,
    },
  ];
  save(KEY_STAFF, demo);
  const leaves: LeaveRecord[] = [
    { id: 'lv001', staffId: 'stf001', kind: 'grant', date: '2025-10-01', days: 20, hours: 0, status: 'approved', note: '年次付与' },
    { id: 'lv002', staffId: 'stf001', kind: 'use', date: '2026-01-09', days: 1, hours: 0, status: 'approved', note: '' },
    { id: 'lv003', staffId: 'stf002', kind: 'grant', date: '2025-12-01', days: 12, hours: 0, status: 'approved', note: '年次付与' },
  ];
  save(KEY_LEAVE, leaves);
  const nowIso = new Date().toISOString();
  const docs: DocumentItem[] = [
    { id: 'doc1', type: 'rule', title: '就業規則', url: 'https://drive.google.com/', createdAt: nowIso, updatedAt: nowIso },
    { id: 'doc2', type: 'form', title: '休暇届（様式）', url: 'https://drive.google.com/', createdAt: nowIso, updatedAt: nowIso },
    { id: 'doc3', type: 'form', title: '時間外勤務命令書（様式）', url: 'https://drive.google.com/', createdAt: nowIso, updatedAt: nowIso },
  ];
  save(KEY_DOCUMENTS, docs);
  // デモの従業員ログイン用パスワード（職員番号1001〜1003、パスワードは全員 1234）
  localStorage.setItem(KEY_STAFF_PW, JSON.stringify({ stf001: '1234', stf002: '1234', stf003: '1234' }));
  localStorage.setItem(KEY_SEEDED, '7');
}
