import { useEffect, useState } from 'react';
import { PageContainer, Card, Field, Input, Button, Alert, SectionTitle } from '../../components/UI';
import { getMyProfile, changeStaffPassword } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS } from '../../utils/constants';
import type { Staff } from '../../types';

export default function StaffSettings() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { getMyProfile().then(setStaff); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setMessage('');
    if (newPw.length < 4) { setError('新しいパスワードは4文字以上で入力してください'); return; }
    if (newPw !== confirm) { setError('新しいパスワード（確認）が一致しません'); return; }
    setSaving(true);
    try {
      await changeStaffPassword(oldPw, newPw);
      setMessage('パスワードを変更しました');
      setOldPw(''); setNewPw(''); setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'パスワードの変更に失敗しました');
    } finally { setSaving(false); }
  };

  return (
    <PageContainer title="設定">
      <div className="max-w-md">
        {staff && (
          <Card className="mb-4">
            <SectionTitle>プロフィール</SectionTitle>
            <p className="text-sm text-ink">{staff.lastName} {staff.firstName}</p>
            <p className="text-xs text-ink-mute mt-1">職員番号: {staff.employeeNumber || '未設定'}／{EMPLOYMENT_TYPE_LABELS[staff.employmentType]}</p>
          </Card>
        )}
        <Card>
          <SectionTitle>パスワードの変更</SectionTitle>
          {message && <Alert type="success">{message}</Alert>}
          {error && <Alert type="error">{error}</Alert>}
          <form onSubmit={submit}>
            <Field label="現在のパスワード" required>
              <Input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} autoComplete="current-password" required />
            </Field>
            <Field label="新しいパスワード（4文字以上）" required>
              <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" required />
            </Field>
            <Field label="新しいパスワード（確認）" required>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>
            <Button type="submit" size="lg" disabled={saving}>{saving ? '変更中…' : '変更する'}</Button>
          </form>
        </Card>
      </div>
    </PageContainer>
  );
}
