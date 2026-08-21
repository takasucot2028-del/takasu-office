import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageContainer, Card, Badge } from '../components/UI';
import { getDashboardData, getDashboardCached, getDashboardAlertData, todayStr } from '../api/data';
import type { DayAbsences, PendingSummary } from '../api/data';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS } from '../utils/constants';
import { currentObligation } from '../utils/annualLeave';
import { monthlyTotals, evaluate36 } from '../utils/limit36';
import { getPrefs } from '../utils/prefs';
import { shiftPlanByDate, isMissingPunch } from '../utils/shiftPlan';
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
  const [leaveAlerts, setLeaveAlerts] = useState<{ name: string; remaining: number; deadline: string; overdue: boolean }[] | null>(null);
  const [ot36Alerts, setOt36Alerts] = useState<{ name: string; level: 'error' | 'warn'; texts: string[] }[] | null>(null);
  const [punchAlerts, setPunchAlerts] = useState<{ name: string; dates: string[] }[] | null>(null);

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

  // 年5日取得義務の未達者。主要表示の妨げにならないよう、描画後に裏で取得する。
  // 表示しない設定のときは取得自体を行わない。
  /**
   * 警告用のデータ。
   * 年5日未達・36協定・打刻漏れをまとめて1リクエストで取得する。
   * 本体の表示を妨げないよう、描画後に裏で読み込む。
   */
  useEffect(() => {
    if (!staff.length) return;
    let alive = true;
    (async () => {
      const showLeave = getPrefs().showLeaveObligation;
      let d;
      try { d = await getDashboardAlertData(today, showLeave); } catch { return; }
      if (!alive) return;
      const active = staff.filter(s => s.status === 'active');
      const month = today.slice(0, 7);

      // 年5日の取得義務（表示する設定のときだけ）
      if (showLeave) {
        setLeaveAlerts(active
          .map(s => {
            const o = currentObligation(d.leave.filter(r => r.staffId === s.id), today);
            if (!o || o.achieved) return null;
            return { name: `${s.lastName} ${s.firstName}`, remaining: o.remaining, deadline: o.deadline, overdue: o.overdue };
          })
          .filter((x): x is { name: string; remaining: number; deadline: string; overdue: boolean } => x !== null)
          .sort((a, b) => a.deadline.localeCompare(b.deadline)));
      } else {
        setLeaveAlerts([]);
      }

      // 36協定の上限
      setOt36Alerts(active
        .map(s => {
          const st = evaluate36(monthlyTotals(d.overtime.filter(r => r.staffId === s.id)), month);
          if (st.warnings.length === 0) return null;
          return {
            name: `${s.lastName} ${s.firstName}`,
            level: st.warnings.some(w => w.level === 'error') ? ('error' as const) : ('warn' as const),
            texts: st.warnings.map(w => w.text),
          };
        })
        .filter((x): x is { name: string; level: 'error' | 'warn'; texts: string[] } => x !== null)
        .sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)));

      // シフトがあるのに打刻がない日（区分マスタが読めているときだけ）
      if (patterns.length) {
        setPunchAlerts(active
          .map(s => {
            const plans = shiftPlanByDate(d.confirmed.filter(c => c.staffId === s.id), patterns);
            const recByDate = new Map(d.attendance.filter(r => r.staffId === s.id).map(r => [r.date, r]));
            const dates = [...plans.keys()]
              .filter(x => isMissingPunch(recByDate.get(x), plans.get(x), x, today))
              .sort();
            return dates.length ? { name: `${s.lastName} ${s.firstName}`, dates } : null;
          })
          .filter((x): x is { name: string; dates: string[] } => x !== null));
      }
    })();
    return () => { alive = false; };
  }, [staff, patterns, today]);

  const activeStaff = staff.filter(s => s.status === 'active');
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const patternMap = new Map(patterns.map(p => [p.id, p]));

  return (
    <PageContainer title="事務管理ダッシュボード">
      {/* 年5日取得義務の未達（労基法第39条第7項） */}
      {leaveAlerts && leaveAlerts.length > 0 && (
        <Card className="mb-4 border-red-300 bg-red-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-800">年5日の年休取得が未達の職員</h2>
            <Badge color="red">{leaveAlerts.length}名</Badge>
          </div>
          <div className="space-y-1 text-sm">
            {leaveAlerts.map((a, i) => (
              <div key={i} className="flex items-center gap-3 flex-wrap">
                <span className="font-medium">{a.name}</span>
                <span>あと <span className="font-bold">{a.remaining}日</span></span>
                <span className={a.overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>
                  期限 {a.deadline}{a.overdue ? '（超過）' : ''}
                </span>
              </div>
            ))}
          </div>
          <Link to="/labor/leave" className="text-xs text-emerald-700 hover:underline mt-2 inline-block">有給休暇管理を開く →</Link>
        </Card>
      )}

      {/* シフトがあるのに打刻がない日 */}
      {punchAlerts && punchAlerts.length > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-800">シフトがあるのに打刻がない日（今月）</h2>
            <Badge color="yellow">{punchAlerts.reduce((n, a) => n + a.dates.length, 0)}日</Badge>
          </div>
          <div className="space-y-1 text-sm">
            {punchAlerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3 flex-wrap">
                <span className="font-medium">{a.name}</span>
                <span className="text-gray-600">{a.dates.map(d => `${Number(d.slice(8))}日`).join('、')}</span>
              </div>
            ))}
          </div>
          <Link to="/labor/attendance" className="text-xs text-emerald-700 hover:underline mt-2 inline-block">勤怠管理を開く →</Link>
        </Card>
      )}

      {/* 36協定の上限（労基法第36条） */}
      {ot36Alerts && ot36Alerts.length > 0 && (
        <Card className={`mb-4 ${ot36Alerts.some(a => a.level === 'error') ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-800">36協定の上限に注意が必要な職員</h2>
            <Badge color={ot36Alerts.some(a => a.level === 'error') ? 'red' : 'yellow'}>{ot36Alerts.length}名</Badge>
          </div>
          <div className="space-y-2 text-sm">
            {ot36Alerts.map((a, i) => (
              <div key={i}>
                <span className="font-medium">{a.name}</span>
                <ul className="ml-4 list-disc text-xs text-gray-600">
                  {a.texts.map((t, j) => <li key={j} className={a.level === 'error' ? 'text-red-700' : ''}>{t}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <Link to="/labor/overtime" className="text-xs text-emerald-700 hover:underline mt-2 inline-block">時間外管理を開く →</Link>
        </Card>
      )}

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
