// 従業員向けの確定シフト表（閲覧のみ）
// 掲示するシフト表と同じ内容を、スマホでも見やすい形で表示する。
import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Button, Badge, SectionTitle } from '../../components/UI';
import { getShiftBoard, getMyProfile, listShiftPatterns, onDataRefresh, todayStr } from '../../api/data';
import type { ShiftBoard } from '../../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS, staffInLocation } from '../../utils/constants';
import { isSpecialHoliday } from '../../utils/holidays';
import type { ShiftPattern, WorkLocation, Staff } from '../../types';

/** 'YYYY-MM' の日付一覧 */
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
function addMonth(month: string, diff: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + diff, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function StaffSchedule() {
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const [location, setLocation] = useState<WorkLocation>('sotai');
  const [board, setBoard] = useState<ShiftBoard | null>(null);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [me, setMe] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const today = todayStr();

  useEffect(() => {
    listShiftPatterns().then(setPatterns).catch(() => {});
    getMyProfile().then(s => {
      if (!s) return;
      setMe(s);
      // 自分の勤務場所を最初に開く（両方の人は総体から）
      if (s.workLocation === 'kaiyo') setLocation('kaiyo');
    });
  }, []);

  // 事務局がシフトを更新したら自動で反映する
  useEffect(() => onDataRefresh(() => setVersion(v => v + 1)), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const b = await getShiftBoard(month);
      if (!alive) return;
      setBoard(b);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [month, version]);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);
  /** その勤務場所で使える区分（''=すべての場所で使える） */
  const validPatterns = useMemo(
    () => patterns.filter(p => !p.location || p.location === location).sort((a, b) => a.order - b.order),
    [patterns, location]
  );

  // 職員×日 → 区分ID（並び順に整列）
  const cell = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of board?.shifts ?? []) {
      if (s.location !== location) continue;
      const k = `${s.staffId}_${s.date}`;
      m.set(k, [...(m.get(k) ?? []), s.patternId]);
    }
    for (const [k, ids] of m) {
      m.set(k, ids.slice().sort((a, b) => (patternMap.get(a)?.order ?? 99) - (patternMap.get(b)?.order ?? 99)));
    }
    return m;
  }, [board, location, patternMap]);

  const names = (ids: string[]) => ids.map(id => patternMap.get(id)?.name ?? '').join(' ');
  const staffOfLoc = useMemo(
    () => (board?.staff ?? []).filter(s => staffInLocation(s.workLocation, location)),
    [board, location]
  );

  // 自分のシフト（勤務場所をまたいで拾う）
  const mine = useMemo(() => {
    if (!me || !board) return [];
    return board.shifts
      .filter(s => s.staffId === me.id)
      .reduce<{ date: string; location: WorkLocation; ids: string[] }[]>((acc, s) => {
        const hit = acc.find(x => x.date === s.date && x.location === s.location);
        if (hit) hit.ids.push(s.patternId);
        else acc.push({ date: s.date, location: s.location, ids: [s.patternId] });
        return acc;
      }, [])
      .map(x => ({ ...x, ids: x.ids.slice().sort((a, b) => (patternMap.get(a)?.order ?? 99) - (patternMap.get(b)?.order ?? 99)) }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location));
  }, [me, board, patternMap]);

  const myHours = useMemo(() => {
    let h = 0;
    for (const d of mine) {
      for (const id of d.ids) {
        const p = patternMap.get(id);
        if (!p) continue;
        const [sh, sm] = p.startTime.split(':').map(Number);
        const [eh, em] = p.endTime.split(':').map(Number);
        const min = (eh * 60 + em) - (sh * 60 + sm);
        if (min > 0) h += min / 60;
      }
    }
    return Math.round(h * 10) / 10;
  }, [mine, patternMap]);

  const dayColor = (date: string) => {
    const wd = new Date(`${date}T00:00:00`).getDay();
    if (isSpecialHoliday(date) || wd === 0) return 'text-alert';
    return wd === 6 ? 'text-info' : 'text-ink-mute';
  };

  return (
    <PageContainer title="シフト表">
      {/* 月と勤務場所 */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => setMonth(m => addMonth(m, -1))}>←</Button>
          <span className="num font-bold text-ink">{month.replace('-', '年')}月</span>
          <Button variant="secondary" onClick={() => setMonth(m => addMonth(m, 1))}>→</Button>
          {month !== today.slice(0, 7) && (
            <Button variant="secondary" onClick={() => setMonth(today.slice(0, 7))}>今月</Button>
          )}
          <div className="flex-1" />
          <div className="flex rounded-md overflow-hidden border border-rule">
            {(Object.keys(WORK_LOCATION_LABELS) as WorkLocation[]).map(loc => (
              <button key={loc} onClick={() => setLocation(loc)}
                className={`px-3 py-1.5 text-sm ${location === loc ? 'bg-pine text-white' : 'bg-white text-ink-soft hover:bg-paper'}`}>
                {WORK_LOCATION_LABELS[loc]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-mute mt-2">
          事務局が確定したシフトです。変更があるとホーム画面にお知らせが出ます。
          {validPatterns.length > 0 && (
            <span className="num ml-1">
              {validPatterns.map(p => `${p.name} ${p.startTime}〜${p.endTime}`).join('／')}
            </span>
          )}
        </p>
      </Card>

      {/* 自分のシフト */}
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-ink">自分のシフト</h2>
          {mine.length > 0 && <Badge color="green">{mine.length}日・{myHours}h</Badge>}
        </div>
        {loading ? (
          <p className="text-sm text-ink-mute">読み込み中…</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-ink-soft">この月のシフトはまだ確定していません。</p>
        ) : (
          <div className="divide-y divide-rule-soft">
            {mine.map(d => {
              const wd = new Date(`${d.date}T00:00:00`).getDay();
              const isToday = d.date === today;
              const past = d.date < today;
              return (
                <div key={`${d.date}_${d.location}`}
                  className={`flex items-center gap-3 py-2 text-sm ${past ? 'opacity-50' : ''} ${isToday ? 'bg-pine-soft -mx-2 px-2 rounded' : ''}`}>
                  <span className="num w-16 shrink-0 font-medium">
                    {Number(d.date.slice(5, 7))}/{Number(d.date.slice(8))}
                    <span className={`ml-1 text-xs ${dayColor(d.date)}`}>({WEEKDAY_LABELS[wd]})</span>
                  </span>
                  <span className="w-24 shrink-0 text-xs text-ink-mute">{WORK_LOCATION_LABELS[d.location]}</span>
                  <span className="font-medium text-ink">{names(d.ids)}</span>
                  <span className="num text-xs text-ink-mute">
                    {d.ids.map(id => {
                      const p = patternMap.get(id);
                      return p ? `${p.startTime}〜${p.endTime}` : '';
                    }).filter(Boolean).join(', ')}
                  </span>
                  {isToday && <Badge color="green">本日</Badge>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 全員のシフト表 */}
      <Card className="p-0 overflow-x-auto">
        <div className="px-4 pt-4 pb-2">
          <SectionTitle note="横にスクロールできます。自分の行は色付きです。">
            {WORK_LOCATION_LABELS[location]}のシフト表
          </SectionTitle>
        </div>
        {loading ? (
          <p className="text-sm text-ink-mute px-4 pb-4">読み込み中…</p>
        ) : staffOfLoc.length === 0 ? (
          <p className="text-sm text-ink-soft px-4 pb-4">この勤務場所の職員がいません。</p>
        ) : (
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-paper border-b border-r border-rule px-3 py-1 text-left font-medium text-ink-soft whitespace-nowrap">職員</th>
                {days.map(date => {
                  const wd = new Date(`${date}T00:00:00`).getDay();
                  return (
                    <th key={date} className={`num bg-paper border-b border-rule px-1 py-1 font-medium w-9 ${dayColor(date)} ${date === today ? 'bg-pine-soft' : ''}`}>
                      <div>{Number(date.slice(8))}</div>
                      <div className="text-xs">{WEEKDAY_LABELS[wd]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {staffOfLoc.map((s, i) => {
                const isMe = me?.id === s.id;
                const stripe = isMe ? 'bg-pine-soft' : i % 2 === 1 ? 'bg-paper' : 'bg-white';
                return (
                  <tr key={s.id} className={stripe}>
                    <td className={`sticky left-0 z-10 ${stripe} border-b border-r border-rule-soft px-3 py-1 whitespace-nowrap ${isMe ? 'font-bold text-pine' : 'font-medium'}`}>
                      {s.name}
                    </td>
                    {days.map(date => {
                      const ids = cell.get(`${s.id}_${date}`) ?? [];
                      return (
                        <td key={date}
                          className={`border-b border-rule-soft text-center px-0.5 py-1 ${date === today ? 'bg-pine-soft/60' : ''}`}>
                          <span className="font-medium text-ink">{names(ids)}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </PageContainer>
  );
}
