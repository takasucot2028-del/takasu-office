// ============================================
// GAS Web App 通信レイヤー
// data.ts からのみ呼ばれる。各関数は ApiResponse を返す。
// ============================================
import type {
  Staff, AttendanceRecord, LeaveRecord,
  ShiftPattern, AvailabilityRecord, ConfirmedShift, WorkLocation,
  OvertimeRecord, CompLeaveUse, RequestStatus, DocumentItem,
  ExpenseCategory, Budget, Expense, ShiftChange,
} from '../types';

/** 本日の勤務・休暇（従業員も閲覧可。氏名・時間のみ、個人情報は含まない） */
export interface TodayWorkShift {
  location: WorkLocation; staffName: string; patternName: string; startTime: string; endTime: string; order: number;
}
export interface TodayWorkAbsence { staffName: string; days?: number; hours: number; note: string }
export interface TodayWork { shifts: TodayWorkShift[]; leave: TodayWorkAbsence[]; comp: TodayWorkAbsence[] }

/** 未承認（要対応）の申請1件（誰の・いつ・何の申請か） */
export interface PendingItem {
  type: 'overtime' | 'leave' | 'expense';
  staffName: string;
  date: string;
  detail: string;
}
/** 未承認（要対応）の申請件数と明細 */
export interface PendingSummary {
  expenses: number; overtime: number; leave: number;
  items?: PendingItem[];
}

/** 従業員の経費申請フォーム用コンテキスト（年度の予算行＋残額） */
export interface ExpenseContext {
  categories: ExpenseCategory[];
  lines: { project: string; categoryId: string; budget: number; used: number; remaining: number }[];
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  token?: string;
}

// GAS Web App URL（デプロイ後に GitHub Actions の変数 VITE_GAS_URL で設定）
const API_BASE = import.meta.env.VITE_GAS_URL || '';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// 非JSON応答（GASが稀に返す404/HTML等）や通信エラー時に安全に再試行できるアクション。
//  - 読み取り(get*)・ログイン・バッチ … 副作用なし
//  - save/upsert/set/delete … キー単位で置換/更新する冪等な書き込み（再試行しても結果は同じ）
//  - IDで冪等化した追加（GAS側が同一IDを二重登録しない）… 経費・代休・有給の登録
// 上記以外の追加系(add*)・打刻(punch)はサーバー側で重複しうるため再試行しない（業務エラーは元々再試行しない）。
const IDEMPOTENT_ADDS = new Set([
  'addExpense', 'addCompUse', 'addLeave',
  'addMyExpense', 'addMyOvertime', 'addMyLeaveRequest', // 従業員申請もクライアント採番＋GAS側冪等化済み
]);
const isRetryable = (action: string) =>
  /^(get|save|upsert|set|delete)/.test(action) || IDEMPOTENT_ADDS.has(action) || action === 'batch' || /Login$/.test(action);

async function request<T>(action: string, payload?: Record<string, unknown>): Promise<ApiResponse<T>> {
  if (!API_BASE) {
    console.warn('GAS URLが未設定です。デモモードで動作します。');
    return { success: false, error: 'API未設定' };
  }
  const attempts = isRetryable(action) ? 3 : 1; // 読み取り等は最大3回まで
  let last: ApiResponse<T> = { success: false, error: '不明なエラー' };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(400 * i); // 400ms, 800ms のバックオフ
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // プリフライト回避のため text/plain
        body: JSON.stringify({ action, ...payload }),
      });
      const text = await res.text();
      try {
        return JSON.parse(text); // 正常応答（成功/失敗どちらも即返す。業務エラーは再試行しない）
      } catch {
        console.error(`GAS応答がJSONではありません [${action}] status=${res.status} (試行${i + 1}/${attempts}):`, text.slice(0, 300));
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
        const hint = res.status >= 400
          ? `サーバーエラー(${res.status})`
          : 'サーバーがHTMLを返しました（時間をおいて再度お試しください）';
        last = { success: false, error: `${hint}: ${snippet}` };
      }
    } catch (e) {
      last = { success: false, error: `通信に失敗しました: ${String(e)}` };
    }
  }
  return last;
}

// === バッチ（1リクエストで複数処理をまとめて実行） ===
export const batch = (requests: Record<string, unknown>[], token: string) =>
  request<ApiResponse[]>('batch', { requests, token });

// === 認証 ===
export const adminLogin = (email: string, password: string) =>
  request<never>('adminLogin', { email, password });

export const changePassword = (token: string, oldPassword: string, newPassword: string) =>
  request<void>('changePassword', { token, oldPassword, newPassword });

// === 従業員ログイン・自分用 ===
export const staffLogin = (employeeNumber: string, password: string) =>
  request<Staff>('staffLogin', { employeeNumber, password });
export const getMyProfile = (token: string) => request<Staff>('getMyProfile', { token });
export const getMyAttendance = (month: string, token: string) =>
  request<AttendanceRecord[]>('getMyAttendance', { month, token });
export const punch = (punchType: 'in' | 'out', token: string) =>
  request<{ date: string; time: string; punchType: string }>('punch', { punchType, token });
