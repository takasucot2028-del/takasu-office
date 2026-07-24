import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { listStaff, listLeave, addLeave, deleteLeave, computeLeaveBalance, genId, todayStr } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS, standardLeaveGrant } from '../../utils/constants';
import type { LeaveKind, LeaveRecord, Staff } from '../../types';

export default function Leave() {
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const staff = useMemo(() => allStaff.filter(s => s.status === 'active'), [allStaff]);
  const [staffId, setStaffId] = useState('');
  const selectedStaff = useMemo(() => staff.find(s => s.id === staffId) ?? null, [staff, staffId]);
  const [version, setVersion] = useState(0); // 追加・削除後の再読込用

  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [kind, setKind] = useState<LeaveKind>('use');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const summary = computeLeaveBalance(records);

  // 職員一覧を初回に読み込む
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await listStaff();
      if (!alive) return;
      setAllStaff(s);
      setStaffLoaded(true);
      const first = s.find(x => x.status === 'active');
      if (first) setStaffId(first.id);
    })();
    return () => { alive = false; };
  }, []);

  // 職員・更新のたびに有給記録を読み込む
  useEffect(() => {
    if (!staffId) { setRecords([]); return; }
    let alive = true;
    (async () => {
      const list = await listLeave(staffId);
      if (!alive) return;
      setRecords(list);
    })();
    return () => { alive = false; };
  }, [staffId, version]);

  const handleAdd = async (e: React.FormEvent) => {
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
    setSaving(true);
    try {
      await addLeave({ id: genId('lv'), staffId, kind, date, days: d, note });
      setNote('');
      setDays('1');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '有給記録の追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleStandardGrant = async () => {
    if (!selectedStaff) return;
    setError('');
    const g = standardLeaveGrant(selectedStaff, todayStr());
    if (!g.eligible) { setError(g.reason || '標準付与できません'); return; }
    const typeLabel = EMPLOYMENT_TYPE_LABELS[selectedStaff.employmentType];
    if (!confirm(`${selectedStaff.lastName} ${selectedStaff.firstName} さんに 標準付与 ${g.days}日 を付与します。よろしいですか？`)) return;
    setSaving(true);
    try {
      await addLeave({ id: genId('lv'), staffId, kind: 'grant', date: todayStr(), days: g.days, note: `標準付与（${typeLabel}）` });
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '標準付与に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この記録を削除しますか？')) return;
    try {
      await deleteLeave(id);
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '有給記録の削除に失敗しました');
    }
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

      {staffLoaded && staff.length === 0 && <Alert type="info">在職中の職員がいません。先に職員名簿から登録してください。</Alert>}

      {staffId && (
        <>
          {/* 残数サマリー */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <SummaryTile label="付与合計" value={`${summary.granted}日`} />
            <SummaryTile label="取得合計" value={`${summary.used}日`} />
            <SummaryTile label="残日数" value={`${summary.balance}日`} highlight />
          </div>

          {/* 標準付与 */}
          {selectedStaff && (
            <Card className="mb-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="font-bold text-gray-800">標準付与</h2>
                  <p className="text-xs text-gray-500 mt-0.5">常勤職員＝10日／パート職員＝5日（雇用開始から6か月経過後）</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {EMPLOYMENT_TYPE_LABELS[selectedStaff.employmentType]}・入職日 {selectedStaff.hireDate || '未設定'}
                    {(() => {
                      const g = standardLeaveGrant(selectedStaff, todayStr());
                      return g.eligible
                        ? <span className="text-emerald-700"> → {g.days}日 付与可能</span>
                        : <span className="text-gray-400"> → {g.reason}</span>;
                    })()}
                  </p>
                </div>
                <Button variant="secondary" onClick={handleStandardGrant} disabled={saving || !standardLeaveGrant(selectedStaff, todayStr()).eligible}>
                  標準付与する
                </Button>
              </div>
            </Card>
          )}

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
                <Button type="submit" className="w-full" disabled={saving}>{saving ? '追加中…' : '追加'}</Button>
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
