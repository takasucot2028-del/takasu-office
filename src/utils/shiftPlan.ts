// 確定シフト（予定）と勤怠（実績）を突き合わせるための共通処理
import { patternHours } from './overtime';
import type { ConfirmedShift, ShiftPattern, AttendanceRecord } from '../types';

/** その日の勤務予定 */
export interface DayShift {
  patterns: ShiftPattern[];
  hours: number;      // 予定の合計時間
  label: string;      // 区分名（例: 「① ③」）
  timeLabel: string;  // 時刻（例: 「08:30〜13:00, 17:00〜21:15」）
}

/**
 * 日付ごとの勤務予定をまとめる。
 * 1日に複数の区分（①と③など）が入ることがあるため、区分ごとに足し合わせる。
 */
export function shiftPlanByDate(
  confirmed: ConfirmedShift[],
  patterns: ShiftPattern[]
): Map<string, DayShift> {
  const patternMap = new Map(patterns.map(p => [p.id, p]));
  const map = new Map<string, ShiftPattern[]>();
  for (const c of confirmed) {
    const p = patternMap.get(c.patternId);
    if (!p) continue;
    map.set(c.date, [...(map.get(c.date) ?? []), p]);
  }
  const out = new Map<string, DayShift>();
  for (const [date, list] of map) {
    const sorted = list.slice().sort((a, b) => a.order - b.order);
    out.set(date, {
      patterns: sorted,
      hours: Math.round(sorted.reduce((s, p) => s + patternHours(p), 0) * 10) / 10,
      label: sorted.map(p => p.name).join(' '),
      timeLabel: sorted.map(p => `${p.startTime}〜${p.endTime}`).join(', '),
    });
  }
  return out;
}

/**
 * 「シフトがあるのに打刻がない日」か。
 * 当日はまだ勤務の途中なので対象にせず、有給・欠勤として登録済みの日も除く。
 */
export function isMissingPunch(
  rec: AttendanceRecord | undefined,
  plan: DayShift | undefined,
  date: string,
  today: string
): boolean {
  if (!plan || plan.patterns.length === 0) return false;
  if (date >= today) return false;             // 当日・未来は対象外
  if (!rec) return true;                       // 記録そのものがない
  if (rec.dayType !== 'work') return false;    // 有給・欠勤として処理済み
  return !rec.startTime || !rec.endTime;       // 出勤か退勤が空
}

/** 予定と実績の差（時間）。実績が入っていない日は null */
export function planGapHours(
  rec: AttendanceRecord | undefined,
  plan: DayShift | undefined,
  workedMinutes: number
): number | null {
  if (!plan || !rec || rec.dayType !== 'work') return null;
  if (!rec.startTime || !rec.endTime) return null;
  return Math.round((workedMinutes / 60 - plan.hours) * 10) / 10;
}
