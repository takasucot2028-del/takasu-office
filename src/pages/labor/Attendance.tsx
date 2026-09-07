import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Select, Input, Button, Table, Th, Td, Alert } from '../../components/UI';
import { listStaff, saveMonthAttendance, getAttendancePageData, listShiftPatterns, todayStr } from '../../api/data';
import { DAY_TYPE_LABELS, WEEKDAY_LABELS, breakMinutesBetween } from '../../utils/constants';
import { shiftPlanByDate, isMissingPunch } from '../../utils/shiftPlan';
import { overtimeByDate, OVERTIME_KIND_LABELS } from '../../utils/overtime';
import { workMinutesOf, roundedTimesOf, dayShiftMap } from '../../utils/worktime';
import type { DayShift } from '../../utils/worktime';
import type { AttendanceRecord, AttendanceDayType, Staff, ShiftPattern, ConfirmedShift, OvertimeRecord } from '../../types';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 'YYYY-MM' の月の日付一覧（YYYY-MM-DD） */
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** 実働分数。打刻はシフトに合わせて丸めてから計算する（utils/worktime） */
function workMinutes(rec: AttendanceRecord, shift?: DayShift): number {
  return workMinutesOf(rec, shift);
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
  const [overtime, setOvertime] = useState<OvertimeRecord[]>([]);

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

  useEffect(() => { listShiftPatterns().then(setPatterns).catch(() => {}); }, []);

  // 職員・月が変わるたびに勤怠・確定シフト・時間外を1リクエストで読み込む
  useEffect(() => {
    if (!staffId) return;
    let alive = true;
    setMessage('');
    (async () => {
      const d = await getAttendancePageData(staffId, month);
      if (!alive) return;
      const map: Record<string, AttendanceRecord> = {};
      for (const rec of d.attendance) map[rec.date] = rec;
      setRecords(map);
      setConfirmed(d.confirmed);
      setOvertime(d.overtime);
    })();
    return () => { alive = false; };
  }, [staffId, month]);

  // 日付ごとの時間外実績（時間外管理で保存された実績時間）
  const otByDate = useMemo(() => overtimeByDate(overtime), [overtime]);
  const monthOtHours = useMemo(
    () => Math.round(overtime.filter(r => r.kind === 'overtime').reduce((t, r) => t + (Number(r.resultHours) || 0), 0) * 10) / 10,
    [overtime]
  );
  const monthHolidayHours = useMemo(
    () => Math.round(overtime.filter(r => r.kind === 'holiday').reduce((t, r) => t + (Number(r.resultHours) || 0), 0) * 10) / 10,
    [overtime]
  );

  // 日付ごとの勤務予定と、シフトがあるのに打刻がない日
  const plans = useMemo(() => shiftPlanByDate(confirmed, patterns), [confirmed, patterns]);
  // 打刻を丸めるための材料（シフトの開始・終了と早出申請の有無）
  const shiftMap = useMemo(
    () => dayShiftMap(confirmed, patterns, overtime, staffId),
    [confirmed, patterns, overtime, staffId]
  );
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
  const totalMinutes = recList.reduce((s, r) => s + workMinutes(r, shiftMap.get(r.date)), 0);

  const exportExcel = () => {
    if (!selectedStaff) return;
    const rows: (string | number)[][] = [
      [`出勤簿 ${month}`, '', '', '', '', '', ''],
      [`氏名: ${selectedStaff.lastName} ${selectedStaff.firstName}`, '', '', '', '', '', ''],
      [],
      ['日付', '曜日', 'シフト予定', 'シフト時間', '区分', '出勤', '退勤', '計算に使う時刻', '休憩', '休憩(分)', '実働', '時間外', '種別', '備考'],
      ...days.map(date => {
        const rec = records[date];
        const plan = plans.get(date);
        const wd = WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];
        const planCells = [plan ? plan.timeLabel : '', plan ? plan.hours : ''];
        const ot = otByDate.get(date);
        const otCells = [ot ? ot.hours : '', ot ? OVERTIME_KIND_LABELS[ot.kind] : ''];
        if (!rec) return [date, wd, ...planCells, '', '', '', '', '', '', '', ...otCells, ''];
        const sh = shiftMap.get(date);
        const t = roundedTimesOf(rec, sh);
        return [
          date,
          wd,
          ...planCells,
          DAY_TYPE_LABELS[rec.dayType],
          rec.startTime,
          rec.endTime,
          t.startRounded || t.endRounded ? `${t.startTime}〜${t.endTime}` : '',
          rec.breakStart && rec.breakEnd ? `${rec.breakStart}〜${rec.breakEnd}` : '',
          rec.breakMinutes || '',
          rec.dayType === 'work' ? formatMinutes(workMinutes(rec, sh)) : '',
          ...otCells,
          rec.note,
        ];
      }),
      [],
      ['出勤日数', workDays, '有給日数', paidDays, '欠勤日数', absentDays, '総実働', formatMinutes(totalMinutes), '時間外', monthOtHours, '休日勤務', monthHolidayHours],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 5 }, { wch: 14 }, { wch: 10 }, { wch: 6 }, { wch: 7 }, { wch: 7 }, { wch: 15 }, { wch: 13 }, { wch: 9 }, { wch: 7 }, { wch: 8 }, { wch: 8 }, { wch: 20 }];
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <SummaryTile label="出勤日数" value={`${workDays}日`} />
            <SummaryTile label="有給日数" value={`${paidDays}日`} />
            <SummaryTile label="欠勤日数" value={`${absentDays}日`} />
            <SummaryTile label="総実働時間" value={formatMinutes(totalMinutes)} />
            <SummaryTile label="時間外" value={`${monthOtHours}h`} />
            <SummaryTile label="休日勤務" value={`${monthHolidayHours}h`} />
          </div>
          <p className="text-xs text-gray-400 -mt-2 mb-4">
            時間外・休日勤務は「時間外」画面で登録された実績です。この画面では変更できません。<br />
            実働は打刻をシフトに合わせて丸めて計算します（<span className="text-blue-600">青字</span>が計算に使った時刻）。
            シフト開始前の打刻は、早出の申請がなければシフト開始から。シフト終了後の打刻は15分単位で切り上げ。
            シフト開始以降の出勤打刻と早退は実時刻のままです。
          </p>

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
                  <Th>時間外</Th>
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
                        {rec && isWork ? formatMinutes(workMinutes(rec, shiftMap.get(date))) : ''}
                        {/* 打刻をシフトに合わせて丸めた日は、計算に使った時刻を添える */}
                        {rec && isWork && (() => {
                          const t = roundedTimesOf(rec, shiftMap.get(date));
                          if (!t.startRounded && !t.endRounded) return null;
                          return (
                            <div className="text-[10px] text-blue-600 leading-tight" title="打刻をシフトに合わせて丸めた時刻で計算しています">
                              {t.startTime}〜{t.endTime}
                            </div>
                          );
                        })()}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {(() => {
                          const ot = otByDate.get(date);
                          if (!ot) return <span className="text-gray-300">—</span>;
                          return (
                            <span className={ot.kind === 'holiday' ? 'text-purple-700' : 'text-gray-800'}>
                              <span className="font-medium">{ot.hours}h</span>
                              <span className="ml-1 text-xs">{OVERTIME_KIND_LABELS[ot.kind]}</span>
                              {ot.status === 'applied' && <span className="ml-1 text-xs text-amber-600">未承認</span>}
                            </span>
                          );
                        })()}
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
