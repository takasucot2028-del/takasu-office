// 日本の国民の祝日（振替休日・国民の休日を含む）を年ごとに計算してキャッシュする。
// 春分・秋分は近似式（西暦2000〜2099で有効）。シフトの入力チェックで
// 「平日／休日・祝日」を判定するために使用する。

const _cache = new Map<number, Set<string>>();

function pad(n: number): string { return String(n).padStart(2, '0'); }
function ymd(y: number, m: number, d: number): string { return `${y}-${pad(m)}-${pad(d)}`; }
function dowOf(dateStr: string): number { return new Date(`${dateStr}T00:00:00`).getDay(); } // 0=日

/** その年月の第n月曜日の「日」 */
function nthMonday(year: number, month: number, n: number): number {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (n - 1) * 7;
}
function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function build(year: number): Set<string> {
  const set = new Set<string>();
  const add = (m: number, d: number) => set.add(ymd(year, m, d));
  add(1, 1);                                       // 元日
  set.add(ymd(year, 1, nthMonday(year, 1, 2)));    // 成人の日
  add(2, 11);                                      // 建国記念の日
  if (year >= 2020) add(2, 23);                    // 天皇誕生日
  add(3, vernalEquinox(year));                     // 春分の日
  add(4, 29);                                      // 昭和の日
  add(5, 3); add(5, 4); add(5, 5);                 // 憲法記念日・みどりの日・こどもの日
  set.add(ymd(year, 7, nthMonday(year, 7, 3)));    // 海の日
  if (year >= 2016) add(8, 11);                    // 山の日
  set.add(ymd(year, 9, nthMonday(year, 9, 3)));    // 敬老の日
  add(9, autumnalEquinox(year));                   // 秋分の日
  set.add(ymd(year, 10, nthMonday(year, 10, 2)));  // スポーツの日
  add(11, 3); add(11, 23);                         // 文化の日・勤労感謝の日

  // 国民の休日：前日と翌日がともに祝日の平日（日曜以外）を休日にする
  for (const d of [...set].sort()) {
    const mid = new Date(`${d}T00:00:00`); mid.setDate(mid.getDate() + 1);
    const after = new Date(`${d}T00:00:00`); after.setDate(after.getDate() + 2);
    const midStr = ymd(mid.getFullYear(), mid.getMonth() + 1, mid.getDate());
    const afterStr = ymd(after.getFullYear(), after.getMonth() + 1, after.getDate());
    if (set.has(afterStr) && !set.has(midStr) && mid.getDay() !== 0) set.add(midStr);
  }
  // 振替休日：日曜が祝日なら、その後の最初の非祝日を休日にする
  for (const d of [...set].sort()) {
    if (dowOf(d) !== 0) continue;
    const sub = new Date(`${d}T00:00:00`);
    do { sub.setDate(sub.getDate() + 1); } while (set.has(ymd(sub.getFullYear(), sub.getMonth() + 1, sub.getDate())));
    set.add(ymd(sub.getFullYear(), sub.getMonth() + 1, sub.getDate()));
  }
  return set;
}

function holidaysOf(year: number): Set<string> {
  let s = _cache.get(year);
  if (!s) { s = build(year); _cache.set(year, s); }
  return s;
}

/** 国民の祝日（振替休日・国民の休日を含む）か。dateStr は YYYY-MM-DD */
export function isNationalHoliday(dateStr: string): boolean {
  return holidaysOf(Number(dateStr.slice(0, 4))).has(dateStr);
}

/** 休業日＝土曜・日曜または祝日か */
export function isClosedDay(dateStr: string): boolean {
  const dow = dowOf(dateStr);
  return dow === 0 || dow === 6 || isNationalHoliday(dateStr);
}
