import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, Card, Button, Table, Th, Td } from '../../components/UI';
import { getMyAttendancePageData, todayStr } from '../../api/data';
import { DAY_TYPE_LABELS, WEEKDAY_LABELS } from '../../utils/constants';
import { isSpecialHoliday } from '../../utils/holidays';
import { workMinutesOf, roundedTimesOf, dayShiftMap } from '../../utils/worktime';
import type { DayShift } from '../../utils/worktime';
import type { AttendanceRecord } from '../../types';

function currentMonth(): string { return todayStr().slice(0, 7); }
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
/** 実働分数。打刻はシフトに合わせて丸めてから計算する（utils/worktime） */
function workMinutes(rec?: AttendanceRecord, shift?: DayShift): number {
  return workMinutesOf(rec, shift);
}
const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

export default function StaffAttendance() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({});
  const [shiftMap, setShiftMap] = useState<Map<string, DayShift>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const d = await getMyAttendancePageData(month);
      if (!alive) return;
      const map: Record<string, AttendanceRecord> = {};
      for (const r of d.attendance) map[r.date] = r;
      setRecords(map);
      // 打刻を丸めるための材料（シフトの開始・終了と早出申請の有無）
      setShiftMap(dayShiftMap(d.confirmed, d.patterns, d.overtime)); // 本人ぶんのみのデータ
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month]);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const totals = useMemo(() => {
    const list = days.map(d => records[d]).filter((r): r is AttendanceRecord => !!r);
    return {
      work: list.filter(r => r.dayType === 'work').length,
      paid: list.filter(r => r.dayType === 'paid').length,
      absent: list.filter(r => r.dayType === 'absent').length,
      minutes: list.reduce((s, r) => s + workMinutes(r, shiftMap.get(r.date)), 0),
    };
  }, [days, records, shiftMap]);

  return (
    <PageContainer title="出勤簿">
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, -1))}>← 前月</Button>
          <span className="font-bold text-gray-800">{Number(month.slice(0, 4))}年{Number(month.slice(5))}月</span>
          <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, 1))}>翌月 →</Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => navigate(`/me/attendance/print?month=${month}`)}>出勤簿を出力（PDF）</Button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          実働＝退勤−出勤−休憩。内容に誤りがある場合は事務局へご連絡ください。
        </p>
      </Card>

      {/* 月次集計 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Tile label="出勤日数" value={`${totals.work}日`} />
        <Tile label="有給日数" value={`${totals.paid}日`} />
        <Tile label="欠勤日数" value={`${totals.absent}日`} />
        <Tile label="総実働時間" value={hhmm(totals.minutes)} />
      </div>

      <p className="text-xs text-gray-500 mb-3">
        実働は打刻をシフトに合わせて計算します。シフト開始より早く打刻した日は、時間外の申請がなければ
        <b>シフト開始から</b>。シフト終了より遅く打刻した日は<b>15分単位で切り上げ</b>ます
        （<span className="text-blue-600">青字</span>が計算に使った時刻）。
      </p>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead>
            <tr><Th>日付</Th><Th>区分</Th><Th>出勤</Th><Th>退勤</Th><Th>休憩</Th><Th>実働</Th><Th>備考</Th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><Td className="text-center text-gray-400 py-8" colSpan={7}>読み込み中…</Td></tr>
            ) : days.map(date => {
              const rec = records[date];
              const wd = new Date(`${date}T00:00:00`).getDay();
              const holiday = isSpecialHoliday(date);
              const brk = rec?.breakStart && rec?.breakEnd
                ? `${rec.breakStart}〜${rec.breakEnd}`
                : rec?.breakMinutes ? `${rec.breakMinutes}分` : '';
              return (
                <tr key={date} className={holiday || wd === 0 ? 'bg-red-50/50' : wd === 6 ? 'bg-blue-50/50' : ''}>
                  <Td className="whitespace-nowrap">
                    {Number(date.slice(8))}日
                    <span className={`ml-1 text-xs ${holiday || wd === 0 ? 'text-red-500' : wd === 6 ? 'text-blue-500' : 'text-gray-400'}`}>
                      ({WEEKDAY_LABELS[wd]}{holiday ? '・休' : ''})
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">{rec ? DAY_TYPE_LABELS[rec.dayType] : ''}</Td>
                  <Td className="whitespace-nowrap">{rec?.dayType === 'work' ? rec.startTime : ''}</Td>
                  <Td className="whitespace-nowrap">{rec?.dayType === 'work' ? rec.endTime : ''}</Td>
                  <Td className="whitespace-nowrap text-xs text-gray-500">{rec?.dayType === 'work' ? brk : ''}</Td>
                  <Td className="whitespace-nowrap font-medium">
                    {(() => {
                      if (!rec || rec.dayType !== 'work') return '';
                      const sh = shiftMap.get(date);
                      const min = workMinutes(rec, sh);
                      if (min <= 0) return '';
                      const t = roundedTimesOf(rec, sh);
                      return (
                        <>
                          {hhmm(min)}
                          {(t.startRounded || t.endRounded) && (
                            <div className="text-[10px] font-normal text-blue-600 leading-tight">
                              {t.startTime}〜{t.endTime}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </Td>
                  <Td className="text-xs text-gray-500">{rec?.note || ''}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </PageContainer>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="text-center py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-800">{value}</p>
    </Card>
  );
}
