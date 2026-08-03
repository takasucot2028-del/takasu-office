import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { getExpenseContext, listMyExpenses, addMyExpense, todayStr } from '../../api/data';
import type { ExpenseContext } from '../../api/data';
import { currentFiscalYear, fiscalYearLabel } from '../../utils/constants';
import type { Expense, RequestStatus } from '../../types';

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const STATUS_LABEL: Record<RequestStatus, string> = { requested: '申請中', approved: '承認済', rejected: '却下' };
const STATUS_COLOR: Record<RequestStatus, 'yellow' | 'green' | 'red'> = { requested: 'yellow', approved: 'green', rejected: 'red' };

export default function StaffExpense() {
  const fy = currentFiscalYear();
  const [ctx, setCtx] = useState<ExpenseContext>({ categories: [], lines: [] });
  const [mine, setMine] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [date, setDate] = useState(todayStr());
  const [project, setProject] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const catMap = useMemo(() => new Map(ctx.categories.map(c => [c.id, c.name])), [ctx]);
  const projects = useMemo(() => Array.from(new Set(ctx.lines.map(l => l.project))), [ctx]);
  const catsOfProject = useMemo(() => ctx.lines.filter(l => l.project === project), [ctx, project]);
  const selectedLine = useMemo(() => ctx.lines.find(l => l.project === project && l.categoryId === categoryId), [ctx, project, categoryId]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setMessage('');
    (async () => {
      const [c, m] = await Promise.all([getExpenseContext(fy), listMyExpenses()]);
      if (!alive) return;
      setCtx(c); setMine(m); setLoading(false);
    })();
    return () => { alive = false; };
  }, [fy, version]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !categoryId) { setError('事業と費目を選んでください'); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('金額を入力してください'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      await addMyExpense({ fiscalYear: fy, date, project, categoryId, amount: amt, description });
      setMessage('経費を申請しました。事務局の承認をお待ちください。');
      setAmount(''); setDescription('');
      setVersion(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : '申請に失敗しました'); }
    finally { setSaving(false); }
  };

  return (
    <PageContainer title="経費の申請">
      <Card className="mb-4"><p className="text-sm text-gray-600">対象年度：<span className="font-bold">{fiscalYearLabel(fy)}</span></p></Card>
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <Card className="mb-4">
        <h2 className="font-bold text-gray-800 mb-3">申請する</h2>
        {ctx.lines.length === 0 && !loading && <Alert type="info">今年度の事業予算がまだ登録されていません。事務局にお問い合わせください。</Alert>}
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
          <Field label="支出日"><Input type="date" value={date} onChange={e => setDate(e.target.value)} required /></Field>
          <Field label="金額（円）"><Input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} required /></Field>
          <Field label="事業">
            <Select value={project} onChange={e => { setProject(e.target.value); setCategoryId(''); }}>
              <option value="">選択してください</option>
              {projects.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="費目">
            <Select value={categoryId} onChange={e => setCategoryId(e.target.value)} disabled={!project}>
              <option value="">選択してください</option>
              {catsOfProject.map(l => <option key={l.categoryId} value={l.categoryId}>{catMap.get(l.categoryId) || l.categoryId}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="内容"><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="例: 大会用の文房具" /></Field>
          </div>
          {selectedLine && (
            <div className="sm:col-span-2 text-sm bg-gray-50 rounded-md px-3 py-2">
              この費目の残額：<span className={`font-bold ${selectedLine.remaining < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{yen(selectedLine.remaining)}</span>
              <span className="text-xs text-gray-400 ml-2">（予算 {yen(selectedLine.budget)}・執行 {yen(selectedLine.used)}）</span>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving || ctx.lines.length === 0}>{saving ? '申請中…' : '申請する'}</Button>
          </div>
        </form>
      </Card>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead><tr><Th>日付</Th><Th>事業／費目</Th><Th>金額</Th><Th>状態</Th><Th>内容</Th></tr></thead>
          <tbody>
            {mine.map(e => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{e.date}</Td>
                <Td className="whitespace-nowrap">{e.project}／{catMap.get(e.categoryId) || e.categoryId}</Td>
                <Td className="whitespace-nowrap font-medium">{yen(e.amount)}</Td>
                <Td><Badge color={STATUS_COLOR[e.status || 'requested']}>{STATUS_LABEL[e.status || 'requested']}</Badge></Td>
                <Td>{e.description}</Td>
              </tr>
            ))}
            {!loading && mine.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={5}>申請はまだありません</Td></tr>}
            {loading && <tr><Td className="text-center text-gray-400 py-8" colSpan={5}>読み込み中…</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </PageContainer>
  );
}
