import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Select, Input, Field, Button, Table, Th, Td, Badge, Alert } from '../../components/UI';
import { listStaff, listShiftsByDate, addShift, deleteShift, genId, todayStr } from '../../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS } from '../../utils/constants';
import type { WorkLocation, Staff, Shift } from '../../types';

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Shifts() {
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const staff = useMemo(() => allStaff.filter(s => s.status === 'active'), [allStaff]);
  const staffMap = useMemo(() => new Map(allStaff.map(s => [s.id, s])), [allStaff]);

  const [date, setDate] = useState(todayStr());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0); // 追加・削除後の再読込用

  const [staffId, setStaffId] = useState('');
  const [location, setLocation] = useState<WorkLocation>('sotai');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const weekday = WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];

  // 職員一覧を初回に読み込む
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await listStaff();
      if (!alive) return;
      setAllStaff(s);
      setStaffLoaded(true);
      const first = s.find(x => x.status === 'active');
      if (first) {
        setStaffId(first.id);
        if (first.workLocation) setLocation(first.workLocation);
      }
    })();
    return () => { alive = false; };
  }, []);

  // 日付・更新のたびにシフトを読み込む
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const list = await listShiftsByDate(date);
      if (!alive) return;
      setShifts(list);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [date, version]);

  // 職員を選んだらその職員の主な勤務場所を初期値にする
  const handleStaffChange = (id: string) => {
    setStaffId(id);
    const s = staff.find(x => x.id === id);
    if (s?.workLocation) setLocation(s.workLocation);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!staffId) return;
    if (!startTime || !endTime || endTime <= startTime) {
      setError('終了時刻は開始時刻より後にしてください');
      return;
    }
    setSaving(true);
    try {
      await addShift({ id: genId('sft'), staffId, date, location, startTime, endTime, note });
      setNote('');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シフトの登録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteShift(id);
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シフトの削除に失敗しました');
    }
  };

  return (
    <PageContainer title="シフト管理">
      {/* 日付選択 */}
      <Card className="mb-4">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDate(d => shiftDate(d, -1))}>← 前日</Button>
          <div className="flex-1 max-w-48">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <span className="text-sm text-gray-500">({weekday})</span>
          <Button variant="secondary" size="sm" onClick={() => setDate(d => shiftDate(d, 1))}>翌日 →</Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(todayStr())}>今日</Button>
        </div>
      </Card>

      {staffLoaded && staff.length === 0 && <Alert type="info">在職中の職員がいません。先に職員名簿から登録してください。</Alert>}

      {staff.length > 0 && (
        <>
          {/* シフト追加 */}
          <Card className="mb-4">
            <h2 className="font-bold text-gray-800 mb-4">シフトの追加</h2>
            {error && <Alert type="error">{error}</Alert>}
            <form onSubmit={handleAdd} className="grid sm:grid-cols-6 gap-3 items-end">
              <div className="sm:col-span-2">
                <Field label="職員">
                  <Select value={staffId} onChange={e => handleStaffChange(e.target.value)}>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>{s.lastName} {s.firstName}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="勤務場所">
                <Select value={location} onChange={e => setLocation(e.target.value as WorkLocation)}>
                  {Object.entries(WORK_LOCATION_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="開始">
                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
              </Field>
              <Field label="終了">
                <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
              </Field>
              <div className="mb-4">
                <Button type="submit" className="w-full" disabled={saving}>{saving ? '追加中…' : '追加'}</Button>
              </div>
            </form>
            <Field label="備考">
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="例: 教室対応、鍵当番" />
            </Field>
          </Card>

          {/* 当日のシフト一覧 */}
          <Card className="p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>勤務場所</Th>
                  <Th>職員</Th>
                  <Th>時間</Th>
                  <Th>備考</Th>
                  <Th className="w-16"></Th>
                </tr>
              </thead>
              <tbody>
                {shifts.map(sh => {
                  const s = staffMap.get(sh.staffId);
                  return (
                    <tr key={sh.id}>
                      <Td>
                        <Badge color={sh.location === 'sotai' ? 'blue' : 'green'}>
                          {WORK_LOCATION_LABELS[sh.location]}
                        </Badge>
                      </Td>
                      <Td className="font-medium">{s ? `${s.lastName} ${s.firstName}` : '(不明)'}</Td>
                      <Td>{sh.startTime}〜{sh.endTime}</Td>
                      <Td>{sh.note}</Td>
                      <Td>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(sh.id)}>削除</Button>
                      </Td>
                    </tr>
                  );
                })}
                {shifts.length === 0 && (
                  <tr>
                    <Td className="text-center text-gray-400 py-8" colSpan={5}>
                      {loading ? '読み込み中…' : 'この日のシフトはまだ登録されていません'}
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
