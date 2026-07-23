import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);

  const [month, setMonth] = useState(currentMonth());
  const [location, setLocation] = useState<WorkLocation>('sotai');
  const [mode, setMode] = useState<Mode>('request');

  const [availMap, setAvailMap] = useState<Record<string, AvailabilityStatus>>({});
  // 確定は1セルに複数区分を持てるため patternId の配列で保持する
  const [confMap, setConfMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // 確定モードで区分を選ぶポップアップ
  const [menu, setMenu] = useState<{ staffId: string; date: string; x: number; y: number } | null>(null);

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
    setMenu(null);
    (async () => {
      const [avail, conf] = await Promise.all([listAvailabilityByMonth(month), listConfirmedByMonth(month)]);
      if (!alive) return;
      const am: Record<string, AvailabilityStatus> = {};
      for (const r of avail) am[aKey(r.staffId, r.date)] = r.status;
      const cm: Record<string, string[]> = {};
      for (const r of conf) {
        const k = cKey(r.staffId, r.date, r.location);
        (cm[k] = cm[k] || []).push(r.patternId);
      }
      setAvailMap(am);
      setConfMap(cm);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month]);

  // 希望セル：クリックで 空→○→×
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

  // 確定セル：区分の付け外し（複数可）
  const togglePattern = (staffId: string, date: string, patternId: string) => {
    const k = cKey(staffId, date, location);
    setConfMap(prev => {
      const cur = prev[k] || [];
      const has = cur.includes(patternId);
      const arr = has ? cur.filter(id => id !== patternId) : [...cur, patternId];
      const next = { ...prev };
      if (arr.length) next[k] = arr; else delete next[k];
      return next;
    });
  };
  const clearCell = (staffId: string, date: string) => {
    const k = cKey(staffId, date, location);
    setConfMap(prev => { const next = { ...prev }; delete next[k]; return next; });
  };

  // 区分を master 順に並べた patternId 配列
  const cellPatternIds = (staffId: string, date: string): string[] => {
    const ids = confMap[cKey(staffId, date, location)] || [];
    return patterns.filter(p => ids.includes(p.id)).map(p => p.id);
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
        for (const [k, pids] of Object.entries(confMap)) {
          if (!k.endsWith(`_${location}`)) continue;
          const rest = k.slice(0, k.length - location.length - 1);
          const sep = rest.lastIndexOf('_');
          const staffId = rest.slice(0, sep);
          const date = rest.slice(sep + 1);
          if (!date.startsWith(month)) continue;
          for (const patternId of pids) {
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

  // 保存してから印刷ページへ（表示中の内容をそのまま印刷できるように）
  const handlePrint = async () => {
    await handleSave();
    navigate(`/labor/shifts/print?month=${month}&location=${location}`);
  };

  // 集計（確定モード）
  const staffTotals = (staffId: string) => {
    let daysCount = 0, hours = 0;
    for (const date of days) {
      const ids = confMap[cKey(staffId, date, location)] || [];
      if (ids.length) {
        daysCount++;
        for (const id of ids) { const p = patternMap.get(id); if (p) hours += patternHours(p); }
      }
    }
    return { daysCount, hours: Math.round(hours * 10) / 10 };
  };
  const dayCount = (date: string) =>
    staffOfLoc.reduce((n, s) => n + ((confMap[cKey(s.id, date, location)] || []).length ? 1 : 0), 0);

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
          row.push(cellPatternIds(s.id, date).map(id => patternMap.get(id)?.name ?? '').join(' '));
        }
      }
      if (mode === 'confirm') { const t = staffTotals(s.id); row.push(t.daysCount, t.hours); }
      rows.push(row);
    }
    if (mode === 'confirm') {
      rows.push(['人数', ...days.map(d => dayCount(d) || '')]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, ...days.map(() => ({ wch: 6 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'シフト');
    XLSX.writeFile(wb, `シフト表_${WORK_LOCATION_LABELS[location]}_${month}.xlsx`);
  };

  const cellBase = 'min-w-9 text-center text-xs border-b border-r border-gray-100 cursor-pointer select-none p-0 h-9';
  const menuStaff = menu ? allStaff.find(s => s.id === menu.staffId) : null;

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
          {mode === 'confirm' && <Button variant="secondary" size="sm" onClick={handlePrint}>印刷</Button>}
          <Button variant="secondary" size="sm" onClick={exportExcel}>Excel出力</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
        </div>

        {/* 凡例 */}
        <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          {mode === 'request' ? (
            <span>クリックで切替：空欄（不明）→ <span className="text-green-600 font-bold">○</span>（入れる）→ <span className="text-red-500 font-bold">×</span>（入れない）</span>
          ) : (
            <>
              <span>セルをクリックで区分を選択（複数可）。背景色は希望（<span className="text-green-600">緑=○</span> / <span className="text-red-500">赤=×</span>）</span>
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
                      const avail = availMap[aKey(s.id, date)];
                      if (mode === 'request') {
                        return (
                          <td key={date} onClick={() => cycleAvail(s.id, date)}
                            className={`${cellBase} w-9 ${wd === 0 ? 'bg-red-50/40' : wd === 6 ? 'bg-blue-50/40' : ''}`}>
                            {avail === 'available' ? <span className="text-green-600 font-bold">○</span>
                              : avail === 'unavailable' ? <span className="text-red-500 font-bold">×</span> : ''}
                          </td>
                        );
                      }
                      const ids = cellPatternIds(s.id, date);
                      const hint = avail === 'available' ? 'bg-green-50' : avail === 'unavailable' ? 'bg-red-50' : (wd === 0 ? 'bg-red-50/40' : wd === 6 ? 'bg-blue-50/40' : '');
                      return (
                        <td key={date}
                          onClick={e => setMenu({ staffId: s.id, date, x: Math.min(e.clientX, window.innerWidth - 190), y: Math.min(e.clientY, window.innerHeight - 240) })}
                          className={`${cellBase} ${hint}`}>
                          <span className="font-medium text-gray-800 leading-tight px-0.5">{ids.map(id => patternMap.get(id)?.name ?? '').join(' ')}</span>
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

      {/* 確定：区分選択ポップアップ */}
      {menu && menuStaff && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-xl p-2 w-44" style={{ left: menu.x, top: menu.y }}>
            <div className="text-xs text-gray-500 mb-1 px-1">
              {menuStaff.lastName} {menuStaff.firstName}・{Number(menu.date.slice(5, 7))}/{Number(menu.date.slice(8))}
            </div>
            <div className="flex flex-col gap-1">
              {patterns.map(p => {
                const on = (confMap[cKey(menu.staffId, menu.date, location)] || []).includes(p.id);
                return (
                  <button key={p.id} onClick={() => togglePattern(menu.staffId, menu.date, p.id)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded text-sm ${on ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}>
                    <span>{on ? '✓ ' : ''}{p.name}</span>
                    <span className={`text-xs ${on ? 'text-emerald-100' : 'text-gray-400'}`}>{p.startTime}〜{p.endTime}</span>
                  </button>
                );
              })}
              {patterns.length === 0 && <span className="text-xs text-gray-400 px-1 py-2">区分マスタで区分を登録してください</span>}
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
