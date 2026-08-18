// 36協定（時間外・休日労働に関する協定）の上限管理
//
// 労働基準法第36条の上限（2019年4月〜、中小企業は2020年4月〜）
//   原則            … 月45時間、年360時間（時間外のみ。休日労働は含まない）
//   特別条項がある場合の絶対的上限
//     ・年720時間（時間外のみ）
//     ・月100時間未満（時間外＋休日労働）
//     ・2〜6か月のどの平均も80時間以内（時間外＋休日労働）
//     ・月45時間を超えられるのは年6回まで
//
// 起算月は法人の36協定によるが、ここでは会計年度（4月始まり）で集計する。

import { fiscalYearOf } from './constants';

export const LIMIT_MONTHLY = 45;            // 原則の月上限（時間外のみ）
export const LIMIT_YEARLY = 360;            // 原則の年上限（時間外のみ）
export const LIMIT_YEARLY_SPECIAL = 720;    // 特別条項でも超えられない年上限
export const LIMIT_MONTHLY_ABSOLUTE = 100;  // 月の絶対上限（未満であること。時間外＋休日）
export const LIMIT_MULTI_MONTH_AVG = 80;    // 2〜6か月平均の上限（時間外＋休日）
export const LIMIT_OVER45_COUNT = 6;        // 月45時間を超えられる年間の回数
const WARN_MONTHLY = 40;                    // 月45時間が近いことを知らせる閾値

/** 1か月ぶんの時間外・休日労働 */
export interface MonthOvertime {
  month: string;         // YYYY-MM
  overtimeHours: number; // 時間外（休日労働を含まない）
  holidayHours: number;  // 休日労働
}

export interface Limit36Warning {
  level: 'error' | 'warn';  // error=上限超過、warn=上限に近い/原則超え
  text: string;
}

export interface Limit36Status {
  month: string;
  overtimeHours: number;      // 当月の時間外
  totalHours: number;         // 当月の時間外＋休日労働
  yearOvertimeHours: number;  // 年度の開始〜当月の時間外累計
  over45Count: number;        // 年度内で月45時間を超えた月数
  averages: { months: number; avg: number }[]; // 当月を末尾とする2〜6か月平均（時間外＋休日）
  warnings: Limit36Warning[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** YYYY-MM に月数を足す */
function addMonth(month: string, diff: number): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(y, m - 1 + diff, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/** 時間外の記録から月別の集計を作る（承認済みの実績のみ） */
export function monthlyTotals(
  records: { date: string; kind: string; status: string; resultHours: number }[]
): MonthOvertime[] {
  const map = new Map<string, MonthOvertime>();
  for (const r of records) {
    if (r.status !== 'approved') continue;
    const month = r.date.slice(0, 7);
    const cur = map.get(month) ?? { month, overtimeHours: 0, holidayHours: 0 };
    const h = Number(r.resultHours) || 0;
    if (r.kind === 'holiday') cur.holidayHours += h;
    else cur.overtimeHours += h;
    map.set(month, cur);
  }
  return [...map.values()]
    .map(m => ({ month: m.month, overtimeHours: r1(m.overtimeHours), holidayHours: r1(m.holidayHours) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 指定月時点の36協定の状況を判定する。
 * 年の累計・45時間超の回数は、その月が属する会計年度（4月始まり）で数える。
 */
export function evaluate36(months: MonthOvertime[], targetMonth: string): Limit36Status {
  const byMonth = new Map(months.map(m => [m.month, m]));
  const get = (m: string) => byMonth.get(m) ?? { month: m, overtimeHours: 0, holidayHours: 0 };
  const cur = get(targetMonth);
  const total = r1(cur.overtimeHours + cur.holidayHours);

  // 会計年度の開始月から当月までを年の集計対象にする
  const fy = fiscalYearOf(`${targetMonth}-01`);
  const inFiscalYear = months.filter(m => fiscalYearOf(`${m.month}-01`) === fy && m.month <= targetMonth);
  const yearOvertimeHours = r1(inFiscalYear.reduce((s, m) => s + m.overtimeHours, 0));
  const over45Count = inFiscalYear.filter(m => m.overtimeHours > LIMIT_MONTHLY).length;

  // 当月を末尾とする2〜6か月平均（時間外＋休日労働）
  const averages: { months: number; avg: number }[] = [];
  for (let k = 2; k <= 6; k++) {
    let sum = 0;
    for (let i = 0; i < k; i++) {
      const m = get(addMonth(targetMonth, -i));
      sum += m.overtimeHours + m.holidayHours;
    }
    averages.push({ months: k, avg: r1(sum / k) });
  }

  const warnings: Limit36Warning[] = [];
  if (total >= LIMIT_MONTHLY_ABSOLUTE) {
    warnings.push({ level: 'error', text: `当月の時間外＋休日労働が${total}時間です。月${LIMIT_MONTHLY_ABSOLUTE}時間未満に収める必要があります。` });
  }
  const overAvg = averages.filter(a => a.avg > LIMIT_MULTI_MONTH_AVG);
  if (overAvg.length > 0) {
    warnings.push({
      level: 'error',
      text: `直近${overAvg.map(a => a.months).join('・')}か月の平均が${LIMIT_MULTI_MONTH_AVG}時間を超えています（${overAvg.map(a => `${a.months}か月平均 ${a.avg}h`).join('、')}）。`,
    });
  }
  if (yearOvertimeHours > LIMIT_YEARLY_SPECIAL) {
    warnings.push({ level: 'error', text: `年度の時間外が${yearOvertimeHours}時間で、年${LIMIT_YEARLY_SPECIAL}時間の上限を超えています。` });
  }
  if (over45Count > LIMIT_OVER45_COUNT) {
    warnings.push({ level: 'error', text: `月${LIMIT_MONTHLY}時間を超えた月が${over45Count}回あります（年${LIMIT_OVER45_COUNT}回まで）。` });
  }
  if (cur.overtimeHours > LIMIT_MONTHLY) {
    warnings.push({
      level: 'warn',
      text: `当月の時間外が${cur.overtimeHours}時間で、原則の月${LIMIT_MONTHLY}時間を超えています（特別条項の対象。年${LIMIT_OVER45_COUNT}回まで／今年度${over45Count}回目）。`,
    });
  } else if (cur.overtimeHours >= WARN_MONTHLY) {
    warnings.push({ level: 'warn', text: `当月の時間外が${cur.overtimeHours}時間です。月${LIMIT_MONTHLY}時間まであと${r1(LIMIT_MONTHLY - cur.overtimeHours)}時間です。` });
  }
  if (yearOvertimeHours > LIMIT_YEARLY && yearOvertimeHours <= LIMIT_YEARLY_SPECIAL) {
    warnings.push({ level: 'warn', text: `年度の時間外が${yearOvertimeHours}時間で、原則の年${LIMIT_YEARLY}時間を超えています（特別条項の対象）。` });
  }

  return { month: targetMonth, overtimeHours: cur.overtimeHours, totalHours: total, yearOvertimeHours, over45Count, averages, warnings };
}