export const setMyBreak = (breakStart: string, breakEnd: string, token: string) =>
  request<{ date: string; breakMinutes: number; breakStart: string; breakEnd: string }>(
    'setMyBreak', { breakStart, breakEnd, token });
export const getTodayWork = (date: string, token: string) =>
  request<TodayWork>('getTodayWork', { date, token });
export const getPendingSummary = (token: string) =>
  request<PendingSummary>('getPendingSummary', { token });
export const getMyShiftChanges = (token: string) =>
  request<ShiftChange[]>('getMyShiftChanges', { token });
export const markShiftChangesRead = (token: string) =>
  request<void>('markShiftChangesRead', { token });
export const getMyAvailability = (month: string, token: string) =>
  request<AvailabilityRecord[]>('getMyAvailability', { month, token });
export const saveMyAvailability = (month: string, records: AvailabilityRecord[], token: string) =>
  request<void>('saveMyAvailability', { month, records, token });
export const getMyOvertime = (token: string) => request<OvertimeRecord[]>('getMyOvertime', { token });
export const addMyOvertime = (record: Partial<OvertimeRecord>, token: string) =>
  request<void>('addMyOvertime', { record, token });
export const getMyLeave = (token: string) => request<LeaveRecord[]>('getMyLeave', { token });
export const addMyLeaveRequest = (record: Partial<LeaveRecord>, token: string) =>
  request<void>('addMyLeaveRequest', { record, token });
export const staffChangePassword = (token: string, oldPassword: string, newPassword: string) =>
  request<void>('staffChangePassword', { token, oldPassword, newPassword });

// === 文書管理 ===
export const getDocuments = (token: string) => request<DocumentItem[]>('getDocuments', { token });
export const saveDocument = (doc: DocumentItem, token: string) =>
  request<DocumentItem>('saveDocument', { doc, token });
export const deleteDocument = (id: string, token: string) =>
  request<void>('deleteDocument', { id, token });

// === 会計管理（事務局） ===
export const getExpenseCategories = (token: string) =>
  request<ExpenseCategory[]>('getExpenseCategories', { token });
export const saveExpenseCategories = (categories: ExpenseCategory[], token: string) =>
  request<{ saved: number }>('saveExpenseCategories', { categories, token });
export const getBudgets = (fiscalYear: number, token: string) =>
  request<Budget[]>('getBudgets', { fiscalYear, token });
export const saveBudgets = (fiscalYear: number, records: Budget[], token: string) =>
  request<void>('saveBudgets', { fiscalYear, records, token });
export const getExpenses = (fiscalYear: number, token: string) =>
  request<Expense[]>('getExpenses', { fiscalYear, token });
export const addExpense = (record: Expense, token: string) =>
  request<void>('addExpense', { record, token });
export const setExpenseStatus = (id: string, status: RequestStatus, token: string) =>
  request<void>('setExpenseStatus', { id, status, token });
export const deleteExpense = (id: string, token: string) =>
  request<void>('deleteExpense', { id, token });

// === 会計管理（従業員） ===
export const getExpenseContext = (fiscalYear: number, token: string) =>
  request<ExpenseContext>('getExpenseContext', { fiscalYear, token });
export const getMyExpenses = (token: string) =>
  request<Expense[]>('getMyExpenses', { token });
export const addMyExpense = (record: Partial<Expense>, token: string) =>
  request<void>('addMyExpense', { record, token });

// === 管理者：従業員パスワード発行・休暇承認 ===
export const setStaffPassword = (staffId: string, password: string, token: string) =>
  request<void>('setStaffPassword', { staffId, password, token });
export const setLeaveStatus = (id: string, status: RequestStatus, token: string) =>
  request<void>('setLeaveStatus', { id, status, token });

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

export const getAttendanceMonthAll = (month: string, token: string) =>
  request<AttendanceRecord[]>('getAttendanceMonthAll', { month, token });

export const getCompUseMonth = (month: string, token: string) =>
  request<CompLeaveUse[]>('getCompUseMonth', { month, token });

export const getAttendanceRange = (staffId: string, from: string, to: string, token: string) =>
  request<AttendanceRecord[]>('getAttendanceRange', { staffId, from, to, token });

export const getOvertimeFiscalYear = (fiscalYear: number, token: string) =>
  request<OvertimeRecord[]>('getOvertimeFiscalYear', { fiscalYear, token });

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

// === 本日の休暇（有給取得・代休取得） ===
export const getAbsencesByDate = (date: string, token: string) =>
  request<{ leave: LeaveRecord[]; comp: CompLeaveUse[] }>('getAbsencesByDate', { date, token });

// === 有給休暇 ===
export const getAllLeave = (token: string) =>
  request<LeaveRecord[]>('getAllLeave', { token });

export const getLeave = (staffId: string, token: string) =>
  request<LeaveRecord[]>('getLeave', { staffId, token });

export const addLeave = (record: LeaveRecord, token: string) =>
  request<void>('addLeave', { record, token });

export const deleteLeave = (id: string, token: string) =>
  request<void>('deleteLeave', { id, token });
