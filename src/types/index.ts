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
  employeeNumber: string;     // 職員番号（従業員ログインのID。未設定は空）
  employmentType: EmploymentType;
  workLocation: WorkLocation | '' | 'both';  // 勤務場所（未設定は空、both=総体・海洋センター両方）
  position: string;           // 役職・担当
  hireDate: string;           // 入職日 YYYY-MM-DD
  retireDate: string;         // 退職日 YYYY-MM-DD（在職中は空）
  status: StaffStatus;
  phone: string;
  email: string;
  address: string;
  qualifications: string;     // 保有資格
  hourlyWage: number;         // 時給（時間外手当の計算に使用。0=未設定）
  monthlyHourLimit: number;   // 月の労働時間の上限（扶養等の制限。0=制限なし）
  childNursingChildren: number; // 子の看護等休暇（第26条）の対象となる子の人数。0=未設定（1人=年5日/2人以上=年10日）
  weeklyWorkDays: number;     // 週の所定労働日数。年次有給の比例付与の判定に使う（0=未設定＝通常付与で計算）
  hasPassword?: boolean;      // 従業員ログイン用パスワードが設定済みか（サーバー算出・読取専用）
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
  breakMinutes: number;       // 休憩合計（分）。breakStart/breakEnd があればそこから計算した値
  breakStart?: string;        // 休憩開始 HH:MM（任意。時刻で入力した場合に保持）
  breakEnd?: string;          // 休憩終了 HH:MM（任意）
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

// ==== 時間外・休日勤務 ====

/** 時間外の種別（平日の時間外 / 休日勤務） */
export type OvertimeKind = 'overtime' | 'holiday';
/** 申請の状態 */
export type OvertimeStatus = 'applied' | 'approved';
/** 実績の処理区分（未定 / 時間外手当 / 代休） */
export type OvertimeDisposition = '' | 'allowance' | 'comp';

/** 時間外・休日勤務（1職員×1日の申請） */
export interface OvertimeRecord {
  id: string;
  staffId: string;
  date: string;               // YYYY-MM-DD
  kind: OvertimeKind;         // 追加時に自動判定（常勤の土日祝=holiday）
  appliedHours: number;       // 申請（予定）時間。startTime/endTime から算出した値
  startTime?: string;         // 申請の開始 HH:MM（任意。時刻で申請した場合に保持）
  endTime?: string;           // 申請の終了 HH:MM（任意）
  reason: string;             // 事由
  status: OvertimeStatus;     // applied→approved
  disposition: OvertimeDisposition;
  resultHours: number;        // 実績時間（保存時に勤怠から自動計算して記録）
  note: string;
}

/** 代休の取得（消化）記録 */
export interface CompLeaveUse {
  id: string;
  staffId: string;
  date: string;               // YYYY-MM-DD
  hours: number;              // 消化時間
  note: string;
}

/** 文書の種別 */
export type DocType = 'form' | 'rule' | 'other';

/** 文書（様式・規則など）。実体はGoogleドライブ等に置き、共有リンクを登録する */
export interface DocumentItem {
  id: string;
  type: DocType;
  title: string;
  url: string;                // 共有リンク
  createdAt: string;
  updatedAt: string;
}

/** ログインの役割 */
export type Role = 'admin' | 'staff';

/** 申請の承認状態（従業員申請＝requested、事務局登録/承認＝approved） */
export type RequestStatus = 'requested' | 'approved' | 'rejected';

/** 有給休暇の記録種別 */
export type LeaveKind = 'grant' | 'use';

/**
 * 休暇の種類。'paid'＝年次有給休暇（従来からの記録はすべてこれ）。
 * それ以外は就業規則の特別休暇（第24〜31条）。
 */
export type LeaveType =
  | 'paid'          // 年次有給休暇
  | 'sick'          // 病気休暇（第29条）
  | 'refresh'       // リフレッシュ休暇（第31条・年3日）
  | 'condolence'    // 慶弔休暇（第28条）
  | 'fertility'     // 不妊治療休暇（第27条）
  | 'childcareTime' // 育児時間（第24条1項）
  | 'menstrual'     // 生理休暇（第24条2項）
  | 'childNursing'  // 子の看護等休暇（第26条）
  | 'familyCare'    // 介護休暇（第25条）
  | 'jury';         // 裁判員等のための休暇（第30条）

/** 有給休暇記録（付与または取得）。取得は日単位・時間単位のどちらも可（1日=7.5時間） */
export interface LeaveRecord {
  id: string;
  staffId: string;
  kind: LeaveKind;
  date: string;               // 付与日または取得日 YYYY-MM-DD
  days: number;               // 日単位の量（0.5日単位可）。時間単位の記録では0
  hours: number;              // 時間単位の量。日単位の記録では0。startTime/endTime から算出可
  startTime?: string;         // 時間単位取得の開始 HH:MM（任意）
  endTime?: string;           // 時間単位取得の終了 HH:MM（任意）
  status: RequestStatus;      // 承認状態（付与・事務局登録=approved、従業員申請=requested）
  leaveType?: LeaveType;      // 休暇の種類（未設定＝'paid' 年次有給休暇として扱う）
  subReason?: string;         // 事由ID（慶弔休暇・子の看護等休暇。SubReason.id）
  note: string;
}

// ==== 会計管理（事業予算・経費申請） ====

/** 費目（科目）マスタ */
export interface ExpenseCategory {
  id: string;
  name: string;               // 消耗品費・旅費交通費 など
  order: number;
}

/** 予算（年度 × 事業 × 費目） */
export interface Budget {
  id: string;
  fiscalYear: number;         // 会計年度（4月始まりの西暦。例: 2026年度=2026）
  division: string;           // 事業区分ID（ProjectDivision.id。空＝未分類）
  project: string;            // 事業名
  categoryId: string;         // ExpenseCategory.id
  amount: number;             // 予算額（円）
  note: string;               // 備考（費目の内訳説明など）
}

/** シフト変更の通知（従業員へ知らせる確定シフトの変更） */
export interface ShiftChange {
  id: string;
  staffId: string;
  date: string;               // 変更された勤務日 YYYY-MM-DD
  location: WorkLocation;
  before: string;             // 変更前の区分名（例: 「① ②」「なし」）
  after: string;              // 変更後の区分名
  changedAt: string;          // 変更日時 YYYY-MM-DD HH:mm
  readAt: string;             // 従業員が確認した日時（未確認は空）
}

/** 事業区分（区分 → 事業 → 費目 の最上位） */
export interface ProjectDivision {
  id: string;
  name: string;
}

/** 経費（申請・実績） */
export interface Expense {
  id: string;
  fiscalYear: number;
  staffId: string;            // 申請者（事務局直接登録は空でも可）
  date: string;               // 支出日 YYYY-MM-DD
  project: string;            // 事業名
  categoryId: string;         // 費目
  amount: number;             // 金額（円）
  description: string;        // 内容・摘要
  status: RequestStatus;      // requested→approved/rejected（approved のみ執行に計上）
  note: string;               // 事務局メモ
}
