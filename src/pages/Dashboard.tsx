import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageContainer, Card, Badge } from '../components/UI';
import { listStaff, listShiftPatterns, listConfirmedByDate, listAbsencesByDate, todayStr } from '../api/data';
import type { DayAbsences } from '../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS } from '../utils/constants';
import type { WorkLocation, Staff, ShiftPattern, ConfirmedShift } from '../types';

export default function Dashboard() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [todayShifts, setTodayShifts] = useState<ConfirmedShift[]>([]);
  const [absences, setAbsences] = useState<DayAbsences>({ leave: [], comp: [] });
  const [loading, setLoading] = useState(true);

  const today = todayStr();
  const weekday = WEEKDAY_LABELS[new Date(`${today}T00:00:00`).getDay()];

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, p, sh, ab] = await Promise.all([
        listStaff(), listShiftPatterns(), listConfirmedByDate(today), listAbsencesByDate(today),
      ]);
      if (!alive) return;
      setStaff(s);
      setPatterns(p);
      setTodayShifts(sh);
      setAbsences(ab);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [today]);

  const activeStaff = staff.filter(s => s.status === 'active');
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const patternMap = new Map(patterns.map(p => [p.id, p]));

  return (
    <PageContainer title="事務管理ダッシュボード">
      {/* 本日の勤務 */}
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">本日の勤務・休暇 <span className="text-sm font-normal text-gray-500">{today}（{weekday}）</span></h2>
          <Link to="/labor/shifts" className="text-xs text-emerald-700 hover:underline">シフト管理へ →</Link>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">読み込み中…</p>
        ) : todayShifts.length === 0 ? (
          <p className="text-sm text-gray-400">本日のシフトは登録されていません</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {(Object.keys(WORK_LOCATION_LABELS) as WorkLocation[]).map(loc => {
              const shifts = todayShifts.filter(sh => sh.location === loc);
              return (
                <div key={loc}>
                  <div className="mb-2">
                    <Badge color={loc === 'sotai' ? 'blue' : 'green'}>{WORK_LOCATION_LABELS[loc]}</Badge>
                  </div>
                  {shifts.length === 0 ? (
                    <p className="text-xs text-gray-400">勤務者なし</p>
                  ) : (
                    <ul className="space-y-1">
                      {shifts.map(sh => {
                        const s = staffMap.get(sh.staffId);
                        const p = patternMap.get(sh.patternId);
                        return (
                          <li key={sh.id} className="text-sm text-gray-700 flex items-baseline gap-2">
                            <span className="font-medium">{s ? `${s.lastName} ${s.firstName}` : '(不明)'}</span>
                            {p && <span className="text-gray-500">{p.name} {p.startTime}〜{p.endTime}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 本日の休暇 */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="mb-2"><Badge color="yellow">休暇</Badge></div>
          {loading ? (
            <p className="text-xs text-gray-400">読み込み中…</p>
          ) : absences.leave.length === 0 && absences.comp.length === 0 ? (
            <p className="text-xs text-gray-400">本日の休暇取得者はいません</p>
          ) : (
            <ul className="space-y-1">
              {absences.leave.map(r => {
                const s = staffMap.get(r.staffId);
                return (
                  <li key={r.id} className="text-sm text-gray-700 flex items-baseline gap-2">
                    <span className="font-medium">{s ? `${s.lastName} ${s.firstName}` : '(不明)'}</span>
                    <span className="text-yellow-700">有給 {r.hours > 0 ? `${r.hours}時間` : `${r.days}日`}</span>
                    {r.note && <span className="text-xs text-gray-400">{r.note}</span>}
                  </li>
                );
              })}
              {absences.comp.map(r => {
                const s = staffMap.get(r.staffId);
                return (
                  <li key={r.id} className="text-sm text-gray-700 flex items-baseline gap-2">
                    <span className="font-medium">{s ? `${s.lastName} ${s.firstName}` : '(不明)'}</span>
                    <span className="text-blue-700">代休 {r.hours}時間</span>
                    {r.note && <span className="text-xs text-gray-400">{r.note}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* 労務管理 */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">労務管理</h2>
            <Badge color="green">稼働中</Badge>
          </div>
          <p className="text-sm text-gray-500 mb-1">在職職員数: {loading ? '—' : `${activeStaff.length}名`}</p>
          <p className="text-xs text-gray-400 mb-4">職員名簿・シフト・勤怠管理・有給休暇の管理</p>
          <div className="flex flex-wrap gap-2">
            <ModuleLink to="/labor/staff">職員名簿</ModuleLink>
            <ModuleLink to="/labor/shifts">シフト管理</ModuleLink>
            <ModuleLink to="/labor/attendance">勤怠管理</ModuleLink>
            <ModuleLink to="/labor/leave">有給休暇</ModuleLink>
          </div>
        </Card>

        {/* 今後追加予定のモジュール */}
        <ComingSoonCard title="会計管理" description="収支管理・予算管理・帳票出力" />
        <ComingSoonCard title="文書管理" description="規程・議事録・契約書類の管理" />
        <ComingSoonCard title="備品・施設管理" description="備品台帳・施設利用状況の管理" />
      </div>
    </PageContainer>
  );
}

function ModuleLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
    >
      {children}
    </Link>
  );
}

function ComingSoonCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="opacity-70">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-500">{title}</h2>
        <Badge color="gray">準備中</Badge>
      </div>
      <p className="text-xs text-gray-400">{description}</p>
    </Card>
  );
}
