import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { PageContainer, Card, Button, Alert } from '../../components/UI';
import {
  listStaff, listShiftPatterns, todayStr,
  listAvailabilityByMonth, saveMonthAvailability,
  listConfirmedByMonth, saveMonthConfirmed, genId,
} from '../../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS, staffInLocation } from '../../utils/constants';
import type { Staff, ShiftPattern, WorkLocation, AvailabilityRecord, ConfirmedShift } from '../../types';

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
  const navigate = useNavigate();
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);

  const [month, setMonth] = useState(currentMonth());
  const [location, setLocation] = useState<WorkLocation>('sotai');
  const [mode, setMode] = useState<Mode>('request');

  // 希望＝人単位（key aKey）、確定＝場所単位（key cKey）。どちらも patternId の配列
  const [reqMap, setReqMap] = useState<Record<string, string[]>>({});
  const [confMap, setConfMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ staffId: string; date: string; x: number; y: number } | null>(null);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);
  // 現在の勤務場所で使える区分（すべて + その場所専用）
  const validPatterns = useMemo(
    () => patterns.filter(p => p.location === '' || p.location === location),
    [patterns, location]
  );
  const staffOfLoc = useMemo(
    () => allStaff.filter(s => s.status === 'active' && staffInLocation(s.workLocation, location)),
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
    setMenu(null);
    (async () => {
      const [avail, conf] = await Promise.all([listAvailabilityByMonth(month), listConfirmedByMonth(month)]);
      if (!alive) return;
      const rm: Record<string, string[]> = {};
      for (const r of avail) { const k = aKey(r.staffId, r.date); (rm[k] = rm[k] || []).push(r.patternId); }
      const cm: Record<string, string[]> = {};
      for (const r of conf) { const k = cKey(r.staffId, r.date, r.location); (cm[k] = cm[k] || []).push(r.patternId); }
      setReqMap(rm);
      setConfMap(cm);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month]);

  // 区分を master 順に並べ、現在の場所で有効なものだけ返す
  const orderValid = (ids: string[]): string[] => validPatterns.filter(p => ids.includes(p.id)).map(p => p.id);
  const reqIds = (staffId: string, date: string) => orderValid(reqMap[aKey(staffId, date)] || []);
  const confIds = (staffId: string, date: string) => orderValid(confMap[cKey(staffId, date, location)] || []);
  const names = (ids: string[]) => ids.map(id => patternMap.get(id)?.name ?? '').join(' ');

  // ポップアップで区分を付け外し（モードにより希望/確定を更新）
  const togglePattern = (staffId: string, date: string, patternId: string) => {
    if (mode === 'request') {
      const k = aKey(staffId, date);
      setReqMap(prev => {
        const cur = prev[k] || [];
        const arr = cur.includes(patternId) ? cur.filter(id => id !== patternId) : [...cur, patternId];
        const next = { ...prev };
        if (arr.length) next[k] = arr; else delete next[k];
        return next;
      });
    } else {
      const k = cKey(staffId, date, location);
      setConfMap(prev => {
        const cur = prev[k] || [];
        const arr = cur.includes(patternId) ? cur.filter(id => id !== patternId) : [...cur, patternId];
        const next = { ...prev };
        if (arr.length) next[k] = arr; else delete next[k];
        return next;
      });
    }
  };
  const clearCell = (staffId: string, date: string) => {
    if (mode === 'request') {
      const k = aKey(staffId, date);
      setReqMap(prev => { const n = { ...prev }; delete n[k]; return n; });
    } else {
      const k = cKey(staffId, date, location);
      setConfMap(prev => { const n = { ...prev }; delete n[k]; return n; });
    }
  };
  const isOn = (staffId: string, date: string, patternId: string) => {
    const arr = mode === 'request' ? reqMap[aKey(staffId, date)] : confMap[cKey(staffId, date, location)];
    return (arr || []).includes(patternId);
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
        for (const [k, pids] of Object.entries(reqMap)) {
          const sep = k.lastIndexOf('_');
          const staffId = k.slice(0, sep);
          const date = k.slice(sep + 1);
          if (!date.startsWith(month) || !idSet.has(staffId)) continue;
          for (const patternId of pids) records.push({ id: `${staffId}_${date}_${patternId}`, staffId, date, patternId });
        }
        await saveMonthAvailability(month, ids, records);
      } else {
        const records: ConfirmedShift[] = [];
        for (const [k, pids] of Object.entries(confMap)) {
          if (!k.endsWith(`_${location}`)) continue;
          const rest = k.slice(0, k.length - location.length - 1);
          const sep = rest.lastIndexOf('_');
          const staffId = rest.slice(0, sep);
          const date = rest.slice(sep + 1);
          if (!date.startsWith(month)) continue;
          for (const patternId of pids) records.push({ id: genId('cf'), staffId, date, location, patternId, note: '' });
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

  const handlePrint = async () => {
    await handleSave();
    navigate(`/labor/shifts/print?month=${month}&location=${location}`);
  };

  // 集計（確定モード）
  const staffTotals = (staffId: string) => {
    let daysCount = 0, hours = 0;
    for (const date of days) {
      const ids = confIds(staffId, date);
      if (ids.length) { daysCount++; for (const id of ids) { const p = patternMap.get(id); if (p) hours += patternHours(p); } }
    }
    return { daysCount, hours: Math.round(hours * 10) / 10 };
  };
  const dayCount = (date: string) =>
    staffOfLoc.reduce((n, s) => n + (confIds(s.id, date).length ? 1 : 0), 0);

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
        row.push(names(mode === 'request' ? reqIds(s.id, date) : confIds(s.id, date)));
      }
      if (mode === 'confirm') { const t = staffTotals(s.id); row.push(t.daysCount, t.hours); }
      rows.push(row);
    }
    if (mode === 'confirm') rows.push(['人数', ...days.map(d => dayCount(d) || '')]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, ...days.map(() => ({ wch: 6 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'シフト');
    XLSX.writeFile(wb, `シフト表_${WORK_LOCATION_LABELS[location]}_${mode === 'confirm' ? '確定' : '希望'}_${month}.xlsx`);
  };

  const cellBase = 'min-w-9 text-center text-xs border-b border-r border-gray-100 cursor-pointer select-none p-0 h-9';
  const menuStaff = menu ? allStaff.find(s => s.id === menu.staffId) : null;
  const menuReqNames = menu ? names(reqIds(menu.staffId, menu.date)) : '';

  return (
    <PageContainer title="シフト表">
      {/* 操作バー */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, -1))}>←</Button>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, 1))}>→</Button>
          </div>
          <div className="flex rounded-md overflow-hidden border border-gray-300">
            {(Object.keys(WORK_LOCATION_LABELS) as WorkLocation[]).map(loc => (
              <button key={loc} onClick={() => { setLocation(loc); setMenu(null); }}
                className={`px-3 py-1.5 text-sm ${location === loc ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {WORK_LOCATION_LABELS[loc]}
              </button>
            ))}
          </div>
          <div className="flex rounded-md overflow-hidden border border-gray-300">
            <button onClick={() => { setMode('request'); setMenu(null); }}
              className={`px-3 py-1.5 text-sm ${mode === 'request' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>希望</button>
            <button onClick={() => { setMode('confirm'); setMenu(null); }}
              className={`px-3 py-1.5 text-sm ${mode === 'confirm' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>確定</button>
          </div>
          <div className="flex-1" />
          <Link to="/labor/shift-patterns" className="text-xs text-emerald-700 hover:underline">区分マスタ →</Link>
          {mode === 'confirm' && <Button variant="secondary" size="sm" onClick={handlePrint}>印刷</Button>}
          <Button variant="secondary" size="sm" onClick={exportExcel}>Excel出力</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
        </div>

        {/* 凡例 */}
        <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          {mode === 'request'
            ? <span>セルをクリックで希望の区分を選択（複数可・空欄＝希望なし）</span>
            : <span>セルをクリックで区分を割り当て（複数可）。希望がある日は<span className="text-amber-600"> 黄色 </span>で表示</span>}
          {validPatterns.map(p => (
            <span key={p.id} className="text-gray-600">{p.name}: {p.startTime}〜{p.endTime}</span>
          ))}
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
                    <th key={d} className={`min-w-9 px-0 py-1 text-xs font-medium border-b border-r border-gray-100 ${wd === 0 ? 'bg-red-50 text-red-500' : wd === 6 ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-gray-500'}`}>
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
                      const ids = mode === 'request' ? reqIds(s.id, date) : confIds(s.id, date);
                      const weekend = wd === 0 ? 'bg-red-50/40' : wd === 6 ? 'bg-blue-50/40' : '';
                      const hasReq = reqIds(s.id, date).length > 0;
                      const bg = mode === 'confirm' && hasReq ? 'bg-amber-50' : weekend;
                      return (
                        <td key={date}
                          onClick={e => setMenu({ staffId: s.id, date, x: Math.min(e.clientX, window.innerWidth - 190), y: Math.min(e.clientY, window.innerHeight - 260) })}
                          className={`${cellBase} ${bg}`}>
                          <span className="font-medium text-gray-800 leading-tight px-0.5">{names(ids)}</span>
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
                    <td key={date} className="min-w-9 text-center text-xs border-b border-r border-gray-100 text-gray-500">
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

      {/* 区分選択ポップアップ */}
      {menu && menuStaff && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-xl p-2 w-44" style={{ left: menu.x, top: menu.y }}>
            <div className="text-xs text-gray-500 mb-1 px-1">
              {menuStaff.lastName} {menuStaff.firstName}・{Number(menu.date.slice(5, 7))}/{Number(menu.date.slice(8))}
            </div>
            {mode === 'confirm' && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-1 mb-1">希望: {menuReqNames || 'なし'}</div>
            )}
            <div className="flex flex-col gap-1">
              {validPatterns.map(p => {
                const on = isOn(menu.staffId, menu.date, p.id);
                return (
                  <button key={p.id} onClick={() => togglePattern(menu.staffId, menu.date, p.id)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded text-sm ${on ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}>
                    <span>{on ? '✓ ' : ''}{p.name}</span>
                    <span className={`text-xs ${on ? 'text-emerald-100' : 'text-gray-400'}`}>{p.startTime}〜{p.endTime}</span>
                  </button>
                );
              })}
              {validPatterns.length === 0 && <span className="text-xs text-gray-400 px-1 py-2">この場所で使える区分がありません（区分マスタで登録）</span>}
            </div>
            <div className="flex justify-between mt-2 pt-2 border-t text-xs">
              <button onClick={() => clearCell(menu.staffId, menu.date)} className="text-red-500 hover:underline px-1">クリア</button>
              <button onClick={() => setMenu(null)} className="text-gray-500 hover:underline px-1">閉じる</button>
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
