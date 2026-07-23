// 時間外・休日勤務の計算ロジック（画面から共通利用）
import type { Staff, ShiftPattern, OvertimeKind, OvertimeStatus, OvertimeDisposition } from '../types';

export const FULLTIME_STANDARD_HOURS = 8;   // 常勤の1日の所定（これを超えた分が時間外）
export const OVERTIME_RATE = 1.25;          // 時間外の割増（×1.25）
export const HOLIDAY_RATE = 1.5;            // 休日勤務の割増（×1.5）
export const HOLIDAY_WEEKDAYS = [0, 6];     // 休日にあたる曜日（0=日, 6=土）

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

/** 常勤の土日勤務は休日勤務。それ以外（パート、常勤の平日）は時間外 */
export function overtimeKindOf(staff: Staff, date: string): OvertimeKind {
  const wd = new Date(`${date}T00:00:00`).getDay();
  if (staff.employmentType === 'fulltime' && HOLIDAY_WEEKDAYS.includes(wd)) return 'holiday';
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
 * - 常勤・平日: 8時間
 * - 常勤・土日（休日勤務）: 0（実働全部が休日勤務）
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

/** 時間外手当（円）= round(実績時間 × 時給 × 割増率) */
export function allowanceOf(resultHours: number, hourlyWage: number, kind: OvertimeKind): number {
  return Math.round(resultHours * hourlyWage * rateOf(kind));
}
