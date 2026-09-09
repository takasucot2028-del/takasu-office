import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageContainer, Card, Field, Input, Button, Alert } from '../components/UI';
import { getPrefs, setPref } from '../utils/prefs';
import {
  changeAdminPassword, usingGas, clearDataCache,
  listCompanyHolidays, saveCompanyHolidays, genId, todayStr,
} from '../api/data';
import type { CompanyHoliday } from '../types';

export default function Settings() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showLeaveObligation, setShowLeaveObligation] = useState(() => getPrefs().showLeaveObligation);

  // 法人が指定する休日（就業規則 第19条④）
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [hDate, setHDate] = useState(todayStr());
  const [hName, setHName] = useState('');
  const [hSaving, setHSaving] = useState(false);
  const [holidayMsg, setHolidayMsg] = useState('');
  const [holidayErr, setHolidayErr] = useState('');

  useEffect(() => { listCompanyHolidays().then(setHolidays).catch(() => {}); }, []);

  /** 追加・削除のたびに一覧まるごと保存する（件数が少ないため） */
  const persistHolidays = async (next: CompanyHoliday[], msg: string) => {
    const before = holidays;
    setHolidays(next);
    setHSaving(true); setHolidayErr(''); setHolidayMsg('');
    try {
      await saveCompanyHolidays(next);
      setHolidayMsg(msg);
    } catch (err) {
      setHolidays(before); // 保存できなかったので戻す
      setHolidayErr(err instanceof Error ? err.message : '休日の保存に失敗しました');
    } finally { setHSaving(false); }
  };

  const addHoliday = () => {
    if (!hDate) { setHolidayErr('日付を入力してください'); return; }
    if (holidays.some(h => h.date === hDate)) { setHolidayErr('その日はすでに登録されています'); return; }
    const next = [...holidays, { id: genId('ch'), date: hDate, name: hName.trim() }]
      .sort((a, b) => a.date.localeCompare(b.date));
    setHName('');
    void persistHolidays(next, `${hDate} を休日に登録しました`);
  };

  const removeHoliday = (id: string) => {
    void persistHolidays(holidays.filter(h => h.id !== id), '休日を削除しました');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (newPassword.length < 6) {
      setError('新しいパスワードは6文字以上で入力してください');
      return;
    }
    if (newPassword !== confirm) {
      setError('新しいパスワード（確認）が一致しません');
      return;
    }
    setSaving(true);
    try {
      await changeAdminPassword(oldPassword, newPassword);
      setMessage('パスワードを変更しました');
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'パスワードの変更に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer title="設定">
      <div className="max-w-md">
        <Card>
          <h2 className="font-bold text-gray-800 mb-1">パスワードの変更</h2>
          <p className="text-xs text-gray-500 mb-4">事務局ログイン用のパスワードを変更します。</p>
          {message && <Alert type="success">{message}</Alert>}
          {error && <Alert type="error">{error}</Alert>}
          {!usingGas && (
            <Alert type="info">
              現在はデモモード（この端末のブラウザ内に保存）です。変更は本番データ共有には反映されません。
            </Alert>
          )}
          <form onSubmit={handleSubmit}>
            <Field label="現在のパスワード" required>
              <Input
                type="password"
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="新しいパスワード（6文字以上）" required>
              <Input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="新しいパスワード（確認）" required>
              <Input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Button type="submit" disabled={saving}>{saving ? '変更中…' : '変更する'}</Button>
          </form>
        </Card>

        <Card className="mt-4">
          <h2 className="font-bold text-gray-800 mb-1">ダッシュボードの表示</h2>
          <p className="text-xs text-gray-500 mb-3">
            この端末での表示の設定です。ほかのパソコンやスマホには反映されません。
          </p>
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 mt-1"
              checked={showLeaveObligation}
              onChange={e => { setShowLeaveObligation(e.target.checked); setPref('showLeaveObligation', e.target.checked); }} />
            <span>
              「年5日の年休取得が未達の職員」を表示する
              <span className="block text-xs text-gray-500">
                法令上は年5日の取得が必要ですが、ダッシュボードに出す必要がなければ外してください。
                有給休暇の画面では職員ごとの達成状況を引き続き確認できます。
              </span>
            </span>
          </label>
        </Card>

        <Card className="mt-4">
          <h2 className="font-bold text-gray-800 mb-1">法人が指定する休日</h2>
          <p className="text-xs text-gray-500 mb-3">
            就業規則 第19条④の「その他法人が指定する日」を登録します。
            <b>土日・祝日・年末年始（12/29〜1/4）は自動判定</b>のため、登録は不要です。
            登録した日はシフト表や出勤簿で休日として扱われます。
          </p>
          {holidayMsg && <Alert type="success">{holidayMsg}</Alert>}
          {holidayErr && <Alert type="error">{holidayErr}</Alert>}
          <div className="flex items-end gap-2 mb-3">
            <Field label="日付">
              <Input type="date" value={hDate} onChange={e => setHDate(e.target.value)} />
            </Field>
            <Field label="名称（任意）">
              <Input value={hName} onChange={e => setHName(e.target.value)} placeholder="例: 創立記念日" />
            </Field>
            <div className="mb-4"><Button size="sm" onClick={addHoliday} disabled={hSaving}>追加</Button></div>
          </div>
          {holidays.length === 0 ? (
            <p className="text-xs text-gray-400">登録された休日はありません。</p>
          ) : (
            <ul className="divide-y border border-gray-200 rounded-md">
              {holidays.map(h => (
                <li key={h.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span>
                    <span className="font-medium text-gray-800">{h.date}</span>
                    <span className="ml-2 text-gray-500">{h.name || '休業日'}</span>
                  </span>
                  <Button variant="ghost" size="sm" disabled={hSaving}
                    onClick={() => removeHoliday(h.id)}>削除</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="mt-4">
          <h2 className="font-bold text-gray-800 mb-1">表示がおかしいとき</h2>
          <p className="text-xs text-gray-500 mb-3">
            職員名簿やシフトが空のまま表示される場合は、この端末に保存された表示用データを消して読み込み直します。
            スプレッドシートのデータは消えません。
          </p>
          <Button variant="secondary" onClick={() => {
            clearDataCache();
            window.location.reload();
          }}>
            保存データを消して再読み込み
          </Button>
        </Card>

        <Card className="mt-4">
          <h2 className="font-bold text-gray-800 mb-1">年度切替・年度末処理</h2>
          <p className="text-xs text-gray-500 mb-3">
            前年度予算の新年度へのコピーと、年度データのExcelアーカイブを行います。
          </p>
          <Link to="/labor/yearend" className="text-sm text-emerald-700 hover:underline">年度切替を開く →</Link>
        </Card>

        <Card className="mt-4">
          <h2 className="font-bold text-gray-800 mb-1">変更履歴</h2>
          <p className="text-xs text-gray-500 mb-3">
            勤怠・時間外・休暇・会計などの登録や承認が、いつ誰の操作で行われたかを確認できます。
          </p>
          <Link to="/labor/audit" className="text-sm text-emerald-700 hover:underline">変更履歴を開く →</Link>
        </Card>
      </div>
    </PageContainer>
  );
}
