import type { EmploymentType, StaffStatus, AttendanceDayType, WorkLocation, ShiftPattern, Staff } from '../types';

// 事務局デモアカウント
export const ADMIN_EMAIL = 'admin@takasu-sc.jp';
export const ADMIN_PASSWORD = 'admin123';

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  fulltime: '常勤職員',
  parttime: 'パート・アルバイト',
  instructor: '指導員',
  contract: '業務委託',
};

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: '在職',
  retired: '退職',
};

export const WORK_LOCATION_LABELS: Record<WorkLocation, string> = {
  sotai: '総体',
  kaiyo: '海洋センター',
};

/** 職員の勤務場所ラベル（両方=both・未設定=空 に対応） */
export function workLocationLabel(loc: '' | WorkLocation | 'both'): string {
  if (loc === 'both') return '総体・海洋センター';
  if (loc === '') return '';
  return WORK_LOCATION_LABELS[loc];
}

/** 職員がその勤務場所のシフト表に出るか（both は両方に出る） */
export function staffInLocation(workLocation: '' | WorkLocation | 'both', location: WorkLocation): boolean {
  return workLocation === location || workLocation === 'both';
}

/** シフト区分の初期セット（区分マスタが空のときのフォールバック。事務局が編集可能） */
export const DEFAULT_SHIFT_PATTERNS: ShiftPattern[] = [
  { id: 'p1', name: '①', startTime: '08:30', endTime: '13:00', order: 1, location: '' },
  { id: 'p2', name: '②', startTime: '12:45', endTime: '17:15', order: 2, location: '' },
  { id: 'p3', name: '③', startTime: '17:00', endTime: '21:15', order: 3, location: '' },
  { id: 'p4', name: '④', startTime: '17:00', endTime: '19:15', order: 4, location: 'kaiyo' },
];

// ==== 有給休暇の標準付与 ====
export const LEAVE_HOURS_PER_DAY = 7.5;      // 1日の勤務時間（時間単位取得の換算に使用）
export const FULLTIME_LEAVE_DAYS = 10;       // 常勤の標準付与日数
export const PARTTIME_LEAVE_DAYS = 5;        // パートの標準付与日数
export const PARTTIME_ELIGIBLE_MONTHS = 6;   // パートが付与可能になるまでの月数（雇用開始から）

/** 日付文字列(YYYY-MM-DD)に月を加算した日付 */
export function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 標準付与の判定（today は YYYY-MM-DD）。常勤=10日／パート=6か月経過後に5日 */
export function standardLeaveGrant(staff: Staff, today: string): { eligible: boolean; days: number; reason?: string } {
  if (staff.employmentType === 'fulltime') {
    return { eligible: true, days: FULLTIME_LEAVE_DAYS };
  }
  if (staff.employmentType === 'parttime') {
    if (!staff.hireDate) return { eligible: false, days: 0, reason: '入職日が未設定のため付与できません' };
    const eligibleFrom = addMonths(staff.hireDate, PARTTIME_ELIGIBLE_MONTHS);
    if (today >= eligibleFrom) return { eligible: true, days: PARTTIME_LEAVE_DAYS };
    return { eligible: false, days: 0, reason: `雇用開始から6か月経過後（${eligibleFrom}）に付与できます` };
  }
  return { eligible: false, days: 0, reason: '標準付与の対象は常勤職員・パート職員です' };
}

export const DAY_TYPE_LABELS: Record<AttendanceDayType, string> = {
  work: '出勤',
  paid: '有給',
  absent: '欠勤',
};

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
