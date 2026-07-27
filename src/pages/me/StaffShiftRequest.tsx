import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Button, Alert } from '../../components/UI';
import { getMyProfile, listShiftPatterns, getMyAvailability, saveMyAvailability, genId, todayStr } from '../../api/data';
import { WEEKDAY_LABELS } from '../../utils/constants';
import type { Staff, ShiftPattern, AvailabilityRecord } from '../../types';

function currentMonth(): string { return todayStr().slice(0, 7); }
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

export default function StaffShiftRequest() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [map, setMap] = useState<Record<string, string[]>>({}); // date -> patternId[]
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const days = useMemo(() => daysOfMonth(month), [month]);
  const validPatterns = useMemo(
    () => patterns.filter(p => p.location === '' || !staff?.workLocation || staff.workLocation === 'both' || p.location === staff.workLocation),
    [patterns, staff]
  );

  useEffect(() => {
    (async () => {
      const [p, pat] = await Promise.all([getMyProfile(), listShiftPatterns()]);
      setStaff(p); setPatterns(pat);
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true); setMessage('');
    (async () => {
      const list = await getMyAvailability(month);
      if (!alive) return;
      const m: Record<string, string[]> = {};
      for (const r of list) (m[r.date] = m[r.date] || []).push(r.patternId);
      setMap(m); setLoading(false);
    })();
    return () => { alive = false; };
  }, [month]);

  const toggle = (date: string, pid: string) => {
    setMap(prev => {
      const cur = prev[date] || [];
      const arr = cur.includes(pid) ? cur.filter(x => x !== pid) : [...cur, pid];
      const next = { ...prev };
      if (arr.length) next[date] = arr; else delete next[date];
      return next;
    });
  };

  const handleSave = async () => {
    if (!staff) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const records: AvailabilityRecord[] = [];
      for (const [date, pids] of Object.entries(map)) {
        for (const patternId of pids) records.push({ id: genId('av'), staffId: staff.id, date, patternId });
      }
      await saveMyAvailability(month, records);
      setMessage('シフト希望を提出しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally { setSaving(false); }
  };

  return (
    <PageContainer title="シフト希望の申請">
      <Card className="mb-4">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, -1))}>← 前月</Button>
          <span className="font-bold text-gray-800">{Number(month.slice(0, 4))}年{Number(month.slice(5))}月</span>
          <Button variant="secondary" size="sm" onClick={() => setMonth(m => shiftMonth(m, 1))}>翌月 →</Button>
          <div className="flex-1" />
          <Button size="sm" onClick={handleSave} disabled={saving || !staff}>{saving ? '提出中…' : '提出する'}</Button>
        </div>
        <p className="mt-2 text-xs text-gray-500">勤務できる区分を日ごとにタップで選んでください（複数可）。提出後、事務局がシフトを確定します。</p>
      </Card>

      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <Card className="p-0 divide-y divide-gray-100">
        {loading ? (
          <p className="text-sm text-gray-400 p-4">読み込み中…</p>
        ) : validPatterns.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">選べるシフト区分がありません。事務局にお問い合わせください。</p>
        ) : days.map(date => {
          const wd = new Date(`${date}T00:00:00`).getDay();
          const sel = map[date] || [];
          return (
            <div key={date} className={`flex items-center gap-2 px-3 py-2 ${wd === 0 ? 'bg-red-50/40' : wd === 6 ? 'bg-blue-50/40' : ''}`}>
              <div className="w-14 shrink-0 text-sm">
                <span className="font-medium">{Number(date.slice(8))}</span>
                <span className={`ml-1 text-xs ${wd === 0 ? 'text-red-500' : wd === 6 ? 'text-blue-500' : 'text-gray-400'}`}>{WEEKDAY_LABELS[wd]}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {validPatterns.map(p => {
                  const on = sel.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => toggle(date, p.id)}
                      className={`px-2 py-1 rounded text-xs border ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                      {p.name} <span className={on ? 'text-emerald-100' : 'text-gray-400'}>{p.startTime}〜{p.endTime}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Card>

      <div className="flex justify-end mt-4">
        <Button onClick={handleSave} disabled={saving || !staff}>{saving ? '提出中…' : '提出する'}</Button>
      </div>
    </PageContainer>
  );
}
