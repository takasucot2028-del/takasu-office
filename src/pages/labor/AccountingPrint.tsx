import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listExpenseCategories, listBudgets, listExpenses } from '../../api/data';
import { currentFiscalYear, fiscalYearLabel, PROJECT_DIVISIONS, divisionLabel } from '../../utils/constants';
import type { ExpenseCategory, Budget, Expense } from '../../types';

const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const monthOf = (date: string) => Number(date.slice(5, 7));
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

export default function AccountingPrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fy = Number(params.get('fy')) || currentFiscalYear();
  const division = params.get('division') ?? 'all'; // 'all'＝全区分、''＝未分類

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

  // 事業ごとの費目別（予算・執行・残・備考）
  const groups = useMemo(() => projects.map(p => {
    const cats = Array.from(new Set([
      ...budgets.filter(b => b.project === p).map(b => b.categoryId),
      ...approved.filter(e => e.project === p).map(e => e.categoryId),
    ]));
    const lines = cats.map(cid => {
      const bud = budgets.find(b => b.project === p && b.categoryId === cid);
      return { name: catMap.get(cid) || cid, budget: bud?.amount || 0, used: usedOf(p, cid), note: bud?.note || '' };
    });
    return { project: p, lines, budgetSum: lines.reduce((s, l) => s + l.budget, 0), usedSum: lines.reduce((s, l) => s + l.used, 0) };
  }), [projects, budgets, approved, catMap]);

  // 事業→区分（予算行の区分）。区分 → 事業 → 費目 の順に集計する
  const divisionOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of budgets) if (b.project && !m.has(b.project)) m.set(b.project, b.division || '');
    return (project: string) => m.get(project) ?? '';
  }, [budgets]);
  const divisionGroups = useMemo(() => {
    const order = [...PROJECT_DIVISIONS.map(d => d.id), ''];
    return order
      .map(id => {
        const items = groups.filter(g => divisionOf(g.project) === id);
        return {
          id, name: divisionLabel(id), projects: items,
          budgetSum: items.reduce((s, g) => s + g.budgetSum, 0),
          usedSum: items.reduce((s, g) => s + g.usedSum, 0),
        };
      })
      .filter(d => d.projects.length > 0)
      .filter(d => division === 'all' || d.id === division); // 指定区分のみ出力
  }, [groups, divisionOf, division]);

  return (
    <div className="acct-print max-w-full mx-auto px-4 py-5">
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">PDFで保存（印刷）</button>
        <span className="text-xs text-gray-400">送信先を「PDFに保存」に。用紙は横向き推奨。</span>
      </div>

      <h1 className="text-lg font-bold text-center mb-1">会計報告（予算執行状況）</h1>
      <p className="text-sm text-center mb-4">
        {fiscalYearLabel(fy)}{division !== 'all' && `　【${divisionLabel(division)}】`}
      </p>

      {loading ? <p className="text-sm text-gray-400">読み込み中…</p> : (
        <div style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
          {/* 事業ごとの費目別 予算執行 */}
          <h2 className="font-bold mb-1">区分・事業ごとの費目別 予算・執行状況</h2>
          {divisionGroups.length === 0 && <p className="text-sm text-gray-400 mb-4">該当する予算が登録されていません</p>}
          {divisionGroups.map(d => (
            <div key={d.id || 'none'} className="mb-5">
              <div className="flex items-baseline justify-between border-b-2 border-gray-700 mb-2 pb-0.5">
                <span className="font-bold">【{d.name}】</span>
                <span className="text-xs">
                  予算 {yen(d.budgetSum)}／執行 {yen(d.usedSum)}／残 {yen(d.budgetSum - d.usedSum)}
                </span>
              </div>
              {d.projects.map(g => (
            <div key={g.project} className="mb-4" style={{ breakInside: 'avoid' }}>
              <div className="font-bold bg-gray-100 border border-gray-500 border-b-0 px-2 py-1">{g.project}</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-left">費目</th>
                    <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-right w-28">予算額</th>
                    <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-right w-28">執行額</th>
                    <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-right w-28">残額</th>
                    <th className="border border-gray-500 px-2 py-1 bg-gray-100 text-left">備考</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="border border-gray-500 px-2 py-1">{l.name}</td>
                      <td className="border border-gray-500 px-2 py-1 text-right">{yen(l.budget)}</td>
                      <td className="border border-gray-500 px-2 py-1 text-right">{yen(l.used)}</td>
                      <td className="border border-gray-500 px-2 py-1 text-right">{yen(l.budget - l.used)}</td>
                      <td className="border border-gray-500 px-2 py-1">{l.note}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td className="border border-gray-500 px-2 py-1 font-bold">合計</td>
                    <td className="border border-gray-500 px-2 py-1 text-right font-bold">{yen(g.budgetSum)}</td>
                    <td className="border border-gray-500 px-2 py-1 text-right font-bold">{yen(g.usedSum)}</td>
                    <td className="border border-gray-500 px-2 py-1 text-right font-bold">{yen(g.budgetSum - g.usedSum)}</td>
                    <td className="border border-gray-500 px-2 py-1"></td>
                  </tr>
                </tbody>
              </table>
            </div>
              ))}
            </div>
          ))}
          <div className="mb-5" />

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
