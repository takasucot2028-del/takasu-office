import { useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { listStaff, listLeave, addLeave, deleteLeave, leaveBalance, genId } from '../../utils/store';
import type { LeaveKind } from '../../types';

export default function Leave() {
  const staff = useMemo(() => listStaff().filter(s => s.status === 'active'), []);
  const [staffId, setStaffId] = useState(staff[0]?.id ?? '');
  const [version, setVersion] = useState(0); // 追加・削除後の再読込用

  const [kind, setKind] = useState<LeaveKind>('use');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const records = useMemo(() => (staffId ? listLeave(staffId) : []), [staffId, version]);
  const summary = useMemo(
    () => (staffId ? leaveBalance(staffId) : { granted: 0, used: 0, balance: 0 }),
    [staffId, version]
  );

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const d = Number(days);
    if (!d || d <= 0) {
      setError('日数は0.5日単位の正の数で入力してください');
      return;
    }
    if (kind === 'use' && d > summary.balance) {
      setError(`残日数（${summary.balance}日）を超えています`);
      return;
    }
    addLeave({ id: genId('lv'), staffId, kind, date, days: d, note });
    setNote('');
    setDays('1');
    setVersion(v => v + 1);
  };

  const handleDelete = (id: string) => {
    if (!confirm('この記録を削除しますか？')) return;
    deleteLeave(id);
    setVersion(v => v + 1);
  };

  return (
    <PageContainer title="有給休暇管理">
      <Card className="mb-4">
        <Select value={staffId} onChange={e => setStaffId(e.target.value)}>
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.lastName} {s.firstName}（{s.position || '役職なし'}）</option>
          ))}
        </Select>
      </Card>

      {staff.length === 0 && <Alert type="info">在職中の職員がいません。先に職員名簿から登録してください。</Alert>}

      {staffId && (
        <>
          {/* 残数サマリー */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <SummaryTile label="付与合計" value={`${summary.granted}日`} />
            <SummaryTile label="取得合計" value={`${summary.used}日`} />
            <SummaryTile label="残日数" value={`${summary.balance}日`} highlight />
          </div>

          {/* 記録追加 */}
          <Card className="mb-4">
            <h2 className="font-bold text-gray-800 mb-4">記録の追加</h2>
            {error && <Alert type="error">{error}</Alert>}
            <form onSubmit={handleAdd} className="grid sm:grid-cols-5 gap-3 items-end">
              <Field label="種別">
                <Select value={kind} onChange={e => setKind(e.target.value as LeaveKind)}>
                  <option value="use">取得</option>
                  <option value="grant">付与</option>
                </Select>
              </Field>
              <Field label={kind === 'grant' ? '付与日' : '取得日'}>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} required />
              </Field>
              <Field label="日数">
                <Input type="number" min={0.5} step={0.5} value={days} onChange={e => setDays(e.target.value)} required />
              </Field>
              <Field label="備考">
                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="例: 年次付与" />
              </Field>
              <div className="mb-4">
                <Button type="submit" className="w-full">追加</Button>
              </div>
            </form>
          </Card>

          {/* 履歴 */}
          <Card className="p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>日付</Th>
                  <Th>種別</Th>
                  <Th>日数</Th>
                  <Th>備考</Th>
                  <Th className="w-16"></Th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <Td>{r.date}</Td>
                    <Td>
                      <Badge color={r.kind === 'grant' ? 'blue' : 'green'}>
                        {r.kind === 'grant' ? '付与' : '取得'}
                      </Badge>
                    </Td>
                    <Td>{r.days}日</Td>
                    <Td>{r.note}</Td>
                    <Td>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)}>削除</Button>
                    </Td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <Td className="text-center text-gray-400 py-8" colSpan={5}>
                      記録がありません
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </PageContainer>
  );
}

function SummaryTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
    </Card>
  );
}
