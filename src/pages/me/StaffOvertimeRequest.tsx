import { useEffect, useState } from 'react';
import { PageContainer, Card, Field, Input, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { getMyProfile, getMyOvertime, addMyOvertime, todayStr } from '../../api/data';
import { WEEKDAY_LABELS, hoursBetween } from '../../utils/constants';
import { overtimeKindOf, allowanceOf, OVERTIME_KIND_LABELS, OVERTIME_STATUS_LABELS, OVERTIME_DISPOSITION_LABELS } from '../../utils/overtime';
import type { Staff, OvertimeRecord } from '../../types';

const h1 = (n: number) => `${Math.round(n * 10) / 10}h`;

export default function StaffOvertimeRequest() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [records, setRecords] = useState<OvertimeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [date, setDate] = useState(todayStr());
  const [start, setStart] = useState('17:00');
  const [end, setEnd] = useState('19:00');
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(0);
  const hrs = hoursBetween(start, end);

  useEffect(() => { getMyProfile().then(setStaff); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMyOvertime().then(r => { if (alive) { setRecords(r); setLoading(false); } });
    return () => { alive = false; };
  }, [version]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff) return;
    if (!start || !end) { setError('開始・終了の時刻を入力してください'); return; }
    if (hrs <= 0) { setError('終了は開始より後の時刻にしてください'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      await addMyOvertime({ date, appliedHours: hrs, startTime: start, endTime: end, reason, kind: overtimeKindOf(staff, date) });
      setMessage('時間外を申請しました。事務局の承認をお待ちください。');
      setReason('');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally { setSaving(false); }
  };

  const statusColor = (s: OvertimeRecord['status']) => s === 'approved' ? 'green' : 'yellow';

  return (
    <PageContainer title="時間外・休日勤務の申請">
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <Card className="mb-4">
        <h2 className="font-bold text-gray-800 mb-3">申請する</h2>
        <form onSubmit={add} className="grid sm:grid-cols-5 gap-3 items-end">
          <Field label="日付">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </Field>
          <Field label="開始">
            <Input type="time" value={start} onChange={e => setStart(e.target.value)} required />
          </Field>
          <Field label="終了">
            <Input type="time" value={end} onChange={e => setEnd(e.target.value)} required />
          </Field>
          <Field label="事由">
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="例: イベント準備" />
          </Field>
          <div className="mb-4"><Button type="submit" className="w-full" disabled={saving || !staff}>{saving ? '申請中…' : '申請する'}</Button></div>
        </form>
        <p className="text-xs text-gray-400">申請時間 = 終了 − 開始（現在: <span className="font-medium text-gray-600">{hrs > 0 ? `${hrs}h` : '—'}</span>）。実績時間・手当/代休は、勤務後に事務局が勤怠をもとに確定します。</p>
      </Card>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead>
            <tr><Th>日付</Th><Th>種別</Th><Th>申請</Th><Th>状態</Th><Th>実績</Th><Th>処理</Th><Th>金額</Th></tr>
          </thead>
          <tbody>
            {records.map(r => {
              const wd = new Date(`${r.date}T00:00:00`).getDay();
              const k = r.kind || (staff ? overtimeKindOf(staff, r.date) : 'overtime');
              const approved = r.status === 'approved';
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{Number(r.date.slice(5, 7))}/{Number(r.date.slice(8))}
                    <span className="ml-1 text-xs text-gray-400">({WEEKDAY_LABELS[wd]})</span>
                  </Td>
                  <Td><Badge color={k === 'holiday' ? 'red' : 'yellow'}>{OVERTIME_KIND_LABELS[k]}</Badge></Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    {r.startTime && r.endTime ? <span>{r.startTime}〜{r.endTime}<span className="text-gray-400 ml-1">({r.appliedHours}h)</span></span> : `${r.appliedHours}h`}
                  </Td>
                  <Td><Badge color={statusColor(r.status)}>{OVERTIME_STATUS_LABELS[r.status === 'approved' ? 'approved' : 'applied']}</Badge></Td>
                  <Td className="whitespace-nowrap">{approved ? h1(r.resultHours || 0) : '—'}</Td>
                  <Td>{approved && r.disposition ? OVERTIME_DISPOSITION_LABELS[r.disposition] : '—'}</Td>
                  <Td className="whitespace-nowrap">{approved && r.disposition === 'allowance' && staff ? `¥${allowanceOf(r.resultHours || 0, staff.hourlyWage || 0, k).toLocaleString()}` : '—'}</Td>
                </tr>
              );
            })}
            {!loading && records.length === 0 && <tr><Td className="text-center text-gray-400 py-8" colSpan={7}>申請はまだありません</Td></tr>}
            {loading && <tr><Td className="text-center text-gray-400 py-8" colSpan={7}>読み込み中…</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </PageContainer>
  );
}
