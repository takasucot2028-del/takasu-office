// ============================================
// GAS Web App 通信レイヤー
// data.ts からのみ呼ばれる。各関数は ApiResponse を返す。
// ============================================
import type {
  Staff, AttendanceRecord, LeaveRecord,
  ShiftPattern, AvailabilityRecord, ConfirmedShift, WorkLocation,
  OvertimeRecord, CompLeaveUse,
} from '../types';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  token?: string;
}

// GAS Web App URL（デプロイ後に GitHub Actions の変数 VITE_GAS_URL で設定）
const API_BASE = import.meta.env.VITE_GAS_URL || '';

async function request<T>(action: string, payload?: Record<string, unknown>): Promise<ApiResponse<T>> {
  if (!API_BASE) {
    console.warn('GAS URLが未設定です。デモモードで動作します。');
    return { success: false, error: 'API未設定' };
  }
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // プリフライト回避のため text/plain
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// === 認証 ===
export const adminLogin = (email: string, password: string) =>
  request<never>('adminLogin', { email, password });

export const changePassword = (token: string, oldPassword: string, newPassword: string) =>
  request<void>('changePassword', { token, oldPassword, newPassword });

// === 職員 ===
export const getStaff = (token: string) =>
  request<Staff[]>('getStaff', { token });

export const upsertStaff = (staff: Staff, token: string) =>
  request<Staff>('upsertStaff', { staff, token });

// === 勤怠 ===
export const getAttendance = (staffId: string, month: string, token: string) =>
  request<AttendanceRecord[]>('getAttendance', { staffId, month, token });

export const saveMonthAttendance = (
  staffId: string, month: string, records: AttendanceRecord[], token: string
) => request<void>('saveMonthAttendance', { staffId, month, records, token });

// === シフト区分マスタ ===
export const getShiftPatterns = (token: string) =>
  request<ShiftPattern[]>('getShiftPatterns', { token });

export const saveShiftPatterns = (patterns: ShiftPattern[], token: string) =>
  request<{ saved: number }>('saveShiftPatterns', { patterns, token });

// === シフト希望（○×） ===
export const getAvailabilityMonth = (month: string, token: string) =>
  request<AvailabilityRecord[]>('getAvailabilityMonth', { month, token });

export const saveMonthAvailability = (
  month: string, staffIds: string[], records: AvailabilityRecord[], token: string
) => request<void>('saveMonthAvailability', { month, staffIds, records, token });

// === 確定シフト ===
export const getConfirmedMonth = (month: string, token: string) =>
  request<ConfirmedShift[]>('getConfirmedMonth', { month, token });

export const saveMonthConfirmed = (
  month: string, location: WorkLocation, records: ConfirmedShift[], token: string
) => request<void>('saveMonthConfirmed', { month, location, records, token });

// === 時間外・休日勤務 ===
export const getOvertimeMonth = (month: string, token: string) =>
  request<OvertimeRecord[]>('getOvertimeMonth', { month, token });

export const getOvertimeByStaff = (staffId: string, token: string) =>
  request<OvertimeRecord[]>('getOvertimeByStaff', { staffId, token });

export const saveMonthOvertime = (
  staffId: string, month: string, records: OvertimeRecord[], token: string
) => request<void>('saveMonthOvertime', { staffId, month, records, token });

// === 代休取得（消化） ===
export const getCompUse = (staffId: string, token: string) =>
  request<CompLeaveUse[]>('getCompUse', { staffId, token });

export const addCompUse = (record: CompLeaveUse, token: string) =>
  request<void>('addCompUse', { record, token });

export const deleteCompUse = (id: string, token: string) =>
  request<void>('deleteCompUse', { id, token });

// === 有給休暇 ===
export const getLeave = (staffId: string, token: string) =>
  request<LeaveRecord[]>('getLeave', { staffId, token });

export const addLeave = (record: LeaveRecord, token: string) =>
  request<void>('addLeave', { record, token });

export const deleteLeave = (id: string, token: string) =>
  request<void>('deleteLeave', { id, token });
