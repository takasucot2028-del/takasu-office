import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listExpenseCategories, listBudgets, listExpenses } from '../../api/data';
import { currentFiscalYear, fiscalYearLabel } from '../../utils/constants';
import type { ExpenseCategory, Budget, Expense } from '../../types';

const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const monthOf = (date: string) => Number(date.slice(5, 7));
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

export default function AccountingPrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fy = Number(params.get('fy')) || currentFiscalYear();

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 8mm; }';
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, b, e] = await Promise.all([listExpenseCategories(), listBudgets(fy), listExpenses(fy)]);
      if (!alive) return;
      setCategories(c); setBudgets(b); setExpenses(e); setLoading(false);
    })();
    return () => { alive = false; };
  }, [fy]);

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const approved = useMemo(() => expenses.filter(e => e.status === 'approved'), [expenses]);
  const usedOf = (project: string, categoryId: string) =>
    approved.filter(e => e.project === project && e.categoryId === categoryId).reduce((s, e) => s + e.amount, 0);

  const projects = useMemo(
    () => Array.from(new Set([...budgets.map(b => b.project), ...approved.map(e => e.project)].filter(Boolean))),
    [budgets, approved]
  );
  const rows = useMemo(() => projects.map(p => {
    const months = FY_MONTHS.map(m => approved.filter(e => e.project === p && monthOf(e.date) === m).reduce((s, e) => s + e.amount, 0));
    return { project: p, months, total: months.reduce((s, n) => s + n, 0) };
  }), [projects, approved]);
  const monthTotals = FY_MONTHS.map((_, i) => rows.reduce((s, r) => s + r.months[i], 0));
  const grandTotal = monthTotals.reduce((s, n) => s + n, 0);

  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);
  const usedTotal = approved.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="acct-print max-w-full mx-auto px-4 py-5">
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">PDFで保存（印刷）</button>
        <span className="text-xs text-gray-400">送信先を「PDFに保存」に。用紙は横向き推奨。</span>
      </div>

      <h1 className="text-lg font-bold text-center mb-1">会計報告（予算執行状況）</h1>
      <p className="text-sm text-center mb-4">{fiscalYearLabel(fy)}</p>

      {loading ? <p className="text-sm text-gray-400">読み込み中…</p> : (
        <div style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
          {/* 予算執行状況 */}
          <h2 className="font-bold mb-1">予算執行状況（事業・費目別）</h2>
          <table className="w-full text-xs border-collapse mb-5">
            <thead>
              <tr>
                <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-left">事業</th>
                <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-left">費目</th>
                <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-right w-28">予算</th>
                <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-right w-28">執行</th>
                <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-right w-28">残額</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => {
                const used = usedOf(b.project, b.categoryId);
                return (
                  <tr key={b.id}>
                    <td className="border border-gray-500 px-2 py-1">{b.project}</td>
                    <td className="border border-gray-500 px-2 py-1">{catMap.get(b.categoryId) || b.categoryId}</td>
                    <td className="border border-gray-500 px-2 py-1 text-right">{yen(b.amount)}</td>
                    <td className="border border-gray-500 px-2 py-1 text-right">{yen(used)}</td>
                    <td className="border border-gray-500 px-2 py-1 text-right">{yen(b.amount - used)}</td>
                  </tr>
                );
              })}
              {budgets.length === 0 && <tr><td className="border border-gray-500 px-2 py-2 text-center text-gray-400" colSpan={5}>予算が登録されていません</td></tr>}
              {budgets.length > 0 && (
                <tr className="bg-gray-50">
                  <td className="border border-gray-500 px-2 py-1 font-bold" colSpan={2}>合計</td>
                  <td className="border border-gray-500 px-2 py-1 text-right font-bold">{yen(budgetTotal)}</td>
                  <td className="border border-gray-500 px-2 py-1 text-right font-bold">{yen(usedTotal)}</td>
                  <td className="border border-gray-500 px-2 py-1 text-right font-bold">{yen(budgetTotal - usedTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 月次集計 */}
          <h2 className="font-bold mb-1">月次集計（事業別・承認済み）</h2>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-left">事業</th>
                {FY_MONTHS.map(m => <th key={m} className="border border-gray-500 px-1 py-1 bg-gray-100 text-right">{m}月</th>)}
                <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-right">合計</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.project}>
                  <td className="border border-gray-500 px-2 py-1 whitespace-nowrap">{r.project}</td>
                  {r.months.map((n, i) => <td key={i} className="border border-gray-500 px-1 py-1 text-right">{n ? n.toLocaleString() : ''}</td>)}
                  <td className="border border-gray-500 px-2 py-1 text-right font-medium">{r.total.toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="border border-gray-500 px-2 py-2 text-center text-gray-400" colSpan={14}>承認済みの経費がありません</td></tr>}
              {rows.length > 0 && (
                <tr className="bg-gray-50">
                  <td className="border border-gray-500 px-2 py-1 font-bold">月計</td>
                  {monthTotals.map((n, i) => <td key={i} className="border border-gray-500 px-1 py-1 text-right">{n ? n.toLocaleString() : ''}</td>)}
                  <td className="border border-gray-500 px-2 py-1 text-right font-bold">{grandTotal.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
