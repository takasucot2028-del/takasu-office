// 年次有給休暇の法定管理（労働基準法第39条）
//
// このファイルが扱うのは次の3点。
//   1. 勤続年数に応じた法定付与日数（通常付与・比例付与）
//   2. 付与から2年で時効消滅すること（第115条）
//   3. 年10日以上付与された者の「年5日取得義務」（第39条第7項）
//
// 日数と時間の換算は 1日 = LEAVE_HOURS_PER_DAY 時間で統一する。

import { LEAVE_HOURS_PER_DAY, addMonths } from './constants';
import type { Staff, LeaveRecord } from '../types';

/** 付与の節目。0=6か月、以降は1年6か月、2年6か月…6年6か月以上 */
export const SERVICE_LABELS = ['6か月', '1年6か月', '2年6か月', '3年6か月', '4年6か月', '5年6か月', '6年6か月'];

/** 入職からその節目までの月数 */
const SERVICE_MONTHS = [6, 18, 30, 42, 54, 66, 78];

/** 通常付与（週所定労働日数5日以上、または週所定労働時間30時間以上）の日数 */
export const STATUTORY_DAYS_FULL = [10, 11, 12, 14, 16, 18, 20];

/** 比例付与（週30時間未満かつ週4日以下）。キーは週所定労働日数 */
export const STATUTORY_DAYS_PROPORTIONAL: Record<number, number[]> = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6, 8, 9, 10, 11],
  2: [3, 4, 4, 5, 6, 6, 7],
  1: [1, 2, 2, 2, 3, 3, 3],
};

/** 時効（付与から2年） */
export const LEAVE_EXPIRY_MONTHS = 24;

/** 年5日取得義務の対象になる付与日数と、その義務日数 */
export const OBLIGATION_TRIGGER_DAYS = 10;
export const OBLIGATION_REQUIRED_DAYS = 5;

/** その職員が比例付与の対象か。常勤は常に通常付与 */
export function isProportional(staff: Pick<Staff, 'employmentType' | 'weeklyWorkDays'>): boolean {
  if (staff.employmentType === 'fulltime') return false;
  const d = Number(staff.weeklyWorkDays) || 0;
  return d >= 1 && d <= 4;
}

/** 勤続年数の節目ごとの法定付与日数 */
export function statutoryDaysAt(staff: Pick<Staff, 'employmentType' | 'weeklyWorkDays'>, index: number): number {
  const i = Math.min(Math.max(index, 0), STATUTORY_DAYS_FULL.length - 1);
  if (!isProportional(staff)) return STATUTORY_DAYS_FULL[i];
  const table = STATUTORY_DAYS_PROPORTIONAL[Number(staff.weeklyWorkDays)];
  return table ? table[i] : STATUTORY_DAYS_FULL[i];
}

/** 法定付与1回分 */
export interface LeaveGrantPlan {
  index: number;        // 0=6か月、1=1年6か月…
  date: string;         // 付与日 YYYY-MM-DD
  days: number;         // 付与日数
  serviceLabel: string; // 「6か月」など
  registered: boolean;  // 同じ日付の付与記録が既にあるか
}

/**
 * 入職日から asOf までに到来する法定付与の一覧。
 * 6年6か月以降は毎年同じ日数（通常付与なら20日）を付与し続ける。
 */
export function statutoryGrantSchedule(
  staff: Pick<Staff, 'employmentType' | 'weeklyWorkDays' | 'hireDate' | 'retireDate' | 'status'>,
  asOf: string,
  records: LeaveRecord[] = []
): LeaveGrantPlan[] {
  if (!staff.hireDate) return [];
  const granted = new Set(
    records.filter(r => r.kind === 'grant' && (r.leaveType || 'paid') === 'paid').map(r => r.date)
  );
  const end = staff.status === 'retired' && staff.retireDate && staff.retireDate < asOf ? staff.retireDate : asOf;

  const out: LeaveGrantPlan[] = [];
  for (let i = 0; ; i++) {
    // 6年6か月より先は12か月ずつ足していく
    const months = i < SERVICE_MONTHS.length
      ? SERVICE_MONTHS[i]
      : SERVICE_MONTHS[SERVICE_MONTHS.length - 1] + (i - SERVICE_MONTHS.length + 1) * 12;
    const date = addMonths(staff.hireDate, months);
    if (date > end) break;
    const label = i < SERVICE_LABELS.length ? SERVICE_LABELS[i] : `${Math.floor(months / 12)}年${months % 12}か月`;
    out.push({
      index: i, date, days: statutoryDaysAt(staff, i),
      serviceLabel: label, registered: granted.has(date),
    });
    if (i > 60) break; // 念のための打ち切り
  }
  return out;
}

// ==== 残日数（2年の時効を考慮した先入先出） ====

