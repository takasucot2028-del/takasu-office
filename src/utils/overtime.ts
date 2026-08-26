// 時間外・休日勤務の計算ロジック（画面から共通利用）
import type { Staff, ShiftPattern, OvertimeKind, OvertimeStatus, OvertimeDisposition, AttendanceRecord } from '../types';
import { isClosedDay } from './holidays';

export const FULLTIME_STANDARD_HOURS = 7.5;   // 常勤の1日の所定（これを超えた分が時間外）
// 割増率（就業規則 第37条。時間外25%・月60時間超50%・休日35%・深夜25%）
export const OVERTIME_RATE = 1.25;            // 時間外（×1.25）
export const OVERTIME_RATE_OVER60 = 1.50;     // 月60時間を超えた分の時間外（×1.50）
export const OVERTIME_MONTHLY_THRESHOLD = 60; // 割増率が上がる月間時間外の境目（時間）
export const HOLIDAY_RATE = 1.35;             // 休日勤務（×1.35）
export const NIGHT_RATE = 1.25;               // 深夜（22:00〜5:00）×1.25
export const NIGHT_RATE_ADD = 0.25;           // 深夜の加算部分（通常の賃金に上乗せする分）

/**
 * 代休にしたときの支給率（就業規則 第20条2項）。
 * 賃金の本体部分は代休に振り替えるが、割増部分は支給する。
 */
export const compRateOf = (rate: number) => Math.round((rate - 1) * 100) / 100;

