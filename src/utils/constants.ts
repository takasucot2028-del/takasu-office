import type { EmploymentType, StaffStatus, AttendanceDayType, WorkLocation, ShiftPattern } from '../types';

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

/** シフト区分の初期セット（区分マスタが空のときのフォールバック。事務局が編集可能） */
export const DEFAULT_SHIFT_PATTERNS: ShiftPattern[] = [
  { id: 'p1', name: '①', startTime: '08:30', endTime: '13:00', order: 1 },
  { id: 'p2', name: '②', startTime: '12:45', endTime: '17:15', order: 2 },
  { id: 'p3', name: '③', startTime: '17:00', endTime: '21:15', order: 3 },
];

export const DAY_TYPE_LABELS: Record<AttendanceDayType, string> = {
  work: '出勤',
  paid: '有給',
  absent: '欠勤',
};

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
