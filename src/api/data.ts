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
  OvertimeRecord, CompLeaveUse,
} from '../types';
import { DEFAULT_SHIFT_PATTERNS, LEAVE_HOURS_PER_DAY } from '../utils/constants';
import * as local from '../utils/store';
import * as gas from './client';

const USE_GAS = !!import.meta.env.VITE_GAS_URL;

/** GAS を使う構成かどうか（UI表示の切り替え用） */
export const usingGas = USE_GAS;

// セッションのトークン（GAS の各APIに付与する）
function token(): string {
  return sessionStorage.getItem('tof_token') || '';
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
  const grantedHours = records.filter(r => r.kind === 'grant').reduce((s, r) => s + toHours(r), 0);
  const usedHours = records.filter(r => r.kind === 'use').reduce((s, r) => s + toHours(r), 0);
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