/** 代休を取得できる期限（第20条3項）。勤務日の属する賃金計算期間の翌月末日まで */
export function compDeadlineOf(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(y, m + 1, 0); // 翌月の末日
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const OVERTIME_STATUS_LABELS: Record<OvertimeStatus, string> = {
  applied: '申請中',
  approved: '承認済',
};
export const OVERTIME_DISPOSITION_LABELS: Record<OvertimeDisposition, string> = {
  '': '未定',
  allowance: '手当',
  comp: '代休',
};
export const OVERTIME_KIND_LABELS: Record<OvertimeKind, string> = {
  overtime: '時間外',
  holiday: '休日',
};

/** 時間外管理の対象となる雇用区分か（常勤・パートのみ） */
export function isOvertimeTarget(staff: Staff): boolean {
  return staff.employmentType === 'fulltime' || staff.employmentType === 'parttime';
}

/** 常勤の土日・祝日勤務は休日勤務。それ以外（パート、常勤の平日）は時間外 */
export function overtimeKindOf(staff: Staff, date: string): OvertimeKind {
  if (staff.employmentType === 'fulltime' && isClosedDay(date)) return 'holiday';
  return 'overtime';
}

export function rateOf(kind: OvertimeKind): number {
  return kind === 'holiday' ? HOLIDAY_RATE : OVERTIME_RATE;
}

/**
 * シフト表の勤務時間を超えたこと自体に割増がつく雇用区分か。
 *
 * パートタイム労働者就業規則 第8条1項により、パート職員はシフトを超えて
 * 働いても基本の勤務時間（8:30〜21:30）の範囲内なら通常の賃金（1.0倍）。
 * 割増は時間帯・法定超・深夜で判定するため、partPremiumOf を使う。
 */
export function shiftExcessIsPremium(staff: Staff): boolean {
  return staff.employmentType === 'fulltime';
}

/* ---- 深夜労働（22:00〜翌5:00）。就業規則 第37条／パート規則 第8条3項 ---- */

const hm = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * 開始〜終了のうち深夜帯に重なる分数。
 * 退勤が出勤より小さい場合は日をまたいだものとして翌日扱いにする。
 */
export function nightMinutesBetween(start: string, end: string): number {
  const s = hm(start); let e = hm(end);
  if (s === null || e === null) return 0;
  if (e <= s) e += 24 * 60;
  // 深夜帯: [22:00, 翌5:00) と、当日早朝の [0:00, 5:00)
  const bands: [number, number][] = [[22 * 60, 29 * 60], [0, 5 * 60]];
  return bands.reduce((t, [bs, be]) => t + Math.max(0, Math.min(e as number, be) - Math.max(s, bs)), 0);
}

/** その日の勤怠から深夜労働の時間数を求める（休憩は深夜帯に重ならない前提） */
export function nightHoursOf(rec: AttendanceRecord | undefined): number {
  if (!rec || rec.dayType !== 'work') return 0;
  return Math.round((nightMinutesBetween(rec.startTime, rec.endTime) / 60) * 100) / 100;
}

/**
 * 深夜手当（円）。通常の賃金は実働時間分としてすでに支払われるため、
 * ここでは上乗せする25％分だけを求める。
 * 時間外かつ深夜の時間は、時間外手当（×1.25）＋深夜加算（×0.25）＝×1.50 になる。
 */
export function nightAllowanceOf(nightHours: number, hourlyWage: number): number {
  return Math.round(nightHours * hourlyWage * NIGHT_RATE_ADD);
}

/* ==== パート職員の割増（パートタイム労働者就業規則 第8条） ====
 *
 * 第8条1項 シフト表の勤務時間を超えても、基本の勤務時間（8:30〜21:30）の
 *          範囲内なら通常の賃金（1.0倍）＝割増なし。
 * 第8条2項 基本の勤務時間以外の時間帯に働いた分は 1.25倍。
 * 第8条3項 法定労働時間（1日8時間・週40時間）超、または深夜（22:00〜5:00）は 1.25倍。
 *
 * 通常の賃金は実働時間分としてすでに支払われるため、ここでは上乗せする
 * 加算分（0.25／0.50）だけを求める。
 * 法定時間外かつ深夜は労基法第37条により 1.25＋0.25＝1.50倍が必要なので加算0.50。
 */

export const BASIC_WORK_START = 8 * 60 + 30;   // 8:30（第4条1項 基本の勤務時間）
export const BASIC_WORK_END = 21 * 60 + 30;    // 21:30
export const DAILY_LEGAL_MINUTES = 8 * 60;     // 法定労働時間 1日8時間
export const WEEKLY_LEGAL_HOURS = 40;          // 法定労働時間 週40時間
export const PREMIUM_ADD = 0.25;               // 加算25%
export const PREMIUM_ADD_BOTH = 0.50;          // 法定時間外かつ深夜の加算

/** その分（0:00からの通算分）が深夜帯か */
const isNightMinute = (m: number): boolean => {
  const t = ((m % 1440) + 1440) % 1440;
  return t < 5 * 60 || t >= 22 * 60;
};
/** その分が基本の勤務時間（8:30〜21:30）の外か。深夜帯は必ず外になる */
const isOutsideBasic = (m: number): boolean => {
  const t = ((m % 1440) + 1440) % 1440;
  return t < BASIC_WORK_START || t >= BASIC_WORK_END;
};

/**
 * 実際に働いた分を並べる（休憩を除く）。
 * 休憩の時刻が入っていればその範囲を除き、分数だけの場合は
 * 基本の勤務時間内から真ん中あたりを除く（休憩は日中に取る前提）。
 */
function workedMinutesOf(rec: AttendanceRecord): number[] {
  if (rec.dayType !== 'work') return [];
  const s = hm(rec.startTime); let e = hm(rec.endTime);
  if (s === null || e === null || e === s) return [];
  if (e < s) e += 24 * 60;                       // 日をまたいだ勤務
  let mins: number[] = [];
  for (let m = s; m < e; m++) mins.push(m);

  const bs = hm(rec.breakStart || ''), be = hm(rec.breakEnd || '');
  if (bs !== null && be !== null && be > bs) {
    mins = mins.filter(m => m < bs || m >= be);
    return mins;
  }
  const brk = Math.max(0, Math.round(rec.breakMinutes || 0));
  if (brk === 0) return mins;
  const inBasic = mins.filter(m => !isOutsideBasic(m));
  const target = inBasic.length >= brk ? inBasic : mins;   // 日中で足りなければ全体から
  const from = Math.max(0, Math.floor((target.length - brk) / 2));
  const removed = new Set(target.slice(from, from + brk));
  return mins.filter(m => !removed.has(m));
}

/** 1日の割増の内訳（時間はすべて時間単位） */
export interface PartPremium {
  workedHours: number;    // 実働
  outsideHours: number;   // 基本の勤務時間外（深夜を含む）
  nightHours: number;     // 深夜（22:00〜5:00）
  legalHours: number;     // 法定時間外（1日8時間超）
  hours25: number;        // 加算25%の対象時間
  hours50: number;        // 加算50%の対象時間（法定時間外かつ深夜）
  amount: number;         // 加算額（通常の賃金への上乗せ分）
}
const EMPTY_PART_PREMIUM: PartPremium = {
  workedHours: 0, outsideHours: 0, nightHours: 0, legalHours: 0, hours25: 0, hours50: 0, amount: 0,
};

const h2 = (min: number) => Math.round((min / 60) * 100) / 100;

/** その日の勤怠から、パート職員の割増（加算分）を求める */
export function partPremiumOf(rec: AttendanceRecord | undefined, hourlyWage: number): PartPremium {
  if (!rec) return EMPTY_PART_PREMIUM;
  const mins = workedMinutesOf(rec);
  if (mins.length === 0) return EMPTY_PART_PREMIUM;
  let outside = 0, night = 0, legal = 0, m25 = 0, m50 = 0;
  mins.forEach((m, i) => {
    const overLegal = i >= DAILY_LEGAL_MINUTES;   // 8時間を超えた分（時系列で後ろ）
    const atNight = isNightMinute(m);
    const atOutside = isOutsideBasic(m);
    if (atOutside) outside++;
    if (atNight) night++;
    if (overLegal) legal++;
    if (overLegal && atNight) m50++;              // 法定時間外かつ深夜は×1.50（労基法第37条）
    else if (overLegal || atOutside) m25++;       // 第8条2項・3項
  });
  return {
    workedHours: h2(mins.length), outsideHours: h2(outside), nightHours: h2(night),
    legalHours: h2(legal), hours25: h2(m25), hours50: h2(m50),
    amount: Math.round((m25 / 60) * hourlyWage * PREMIUM_ADD + (m50 / 60) * hourlyWage * PREMIUM_ADD_BOTH),
  };
}

/** 週（日曜起算）の始まりの日付 */
function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 1か月分の割増 */
export interface PartMonthPremium {
  byDate: Map<string, PartPremium>;
  workedHours: number; outsideHours: number; nightHours: number; legalHours: number;
  hours25: number; hours50: number;
  dailyAmount: number;                                  // 日ごとの加算の合計
  weeks: { start: string; excessHours: number }[];      // 週40時間を超えた週
  weeklyExcessHours: number;
  weeklyExcessAmount: number;
  amount: number;                                       // 加算の総額
}

/**
 * 1か月分をまとめて計算する。
 * 週40時間超（第8条3項）は、日8時間超と重ならないように
 * 「その週の実働 − その週の日8時間超 − 40時間」で求める（日曜起算）。
 */
export function partMonthPremium(records: AttendanceRecord[], hourlyWage: number): PartMonthPremium {
  const byDate = new Map<string, PartPremium>();
  const weekMap = new Map<string, { worked: number; legal: number }>();
  let workedHours = 0, outsideHours = 0, nightHours = 0, legalHours = 0;
  let hours25 = 0, hours50 = 0, dailyAmount = 0;

  for (const rec of records) {
    const p = partPremiumOf(rec, hourlyWage);
    if (p.workedHours === 0) continue;
    byDate.set(rec.date, p);
    workedHours += p.workedHours; outsideHours += p.outsideHours; nightHours += p.nightHours;
    legalHours += p.legalHours; hours25 += p.hours25; hours50 += p.hours50;
    dailyAmount += p.amount;
    const key = weekStartOf(rec.date);
    const w = weekMap.get(key) || { worked: 0, legal: 0 };
    w.worked += p.workedHours; w.legal += p.legalHours;
    weekMap.set(key, w);
  }

  const weeks = Array.from(weekMap.entries())
    .map(([start, w]) => ({ start, excessHours: h2((w.worked - w.legal - WEEKLY_LEGAL_HOURS) * 60) }))
    .filter(w => w.excessHours > 0)
    .sort((a, b) => a.start.localeCompare(b.start));
  const weeklyExcessHours = h2(weeks.reduce((t, w) => t + w.excessHours, 0) * 60);
  const weeklyExcessAmount = Math.round(weeklyExcessHours * hourlyWage * PREMIUM_ADD);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    byDate,
    workedHours: r2(workedHours), outsideHours: r2(outsideHours), nightHours: r2(nightHours),
    legalHours: r2(legalHours), hours25: r2(hours25), hours50: r2(hours50),
    dailyAmount, weeks, weeklyExcessHours, weeklyExcessAmount,
    amount: dailyAmount + weeklyExcessAmount,
  };
}

