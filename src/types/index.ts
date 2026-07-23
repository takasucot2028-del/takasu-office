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

// ==== シフト（希望→確定） ====

/** シフト区分（早番/遅番など）。事務局が区分マスタで管理する */
export interface ShiftPattern {
  id: string;
  name: string;               // 表示名（①②③ や 早番 など）
  startTime: string;          // HH:MM
  endTime: string;            // HH:MM
  order: number;              // 並び順
  location: '' | WorkLocation; // 対象勤務場所（''=すべて。海洋専用の区分などに使う）
}

/** 希望（1職員×1日×1区分）。1日に複数区分を希望できるため区分ごとに1レコード */
export interface AvailabilityRecord {
  id: string;                 // `${staffId}_${date}_${patternId}`
  staffId: string;
  date: string;               // YYYY-MM-DD
  patternId: string;          // ShiftPattern.id
}

/** 確定シフト（1職員×1日×1勤務場所） */
export interface ConfirmedShift {
  id: string;                 // `${staffId}_${date}_${location}`
  staffId: string;
  date: string;               // YYYY-MM-DD
  location: WorkLocation;
  patternId: string;          // ShiftPattern.id
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
