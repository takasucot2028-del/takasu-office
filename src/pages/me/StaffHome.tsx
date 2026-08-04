import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageContainer, Card, Button, Alert } from '../../components/UI';
import { getMyProfile, punch, setMyBreak, getStaffHomeData, todayStr } from '../../api/data';
import { WEEKDAY_LABELS, DOC_TYPE_LABELS, breakMinutesBetween } from '../../utils/constants';
import type { Staff, AttendanceRecord, DocumentItem } from '../../types';

function parseHM(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** 実働＝退勤−出勤−休憩。breakOverride を渡すと入力中の休憩で即時計算する */
function workedText(rec?: AttendanceRecord, breakOverride?: number): string {
  if (!rec) return '';
  const s = parseHM(rec.startTime), e = parseHM(rec.endTime);
  if (s === null || e === null) return '';
  const brk = breakOverride ?? (rec.breakMinutes || 0);
  const min = Math.max(0, e - s - brk);
  return `${Math.floor(min / 60)}時間${min % 60}分`;
}

export default function StaffHome() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [today, setToday] = useState<AttendanceRecord | undefined>();
  const [recentDocs, setRecentDocs] = useState<DocumentItem[]>([]);
  const [breakStartInput, setBreakStartInput] = useState('');
  const [breakEndInput, setBreakEndInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const date = todayStr();
  const wd = WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];
  const breakNum = breakMinutesBetween(breakStartInput, breakEndInput);

  const load = async () => {
    const [p, home] = await Promise.all([getMyProfile(), getStaffHomeData(date.slice(0, 7))]);
    setStaff(p);
    const rec = home.attendance.find(r => r.date === date);
    setToday(rec);
    setBreakStartInput(rec?.breakStart || '');
    setBreakEndInput(rec?.breakEnd || '');
    setRecentDocs(home.documents.slice(0, 4));
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

  const saveBreak = async () => {
    if ((breakStartInput && !breakEndInput) || (!breakStartInput && breakEndInput)) {
      setError('休憩は開始と終了の両方を入力してください'); return;
    }
    if (breakStartInput && breakEndInput && breakNum === 0) {
      setError('休憩の終了は開始より後の時刻にしてください'); return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      await setMyBreak(breakStartInput, breakEndInput);
      setMessage(breakNum > 0 ? `休憩 ${breakStartInput}〜${breakEndInput}（${breakNum}分）を保存しました` : '休憩を保存しました');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '休憩時間の保存に失敗しました');
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
              <div><span className="text-gray-400 text-xs">実働</span><div className="text-lg font-bold">{workedText(today, breakNum) || '—'}</div></div>
            </div>
          )}
        </div>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => doPunch('in')} disabled={busy} className="px-8 py-3 text-base">出勤</Button>
          <Button onClick={() => doPunch('out')} disabled={busy} variant="secondary" className="px-8 py-3 text-base">退勤</Button>
        </div>

        {/* 休憩時間の入力（本日分・時刻で入力） */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-center flex-wrap gap-2 text-sm">
            <span className="text-gray-500">本日の休憩</span>
            <input
              type="time" value={breakStartInput} disabled={busy}
              onChange={e => setBreakStartInput(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5"
            />
            <span className="text-gray-500">〜</span>
            <input
              type="time" value={breakEndInput} disabled={busy}
              onChange={e => setBreakEndInput(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5"
            />
            <span className="text-gray-500 tabular-nums">{breakNum > 0 ? `（${breakNum}分）` : ''}</span>
            <Button size="sm" variant="secondary" onClick={saveBreak} disabled={busy}>休憩を保存</Button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            昼休みや中抜けの時間帯（例: 13:00〜14:00）を入力してください。実働＝退勤−出勤−休憩 で計算されます。
          </p>
        </div>

        <p className="text-xs text-gray-400 mt-3">打刻の時刻はサーバー基準で記録されます。修正が必要な場合は事務局へご連絡ください。</p>
      </Card>

      {/* メニュー */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <MenuLink to="/me/shifts" label="シフト希望" desc="勤務できる日を申請" />
        <MenuLink to="/me/overtime" label="時間外申請" desc="残業・休日勤務を申請" />
        <MenuLink to="/me/leave" label="休暇申請" desc="有給の申請・残の確認" />
        <MenuLink to="/me/expense" label="経費申請" desc="事業予算への経費申請" />
        <MenuLink to="/me/documents" label="文書・様式" desc="規則や様式を閲覧" />
        <MenuLink to="/me/settings" label="設定" desc="パスワード変更" />
      </div>

      {/* 新着文書 */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-gray-800">最近の文書</h2>
          <Link to="/me/documents" className="text-xs text-emerald-700 hover:underline">すべて見る →</Link>
        </div>
        {loading ? (
          <p className="text-xs text-gray-400">読み込み中…</p>
        ) : recentDocs.length === 0 ? (
          <p className="text-xs text-gray-400">文書はまだ登録されていません</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentDocs.map(d => (
              <li key={d.id}>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 py-2">
                  <span className="text-xs text-gray-400 w-10 shrink-0">{DOC_TYPE_LABELS[d.type]}</span>
                  <span className="flex-1 text-blue-600 text-sm">{d.title}</span>
                  <span className="text-gray-300 text-xs">開く ↗</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
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
