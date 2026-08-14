import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageContainer, Card, Badge } from '../components/UI';
import { getDashboardData, getDashboardCached, todayStr } from '../api/data';
import type { DayAbsences, PendingSummary } from '../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS } from '../utils/constants';
import type { WorkLocation, Staff, ShiftPattern, ConfirmedShift } from '../types';

// 未承認の種別ごとの表示設定
const PENDING_LABEL = { overtime: '時間外', leave: '休暇', expense: '経費' } as const;
const PENDING_COLOR = { overtime: 'yellow', leave: 'blue', expense: 'green' } as const;
const PENDING_LINK = { overtime: '/labor/overtime', leave: '/labor/leave', expense: '/labor/accounting' } as const;

export default function Dashboard() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [todayShifts, setTodayShifts] = useState<ConfirmedShift[]>([]);
  const [absences, setAbsences] = useState<DayAbsences>({ leave: [], comp: [] });
  const [pending, setPending] = useState<PendingSummary>({ expenses: 0, overtime: 0, leave: 0 });
  const [loading, setLoading] = useState(true);

  const today = todayStr();
  const weekday = WEEKDAY_LABELS[new Date(`${today}T00:00:00`).getDay()];

  useEffect(() => {
    let alive = true;
    const apply = (d: { staff: Staff[]; patterns: ShiftPattern[]; confirmed: ConfirmedShift[]; absences: DayAbsences; pending?: PendingSummary }) => {
      setStaff(d.staff); setPatterns(d.patterns); setTodayShifts(d.confirmed); setAbsences(d.absences);
      if (d.pending) setPending(d.pending);
      setLoading(false);
    };
    const cached = getDashboardCached(today); // 当日の保存があればまず即表示
    if (cached) apply(cached);
    (async () => {
      const d = await getDashboardData(today); // 最新を取得して更新
      if (alive) apply(d);
    })();
    return () => { alive = false; };
  }, [today]);

  const activeStaff = staff.filter(s => s.status === 'active');
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const patternMap = new Map(patterns.map(p => [p.id, p]));

  return (
    <PageContainer title="事務管理ダッシュボード">
      {/* 未承認の申請（要対応） */}
      {!loading && (pending.expenses + pending.overtime + pending.leave) > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-amber-800">未承認の申請があります</h2>
            <Badge color="yellow">要対応 {pending.expenses + pending.overtime + pending.leave}件</Badge>
          </div>
          {/* 誰から・いつ・何の申請かを一覧表示（そのまま該当画面へ移動できる） */}
          {pending.items && pending.items.length > 0 ? (
            <ul className="divide-y divide-amber-200 border border-amber-200 rounded-md bg-white">
              {pending.items.map((it, i) => (
                <li key={i}>
                  <Link to={PENDING_LINK[it.type]} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 hover:bg-amber-50">
                    <Badge color={PENDING_COLOR[it.type]}>{PENDING_LABEL[it.type]}</Badge>
                    <span className="font-medium text-gray-800">{it.staffName}</span>
                    <span className="text-sm text-gray-500">{it.date}</span>
                    <span className="text-sm text-gray-600">{it.detail}</span>
                    <span className="ml-auto text-xs text-amber-700">確認する →</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pending.overtime > 0 && (
                <Link to="/labor/overtime" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-white border border-amber-300 text-sm text-amber-800 hover:bg-amber-100">
                  時間外申請 <span className="font-bold">{pending.overtime}</span>件 →
                </Link>
              )}
              {pending.leave > 0 && (
                <Link to="/labor/leave" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-white border border-amber-300 text-sm text-amber-800 hover:bg-amber-100">
                  休暇申請 <span className="font-bold">{pending.leave}</span>件 →
                </Link>
              )}
              {pending.expenses > 0 && (
                <Link to="/labor/accounting" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-white border border-amber-300 text-sm text-amber-800 hover:bg-amber-100">
                  経費申請 <span className="font-bold">{pending.expenses}</span>件 →
                </Link>
              )}
            </div>
          )}
        </Card>
      )}

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
              // 区分の時間順（①→②→③）に並べ、同じ区分内は職員のかな順
              const shifts = todayShifts
                .filter(sh => sh.location === loc)
                .slice()
                .sort((a, b) => {
                  const oa = patternMap.get(a.patternId)?.order ?? 99;
                  const ob = patternMap.get(b.patternId)?.order ?? 99;
                  if (oa !== ob) return oa - ob;
                  return (staffMap.get(a.staffId)?.lastKana || '').localeCompare(staffMap.get(b.staffId)?.lastKana || '', 'ja');
                });
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

        {/* 文書管理 */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">文書管理</h2>
            <Badge color="green">稼働中</Badge>
          </div>
          <p className="text-xs text-gray-400 mb-4">様式・規則をドライブのリンクで登録し、従業員が閲覧</p>
          <div className="flex flex-wrap gap-2">
            <ModuleLink to="/labor/documents">文書管理</ModuleLink>
          </div>
        </Card>

        {/* 会計管理 */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">会計管理</h2>
            <Badge color="green">稼働中</Badge>
          </div>
          <p className="text-xs text-gray-400 mb-4">事業予算（費目別）の管理と、従業員の経費申請・承認</p>
          <div className="flex flex-wrap gap-2">
            <ModuleLink to="/labor/accounting">会計管理</ModuleLink>
          </div>
        </Card>

        {/* 今後追加予定のモジュール */}
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
