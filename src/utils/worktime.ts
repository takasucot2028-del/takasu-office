// 打刻から「賃金計算に使う出退勤時刻」を求める（打刻の丸め）。
//
// ルール
//  1. 出勤：シフト開始より前に打刻した日は、時間外の申請がなければシフト開始から計算する。
//     （指示のない早入りは労働時間としない。申請がある日は打刻どおり計算する）
//  2. 出勤：シフト開始以降の打刻は実時刻のまま。遅刻を15分単位に切り上げると
//     実際に働いた分を切り捨てることになり、労基法第24条に反するため。
//  3. 退勤：シフト終了より後の打刻は15分単位で切り上げる（切り捨てない）。
//     シフト終了以前（早退）は実時刻のまま。
//  4. 確定シフトのない日は、比べる基準がないため打刻をそのまま使う。
//
// 打刻そのものは書き換えない。画面や帳票で計算するときにこの関数を通す。
import type { AttendanceRecord, ConfirmedShift, ShiftPattern, OvertimeRecord } from '../types';

export const ROUND_UNIT_MINUTES = 15; // 退勤の切り上げ単位

const hm = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 15分単位で切り上げる（12:10 → 12:15、12:15 → 12:15） */
export function roundUpMinutes(min: number, unit = ROUND_UNIT_MINUTES): number {
  return Math.ceil(min / unit) * unit;
}

/** その日のシフトと申請の有無 */
export interface DayShift {
  start: string;          // シフト開始（最も早い区分の開始）
  end: string;            // シフト終了（最も遅い区分の終了）
  hasApplication: boolean; // その日に時間外の申請があるか
}

/** 計算に使う出退勤時刻。丸めた場合は理由を添える */
export interface RoundedTimes {
  startTime: string;
  endTime: string;
  startRounded: boolean;  // 出勤をシフト開始に合わせた
  endRounded: boolean;    // 退勤を15分単位で切り上げた
}

/**
 * 打刻を賃金計算用の時刻に直す。
 * shift が無い日（確定シフトなし）は打刻をそのまま返す。
 */
export function roundedTimesOf(rec: AttendanceRecord | undefined, shift?: DayShift): RoundedTimes {
  const startTime = rec?.startTime || '';
  const endTime = rec?.endTime || '';
  const base: RoundedTimes = { startTime, endTime, startRounded: false, endRounded: false };
  if (!rec || rec.dayType !== 'work' || !shift) return base;

  const s = hm(startTime), e = hm(endTime);
  const ss = hm(shift.start), se = hm(shift.end);

  // 出勤：申請のない早入りはシフト開始から計算する
  if (s !== null && ss !== null && s < ss && !shift.hasApplication) {
    base.startTime = shift.start;
    base.startRounded = true;
  }
  // 退勤：シフト終了より後は15分単位で切り上げる
  if (e !== null && se !== null && e > se) {
    const up = roundUpMinutes(e);
    if (up !== e) { base.endTime = toHM(up); base.endRounded = true; }
  }
  return base;
}

/** 丸めた時刻での実働分数（休憩を差し引く） */
export function workMinutesOf(rec: AttendanceRecord | undefined, shift?: DayShift): number {
  if (!rec || rec.dayType !== 'work') return 0;
  const t = roundedTimesOf(rec, shift);
  const s = hm(t.startTime), e = hm(t.endTime);
  if (s === null || e === null) return 0;
  return Math.max(0, e - s - (rec.breakMinutes || 0));
}

/** 丸めを反映した勤怠レコード。既存の計算にそのまま渡せる */
export function roundedRecord(rec: AttendanceRecord, shift?: DayShift): AttendanceRecord {
  const t = roundedTimesOf(rec, shift);
  if (!t.startRounded && !t.endRounded) return rec;
  return { ...rec, startTime: t.startTime, endTime: t.endTime };
}

/**
 * 確定シフト・区分マスタ・時間外申請から、日付ごとの判定材料をまとめる。
 * キーは staffId を渡したときは日付、渡さないときは「職員ID|日付」。
 *
 * 申請は「シフト開始より前の時間を含むもの」だけを早出の申請とみなす。
 * 終業後の残業だけを申請した日は、始業前の早入りは労働時間にしない。
 */
function buildDayShiftMap(
  confirmed: ConfirmedShift[], patterns: ShiftPattern[], overtime: OvertimeRecord[],
  keyByStaff: boolean, staffId?: string
): Map<string, DayShift> {
  const pat = new Map(patterns.map(p => [p.id, p]));
  const key = (sid: string, date: string) => (keyByStaff ? `${sid}|${date}` : date);

  // まずシフトの開始・終了をまとめる
  const map = new Map<string, DayShift>();
  for (const c of confirmed) {
    if (staffId && c.staffId !== staffId) continue;
    const p = pat.get(c.patternId);
    if (!p || !p.startTime || !p.endTime) continue;
    const k = key(c.staffId, c.date);
    const cur = map.get(k);
    if (!cur) { map.set(k, { start: p.startTime, end: p.endTime, hasApplication: false }); continue; }
    if (p.startTime < cur.start) cur.start = p.startTime;   // 最も早い開始
    if (p.endTime > cur.end) cur.end = p.endTime;           // 最も遅い終了
  }

  // 早出の申請がある日に印をつける
  for (const r of overtime) {
    if (staffId && r.staffId !== staffId) continue;
    const cur = map.get(key(r.staffId, r.date));
    if (!cur) continue;
    // 時刻のない申請（時間だけの申請）は、どの時間帯か分からないため早出とみなす
    if (!r.startTime || r.startTime < cur.start) cur.hasApplication = true;
  }
  return map;
}

/**
 * 1人ぶん。キーは日付。
 * staffId を渡すと全職員ぶんのデータからその職員だけを取り出す。
 * すでに本人ぶんに絞られているデータ（従業員側の画面）は省略してよい。
 */
export function dayShiftMap(
  confirmed: ConfirmedShift[], patterns: ShiftPattern[], overtime: OvertimeRecord[], staffId?: string
): Map<string, DayShift> {
  return buildDayShiftMap(confirmed, patterns, overtime, false, staffId);
}

/** 全職員ぶん。キーは「職員ID|日付」 */
export function dayShiftMapByStaff(
  confirmed: ConfirmedShift[], patterns: ShiftPattern[], overtime: OvertimeRecord[]
): Map<string, DayShift> {
  return buildDayShiftMap(confirmed, patterns, overtime, true);
}
