// 労務管理の型定義

/** 雇用区分 */
export type EmploymentType = 'fulltime' | 'parttime' | 'instructor' | 'contract';

/** 在職状況 */
export type StaffStatus = 'active' | 'retired';

/** 勤務場所 */
export type WorkLocation = 'sotai' | 'kaiyo';

/** 職員 */
export interface Staff {
  id: string;
  lastName: string;
  firstName: string;
  lastKana: string;
  firstKana: string;
  birthDate: string;          // YYYY-MM-DD
  employmentType: EmploymentType;
  workLocation: WorkLocation | '';  // 主な勤務場所（未設定は空）
  position: string;           // 役職・担当
  hireDate: string;           // 入職日 YYYY-MM-DD
  retireDate: string;         // 退職日 YYYY-MM-DD（在職中は空）
  status: StaffStatus;
  phone: string;
  email: string;
  address: string;
  qualifications: string;     // 保有資格
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 勤怠の日区分 */
export type AttendanceDayType = 'work' | 'paid' | 'absent';

/** 勤怠記録（1職員×1日） */
export interface AttendanceRecord {
  id: string;                 // `${staffId}_${date}`
  staffId: string;
  date: string;               // YYYY-MM-DD
  dayType: AttendanceDayType;
  startTime: string;          // HH:MM（未入力は空）
  endTime: string;            // HH:MM（未入力は空）
  breakMinutes: number;
  note: string;
}

/** シフト（1職員×1日×1勤務） */
export interface Shift {
  id: string;
  staffId: string;
  date: string;               // YYYY-MM-DD
  location: WorkLocation;
  startTime: string;          // HH:MM
  endTime: string;            // HH:MM
  note: string;
}

/** 有給休暇の記録種別 */
export type LeaveKind = 'grant' | 'use';

/** 有給休暇記録（付与または取得） */
export interface LeaveRecord {
  id: string;
  staffId: string;
  kind: LeaveKind;
  date: string;               // 付与日または取得日 YYYY-MM-DD
  days: number;               // 日数（0.5日単位可）
  note: string;
}
