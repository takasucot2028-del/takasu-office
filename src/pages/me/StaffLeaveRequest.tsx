import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { getMyLeave, addMyLeaveRequest, computeLeaveBalance, todayStr } from '../../api/data';
import { LEAVE_HOURS_PER_DAY } from '../../utils/constants';
import type { LeaveRecord, RequestStatus } from '../../types';

type LeaveUnit = 'day' | 'hour';
const STATUS_LABEL: Record<RequestStatus, string> = { requested: '申請中', approved: '承認済', rejected: '却下' };
const STATUS_COLOR: Record<RequestStatus, 'yellow' | 'green' | 'red'> = { requested: 'yellow', approved: 'green', rejected: 'red' };

export default function StaffLeaveRequest() {
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [unit, setUnit] = useState<LeaveUnit>('day');
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');

  const summary = useMemo(() => computeLeaveBalance(records), [records]);
  const pending = records.filter(r => r.status === 'requested');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMyLeave().then(r => { if (alive) { setRecords(r); setLoading(false); } });
    return () => { alive = false; };
  }, [version]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(amount);
    if (!v || v <= 0) { setError('日数・時間を入力してください'); return; }
    const useHours = unit === 'hour' ? v : v * LEAVE_HOURS_PER_DAY;
    if (useHours > summary.balanceHours) {
      setError(`残（${summary.balanceDays}日 / ${summary.balanceHours}h）を超えています`);
      return;
    }
    setSaving(true); setError(''); setMessage('');
    try {
      await addMyLeaveRequest({ date, days: unit === 'day' ? v : 0, hours: unit === 'hour' ? v : 0, note });
      setMessage('休暇を申請しました。事務局の承認をお待ちください。');
      setNote(''); setAmount('1');
      setVersion(x => x + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally { setSaving(false); }
  };

  return (
    <PageContainer title="休暇（有給）の申請">
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      {/* 残 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile label="付与" value={`${summary.grantedDays}日`} sub={`${summary.grantedHours}h`} />
        <Tile label="取得(承認済)" value={`${summary.usedDays}日`} sub={`${summary.usedHours}h`} />
        <Tile label="残（1日=7.5h）" value={`${summary.balanceDays}日`} sub={`${summary.balanceHours}h`} highlight />
      </div>

      <Card className="mb-4">
        <h2 className="font-bold text-gray-800 mb-3">申請する</h2>
        <form onSubmit={add} className="grid sm:grid-cols-5 gap-3 items-end">
          <Field label="取得日"><Input type="date" value={date} onChange={e => setDate(e.target.value)} required /></Field>
          <Field label="単位">
            <Select value={unit} onChange={e => setUnit(e.target.value as LeaveUnit)}>
              <option value="day">日</option>
              <option value="hour">時間</option>
            </Select>
          </Field>
          <Field label={unit === 'hour' ? '時間' : '日数'}>
            <Input type="number" min={unit === 'hour' ? 1 : 0.5} step={unit === 'hour' ? 1 : 0.5} value={amount} onChange={e => setAmount(e.target.value)} required />
          </Field>
          <Field label="備考"><Input value={note} onChange={e => setNote(e.target.value)} placeholder="例: 午後半休" /></Field>
          <div className="mb-4"><Button type="submit" className="w-full" disabled={saving}>{saving ? '申請中…' : '申請する'}</Button></div>
        </form>
        <p className="text-xs text-gray-400">1日＝{LEAVE_HOURS_PER_DAY}時間。時間単位は1時間から。申請は事務局の承認後に残へ反映されます。</p>
      </Card>

      {pending.length > 0 && (
        <Alert type="info">承認待ちの申請が {pending.length} 件あります。</Alert>
      )}

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead><tr><Th>日付</Th><Th>種別</Th><Th>日数/時間</Th><Th>状態</Th><Th>備考</Th></tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <Td>{r.date}</Td>
                <Td>{r.kind === 'grant' ? <Badge color="blue">付与</Badge> : <Badge color="gray">取得</Badge>}</Td>
                <Td>{r.hours > 0 ? `${r.hours}時間` : `${r.days}日`}</Td>
                <Td><Badge color={STATUS_COLOR[r.status || 'approved']}>{STATUS_LABEL[r.status || 'approved']}</Badge></Td>
                <Td>{r.note}</Td>
              </tr>
            ))}
            {!loading && records.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={5}>記録はまだありません</Td></tr>}
            {loading && <tr><Td className="text-center text-gray-400 py-8" colSpan={5}>読み込み中…</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </PageContainer>
  );
}

function Tile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </Card>
  );
}
