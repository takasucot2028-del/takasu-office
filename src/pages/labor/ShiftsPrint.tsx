import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listStaff, listShiftPatterns, listConfirmedByMonth, todayStr } from '../../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS } from '../../utils/constants';
import type { Staff, ShiftPattern, WorkLocation, ConfirmedShift } from '../../types';

function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
function patternHours(p: ShiftPattern): number {
  const re = /^(\d{1,2}):(\d{2})$/;
  const s = re.exec(p.startTime), e = re.exec(p.endTime);
  if (!s || !e) return 0;
  const min = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  return min > 0 ? min / 60 : 0;
}

export default function ShiftsPrint() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const month = params.get('month') || todayStr().slice(0, 7);
  const location = (params.get('location') as WorkLocation) || 'sotai';

  const [staff, setStaff] = useState<Staff[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedShift[]>([]);
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, p, c] = await Promise.all([listStaff(), listShiftPatterns(), listConfirmedByMonth(month)]);
      if (!alive) return;
      setStaff(s.filter(x => x.status === 'active' && x.workLocation === location));
      setPatterns(p);
      setConfirmed(c.filter(r => r.location === location));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month, location]);

  // (staffId,date) -> patternId[]（master順）
  const cellIds = (staffId: string, date: string): string[] => {
    const ids = confirmed.filter(r => r.staffId === staffId && r.date === date).map(r => r.patternId);
    return patterns.filter(p => ids.includes(p.id)).map(p => p.id);
  };
  const staffTotals = (staffId: string) => {
    let daysCount = 0, hours = 0;
    for (const date of days) {
      const ids = cellIds(staffId, date);
      if (ids.length) { daysCount++; for (const id of ids) { const p = patternMap.get(id); if (p) hours += patternHours(p); } }
    }
    return { daysCount, hours: Math.round(hours * 10) / 10 };
  };
  const dayCount = (date: string) => staff.reduce((n, s) => n + (cellIds(s.id, date).length ? 1 : 0), 0);

  const [y, m] = month.split('-');

  return (
    <div className="shift-print max-w-full mx-auto px-4 py-5">
      {/* 操作（印刷時は非表示） */}
      <div className="no-print flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">← 戻る</button>
        <button onClick={() => window.print()} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">印刷する</button>
        <span className="text-xs text-gray-400">プレビューで用紙を「横向き」にすると綺麗に収まります</span>
      </div>

      <h1 className="text-lg font-bold text-center mb-1">{Number(y)}年{Number(m)}月 シフト表（{WORK_LOCATION_LABELS[location]}）</h1>
      <p className="text-xs text-gray-600 text-center mb-3">
        {patterns.map(p => `${p.name} ${p.startTime}〜${p.endTime}`).join('　／　')}
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : staff.length === 0 ? (
        <p className="text-sm text-gray-500">この勤務場所の在職職員がいません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse w-full text-xs" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
            <thead>
              <tr>
                <th className="border border-gray-400 px-2 py-1 bg-gray-100 text-left whitespace-nowrap">職員</th>
                {days.map(d => {
                  const wd = new Date(`${d}T00:00:00`).getDay();
                  return (
                    <th key={d} className={`border border-gray-400 px-0 py-1 text-center ${wd === 0 ? 'bg-red-100' : wd === 6 ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <div>{Number(d.slice(8))}</div>
                      <div className="text-[10px]">{WEEKDAY_LABELS[wd]}</div>
                    </th>
                  );
                })}
                <th className="border border-gray-400 px-1 py-1 bg-gray-100 whitespace-nowrap">日数</th>
                <th className="border border-gray-400 px-1 py-1 bg-gray-100 whitespace-nowrap">実働</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(s => {
                const t = staffTotals(s.id);
                return (
                  <tr key={s.id}>
                    <td className="border border-gray-400 px-2 py-1 whitespace-nowrap font-medium">{s.lastName} {s.firstName}</td>
                    {days.map(date => {
                      const wd = new Date(`${date}T00:00:00`).getDay();
                      const names = cellIds(s.id, date).map(id => patternMap.get(id)?.name ?? '').join(' ');
                      return (
                        <td key={date} className={`border border-gray-400 text-center px-0 py-1 ${wd === 0 ? 'bg-red-50' : wd === 6 ? 'bg-blue-50' : ''}`}>{names}</td>
                      );
                    })}
                    <td className="border border-gray-400 text-center px-1">{t.daysCount}</td>
                    <td className="border border-gray-400 text-center px-1 whitespace-nowrap">{t.hours}h</td>
                  </tr>
                );
              })}
              <tr>
                <td className="border border-gray-400 px-2 py-1 bg-gray-50 text-gray-600">人数</td>
                {days.map(date => (
                  <td key={date} className="border border-gray-400 text-center px-0 py-1 text-gray-600">{dayCount(date) || ''}</td>
                ))}
                <td className="border border-gray-400" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
