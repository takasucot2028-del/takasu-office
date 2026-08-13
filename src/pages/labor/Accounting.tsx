import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import {
  getReference, saveExpenseCategories,
  saveBudgets, addExpense, setExpenseStatus, deleteExpense,
  getAccountingData, getAccountingCached, usedOf, genId, todayStr,
} from '../../api/data';
import { currentFiscalYear, fiscalYearLabel } from '../../utils/constants';
import type { Staff, ExpenseCategory, Budget, Expense } from '../../types';

type Tab = 'budget' | 'expense' | 'summary' | 'category';
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
// 会計年度の月順（4月〜翌3月）
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const monthOf = (date: string) => Number(date.slice(5, 7));

export default function Accounting() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('budget');
  const [fy, setFy] = useState(currentFiscalYear());
  const [staff, setStaff] = useState<Staff[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const staffMap = useMemo(() => new Map(staff.map(s => [s.id, `${s.lastName} ${s.firstName}`])), [staff]);

  // 保存直後（version変更）の再読込ではキャッシュ即表示をスキップし、最新のみ反映する。
  const skipCacheRef = useRef(false);

  useEffect(() => { getReference().then(r => { setStaff(r.staff); setCategories(r.categories); }); }, []);
  useEffect(() => {
    let alive = true;
    setMessage('');
    const cached = skipCacheRef.current ? null : getAccountingCached(fy); // 当該年度の保存があればまず即表示
    skipCacheRef.current = false;
    if (cached) {
      setBudgets(cached.budgets); setExpenses(cached.expenses); setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      const { budgets: b, expenses: e } = await getAccountingData(fy); // 最新を取得
      if (!alive) return;
      setExpenses(e); // 経費は読み取りのみ→常に最新
      // 予算はキャッシュ即表示から編集されていなければ最新に更新（編集中は保持）。updaterは副作用なしの純関数。
      const baseline = cached ? cached.budgets : null;
      setBudgets(prev => (baseline && JSON.stringify(prev) !== JSON.stringify(baseline)) ? prev : b);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [fy, version]);

  // ===== 予算 =====
  const setBudgetRow = (id: string, patch: Partial<Budget>) =>
    setBudgets(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  const addBudgetRow = () =>
    setBudgets(prev => [...prev, { id: genId('bg'), fiscalYear: fy, project: '', categoryId: categories[0]?.id || '', amount: 0, note: '' }]);
  const removeBudgetRow = (id: string) => setBudgets(prev => prev.filter(b => b.id !== id));

  const saveBudgetLines = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const clean = budgets.filter(b => b.project.trim() && b.categoryId).map(b => ({ ...b, fiscalYear: fy, amount: Number(b.amount) || 0, note: b.note || '' }));
      await saveBudgets(fy, clean);
      setMessage('予算を保存しました');
      skipCacheRef.current = true; setVersion(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : '保存に失敗しました'); }
    finally { setSaving(false); }
  };

  const budgetTotal = budgets.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const usedTotal = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);

  // ===== 経費 =====
  const pending = expenses.filter(e => e.status === 'requested');
  const changeExpense = async (id: string, status: Expense['status']) => {
    const prev = expenses;
    setExpenses(list => list.map(e => (e.id === id ? { ...e, status } : e))); // 楽観的に即反映
    setError('');
    try { await setExpenseStatus(id, status); }
    catch (err) { setExpenses(prev); setError(err instanceof Error ? err.message : '更新に失敗しました'); }
  };
  const removeExpense = async (id: string) => {
    if (!confirm('この経費を削除しますか？')) return;
    const prev = expenses;
    setExpenses(list => list.filter(e => e.id !== id)); // 楽観的に即削除（再取得せず）
    setError('');
    try { await deleteExpense(id); }
    catch (err) { setExpenses(prev); setError(err instanceof Error ? err.message : '削除に失敗しました'); }
  };

  // 事務局の直接登録フォーム
  const [exDate, setExDate] = useState(todayStr());
  const [exProject, setExProject] = useState('');
  const [exCat, setExCat] = useState('');
  const [exAmount, setExAmount] = useState('');
  const [exDesc, setExDesc] = useState('');
  const projectsOfYear = useMemo(() => Array.from(new Set(budgets.map(b => b.project).filter(Boolean))), [budgets]);
  const addExpenseDirect = async () => {
    if (!exProject || !exCat) { setError('事業と費目を選んでください'); return; }
    const amt = Number(exAmount);
    if (!amt || amt <= 0) { setError('金額を入力してください'); return; }
    setError('');
    const rec: Expense = { id: genId('ex'), fiscalYear: fy, staffId: '', date: exDate, project: exProject, categoryId: exCat, amount: amt, description: exDesc, status: 'approved', note: '事務局登録' };
    // 楽観的更新：先に画面へ即表示し、GASへの書き込みは裏で実行（失敗時のみ取り消す）
    setExpenses(prev => [rec, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setExAmount(''); setExDesc('');
    setMessage('経費を登録しました');
    try {
      await addExpense(rec);
    } catch (err) {
      setExpenses(prev => prev.filter(e => e.id !== rec.id)); // 失敗→取り消し
      setMessage('');
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    }
  };

  // ===== 費目マスタ =====
  const setCat = (id: string, patch: Partial<ExpenseCategory>) =>
    setCategories(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  const addCat = () => setCategories(prev => [...prev, { id: genId('ec'), name: '', order: prev.length + 1 }]);
  const removeCat = (id: string) => setCategories(prev => prev.filter(c => c.id !== id));
  const saveCats = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      await saveExpenseCategories(categories.filter(c => c.name.trim()).map((c, i) => ({ ...c, order: i + 1 })));
      setMessage('費目を保存しました');
    } catch (err) { setError(err instanceof Error ? err.message : '保存に失敗しました'); }
    finally { setSaving(false); }
  };

  // ===== 集計（承認済み経費の月次） =====
  const approved = useMemo(() => expenses.filter(e => e.status === 'approved'), [expenses]);
  const projects = useMemo(
    () => Array.from(new Set([...budgets.map(b => b.project), ...approved.map(e => e.project)].filter(Boolean))),
    [budgets, approved]
  );
  // 事業 × 月（会計年度順）の承認済み合計
  const projectMonthly = useMemo(() => projects.map(p => {
    const row = FY_MONTHS.map(m => approved.filter(e => e.project === p && monthOf(e.date) === m).reduce((s, e) => s + e.amount, 0));
    return { project: p, months: row, total: row.reduce((s, n) => s + n, 0) };
  }), [projects, approved]);
  const monthTotals = FY_MONTHS.map((_, i) => projectMonthly.reduce((s, r) => s + r.months[i], 0));
  const grandTotal = monthTotals.reduce((s, n) => s + n, 0);
  // 費目別 年間合計
  const categoryTotals = useMemo(() => categories.map(c => ({
    name: c.name,
    total: approved.filter(e => e.categoryId === c.id).reduce((s, e) => s + e.amount, 0),
  })).filter(c => c.total > 0), [categories, approved]);

  // 事業ごとの費目別（予算・執行・残・備考）
  const projectGroups = useMemo(() => projects.map(p => {
    const cats = Array.from(new Set([
      ...budgets.filter(b => b.project === p).map(b => b.categoryId),
      ...approved.filter(e => e.project === p).map(e => e.categoryId),
    ]));
    const lines = cats.map(cid => {
      const bud = budgets.find(b => b.project === p && b.categoryId === cid);
      const used = usedOf(expenses, p, cid);
      return { categoryId: cid, name: catMap.get(cid) || cid, budget: bud?.amount || 0, used, note: bud?.note || '' };
    });
    return {
      project: p, lines,
      budgetSum: lines.reduce((s, l) => s + l.budget, 0),
      usedSum: lines.reduce((s, l) => s + l.used, 0),
    };
  }), [projects, budgets, approved, expenses, catMap]);

  // CSV出力（当年度の全経費明細）
  const exportCsv = () => {
    const header = ['日付', '事業', '費目', '金額', '状態', '内容', '申請者'];
    const statusJa: Record<string, string> = { approved: '承認済', requested: '申請中', rejected: '却下' };
    const rows = expenses.map(e => [
      e.date, e.project, catMap.get(e.categoryId) || e.categoryId, String(e.amount),
      statusJa[e.status] || e.status, e.description,
      e.staffId ? (staffMap.get(e.staffId) || '職員') : '事務局',
    ]);
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM付きでExcelの文字化け防止
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `経費明細_${fy}年度.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <PageContainer title="会計管理">
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setFy(y => y - 1)}>←</Button>
            <span className="font-bold text-gray-800 text-sm">{fiscalYearLabel(fy)}</span>
            <Button variant="secondary" size="sm" onClick={() => setFy(y => y + 1)}>→</Button>
          </div>
          <div className="flex rounded-md overflow-hidden border border-gray-300 ml-auto">
            {([['budget', '予算'], ['expense', '経費'], ['summary', '集計'], ['category', '費目マスタ']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-sm ${tab === t ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{label}</button>
            ))}
          </div>
        </div>
      </Card>

      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      {/* 予算タブ */}
      {tab === 'budget' && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Tile label="予算合計" value={yen(budgetTotal)} />
            <Tile label="執行合計" value={yen(usedTotal)} />
            <Tile label="残額合計" value={yen(budgetTotal - usedTotal)} highlight />
          </div>
          <div className="flex justify-end gap-2 mb-3">
            <Button variant="secondary" size="sm" onClick={addBudgetRow}>＋ 行を追加</Button>
            <Button size="sm" onClick={saveBudgetLines} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
          </div>
          <Card className="p-0 overflow-x-auto">
            <Table>
              <thead><tr><Th>事業</Th><Th>費目</Th><Th>予算</Th><Th>執行</Th><Th>残額</Th><Th>備考</Th><Th className="w-12"></Th></tr></thead>
              <tbody>
                {budgets.map(b => {
                  const used = usedOf(expenses, b.project, b.categoryId);
                  return (
                    <tr key={b.id}>
                      <Td className="min-w-32"><Input value={b.project} onChange={e => setBudgetRow(b.id, { project: e.target.value })} placeholder="例: 水泳教室" /></Td>
                      <Td className="min-w-28">
                        <Select value={b.categoryId} onChange={e => setBudgetRow(b.id, { categoryId: e.target.value })}>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                      </Td>
                      <Td className="min-w-28"><Input type="number" min={0} step={1000} value={b.amount || ''} onChange={e => setBudgetRow(b.id, { amount: Number(e.target.value) || 0 })} /></Td>
                      <Td className="whitespace-nowrap text-gray-600">{yen(used)}</Td>
                      <Td className={`whitespace-nowrap font-medium ${b.amount - used < 0 ? 'text-red-600' : 'text-gray-800'}`}>{yen(b.amount - used)}</Td>
                      <Td className="min-w-32"><Input value={b.note || ''} onChange={e => setBudgetRow(b.id, { note: e.target.value })} placeholder="例: 指導者謝金" /></Td>
                      <Td><Button variant="ghost" size="sm" onClick={() => removeBudgetRow(b.id)}>削除</Button></Td>
                    </tr>
                  );
                })}
                {budgets.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={7}>{loading ? '読み込み中…' : 'この年度の予算はまだありません。「行を追加」で登録してください。'}</Td></tr>}
              </tbody>
            </Table>
          </Card>
          <p className="text-xs text-gray-400 mt-2">執行＝承認済み経費の合計。予算を変更したら「保存する」を押してください。</p>
        </>
      )}

      {/* 経費タブ */}
      {tab === 'expense' && (
        <>
          {pending.length > 0 && (
            <Card className="mb-4 border-yellow-300">
              <h2 className="font-bold text-gray-800 mb-3">承認待ちの経費申請（{pending.length}件）</h2>
              <div className="space-y-2">
                {pending.map(e => (
                  <div key={e.id} className="flex items-center gap-3 flex-wrap text-sm">
                    <span className="font-medium">{e.date}</span>
                    <span>{staffMap.get(e.staffId) || '(職員)'}</span>
                    <span className="text-gray-500">{e.project}／{catMap.get(e.categoryId) || e.categoryId}</span>
                    <span className="font-bold">{yen(e.amount)}</span>
                    {e.description && <span className="text-xs text-gray-500">{e.description}</span>}
                    <div className="flex-1" />
                    <Button size="sm" onClick={() => changeExpense(e.id, 'approved')}>承認</Button>
                    <Button size="sm" variant="secondary" onClick={() => changeExpense(e.id, 'rejected')}>却下</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="mb-4">
            <h2 className="font-bold text-gray-800 mb-3">経費を直接登録（承認済）</h2>
            <div className="grid sm:grid-cols-5 gap-3 items-end">
              <Field label="日付"><Input type="date" value={exDate} onChange={e => setExDate(e.target.value)} /></Field>
              <Field label="事業">
                <Select value={exProject} onChange={e => setExProject(e.target.value)}>
                  <option value="">選択</option>
                  {projectsOfYear.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </Field>
              <Field label="費目">
                <Select value={exCat} onChange={e => setExCat(e.target.value)}>
                  <option value="">選択</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="金額"><Input type="number" min={0} value={exAmount} onChange={e => setExAmount(e.target.value)} /></Field>
              <div className="mb-4"><Button className="w-full" onClick={addExpenseDirect}>登録</Button></div>
            </div>
            <Field label="内容"><Input value={exDesc} onChange={e => setExDesc(e.target.value)} placeholder="例: 大会用備品購入" /></Field>
          </Card>

          <Card className="p-0 overflow-x-auto">
            <Table>
              <thead><tr><Th>日付</Th><Th>申請者</Th><Th>事業／費目</Th><Th>金額</Th><Th>状態</Th><Th>内容</Th><Th className="w-12"></Th></tr></thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{e.date}</Td>
                    <Td className="whitespace-nowrap">{e.staffId ? (staffMap.get(e.staffId) || '(職員)') : '事務局'}</Td>
                    <Td className="whitespace-nowrap">{e.project}／{catMap.get(e.categoryId) || e.categoryId}</Td>
                    <Td className="whitespace-nowrap font-medium">{yen(e.amount)}</Td>
                    <Td><Badge color={e.status === 'approved' ? 'green' : e.status === 'requested' ? 'yellow' : 'red'}>{e.status === 'approved' ? '承認済' : e.status === 'requested' ? '申請中' : '却下'}</Badge></Td>
                    <Td>{e.description}</Td>
                    <Td><Button variant="ghost" size="sm" onClick={() => removeExpense(e.id)}>削除</Button></Td>
                  </tr>
                ))}
                {expenses.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={7}>{loading ? '読み込み中…' : '経費はまだありません'}</Td></tr>}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {/* 集計タブ */}
      {tab === 'summary' && (
        <>
          <div className="flex justify-end gap-2 mb-3">
            <Button variant="secondary" size="sm" onClick={exportCsv}>CSV出力</Button>
            <Button variant="secondary" size="sm" onClick={() => navigate(`/labor/accounting/print?fy=${fy}`)}>PDF出力</Button>
          </div>

          <h2 className="font-bold text-gray-800 mb-2">事業ごとの費目別 予算・執行</h2>
          {projectGroups.length === 0 && <Card className="mb-6"><p className="text-sm text-gray-400">{loading ? '読み込み中…' : '事業予算がまだ登録されていません。'}</p></Card>}
          {projectGroups.map(g => (
            <Card key={g.project} className="p-0 overflow-hidden mb-4">
              <div className="px-3 py-2 bg-gray-50 border-b font-bold text-gray-800">{g.project}</div>
              <Table>
                <thead><tr><Th>費目</Th><Th>予算額</Th><Th>執行額</Th><Th>残額</Th><Th>備考</Th></tr></thead>
                <tbody>
                  {g.lines.map(l => (
                    <tr key={l.categoryId}>
                      <Td>{l.name}</Td>
                      <Td className="whitespace-nowrap text-right">{yen(l.budget)}</Td>
                      <Td className="whitespace-nowrap text-right">{yen(l.used)}</Td>
                      <Td className={`whitespace-nowrap text-right ${l.budget - l.used < 0 ? 'text-red-600' : ''}`}>{yen(l.budget - l.used)}</Td>
                      <Td>{l.note}</Td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-medium">
                    <Td>合計</Td>
                    <Td className="whitespace-nowrap text-right">{yen(g.budgetSum)}</Td>
                    <Td className="whitespace-nowrap text-right">{yen(g.usedSum)}</Td>
                    <Td className="whitespace-nowrap text-right">{yen(g.budgetSum - g.usedSum)}</Td>
                    <Td>{''}</Td>
                  </tr>
                </tbody>
              </Table>
            </Card>
          ))}

          <h2 className="font-bold text-gray-800 mb-2 mt-6">月次集計（事業別・承認済み）</h2>
          <Card className="p-0 overflow-x-auto mb-6">
            <table className="border-collapse text-sm w-full">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-gray-50 text-left px-3 py-2 text-gray-600 font-medium border-b border-r whitespace-nowrap">事業</th>
                  {FY_MONTHS.map(m => <th key={m} className="px-2 py-2 text-xs text-gray-500 font-medium border-b border-r bg-gray-50 whitespace-nowrap text-right">{m}月</th>)}
                  <th className="px-3 py-2 text-xs text-gray-600 font-medium border-b bg-gray-50 text-right">合計</th>
                </tr>
              </thead>
              <tbody>
                {projectMonthly.map(r => (
                  <tr key={r.project}>
                    <td className="sticky left-0 bg-white px-3 py-1.5 border-b border-r whitespace-nowrap font-medium">{r.project}</td>
                    {r.months.map((n, i) => <td key={i} className="px-2 py-1.5 border-b border-r text-right text-gray-700">{n ? n.toLocaleString() : ''}</td>)}
                    <td className="px-3 py-1.5 border-b text-right font-medium">{r.total.toLocaleString()}</td>
                  </tr>
                ))}
                {projectMonthly.length === 0 && <tr><td className="text-center text-gray-400 py-8" colSpan={14}>承認済みの経費がありません</td></tr>}
              </tbody>
              {projectMonthly.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50">
                    <td className="sticky left-0 bg-gray-50 px-3 py-1.5 border-t border-r font-medium">月計</td>
                    {monthTotals.map((n, i) => <td key={i} className="px-2 py-1.5 border-t border-r text-right text-gray-700">{n ? n.toLocaleString() : ''}</td>)}
                    <td className="px-3 py-1.5 border-t text-right font-bold text-emerald-700">{grandTotal.toLocaleString()}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Card>

          <h2 className="font-bold text-gray-800 mb-2">費目別 年間合計（承認済み）</h2>
          <Card className="p-0 overflow-hidden">
            <Table>
              <thead><tr><Th>費目</Th><Th>金額</Th></tr></thead>
              <tbody>
                {categoryTotals.map(c => (
                  <tr key={c.name}><Td>{c.name}</Td><Td className="whitespace-nowrap">{yen(c.total)}</Td></tr>
                ))}
                {categoryTotals.length === 0 && <tr><Td className="text-center text-gray-400 py-6" colSpan={2}>承認済みの経費がありません</Td></tr>}
                {categoryTotals.length > 0 && (
                  <tr className="bg-gray-50"><Td className="font-medium">合計</Td><Td className="whitespace-nowrap font-bold text-emerald-700">{yen(grandTotal)}</Td></tr>
                )}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {/* 費目マスタ */}
      {tab === 'category' && (
        <>
          <div className="flex justify-end gap-2 mb-3">
            <Button variant="secondary" size="sm" onClick={addCat}>＋ 費目を追加</Button>
            <Button size="sm" onClick={saveCats} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
          </div>
          <Card className="p-0 overflow-hidden">
            <Table>
              <thead><tr><Th>費目名</Th><Th className="w-16"></Th></tr></thead>
              <tbody>
                {categories.map(c => (
                  <tr key={c.id}>
                    <Td><Input value={c.name} onChange={e => setCat(c.id, { name: e.target.value })} /></Td>
                    <Td><Button variant="ghost" size="sm" onClick={() => removeCat(c.id)}>削除</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <p className="text-xs text-gray-400 mt-2">費目は予算・経費で共通に使います。使用中の費目を削除しても過去データは残ります。</p>
        </>
      )}
    </PageContainer>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
    </Card>
  );
}