/** 区分の実働時間（時間）。開始〜終了、日跨ぎは想定しない */
export function patternHours(p: ShiftPattern): number {
  const re = /^(\d{1,2}):(\d{2})$/;
  const s = re.exec(p.startTime), e = re.exec(p.endTime);
  if (!s || !e) return 0;
  const min = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  return min > 0 ? min / 60 : 0;
}

/**
 * その日の「基準時間」（これを超えた分が実績時間外）。
 * - 常勤・平日: 7.5時間
 * - 常勤・土日祝（休日勤務）: 0（実働全部が休日勤務）
 * - パート: その日の確定シフトの合計時間（shiftHours）
 */
export function standardHoursOf(staff: Staff, date: string, shiftHours: number): number {
  if (staff.employmentType === 'fulltime') {
    return overtimeKindOf(staff, date) === 'holiday' ? 0 : FULLTIME_STANDARD_HOURS;
  }
  // パート
  return shiftHours;
}

/** 実績時間外 = max(0, 実働 - 基準)。小数第2位で丸める */
export function resultHoursOf(workedHours: number, standardHours: number): number {
  return Math.max(0, Math.round((workedHours - standardHours) * 100) / 100);
}

/**
 * その記録の実績時間。雇用区分で求め方が違う。
 *
 * 常勤職員: 実働 − 基準（平日7.5時間、土日祝は0＝全部が休日勤務）。
 * パート職員等: シフト表の勤務時間を超えて働いた分を申請しているため、申請時間を
 *   そのまま実績とする。例えばシフトが8:30からの日に7:30から勤務した場合、
 *   7:30〜8:30 の1時間を申請し、その1時間が実績になる。
 *   ただしこの実績自体に割増はつかない（パート規則 第8条1項＝1.0倍）。
 *   割増は勤務した時間帯・法定超・深夜から partPremiumOf で別に求める。
 *   （実働からシフト時間を引く方法だと、シフトが未登録の日に働いた分が
 *     まるごと時間外になってしまうため）
 */
