/*
 * 支出（出金）伝票。
 *
 * 経費1件につき1枚。承認済みの経費に対して事務局が発行する。
 * 伝票番号は「年度-連番」（例 2026-0001）で、発行したときに採番して経費に保存する。
 * あとから過去日付の経費を足しても、すでに発行した番号がずれないようにするため。
 */
import type { Expense } from '../types';

export const VOUCHER_TITLE = '支出伝票';

/** 承認欄（右から決裁順）。就業規則ではなく会計の決裁ルール */
export const VOUCHER_APPROVERS = ['代表理事', '事務局長', '担当'] as const;

/** 伝票番号の形（2026-0001） */
export function formatVoucherNo(fiscalYear: number, seq: number): string {
  return `${fiscalYear}-${String(seq).padStart(4, '0')}`;
}

/** 伝票番号から連番を取り出す。その年度のものでなければ null */
function seqOf(voucherNo: string, fiscalYear: number): number | null {
  const m = /^(\d{4})-(\d+)$/.exec(voucherNo || '');
  if (!m || Number(m[1]) !== fiscalYear) return null;
  return Number(m[2]);
}

/**
 * その年度の次の伝票番号。
 * 使用済みの最大値＋1にする（欠番は埋めない。番号は帳簿の通し番号として扱う）。
 */
export function nextVoucherNo(expenses: Expense[], fiscalYear: number): string {
  const max = expenses.reduce((m, e) => {
    const n = seqOf(e.voucherNo || '', fiscalYear);
    return n !== null && n > m ? n : m;
  }, 0);
  return formatVoucherNo(fiscalYear, max + 1);
}

/** 伝票を発行できる経費か。承認済みのものだけを証憑にする */
export function canIssueVoucher(e: Expense): boolean {
  return e.status === 'approved';
}

/** 伝票に載せる1行（項目名と値） */
export interface VoucherRow {
  label: string;
  value: string;
}

export interface VoucherData {
  voucherNo: string;
  issuedOn: string;   // 発行日 YYYY-MM-DD
  rows: VoucherRow[]; // 支出日〜申請者
  amount: number;     // 金額（税込）
  description: string;
}

/**
 * 伝票の中身を組み立てる。PDF画面とExcel出力で同じものを使い、
 * 両方の記載内容が食い違わないようにする。
 */
export function buildVoucher(opts: {
  expense: Expense;
  voucherNo: string;
  issuedOn: string;
  divisionName: string;
  categoryName: string;
  applicantName: string;
}): VoucherData {
  const { expense: e, voucherNo, issuedOn, divisionName, categoryName, applicantName } = opts;
  return {
    voucherNo,
    issuedOn,
    rows: [
      { label: '支出日', value: e.date },
      { label: '事業区分', value: divisionName },
      { label: '事業名', value: e.project },
      { label: '費目', value: categoryName },
      { label: '申請者', value: applicantName },
    ],
    amount: e.amount,
    description: e.description,
  };
}

/** 金額の表記（¥1,234） */
export const voucherYen = (n: number) => `¥${(n || 0).toLocaleString()}`;
