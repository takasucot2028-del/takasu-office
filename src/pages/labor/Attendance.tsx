import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Select, Input, Button, Table, Th, Td, Alert } from '../../components/UI';
import { listStaff, listAttendance, saveMonthAttendance, listConfirmedByMonth, getReference, todayStr } from '../../api/data';
import { DAY_TYPE_LABELS, WEEKDAY_LABELS, breakMinutesBetween } from '../../utils/constants';
import { shiftPlanByDate, isMissingPunch } from '../../utils/shiftPlan';
import type { AttendanceRecord, AttendanceDayType, Staff, ShiftPattern, ConfirmedShift } from '../../types';

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
  const navigate = useNavigate();
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const staff = useMemo(() => allStaff.filter(s => s.status === 'active'), [allStaff]);
  const [staffId, setStaffId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedShift[]>([]);

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

  useEffect(() => { getReference().then(r => setPatterns(r.patterns)); }, []);

  // 職員・月が変わるたびに勤怠と確定シフトを読み込む
  useEffect(() => {
    if (!staffId) return;
    let alive = true;
    setMessage('');
    (async () => {
      const [list, conf] = await Promise.all([listAttendance(staffId, month), listConfirmedByMonth(month)]);
      if (!alive) return;
      const map: Record<string, AttendanceRecord> = {};
      for (const rec of list) map[rec.date] = rec;
      setRecords(map);
      setConfirmed(conf.filter(c => c.staffId === staffId));
    })();
    return () => { alive = false; };
  }, [staffId, month]);

  // 日付ごとの勤務予定と、シフトがあるのに打刻がない日
  const plans = useMemo(() => shiftPlanByDate(confirmed, patterns), [confirmed, patterns]);
  const today = todayStr();
  const missingDays = useMemo(
    () => days.filter(d => isMissingPunch(records[d], plans.get(d), d, today)),
    [days, records, plans, today]
  );

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

  /** 休憩の開始・終了（時刻）から休憩分を計算して保存する */
  const setBreakTime = (date: string, breakStart: string, breakEnd: string) => {
    setRec(date, { breakStart, breakEnd, breakMinutes: breakMinutesBetween(breakStart, breakEnd) });
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
      ['日付', '曜日', 'シフト予定', 'シフト時間', '区分', '出勤', '退勤', '休憩', '休憩(分)', '実働', '備考'],
      ...days.map(date => {
        const rec = records[date];
        const plan = plans.get(date);
        const wd = WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];
        const planCells = [plan ? plan.timeLabel : '', plan ? plan.hours : ''];
        if (!rec) return [date, wd, ...planCells, '', '', '', '', '', '', ''];
        return [
          date,
          wd,
          ...planCells,
          DAY_TYPE_LABELS[rec.dayType],
          rec.startTime,
          rec.endTime,
          rec.breakStart && rec.breakEnd ? `${rec.breakStart}〜${rec.breakEnd}` : '',
          rec.breakMinutes || '',
          rec.dayType === 'work' ? formatMinutes(workMinutes(rec)) : '',
          rec.note,
        ];
      }),
      [],
      ['出勤日数', workDays, '有給日数', paidDays, '欠勤日数', absentDays, '総実働', formatMinutes(totalMinutes)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 5 }, { wch: 6 }, { wch: 7 }, { wch: 7 }, { wch: 13 }, { wch: 9 }, { wch: 7 }, { wch: 20 }];
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
          {missingDays.length > 0 && (
            <Alert type="error">
              シフトが入っているのに出退勤が未入力の日が <b>{missingDays.length}日</b> あります
              （{missingDays.map(d => `${Number(d.slice(8))}日`).join('、')}）。
              表の該当行を色付きで表示しています。出退勤を入力するか、有給・欠勤として登録してください。
            </Alert>
          )}

          {/* 月次集計 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <SummaryTile label="出勤日数" value={`${workDays}日`} />
            <SummaryTile label="有給日数" value={`${paidDays}日`} />
            <SummaryTile label="欠勤日数" value={`${absentDays}日`} />
            <SummaryTile label="総実働時間" value={formatMinutes(totalMinutes)} />
          </div>

          <div className="flex justify-end gap-2 mb-3">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/labor/attendance/print?staffId=${staffId}&month=${month}`)}>出勤簿PDF</Button>
            <Button variant="secondary" size="sm" onClick={() => navigate(`/labor/attendance/print?all=1&month=${month}`)}>全員分をまとめて印刷</Button>
            <Button variant="secondary" size="sm" onClick={exportExcel}>Excel出力</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>日付</Th>
                  <Th>シフト予定</Th>
                  <Th>区分</Th>
                  <Th>出勤</Th>
                  <Th>退勤</Th>
                  <Th>休憩</Th>
                  <Th>実働</Th>
                  <Th>備考</Th>
                </tr>
              </thead>
              <tbody>
                {days.map(date => {
                  const wd = new Date(`${date}T00:00:00`).getDay();
                  const rec = records[date];
                  const isWork = rec?.dayType === 'work';
                  const plan = plans.get(date);
                  const missing = isMissingPunch(rec, plan, date, today);
                  return (
                    <tr key={date} className={missing ? 'bg-amber-50' : wd === 0 ? 'bg-red-50/50' : wd === 6 ? 'bg-blue-50/50' : ''}>
                      <Td className="whitespace-nowrap">
                        {Number(date.slice(8))}日
                        <span className={`ml-1 text-xs ${wd === 0 ? 'text-red-500' : wd === 6 ? 'text-blue-500' : 'text-gray-400'}`}>
                          ({WEEKDAY_LABELS[wd]})
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {plan ? (
                          <>
                            <span className="font-medium text-gray-700">{plan.label}</span>
                            <span className="ml-1 text-xs text-gray-500">{plan.timeLabel}</span>
                            <span className="ml-1 text-xs text-gray-400">({plan.hours}h)</span>
                            {missing && <span className="ml-2 text-xs text-amber-700 font-medium">打刻なし</span>}
                          </>
                        ) : <span className="text-xs text-gray-300">—</span>}
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
                      <Td className="min-w-44">
                        {/* 休憩は時刻（開始〜終了）で入力し、分は自動計算する */}
                        <div className="flex items-center gap-1">
                          <Input
                            type="time"
                            value={rec?.breakStart ?? ''}
                            disabled={!isWork}
                            onChange={e => setBreakTime(date, e.target.value, rec?.breakEnd ?? '')}
                          />
                          <span className="text-gray-400 text-xs">〜</span>
                          <Input
                            type="time"
                            value={rec?.breakEnd ?? ''}
                            disabled={!isWork}
                            onChange={e => setBreakTime(date, rec?.breakStart ?? '', e.target.value)}
                          />
                        </div>
                        {isWork && (rec?.breakMinutes || 0) > 0 && (
                          <div className="text-[10px] text-gray-400 mt-0.5 whitespace-nowrap">{rec?.breakMinutes}分</div>
                        )}
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