export function resultHoursFor(
  staff: Staff, date: string, workedHours: number, shiftHours: number, appliedHours: number
): number {
  if (staff.employmentType === 'fulltime') {
    return resultHoursOf(workedHours, standardHoursOf(staff, date, shiftHours));
  }
  return Math.max(0, Math.round((Number(appliedHours) || 0) * 100) / 100);
}

/** 実績が申請時間そのままになる雇用区分か（画面の説明で使う） */
export function usesAppliedHours(staff: Staff): boolean {
  return staff.employmentType !== 'fulltime';
}

/** 時間外手当（円）= round(実績時間 × 時給 × 割増率)。月60時間超の割増は考慮しない単純計算 */
export function allowanceOf(resultHours: number, hourlyWage: number, kind: OvertimeKind): number {
  return Math.round(resultHours * hourlyWage * rateOf(kind));
}

/**
 * 月60時間超の割増を考慮した時間外手当。
 * 平日の時間外は、その月の累計が60時間までは×1.25、60時間を超えた分は×1.50。
 * 休日勤務は月の累計に関係なく×1.35（60時間の累計にも含めない）。
 *
 * @param priorOvertimeHours この記録より前（同月・日付順）の「時間外」実績の累計時間
 */
export function allowanceDetail(
  resultHours: number, hourlyWage: number, kind: OvertimeKind, priorOvertimeHours: number
): { amount: number; normalHours: number; over60Hours: number } {
  if (kind === 'holiday') {
    return { amount: Math.round(resultHours * hourlyWage * HOLIDAY_RATE), normalHours: resultHours, over60Hours: 0 };
  }
  const remain = Math.max(0, OVERTIME_MONTHLY_THRESHOLD - priorOvertimeHours); // 60時間までの残り
  const normalHours = Math.min(resultHours, remain);
  const over60Hours = Math.round((resultHours - normalHours) * 100) / 100;
  const amount = Math.round(normalHours * hourlyWage * OVERTIME_RATE + over60Hours * hourlyWage * OVERTIME_RATE_OVER60);
  return { amount, normalHours: Math.round(normalHours * 100) / 100, over60Hours };
}

