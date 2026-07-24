import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { listStaff, listLeave, addLeave, deleteLeave, computeLeaveBalance, genId, todayStr } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS, standardLeaveGrant, LEAVE_HOURS_PER_DAY } from '../../utils/constants';
import type { LeaveKind, LeaveRecord, Staff } from '../../types';

type LeaveUnit = 'day' | 'hour';
/** 残の表示「X日（Yh）」 */
function balText(days: number, hours: number): string {
  return `${days}日（${hours}h）`;
}

export default function Leave() {
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const staff = useMemo(() => allStaff.filter(s => s.status === 'active'), [allStaff]);
  const [staffId, setStaffId] = useState('');
  const selectedStaff = useMemo(() => staff.find(s => s.id === staffId) ?? null, [staff, staffId]);
  const [version, setVersion] = useState(0); // 追加・削除後の再読込用

  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [kind, setKind] = useState<LeaveKind>('use');
  const [unit, setUnit] = useState<LeaveUnit>('day'); // 取得の単位（日/時間）
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('1');
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

  // 付与は日単位のみ。取得は日/時間を選べる
  const effUnit: LeaveUnit = kind === 'grant' ? 'day' : unit;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const v = Number(amount);
    if (!v || v <= 0) {
      setError(effUnit === 'hour' ? '時間は1時間単位の正の数で入力してください' : '日数は0.5日単位の正の数で入力してください');
      return;
    }
    const useHours = effUnit === 'hour' ? v : v * LEAVE_HOURS_PER_DAY;
    if (kind === 'use' && useHours > summary.balanceHours) {
      setError(`残（${balText(summary.balanceDays, summary.balanceHours)}）を超えています`);
      return;
    }
    const rec: LeaveRecord = {
      id: genId('lv'), staffId, kind, date, note,
      days: effUnit === 'day' ? v : 0,
      hours: effUnit === 'hour' ? v : 0,
    };
    setSaving(true);
    try {
      await addLeave(rec);
      setNote('');
      setAmount('1');
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
      await addLeave({ id: genId('lv'), staffId, kind: 'grant', date: todayStr(), days: g.days, hours: 0, note: `標準付与（${typeLabel}）` });
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
          {/* 残数サマリー（1日=7.5時間で換算） */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <SummaryTile label="付与合計" value={`${summary.grantedDays}日`} sub={`${summary.grantedHours}h`} />
            <SummaryTile label="取得合計" value={`${summary.usedDays}日`} sub={`${summary.usedHours}h`} />
            <SummaryTile label="残（1日=7.5h）" value={`${summary.balanceDays}日`} sub={`${summary.balanceHours}h`} highlight />
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
            <form onSubmit={handleAdd} className="grid sm:grid-cols-6 gap-3 items-end">
              <Field label="種別">
                <Select value={kind} onChange={e => setKind(e.target.value as LeaveKind)}>
                  <option value="use">取得</option>
                  <option value="grant">付与</option>
                </Select>
              </Field>
              <Field label={kind === 'grant' ? '付与日' : '取得日'}>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} required />
              </Field>
              <Field label="単位">
                <Select value={effUnit} onChange={e => setUnit(e.target.value as LeaveUnit)} disabled={kind === 'grant'}>
                  <option value="day">日</option>
                  <option value="hour">時間</option>
                </Select>
              </Field>
              <Field label={effUnit === 'hour' ? '時間' : '日数'}>
                <Input type="number" min={effUnit === 'hour' ? 1 : 0.5} step={effUnit === 'hour' ? 1 : 0.5}
                  value={amount} onChange={e => setAmount(e.target.value)} required />
              </Field>
              <Field label="備考">
                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="例: 午後半休" />
              </Field>
              <div className="mb-4">
                <Button type="submit" className="w-full" disabled={saving}>{saving ? '追加中…' : '追加'}</Button>
              </div>
            </form>
            {kind === 'use' && <p className="text-xs text-gray-400 mt-1">1日＝{LEAVE_HOURS_PER_DAY}時間で残から差し引きます。時間単位は1時間から取得できます。</p>}
          </Card>

          {/* 履歴 */}
          <Card className="p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>日付</Th>
                  <Th>種別</Th>
                  <Th>日数/時間</Th>
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
                    <Td>{r.hours > 0 ? `${r.hours}時間` : `${r.days}日`}</Td>
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

function SummaryTile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </Card>
  );
}