/** 付与1件ぶんの消化状況 */
export interface LeaveLot {
  date: string;         // 付与日
  expiry: string;       // 時効日（この日から使えない）
  hours: number;        // 付与時間
  usedHours: number;    // 消化した時間
  expiredHours: number; // 時効で消滅した時間
  remainHours: number;  // 有効に残っている時間
}

export interface LeaveLedger {
  lots: LeaveLot[];
  grantedHours: number;
  usedHours: number;
  expiredHours: number;  // 時効消滅の合計
  balanceHours: number;  // 有効な残
  overusedHours: number; // 付与を超えて取得している分（データの不整合）
}

const hoursOf = (r: LeaveRecord) => (Number(r.days) || 0) * LEAVE_HOURS_PER_DAY + (Number(r.hours) || 0);
const approved = (r: LeaveRecord) => !r.status || r.status === 'approved';
/** 年次有給休暇の記録か（leaveType 未設定の旧データは年次有給として扱う） */
export const isAnnualPaid = (r: LeaveRecord) => (r.leaveType || 'paid') === 'paid';

/**
 * 付与を古い順に消化していき、asOf 時点の有効残を求める。
 * 取得日に有効だった付与からのみ消化する（時効後の付与は使えない）。
 */
export function computeLeaveLedger(records: LeaveRecord[], asOf: string): LeaveLedger {
  const paid = records.filter(r => approved(r) && isAnnualPaid(r));
  const lots: LeaveLot[] = paid
    .filter(r => r.kind === 'grant')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({
      date: r.date, expiry: addMonths(r.date, LEAVE_EXPIRY_MONTHS),
      hours: hoursOf(r), usedHours: 0, expiredHours: 0, remainHours: hoursOf(r),
    }));

  let overusedHours = 0;
  const uses = paid.filter(r => r.kind === 'use').sort((a, b) => a.date.localeCompare(b.date));
  for (const u of uses) {
    let rest = hoursOf(u);
    for (const lot of lots) {
      if (rest <= 0) break;
      // その取得日に有効な付与だけを消化に使う
      if (lot.date > u.date || u.date >= lot.expiry) continue;
      const take = Math.min(lot.remainHours, rest);
      lot.remainHours -= take;
      lot.usedHours += take;
      rest -= take;
    }
    overusedHours += rest;
  }

  // asOf の時点で時効を迎えている付与の残は消滅
  for (const lot of lots) {
    if (lot.expiry <= asOf && lot.remainHours > 0) {
      lot.expiredHours = lot.remainHours;
      lot.remainHours = 0;
    }
  }

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    lots,
    grantedHours: r1(lots.reduce((s, l) => s + l.hours, 0)),
    usedHours: r1(lots.reduce((s, l) => s + l.usedHours, 0) + overusedHours),
    expiredHours: r1(lots.reduce((s, l) => s + l.expiredHours, 0)),
    balanceHours: r1(lots.reduce((s, l) => s + l.remainHours, 0)),
    overusedHours: r1(overusedHours),
  };
}

// ==== 年5日取得義務（第39条第7項） ====

export interface FiveDayObligation {
  baseDate: string;   // 基準日（10日以上が付与された日）
  deadline: string;   // 取得期限（基準日の1年後の前日）
  taken: number;      // 期間内に取得した日数（時間単位年休は算入しない）
  remaining: number;  // あと何日取得させる必要があるか
  achieved: boolean;  // 5日を満たしたか
  current: boolean;   // asOf が期間内か
  overdue: boolean;   // 期限を過ぎて未達か
}

/** 日付に日数を足す */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 10日以上付与された基準日ごとに、1年間の取得日数と義務の達成状況を返す。
 * 時間単位で取得した年休は年5日には算入できないため、days のみを数える。
 */
export function fiveDayObligations(records: LeaveRecord[], asOf: string): FiveDayObligation[] {
  const paid = records.filter(r => approved(r) && isAnnualPaid(r));
  const bases = paid
    .filter(r => r.kind === 'grant' && (Number(r.days) || 0) >= OBLIGATION_TRIGGER_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date));
  const uses = paid.filter(r => r.kind === 'use');

  return bases.map(b => {
    const deadline = addDays(addMonths(b.date, 12), -1);
    const taken = Math.round(
      uses.filter(u => u.date >= b.date && u.date <= deadline)
        .reduce((s, u) => s + (Number(u.days) || 0), 0) * 100
    ) / 100;
    const remaining = Math.max(0, Math.round((OBLIGATION_REQUIRED_DAYS - taken) * 100) / 100);
    const current = asOf >= b.date && asOf <= deadline;
    return {
      baseDate: b.date, deadline, taken, remaining,
      achieved: remaining <= 0, current, overdue: asOf > deadline && remaining > 0,
    };
  });
}

/** 現在進行中（なければ直近）の義務期間 */
export function currentObligation(records: LeaveRecord[], asOf: string): FiveDayObligation | null {
  const list = fiveDayObligations(records, asOf);
  return list.find(o => o.current) ?? list[list.length - 1] ?? null;
}
