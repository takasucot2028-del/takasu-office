import type { EmploymentType, StaffStatus, AttendanceDayType, WorkLocation, ShiftPattern, Staff, DocType, ExpenseCategory, ProjectDivision, LeaveType } from '../types';

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

/**
 * 「勤務不可」を表す予約済みの区分ID。
 * シフト希望（availability）に patternId としてこの値で保存する。
 * 実在する区分と混ざらないよう、区分マスタでは使用しないIDにしている。
 */
export const UNAVAILABLE_PATTERN_ID = '__unavailable__';

/** 事業区分（会計の集計単位。区分 → 事業 → 費目 の最上位） */
export const PROJECT_DIVISIONS: ProjectDivision[] = [
  { id: 'sc', name: 'SC教室' },
  { id: 'community', name: '地域クラブ' },
  { id: 'entrusted', name: '運動教室委託' },
];
/** 区分IDから区分名を得る（未設定・不明は「未分類」） */
export function divisionLabel(id: string): string {
  return PROJECT_DIVISIONS.find(d => d.id === id)?.name ?? '未分類';
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

// ==== 特別休暇（就業規則 第24〜31条）====

/** 特別休暇の種類の定義 */
export interface SpecialLeaveDef {
  id: LeaveType;
  name: string;
  article: string;             // 根拠となる就業規則の条
  unit: 'day' | 'hour' | 'both'; // 申請できる単位
  annualDays: number;          // 年度（4/1〜3/31）あたりの上限日数。0＝上限なし（職員ごとに決まるものを含む）
  paid: boolean;               // 全期間が有給か（就業規則で無給と定めるものは false）
  paidDays?: number;           // paid:false のとき、年度あたり有給となる日数の限度（超過分は無給）。未設定＝全期間無給
  note: string;                // 画面に出す補足
  needsSubReason?: boolean;    // 事由の選択が必要か（慶弔休暇・子の看護等休暇）
}

/**
 * 特別休暇（第24〜31条）の対象かどうか。
 * 特別休暇は常勤職員のみに付与する。パート・指導員・業務委託は年次有給休暇のみ。
 */
export function canUseSpecialLeave(staff: Pick<Staff, 'employmentType'>): boolean {
  return staff.employmentType === 'fulltime';
}

/** 特別休暇の一覧。年次有給休暇は別枠のためここには含めない */
export const SPECIAL_LEAVE_TYPES: SpecialLeaveDef[] = [
  {
    id: 'condolence', name: '慶弔休暇', article: '第28条', unit: 'day', annualDays: 0, paid: true,
    needsSubReason: true, note: '事由ごとに日数が決まっています。',
  },
  {
    id: 'sick', name: '病気休暇', article: '第29条', unit: 'both', annualDays: 0, paid: false, paidDays: 5,
    note: '私的な負傷又は疾病の療養のため、勤務しないことがやむを得ないと認められる場合の休暇です。1年度（4/1〜3/31）につき5日までは有給、これを超える期間は無給です。事前に法人の承認を受けてください（やむを得ない場合は事後に承認を求めることができます。手続きを怠ると無断欠勤の扱いになります）。必要に応じて医師の診断書の提出を求めることがあります。',
  },
  {
    id: 'refresh', name: 'リフレッシュ休暇', article: '第31条', unit: 'day', annualDays: 3, paid: true,
    note: '心身の疲労回復のための有給休暇です。毎年度3日間。所定休日（第18条）は3日間に含みません（勤務日だけを日数に数えてください）。当該年度内に取得する必要があり、翌年度への繰越はできません。',
  },
  {
    id: 'fertility', name: '不妊治療休暇', article: '第27条', unit: 'both', annualDays: 5, paid: true,
    note: '年5日が限度です。長期の休業（休業開始日の属する事業年度を含む5事業年度で最長1年間）を希望する場合は事務局にご相談ください。',
  },
  {
    id: 'childNursing', name: '子の看護等休暇', article: '第26条', unit: 'both', annualDays: 0, paid: true,
    needsSubReason: true,
    note: '小学校卒業までの子を養育する職員が対象です。上限は1年間（4/1〜3/31）で、対象の子が1人なら5日、2人以上なら10日です（人数は職員名簿の設定を使います）。1日単位でも1時間単位でも取得できます。時間単位は始業から連続・終業まで連続のほか、就業時間の途中に取得してその後就業する（中抜け）こともできます。有給です。',
  },
  {
    id: 'familyCare', name: '介護休暇', article: '第25条', unit: 'both', annualDays: 0, paid: true,
    note: '育児・介護休業法に基づく休暇です。詳細は「育児・介護休業等に関する規則」によります。',
  },
  {
    id: 'childcareTime', name: '育児時間', article: '第24条1項', unit: 'hour', annualDays: 0, paid: true,
    note: '1歳に満たない子を養育する女性職員が対象です。休憩時間のほか、1日2回・1回30分を取得できます。',
  },
  {
    id: 'menstrual', name: '生理休暇', article: '第24条2項', unit: 'both', annualDays: 0, paid: true,
    note: '就業が著しく困難な場合に、必要な期間取得できます。',
  },
  {
    id: 'jury', name: '裁判員等のための休暇', article: '第30条', unit: 'both', annualDays: 0, paid: true,
    note: '裁判員・補充裁判員は必要な日数、裁判員候補者は必要な時間を取得できます。',
  },
];

/** 子の看護等休暇の上限日数（第26条2項）。対象の子が1人=5日、2人以上=10日 */
export const CHILD_NURSING_DAYS_ONE = 5;
export const CHILD_NURSING_DAYS_MANY = 10;

/**
 * その職員のその休暇の年度あたり上限日数。0＝上限なし（都度判断）。
 * 子の看護等休暇だけは対象となる子の人数で 5日／10日 に分かれる。
 */
export function specialLeaveAnnualDays(
  def: SpecialLeaveDef,
  staff?: Pick<Staff, 'childNursingChildren'> | null
): number {
  if (def.id === 'childNursing') {
    const n = Number(staff?.childNursingChildren) || 0;
    if (n <= 0) return 0;   // 人数が未設定なら上限判定をしない
    return n >= 2 ? CHILD_NURSING_DAYS_MANY : CHILD_NURSING_DAYS_ONE;
  }
  return def.annualDays;
}

/**
 * 有給扱いになる日数の年度あたり残（病気休暇の年5日など）。
 * 上限日数（annualDays）と違い、超えても取得はできる（超過分が無給になる）。
 */
export function specialLeavePaidRemain(
  def: SpecialLeaveDef,
  records: { kind: string; date: string; days: number; hours: number; status?: string; leaveType?: string }[],
  fiscalYear: number
): number {
  const limit = def.paidDays ?? 0;
  if (limit <= 0) return 0;
  return Math.round((limit - specialLeaveUsedDays(records, def.id, fiscalYear)) * 100) / 100;
}

/** 支払いの扱いを1行で説明する（画面のバッジ用） */
export function paymentLabel(def: SpecialLeaveDef): string {
  if (def.paid) return '有給';
  if (def.paidDays) return `年${def.paidDays}日まで有給・超過分は無給`;
  return '無給';
}

/** 特別休暇の事由。days がある事由は選ぶと日数が自動で入る */
export interface SubReason { id: string; name: string; days?: number }

/** 慶弔休暇の事由と日数（第28条） */
export const CONDOLENCE_REASONS: SubReason[] = [
  { id: 'marriage', name: '本人が結婚したとき', days: 5 },
  { id: 'birth', name: '妻が出産したとき', days: 3 },
  { id: 'death1', name: '配偶者、子又は父母が死亡したとき', days: 10 },
  { id: 'death2', name: '一親等の姻族（配偶者の父母）が死亡したとき', days: 7 },
  { id: 'death3', name: '一親等の直系尊属（子）が死亡したとき', days: 5 },
  { id: 'death4', name: '兄弟姉妹、祖父母、配偶者の父母又は兄弟姉妹が死亡したとき', days: 3 },
];

/** 子の看護等休暇の事由（第26条1項）。日数は事由では決まらない */
export const CHILD_NURSING_REASONS: SubReason[] = [
  { id: 'illness', name: '負傷し、又は疾病にかかった子の世話をする' },
  { id: 'vaccination', name: '子に予防接種又は健康診断を受けさせる' },
  { id: 'closure', name: '感染症に伴う学級閉鎖等になった子の世話をする' },
  { id: 'ceremony', name: '子の入園式、卒園式、入学式又は卒業式に参加する' },
];

/** その休暇で選べる事由の一覧（事由の選択が不要な休暇は空） */
export function subReasonsFor(typeId?: string): SubReason[] {
  if (typeId === 'condolence') return CONDOLENCE_REASONS;
  if (typeId === 'childNursing') return CHILD_NURSING_REASONS;
  return [];
}

/** 休暇の種類の表示名（年次有給を含む） */
export function leaveTypeLabel(id?: string): string {
  if (!id || id === 'paid') return '年次有給';
  return SPECIAL_LEAVE_TYPES.find(t => t.id === id)?.name ?? id;
}
/** 選択肢に出す表示名。根拠条があるものだけ「（第○条）」を付ける */
export function specialLeaveOptionLabel(t: SpecialLeaveDef): string {
  return t.article ? `${t.name}（${t.article}）` : t.name;
}
/** 特別休暇の定義を得る */
export function specialLeaveDef(id?: string): SpecialLeaveDef | undefined {
  return SPECIAL_LEAVE_TYPES.find(t => t.id === id);
}
/**
 * 指定年度（4/1〜3/31）に取得（承認済）した特別休暇の日数を求める。
 * 時間単位の取得は 1日=7.5時間 で日数に換算する。
 */
export function specialLeaveUsedDays(
  records: { kind: string; date: string; days: number; hours: number; status?: string; leaveType?: string }[],
  typeId: string,
  fiscalYear: number
): number {
  const used = records
    .filter(r => r.kind === 'use'
      && (r.leaveType || 'paid') === typeId
      && (r.status || 'approved') === 'approved'
      && fiscalYearOf(r.date) === fiscalYear)
    .reduce((s, r) => s + (Number(r.days) || 0) + (Number(r.hours) || 0) / LEAVE_HOURS_PER_DAY, 0);
  return Math.round(used * 100) / 100;
}

/** 事由の表示名（慶弔休暇・子の看護等休暇のどちらでも引ける） */
export function subReasonLabel(id?: string): string {
  if (!id) return '';
  return [...CONDOLENCE_REASONS, ...CHILD_NURSING_REASONS].find(r => r.id === id)?.name ?? '';
}
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

/** 休憩の時刻範囲（HH:MM〜HH:MM）から休憩分数を求める。両方揃っていないときは 0 */
export function breakMinutesBetween(start?: string, end?: string): number {
  const re = /^(\d{1,2}):(\d{2})$/;
  const s = re.exec(start || ''), e = re.exec(end || '');
  if (!s || !e) return 0;
  const min = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  return min > 0 ? min : 0;
}

/** 時刻範囲（HH:MM〜HH:MM）から時間数を求める（分/60、小数第2位で丸め。両方揃わなければ0） */
export function hoursBetween(start?: string, end?: string): number {
  return Math.round(breakMinutesBetween(start, end) / 60 * 100) / 100;
}

// ==== 会計管理 ====

/** 会計年度（4月始まり）。date の年度＝4月以降はその年、1〜3月は前年 */
export function fiscalYearOf(date: string): number {
  const d = new Date(`${date}T00:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}
export function currentFiscalYear(): number {
  const d = new Date();
  return (d.getMonth() + 1) >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}
export function fiscalYearLabel(fy: number): string {
  return `${fy}年度（${fy}/4〜${fy + 1}/3）`;
}

/** 費目マスタの初期セット（会計管理が空のときのフォールバック。事務局が編集可能） */
export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: 'ec1', name: '消耗品費', order: 1 },
  { id: 'ec2', name: '旅費交通費', order: 2 },
  { id: 'ec3', name: '通信費', order: 3 },
  { id: 'ec4', name: '謝金', order: 4 },
  { id: 'ec5', name: '印刷製本費', order: 5 },
  { id: 'ec6', name: '会議費', order: 6 },
  { id: 'ec7', name: 'その他', order: 7 },
];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  form: '様式',
  rule: '規則',
  other: 'その他',
};
/** 一覧表示・グループの順序 */
export const DOC_TYPE_ORDER: DocType[] = ['form', 'rule', 'other'];
