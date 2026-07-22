import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Select, Input, Button, Table, Th, Td, Alert } from '../../components/UI';
import { listStaff, listAttendance, saveMonthAttendance } from '../../api/data';
import { DAY_TYPE_LABELS, WEEKDAY_LABELS } from '../../utils/constants';
import type { AttendanceRecord, AttendanceDayType, Staff } from '../../types';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 'YYYY-MM' の月の日付一覧（YYYY-MM-DD） */
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function parseHM(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 実働分数（出勤日で出退勤が入力済みのときのみ） */
function workMinutes(rec: AttendanceRecord): number {
  if (rec.dayType !== 'work') return 0;
  const start = parseHM(rec.startTime);
  const end = parseHM(rec.endTime);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start - (rec.breakMinutes || 0));
}

function formatMinutes(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

export default function Attendance() {
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const staff = useMemo(() => allStaff.filter(s => s.status === 'active'), [allStaff]);
  const [staffId, setStaffId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const days = daysOfMonth(month);
  const selectedStaff = staff.find(s => s.id === staffId);

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

  // 職員・月が変わるたびに勤怠を読み込む
  useEffect(() => {
    if (!staffId) return;
    let alive = true;
    setMessage('');
    (async () => {
      const list = await listAttendance(staffId, month);
      if (!alive) return;
      const map: Record<string, AttendanceRecord> = {};
      for (const rec of list) map[rec.date] = rec;
      setRecords(map);
    })();
    return () => { alive = false; };
  }, [staffId, month]);

  const getRec = (date: string): AttendanceRecord =>
    records[date] ?? {
      id: `${staffId}_${date}`,
      staffId,
      date,
      dayType: 'work',
      startTime: '',
      endTime: '',
      breakMinutes: 0,
      note: '',
    };

  const setRec = (date: string, patch: Partial<AttendanceRecord>) => {
    setRecords(prev => ({ ...prev, [date]: { ...getRec(date), ...patch } }));
  };

  const clearRec = (date: string) => {
    setRecords(prev => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await saveMonthAttendance(staffId, month, Object.values(records));
      setMessage('保存しました');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 月次集計
  const recList = Object.values(records);
  const workDays = recList.filter(r => r.dayType === 'work').length;
  const paidDays = recList.filter(r => r.dayType === 'paid').length;
  const absentDays = recList.filter(r => r.dayType === 'absent').length;
  const totalMinutes = recList.reduce((s, r) => s + workMinutes(r), 0);

  const exportExcel = () => {
    if (!selectedStaff) return;
    const rows: (string | number)[][] = [
      [`出勤簿 ${month}`, '', '', '', '', '', ''],
      [`氏名: ${selectedStaff.lastName} ${selectedStaff.firstName}`, '', '', '', '', '', ''],
      [],
      ['日付', '曜日', '区分', '出勤', '退勤', '休憩(分)', '実働', '備考'],
      ...days.map(date => {
        const rec = records[date];
        const wd = WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];
        if (!rec) return [date, wd, '', '', '', '', '', ''];
        return [
          date,
          wd,
          DAY_TYPE_LABELS[rec.dayType],
          rec.startTime,
          rec.endTime,
          rec.breakMinutes || '',
          rec.dayType === 'work' ? formatMinutes(workMinutes(rec)) : '',
          rec.note,
        ];
      }),
      [],
      ['出勤日数', workDays, '有給日数', paidDays, '欠勤日数', absentDays, '総実働', formatMinutes(totalMinutes)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 5 }, { wch: 6 }, { wch: 7 }, { wch: 7 }, { wch: 9 }, { wch: 7 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '出勤簿');
    XLSX.writeFile(wb, `出勤簿_${selectedStaff.lastName}${selectedStaff.firstName}_${month}.xlsx`);
  };

  return (
    <PageContainer title="勤怠管理">
      <Card className="mb-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Select value={staffId} onChange={e => setStaffId(e.target.value)}>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.lastName} {s.firstName}（{s.position || '役職なし'}）</option>
              ))}
            </Select>
          </div>
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
      </Card>

      {staffLoaded && staff.length === 0 && <Alert type="info">在職中の職員がいません。先に職員名簿から登録してください。</Alert>}

      {selectedStaff && (
        <>
          {message && <Alert type="success">{message}</Alert>}

          {/* 月次集計 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <SummaryTile label="出勤日数" value={`${workDays}日`} />
            <SummaryTile label="有給日数" value={`${paidDays}日`} />
            <SummaryTile label="欠勤日数" value={`${absentDays}日`} />
            <SummaryTile label="総実働時間" value={formatMinutes(totalMinutes)} />
          </div>

          <div className="flex justify-end gap-2 mb-3">
            <Button variant="secondary" size="sm" onClick={exportExcel}>Excel出力</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>日付</Th>
                  <Th>区分</Th>
                  <Th>出勤</Th>
                  <Th>退勤</Th>
                  <Th>休憩(分)</Th>
                  <Th>実働</Th>
                  <Th>備考</Th>
                </tr>
              </thead>
              <tbody>
                {days.map(date => {
                  const wd = new Date(`${date}T00:00:00`).getDay();
                  const rec = records[date];
                  const isWork = rec?.dayType === 'work';
                  return (
                    <tr key={date} className={wd === 0 ? 'bg-red-50/50' : wd === 6 ? 'bg-blue-50/50' : ''}>
                      <Td className="whitespace-nowrap">
                        {Number(date.slice(8))}日
                        <span className={`ml-1 text-xs ${wd === 0 ? 'text-red-500' : wd === 6 ? 'text-blue-500' : 'text-gray-400'}`}>
                          ({WEEKDAY_LABELS[wd]})
                        </span>
                      </Td>
                      <Td className="min-w-24">
                        <Select
                          value={rec?.dayType ?? ''}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === '') clearRec(date);
                            else setRec(date, { dayType: v as AttendanceDayType });
                          }}
                        >
                          <option value="">－</option>
                          {Object.entries(DAY_TYPE_LABELS).map(([v, label]) => (
                            <option key={v} value={v}>{label}</option>
                          ))}
                        </Select>
                      </Td>
                      <Td className="min-w-24">
                        <Input
                          type="time"
                          value={rec?.startTime ?? ''}
                          disabled={!isWork}
                          onChange={e => setRec(date, { startTime: e.target.value })}
                        />
                      </Td>
                      <Td className="min-w-24">
                        <Input
                          type="time"
                          value={rec?.endTime ?? ''}
                          disabled={!isWork}
                          onChange={e => setRec(date, { endTime: e.target.value })}
                        />
                      </Td>
                      <Td className="min-w-20">
                        <Input
                          type="number"
                          min={0}
                          step={5}
                          value={rec?.breakMinutes || ''}
                          disabled={!isWork}
                          onChange={e => setRec(date, { breakMinutes: Number(e.target.value) || 0 })}
                        />
                      </Td>
                      <Td className="whitespace-nowrap text-gray-600">
                        {rec && isWork ? formatMinutes(workMinutes(rec)) : ''}
                      </Td>
                      <Td className="min-w-32">
                        <Input
                          value={rec?.note ?? ''}
                          disabled={!rec}
                          onChange={e => setRec(date, { note: e.target.value })}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <div className="flex justify-end mt-4">
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
          </div>
        </>
      )}
    </PageContainer>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-800">{value}</p>
    </Card>
  );
}
