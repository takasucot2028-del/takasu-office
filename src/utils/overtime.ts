// 時間外・休日勤務の計算ロジック（画面から共通利用）
import type { Staff, ShiftPattern, OvertimeKind, OvertimeStatus, OvertimeDisposition } from '../types';
import { isClosedDay } from './holidays';

export const FULLTIME_STANDARD_HOURS = 7.5;   // 常勤の1日の所定（これを超えた分が時間外）
// 割増率（就業規則 第36条。時間外25%・月60時間超50%・休日35%・深夜25%）
export const OVERTIME_RATE = 1.25;            // 時間外（×1.25）
export const OVERTIME_RATE_OVER60 = 1.50;     // 月60時間を超えた分の時間外（×1.50）
export const OVERTIME_MONTHLY_THRESHOLD = 60; // 割増率が上がる月間時間外の境目（時間）
export const HOLIDAY_RATE = 1.35;             // 休日勤務（×1.35）
export const NIGHT_RATE_ADD = 0.25;           // 深夜（22:00〜5:00）の加算（賃金台帳の参考用）

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

/** 時間外手当（円）= round(実績時間 × 時給 × 割増率)。月60時間超の割増は考慮しない単純計算 */
export function allowanceOf(resultHours: number, hourlyWage: number, kind: OvertimeKind): number {
  return Math.round(resultHours * hourlyWage * rateOf(kind));
}

/**
 * 月60時間超の割増を考慮した時間外手当。
 * 平日の時間外は、その月の累計が60時間までは×1.20、60時間を超えた分は×1.50。
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
