// 日本の国民の祝日（振替休日・国民の休日を含む）を年ごとに計算してキャッシュする。
// 春分・秋分は近似式（西暦2000〜2099で有効）。シフトの入力チェックで
// 「平日／休日・祝日」を判定するために使用する。

const _cache = new Map<number, Map<string, string>>();

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

function build(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const add = (m: number, d: number, name: string) => map.set(ymd(year, m, d), name);
  add(1, 1, '元日');
  map.set(ymd(year, 1, nthMonday(year, 1, 2)), '成人の日');
  add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');
  add(3, vernalEquinox(year), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日');
  map.set(ymd(year, 7, nthMonday(year, 7, 3)), '海の日');
  if (year >= 2016) add(8, 11, '山の日');
  map.set(ymd(year, 9, nthMonday(year, 9, 3)), '敬老の日');
  add(9, autumnalEquinox(year), '秋分の日');
  map.set(ymd(year, 10, nthMonday(year, 10, 2)), 'スポーツの日');
  add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');

  // 国民の休日：前日と翌日がともに祝日の平日（日曜以外）を休日にする
  for (const d of [...map.keys()].sort()) {
    const mid = new Date(`${d}T00:00:00`); mid.setDate(mid.getDate() + 1);
    const after = new Date(`${d}T00:00:00`); after.setDate(after.getDate() + 2);
    const midStr = ymd(mid.getFullYear(), mid.getMonth() + 1, mid.getDate());
    const afterStr = ymd(after.getFullYear(), after.getMonth() + 1, after.getDate());
    if (map.has(afterStr) && !map.has(midStr) && mid.getDay() !== 0) map.set(midStr, '国民の休日');
  }
  // 振替休日：日曜が祝日なら、その後の最初の非祝日を休日にする
  for (const d of [...map.keys()].sort()) {
    if (dowOf(d) !== 0) continue;
    const sub = new Date(`${d}T00:00:00`);
    do { sub.setDate(sub.getDate() + 1); } while (map.has(ymd(sub.getFullYear(), sub.getMonth() + 1, sub.getDate())));
    map.set(ymd(sub.getFullYear(), sub.getMonth() + 1, sub.getDate()), '振替休日');
  }
  return map;
}

function holidaysOf(year: number): Map<string, string> {
  let s = _cache.get(year);
  if (!s) { s = build(year); _cache.set(year, s); }
  return s;
}

/** 国民の祝日（振替休日・国民の休日を含む）か。dateStr は YYYY-MM-DD */
export function isNationalHoliday(dateStr: string): boolean {
  return holidaysOf(Number(dateStr.slice(0, 4))).has(dateStr);
}

/** 祝日の名称。祝日でなければ空文字 */
export function holidayName(dateStr: string): string {
  return holidaysOf(Number(dateStr.slice(0, 4))).get(dateStr) ?? '';
}

/* ---- 就業規則 第19条の休日（土日・祝日・年末年始・法人が指定する日） ---- */

/** 年末年始（12月29日〜1月4日）。第19条③ */
export function isYearEndHoliday(dateStr: string): boolean {
  const m = Number(dateStr.slice(5, 7)), d = Number(dateStr.slice(8, 10));
  return (m === 12 && d >= 29) || (m === 1 && d <= 4);
}

/**
 * 法人が指定する休日（第19条④）。
 * 事務局が設定画面で登録する。画面の描画中に同期で参照するため、
 * 読み込んだ内容をここに保持し、端末にも控えておく。
 */
const COMPANY_KEY = 'tof_company_holidays';
let _company: Map<string, string> | null = null;

function companyMap(): Map<string, string> {
  if (_company) return _company;
  try {
    const raw = localStorage.getItem(COMPANY_KEY);
    const list = raw ? JSON.parse(raw) as { date: string; name: string }[] : [];
    _company = new Map(list.map(h => [h.date, h.name || '休業日']));
  } catch { _company = new Map(); }
  return _company;
}

/** 取得した法人指定休日を反映する（データ層から呼ぶ） */
export function setCompanyHolidays(list: { date: string; name: string }[]) {
  _company = new Map(list.map(h => [h.date, h.name || '休業日']));
  try { localStorage.setItem(COMPANY_KEY, JSON.stringify(list)); } catch { /* 容量超過等は無視 */ }
}

export function isCompanyHoliday(dateStr: string): boolean {
  return companyMap().has(dateStr);
}

/** 休業日＝土曜・日曜・祝日・年末年始・法人が指定する日（就業規則 第19条） */
export function isClosedDay(dateStr: string): boolean {
  const dow = dowOf(dateStr);
  return dow === 0 || dow === 6
    || isNationalHoliday(dateStr) || isYearEndHoliday(dateStr) || isCompanyHoliday(dateStr);
}

/** その日の休日の名称（祝日・年末年始・法人指定日）。休日でなければ空文字 */
export function closedDayName(dateStr: string): string {
  const n = holidayName(dateStr);
  if (n) return n;
  if (isYearEndHoliday(dateStr)) return '年末年始';
  return companyMap().get(dateStr) ?? '';
}

/**
 * 曜日によらない休日（祝日・年末年始・法人指定日）か。
 * 画面で土日と別に色をつけるときに使う。
 */
export function isSpecialHoliday(dateStr: string): boolean {
  return isNationalHoliday(dateStr) || isYearEndHoliday(dateStr) || isCompanyHoliday(dateStr);
}
