import { useState } from 'react';
import { PageContainer, Card, Field, Input, Button, Alert } from '../components/UI';
import { changeAdminPassword, usingGas } from '../api/data';

export default function Settings() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
      </div>
    </PageContainer>
  );
}
