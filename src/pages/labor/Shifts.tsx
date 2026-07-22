import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Button, Alert } from '../../components/UI';
import {
  listStaff, listShiftPatterns, todayStr,
  listAvailabilityByMonth, saveMonthAvailability,
  listConfirmedByMonth, saveMonthConfirmed, genId,
} from '../../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS } from '../../utils/constants';
import type { Staff, ShiftPattern, WorkLocation, AvailabilityStatus, AvailabilityRecord, ConfirmedShift } from '../../types';

type Mode = 'request' | 'confirm';

function currentMonth(): string {
  return todayStr().slice(0, 7);
}
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function patternHours(p: ShiftPattern): number {
  const re = /^(\d{1,2}):(\d{2})$/;
  const s = re.exec(p.startTime), e = re.exec(p.endTime);
  if (!s || !e) return 0;
  const min = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  return min > 0 ? min / 60 : 0;
}
const aKey = (staffId: string, date: string) => `${staffId}_${date}`;
const cKey = (staffId: string, date: string, loc: WorkLocation) => `${staffId}_${date}_${loc}`;

export default function Shifts() {
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);

  const [month, setMonth] = useState(currentMonth());
  const [location, setLocation] = useState<WorkLocation>('sotai');
  const [mode, setMode] = useState<Mode>('request');

  const [availMap, setAvailMap] = useState<Record<string, AvailabilityStatus>>({});
  const [confMap, setConfMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const days = useMemo(() => daysOfMonth(month), [month]);
  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);
  const staffOfLoc = useMemo(
    () => allStaff.filter(s => s.status === 'active' && s.workLocation === location),
    [allStaff, location]
  );

  // 初回：職員・区分を読み込む
  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, p] = await Promise.all([listStaff(), listShiftPatterns()]);
      if (!alive) return;
      setAllStaff(s);
      setPatterns(p);
      setStaffLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  // 月が変わるたびに希望・確定を読み込む
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessage('');
    (async () => {
      const [avail, conf] = await Promise.all([listAvailabilityByMonth(month), listConfirmedByMonth(month)]);
      if (!alive) return;
      const am: Record<string, AvailabilityStatus> = {};
      for (const r of avail) am[aKey(r.staffId, r.date)] = r.status;
      const cm: Record<string, string> = {};
      for (const r of conf) cm[cKey(r.staffId, r.date, r.location)] = r.patternId;
      setAvailMap(am);
      setConfMap(cm);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month]);

  // セル操作
  const cycleAvail = (staffId: string, date: string) => {
    const k = aKey(staffId, date);
    setAvailMap(prev => {
      const cur = prev[k];
      const next = { ...prev };
      if (cur === undefined) next[k] = 'available';
      else if (cur === 'available') next[k] = 'unavailable';
      else delete next[k];
      return next;
    });
  };
  const cycleConfirm = (staffId: string, date: string) => {
    const k = cKey(staffId, date, location);
    const order = ['', ...patterns.map(p => p.id)];
    setConfMap(prev => {
      const cur = prev[k] ?? '';
      const idx = order.indexOf(cur);
      const nextVal = order[(idx + 1) % order.length];
      const next = { ...prev };
      if (nextVal === '') delete next[k];
      else next[k] = nextVal;
      return next;
    });
  };

  const handleSave = async () => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      if (mode === 'request') {
        const ids = staffOfLoc.map(s => s.id);
        const idSet = new Set(ids);
        const records: AvailabilityRecord[] = [];
        for (const [k, status] of Object.entries(availMap)) {
          const sep = k.lastIndexOf('_');
          const staffId = k.slice(0, sep);
          const date = k.slice(sep + 1);
          if (date.startsWith(month) && idSet.has(staffId)) {
            records.push({ id: k, staffId, date, status });
          }
        }
        await saveMonthAvailability(month, ids, records);
      } else {
        const records: ConfirmedShift[] = [];
        for (const [k, patternId] of Object.entries(confMap)) {
          if (!k.endsWith(`_${location}`)) continue;
          const rest = k.slice(0, k.length - location.length - 1);
          const sep = rest.lastIndexOf('_');
          const staffId = rest.slice(0, sep);
          const date = rest.slice(sep + 1);
          if (date.startsWith(month) && patternId) {
            records.push({ id: genId('cf'), staffId, date, location, patternId, note: '' });
          }
        }
        await saveMonthConfirmed(month, location, records);
      }
      setMessage('保存しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 集計（確定モード）
  const staffTotals = (staffId: string) => {
    let daysCount = 0, hours = 0;
    for (const date of days) {
      const pid = confMap[cKey(staffId, date, location)];
      if (pid) { daysCount++; const p = patternMap.get(pid); if (p) hours += patternHours(p); }
    }
    return { daysCount, hours: Math.round(hours * 10) / 10 };
  };
  const dayCount = (date: string) =>
    staffOfLoc.reduce((n, s) => n + (confMap[cKey(s.id, date, location)] ? 1 : 0), 0);

  const exportExcel = () => {
    const header = ['職員', ...days.map(d => `${Number(d.slice(8))}(${WEEKDAY_LABELS[new Date(`${d}T00:00:00`).getDay()]})`)];
    if (mode === 'confirm') header.push('勤務日数', '実働時間');
    const rows: (string | number)[][] = [
      [`${month} シフト表（${WORK_LOCATION_LABELS[location]}・${mode === 'confirm' ? '確定' : '希望'}）`],
      header,
    ];
    for (const s of staffOfLoc) {
      const row: (string | number)[] = [`${s.lastName} ${s.firstName}`];
      for (const date of days) {
        if (mode === 'request') {
          const v = availMap[aKey(s.id, date)];
          row.push(v === 'available' ? '○' : v === 'unavailable' ? '×' : '');
        } else {
          const pid = confMap[cKey(s.id, date, location)];
          row.push(pid ? (patternMap.get(pid)?.name ?? '') : '');
        }
      }
      if (mode === 'confirm') { const t = staffTotals(s.id); row.push(t.daysCount, t.hours); }
      rows.push(row);
    }
    if (mode === 'confirm') {
      rows.push(['人数', ...days.map(d => dayCount(d) || '')]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, ...days.map(() => ({ wch: 5 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'シフト');
    XLSX.writeFile(wb, `シフト表_${WORK_LOCATION_LABELS[location]}_${month}.xlsx`);
  };

  const cellBase = 'w-9 min-w-9 text-center text-xs border-b border-r border-gray-100 cursor-pointer select-none p-0 h-9';

  return (
    <PageContainer title="シフト表">
      {/* 操作バー */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* 月移動 */}
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, -1))}>←</Button>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, 1))}>→</Button>
          </div>
          {/* 場所タブ */}
          <div className="flex rounded-md overflow-hidden border border-gray-300">
            {(Object.keys(WORK_LOCATION_LABELS) as WorkLocation[]).map(loc => (
              <button key={loc} onClick={() => setLocation(loc)}
                className={`px-3 py-1.5 text-sm ${location === loc ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {WORK_LOCATION_LABELS[loc]}
              </button>
            ))}
          </div>
          {/* モード切替 */}
          <div className="flex rounded-md overflow-hidden border border-gray-300">
            <button onClick={() => setMode('request')}
              className={`px-3 py-1.5 text-sm ${mode === 'request' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>希望</button>
            <button onClick={() => setMode('confirm')}
              className={`px-3 py-1.5 text-sm ${mode === 'confirm' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>確定</button>
          </div>
          <div className="flex-1" />
          <Link to="/labor/shift-patterns" className="text-xs text-emerald-700 hover:underline">区分マスタ →</Link>
          <Button variant="secondary" size="sm" onClick={exportExcel}>Excel出力</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
        </div>

        {/* 凡例 */}
        <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          {mode === 'request' ? (
            <span>クリックで切替：空欄（不明）→ <span className="text-green-600 font-bold">○</span>（入れる）→ <span className="text-red-500 font-bold">×</span>（入れない）</span>
          ) : (
            <>
              <span>クリックで区分を順に切替。背景色は希望（<span className="text-green-600">緑=○</span> / <span className="text-red-500">赤=×</span>）</span>
              {patterns.map(p => (
                <span key={p.id} className="text-gray-600">{p.name}: {p.startTime}〜{p.endTime}</span>
              ))}
            </>
          )}
        </div>
      </Card>

      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}
      {staffLoaded && staffOfLoc.length === 0 && (
        <Alert type="info">
          {WORK_LOCATION_LABELS[location]}を主な勤務場所とする在職職員がいません。職員名簿で勤務場所を設定してください。
        </Alert>
      )}

      {staffOfLoc.length > 0 && (
        <Card className="p-0 overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 text-gray-600 font-medium border-b border-r min-w-28">職員</th>
                {days.map(d => {
                  const wd = new Date(`${d}T00:00:00`).getDay();
                  return (
                    <th key={d} className={`w-9 min-w-9 px-0 py-1 text-xs font-medium border-b border-r border-gray-100 ${wd === 0 ? 'bg-red-50 text-red-500' : wd === 6 ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-gray-500'}`}>
                      <div>{Number(d.slice(8))}</div>
                      <div>{WEEKDAY_LABELS[wd]}</div>
                    </th>
                  );
                })}
                {mode === 'confirm' && <th className="bg-gray-50 text-gray-600 font-medium border-b px-2 text-xs whitespace-nowrap">日数</th>}
                {mode === 'confirm' && <th className="bg-gray-50 text-gray-600 font-medium border-b px-2 text-xs whitespace-nowrap">実働</th>}
              </tr>
            </thead>
            <tbody>
              {staffOfLoc.map(s => {
                const t = mode === 'confirm' ? staffTotals(s.id) : null;
                return (
                  <tr key={s.id}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1 border-b border-r whitespace-nowrap font-medium">
                      {s.lastName} {s.firstName}
                    </td>
                    {days.map(date => {
                      const wd = new Date(`${date}T00:00:00`).getDay();
                      const avail = availMap[aKey(s.id, date)];
                      if (mode === 'request') {
                        return (
                          <td key={date} onClick={() => cycleAvail(s.id, date)}
                            className={`${cellBase} ${wd === 0 ? 'bg-red-50/40' : wd === 6 ? 'bg-blue-50/40' : ''}`}>
                            {avail === 'available' ? <span className="text-green-600 font-bold">○</span>
                              : avail === 'unavailable' ? <span className="text-red-500 font-bold">×</span> : ''}
                          </td>
                        );
                      }
                      const pid = confMap[cKey(s.id, date, location)];
                      const hint = avail === 'available' ? 'bg-green-50' : avail === 'unavailable' ? 'bg-red-50' : (wd === 0 ? 'bg-red-50/40' : wd === 6 ? 'bg-blue-50/40' : '');
                      return (
                        <td key={date} onClick={() => cycleConfirm(s.id, date)} className={`${cellBase} ${hint}`}>
                          {pid ? <span className="font-medium text-gray-800">{patternMap.get(pid)?.name ?? '?'}</span> : ''}
                        </td>
                      );
                    })}
                    {mode === 'confirm' && t && <td className="border-b px-2 text-center text-gray-600">{t.daysCount}</td>}
                    {mode === 'confirm' && t && <td className="border-b px-2 text-center text-gray-600">{t.hours}h</td>}
                  </tr>
                );
              })}
              {mode === 'confirm' && (
                <tr>
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1 border-b border-r whitespace-nowrap text-gray-500 text-xs">人数</td>
                  {days.map(date => (
                    <td key={date} className="w-9 min-w-9 text-center text-xs border-b border-r border-gray-100 text-gray-500">
                      {dayCount(date) || ''}
                    </td>
                  ))}
                  <td className="border-b" colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {loading && staffOfLoc.length > 0 && <p className="text-xs text-gray-400 mt-2">読み込み中…</p>}
    </PageContainer>
  );
}
