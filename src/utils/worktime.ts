// 打刻から「賃金計算に使う出退勤時刻」を求める（打刻の丸め）。
//
// ルール
//  1. 出勤：シフト開始より前に打刻した日は、時間外の申請がなければシフト開始から計算する。
//     （指示のない早入りは労働時間としない。申請がある日は打刻どおり計算する）
//  2. 出勤：シフト開始以降の打刻は実時刻のまま。遅刻を15分単位に切り上げると
//     実際に働いた分を切り捨てることになり、労基法第24条に反するため。
//  3. 退勤：打刻した実時刻のまま。日ごとの実働は1分単位で数える。
//     端数の処理は月の総労働時間でだけ行う（roundMonthMinutes）。
//  4. 確定シフトのない日は、比べる基準がないため打刻をそのまま使う。
//
// 打刻そのものは書き換えない。画面や帳票で計算するときにこの関数を通す。
import type { AttendanceRecord, ConfirmedShift, ShiftPattern, OvertimeRecord } from '../types';

const hm = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * 月の総労働時間を15分単位で切り上げる（例: 69時間43分 → 69時間45分）。
 * 給与計算では分単位の端数を切り捨てられないため、従業員に有利な
 * 切り上げだけを行う。日ごとの実働は分単位のまま残し、月の合計にだけ使う。
 */
export const MONTH_ROUND_UNIT_MINUTES = 15;

export function roundMonthMinutes(min: number): number {
  return Math.ceil(Math.max(0, min) / MONTH_ROUND_UNIT_MINUTES) * MONTH_ROUND_UNIT_MINUTES;
}

/** 月の総労働時間（時間）。15分単位なので必ず0.25刻みになる */
export function monthHoursOf(min: number): number {
  return roundMonthMinutes(min) / 60;
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
  startRounded: boolean;  // 出勤をシフト開始に合わせた（退勤は常に実時刻）
}

/**
 * 打刻を賃金計算用の時刻に直す。
 * shift が無い日（確定シフトなし）は打刻をそのまま返す。
 */
export function roundedTimesOf(rec: AttendanceRecord | undefined, shift?: DayShift): RoundedTimes {
  const startTime = rec?.startTime || '';
  const endTime = rec?.endTime || '';
  const base: RoundedTimes = { startTime, endTime, startRounded: false };
  if (!rec || rec.dayType !== 'work' || !shift) return base;

  const s = hm(startTime), ss = hm(shift.start);

  // 出勤：申請のない早入りはシフト開始から計算する
  if (s !== null && ss !== null && s < ss && !shift.hasApplication) {
    base.startTime = shift.start;
    base.startRounded = true;
  }
  // 退勤は打刻した実時刻のまま（1分単位）。端数は月の合計でだけ処理する
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
  if (!t.startRounded) return rec;
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