/**
 * 代休にした勤務に支給する割増部分（第20条2項）。
 * 時間外は当月60時間までが25%、超えた分は50%。休日勤務は35%。
 */
export function compPremiumDetail(
  resultHours: number, hourlyWage: number, kind: OvertimeKind, priorOvertimeHours: number
): { amount: number; normalHours: number; over60Hours: number } {
  if (kind === 'holiday') {
    return {
      amount: Math.round(resultHours * hourlyWage * compRateOf(HOLIDAY_RATE)),
      normalHours: resultHours, over60Hours: 0,
    };
  }
  const remain = Math.max(0, OVERTIME_MONTHLY_THRESHOLD - priorOvertimeHours);
  const normalHours = Math.min(resultHours, remain);
  const over60Hours = Math.round((resultHours - normalHours) * 100) / 100;
  const amount = Math.round(
    normalHours * hourlyWage * compRateOf(OVERTIME_RATE) +
    over60Hours * hourlyWage * compRateOf(OVERTIME_RATE_OVER60)
  );
  return { amount, normalHours: Math.round(normalHours * 100) / 100, over60Hours };
}

/** その日の時間外（実績） */
export interface DayOvertime {
  hours: number;                 // 実績時間
  kind: OvertimeKind;            // 時間外 / 休日
  status: OvertimeStatus;        // 申請中 / 承認済
  disposition: OvertimeDisposition; // 手当 / 代休 / 未定
}

/**
 * 時間外の記録を日付ごとにまとめる。
 * 同じ日に複数の記録がある場合は実績時間を合計する。
 */
export function overtimeByDate(records: { date: string; kind: OvertimeKind; status: OvertimeStatus; disposition: OvertimeDisposition; resultHours: number }[]): Map<string, DayOvertime> {
  const map = new Map<string, DayOvertime>();
  for (const r of records) {
    const hours = Number(r.resultHours) || 0;
    const cur = map.get(r.date);
    if (cur) {
      cur.hours = Math.round((cur.hours + hours) * 100) / 100;
      if (r.status === 'applied') cur.status = 'applied'; // 1件でも未承認なら未承認として示す
    } else {
      map.set(r.date, { hours, kind: r.kind, status: r.status, disposition: r.disposition });
    }
  }
  return map;
}

/**
 * 月内の各記録に「その記録より前の時間外累計」を割り当てる。
 * 日付順に、承認済みの「時間外」実績だけを積み上げる（休日勤務は含めない）。
 */
export function priorOvertimeMap<T extends { id: string; date: string; status: OvertimeStatus }>(
  records: T[],
  kindOf: (r: T) => OvertimeKind,
  resultOf: (r: T) => number
): Map<string, number> {
  const map = new Map<string, number>();
  let acc = 0;
  for (const r of records.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    map.set(r.id, acc);
    if (r.status === 'approved' && kindOf(r) === 'overtime') acc += resultOf(r);
  }
  return map;
}
