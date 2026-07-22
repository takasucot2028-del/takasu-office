import { Link } from 'react-router-dom';
import { PageContainer, Card, Badge } from '../components/UI';
import { listStaff, listShiftsByDate, todayStr } from '../utils/store';
import { WORK_LOCATION_LABELS, WEEKDAY_LABELS } from '../utils/constants';
import type { WorkLocation } from '../types';

export default function Dashboard() {
  const allStaff = listStaff();
  const activeStaff = allStaff.filter(s => s.status === 'active');
  const staffMap = new Map(allStaff.map(s => [s.id, s]));

  const today = todayStr();
  const weekday = WEEKDAY_LABELS[new Date(`${today}T00:00:00`).getDay()];
  const todayShifts = listShiftsByDate(today);

  return (
    <PageContainer title="事務管理ダッシュボード">
      {/* 本日の勤務 */}
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">本日の勤務 <span className="text-sm font-normal text-gray-500">{today}（{weekday}）</span></h2>
          <Link to="/labor/shifts" className="text-xs text-emerald-700 hover:underline">シフト管理へ →</Link>
        </div>
        {todayShifts.length === 0 ? (
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
                        return (
                          <li key={sh.id} className="text-sm text-gray-700 flex items-baseline gap-2">
                            <span className="font-medium">{s ? `${s.lastName} ${s.firstName}` : '(不明)'}</span>
                            <span className="text-gray-500">{sh.startTime}〜{sh.endTime}</span>
                            {sh.note && <span className="text-xs text-gray-400">{sh.note}</span>}
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
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* 労務管理 */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">労務管理</h2>
            <Badge color="green">稼働中</Badge>
          </div>
          <p className="text-sm text-gray-500 mb-1">在職職員数: {activeStaff.length}名</p>
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
