// ============================================
// 統一データアクセス層
// VITE_GAS_URL が設定されていれば GAS Web App（データ共有）、
// 未設定ならば localStorage（デモモード）に切り替える。
// 全関数は Promise を返す（非同期統一）。
// ページはこの層だけを参照し、バックエンドの差異を意識しない。
// ============================================
import type { Staff, AttendanceRecord, LeaveRecord, Shift } from '../types';
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

/** 有給の残数を記録配列から計算（付与合計 - 取得合計） */
export function computeLeaveBalance(records: LeaveRecord[]): { granted: number; used: number; balance: number } {
  const granted = records.filter(r => r.kind === 'grant').reduce((s, r) => s + r.days, 0);
  const used = records.filter(r => r.kind === 'use').reduce((s, r) => s + r.days, 0);
  return { granted, used, balance: granted - used };
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

// === シフト ===
export async function listShiftsByDate(date: string): Promise<Shift[]> {
  if (!USE_GAS) return local.listShiftsByDate(date);
  return unwrap(await gas.getShiftsByDate(date, token()), []);
}

export async function addShift(shift: Shift): Promise<void> {
  if (!USE_GAS) { local.addShift(shift); return; }
  const res = await gas.addShift(shift, token());
  if (!res.success) throw new Error(res.error || 'シフトの登録に失敗しました');
}

export async function deleteShift(id: string): Promise<void> {
  if (!USE_GAS) { local.deleteShift(id); return; }
  const res = await gas.deleteShift(id, token());
  if (!res.success) throw new Error(res.error || 'シフトの削除に失敗しました');
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
