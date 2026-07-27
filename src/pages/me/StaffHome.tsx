import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageContainer, Card, Button, Alert } from '../../components/UI';
import { getMyProfile, getMyAttendance, punch, todayStr } from '../../api/data';
import { WEEKDAY_LABELS } from '../../utils/constants';
import type { Staff, AttendanceRecord } from '../../types';

function parseHM(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function workedText(rec?: AttendanceRecord): string {
  if (!rec) return '';
  const s = parseHM(rec.startTime), e = parseHM(rec.endTime);
  if (s === null || e === null) return '';
  const min = Math.max(0, e - s - (rec.breakMinutes || 0));
  return `${Math.floor(min / 60)}時間${min % 60}分`;
}

export default function StaffHome() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [today, setToday] = useState<AttendanceRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const date = todayStr();
  const wd = WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];

  const load = async () => {
    const [p, att] = await Promise.all([getMyProfile(), getMyAttendance(date.slice(0, 7))]);
    setStaff(p);
    setToday(att.find(r => r.date === date));
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const doPunch = async (type: 'in' | 'out') => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await punch(type);
      setMessage(`${type === 'in' ? '出勤' : '退勤'}を記録しました（${res.time}）`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '打刻に失敗しました');
    } finally { setBusy(false); }
  };

  return (
    <PageContainer title={staff ? `こんにちは、${staff.lastName} ${staff.firstName} さん` : '打刻'}>
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      {/* 打刻 */}
      <Card className="mb-4 text-center">
        <p className="text-sm text-gray-500">{date}（{wd}）</p>
        <div className="my-3 text-sm text-gray-700">
          {loading ? '読み込み中…' : (
            <div className="flex justify-center gap-6">
              <div><span className="text-gray-400 text-xs">出勤</span><div className="text-lg font-bold">{today?.startTime || '—'}</div></div>
              <div><span className="text-gray-400 text-xs">退勤</span><div className="text-lg font-bold">{today?.endTime || '—'}</div></div>
              <div><span className="text-gray-400 text-xs">実働</span><div className="text-lg font-bold">{workedText(today) || '—'}</div></div>
            </div>
          )}
        </div>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => doPunch('in')} disabled={busy} className="px-8 py-3 text-base">出勤</Button>
          <Button onClick={() => doPunch('out')} disabled={busy} variant="secondary" className="px-8 py-3 text-base">退勤</Button>
        </div>
        <p className="text-xs text-gray-400 mt-3">打刻の時刻はサーバー基準で記録されます。修正が必要な場合は事務局へご連絡ください。</p>
      </Card>

      {/* メニュー */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MenuLink to="/me/shifts" label="シフト希望" desc="勤務できる日を申請" />
        <MenuLink to="/me/overtime" label="時間外申請" desc="残業・休日勤務を申請" />
        <MenuLink to="/me/leave" label="休暇申請" desc="有給の申請・残の確認" />
        <MenuLink to="/me/settings" label="設定" desc="パスワード変更" />
      </div>
    </PageContainer>
  );
}

function MenuLink({ to, label, desc }: { to: string; label: string; desc: string }) {
  return (
    <Link to={to} className="block">
      <Card className="hover:bg-gray-50 transition-colors h-full">
        <p className="font-bold text-gray-800">{label}</p>
        <p className="text-xs text-gray-400 mt-1">{desc}</p>
      </Card>
    </Link>
  );
}
