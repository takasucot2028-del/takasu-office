import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import {
  listStaff, listExpenseCategories, saveExpenseCategories,
  listBudgets, saveBudgets, listExpenses, addExpense, setExpenseStatus, deleteExpense,
  usedOf, genId, todayStr,
} from '../../api/data';
import { currentFiscalYear, fiscalYearLabel } from '../../utils/constants';
import type { Staff, ExpenseCategory, Budget, Expense } from '../../types';

type Tab = 'budget' | 'expense' | 'category';
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

export default function Accounting() {
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

  useEffect(() => { listStaff().then(setStaff); listExpenseCategories().then(setCategories); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setMessage('');
    (async () => {
      const [b, e] = await Promise.all([listBudgets(fy), listExpenses(fy)]);
      if (!alive) return;
      setBudgets(b); setExpenses(e); setLoading(false);
    })();
    return () => { alive = false; };
  }, [fy, version]);

  // ===== 予算 =====
  const setBudgetRow = (id: string, patch: Partial<Budget>) =>
    setBudgets(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  const addBudgetRow = () =>
    setBudgets(prev => [...prev, { id: genId('bg'), fiscalYear: fy, project: '', categoryId: categories[0]?.id || '', amount: 0 }]);
  const removeBudgetRow = (id: string) => setBudgets(prev => prev.filter(b => b.id !== id));

  const saveBudgetLines = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const clean = budgets.filter(b => b.project.trim() && b.categoryId).map(b => ({ ...b, fiscalYear: fy, amount: Number(b.amount) || 0 }));
      await saveBudgets(fy, clean);
      setMessage('予算を保存しました');
      setVersion(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : '保存に失敗しました'); }
    finally { setSaving(false); }
  };

  const budgetTotal = budgets.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const usedTotal = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);

  // ===== 経費 =====
  const pending = expenses.filter(e => e.status === 'requested');
  const changeExpense = async (id: string, status: Expense['status']) => {
    try { await setExpenseStatus(id, status); setVersion(v => v + 1); }
    catch (err) { setError(err instanceof Error ? err.message : '更新に失敗しました'); }
  };
  const removeExpense = async (id: string) => {
    if (!confirm('この経費を削除しますか？')) return;
    try { await deleteExpense(id); setVersion(v => v + 1); }
    catch (err) { setError(err instanceof Error ? err.message : '削除に失敗しました'); }
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
    try {
      await addExpense({ id: genId('ex'), fiscalYear: fy, staffId: '', date: exDate, project: exProject, categoryId: exCat, amount: amt, description: exDesc, status: 'approved', note: '事務局登録' });
      setExAmount(''); setExDesc('');
      setVersion(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : '登録に失敗しました'); }
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
            {([['budget', '予算'], ['expense', '経費'], ['category', '費目マスタ']] as [Tab, string][]).map(([t, label]) => (
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
              <thead><tr><Th>事業</Th><Th>費目</Th><Th>予算</Th><Th>執行</Th><Th>残額</Th><Th className="w-12"></Th></tr></thead>
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
                      <Td><Button variant="ghost" size="sm" onClick={() => removeBudgetRow(b.id)}>削除</Button></Td>
                    </tr>
                  );
                })}
                {budgets.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={6}>{loading ? '読み込み中…' : 'この年度の予算はまだありません。「行を追加」で登録してください。'}</Td></tr>}
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
