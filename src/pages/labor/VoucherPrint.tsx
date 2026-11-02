// 支出伝票の印刷（A4縦・1枚に1伝票）
// 下半分は領収書の貼付スペースとして空けてある。
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/UI';
import { listExpenseCategories, listExpenses, listStaff, listBudgets, todayStr } from '../../api/data';
import { currentFiscalYear, divisionLabel } from '../../utils/constants';
import { buildVoucher, voucherYen, VOUCHER_APPROVERS, VOUCHER_TITLE } from '../../utils/voucher';
import type { ExpenseCategory, Expense, Staff, Budget } from '../../types';

export default function VoucherPrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id') || '';
  const fy = Number(params.get('fy')) || currentFiscalYear();

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  // この画面だけA4縦にする（他の印刷画面は横のため）
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 14mm; }';
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, e, s, b] = await Promise.all([
        listExpenseCategories(), listExpenses(fy), listStaff(), listBudgets(fy),
      ]);
      if (!alive) return;
      setCategories(c); setExpenses(e); setStaff(s); setBudgets(b); setLoading(false);
    })();
    return () => { alive = false; };
  }, [fy]);

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const staffMap = useMemo(() => new Map(staff.map(s => [s.id, `${s.lastName} ${s.firstName}`])), [staff]);
  // 事業名→事業区分は予算表の対応で引く（会計画面と同じ）
  const divisionOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of budgets) if (b.project && !m.has(b.project)) m.set(b.project, b.division || '');
    return (project: string) => m.get(project) ?? '';
  }, [budgets]);
  const expense = expenses.find(e => e.id === id);

  const voucher = expense && buildVoucher({
    expense,
    voucherNo: expense.voucherNo || '',
    issuedOn: todayStr(),
    divisionName: divisionLabel(divisionOf(expense.project)),
    categoryName: catMap.get(expense.categoryId) || expense.categoryId,
    applicantName: expense.staffId ? (staffMap.get(expense.staffId) || '(職員)') : '事務局',
  });

  return (
    <div className="bg-paper min-h-screen">
      <div className="no-print bg-white border-b border-rule px-4 py-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>← 戻る</Button>
        <Button size="sm" onClick={() => window.print()}>PDFで保存（印刷）</Button>
        <span className="text-xs text-ink-mute">印刷ダイアログで送信先を「PDFに保存」にするとPDFとして保存できます</span>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-ink-mute">読み込み中…</p>
      ) : !voucher ? (
        <p className="p-6 text-sm text-alert">経費が見つかりません。一覧に戻って選び直してください。</p>
      ) : (
        <div className="p-6 print:p-0">
          <section className="bg-white mx-auto p-8 print:p-0" style={{ width: '182mm' }}>
            {/* 見出し */}
            <div className="flex items-end justify-between mb-5">
              <h1 className="text-2xl font-bold tracking-widest text-ink">{VOUCHER_TITLE}</h1>
              <div className="text-right text-xs leading-6 text-ink-soft">
                <div>伝票番号　<span className="num text-sm font-bold text-ink">{voucher.voucherNo || '—'}</span></div>
                <div>発行日　<span className="num">{voucher.issuedOn}</span></div>
              </div>
            </div>

            {/* 承認欄（右から決裁順） */}
            <div className="flex justify-end gap-0 mb-5">
              {VOUCHER_APPROVERS.map(role => (
                <div key={role} className="border border-ink w-24 -ml-px">
                  <div className="border-b border-ink text-center text-xs py-1 bg-paper">{role}</div>
                  <div className="h-16" />
                </div>
              ))}
            </div>

            {/* 明細 */}
            <table className="w-full border-collapse text-sm mb-5">
              <tbody>
                {voucher.rows.map(r => (
                  <tr key={r.label}>
                    <th className="border border-ink bg-paper text-left px-3 py-2 w-28 font-medium">{r.label}</th>
                    <td className="num border border-ink px-3 py-2">{r.value || '—'}</td>
                  </tr>
                ))}
                <tr>
                  <th className="border border-ink bg-paper text-left px-3 py-2 font-medium">金額（税込）</th>
                  <td className="num border border-ink px-3 py-3 text-right text-xl font-bold">{voucherYen(voucher.amount)}</td>
                </tr>
                <tr>
                  <th className="border border-ink bg-paper text-left px-3 py-2 font-medium align-top">内容・摘要</th>
                  <td className="border border-ink px-3 py-2 h-20 align-top">{voucher.description}</td>
                </tr>
              </tbody>
            </table>

            {/* 領収書の貼付スペース */}
            <div className="border border-dashed border-ink-mute text-center" style={{ height: '95mm' }}>
              <p className="text-xs text-ink-mute mt-3">領収書貼付欄</p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
