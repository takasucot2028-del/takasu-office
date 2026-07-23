import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageContainer, Card, Field, Input, Select, Button, Alert, Modal } from '../../components/UI';
import { getStaff, upsertStaff, genId } from '../../api/data';
import { EMPLOYMENT_TYPE_LABELS, WORK_LOCATION_LABELS } from '../../utils/constants';
import type { Staff, EmploymentType, WorkLocation } from '../../types';

function emptyStaff(): Staff {
  return {
    id: genId('stf'),
    lastName: '', firstName: '', lastKana: '', firstKana: '',
    birthDate: '',
    employmentType: 'fulltime', workLocation: '', position: '',
    hireDate: '', retireDate: '', status: 'active',
    phone: '', email: '', address: '', qualifications: '', hourlyWage: 0, note: '',
    createdAt: '', updatedAt: '',
  };
}

export default function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [form, setForm] = useState<Staff | null>(() => (isNew ? emptyStaff() : null));
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireDate, setRetireDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    (async () => {
      const s = await getStaff(id!);
      if (!alive) return;
      setForm(s);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, isNew]);

  if (loading) {
    return (
      <PageContainer title="職員詳細">
        <p className="text-sm text-gray-400">読み込み中…</p>
      </PageContainer>
    );
  }

  if (!form) {
    return (
      <PageContainer title="職員詳細">
        <Alert type="error">職員が見つかりません</Alert>
        <Button variant="secondary" onClick={() => navigate('/labor/staff')}>職員名簿へ戻る</Button>
      </PageContainer>
    );
  }

  const set = <K extends keyof Staff>(key: K, value: Staff[K]) =>
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.lastName || !form.firstName || !form.lastKana || !form.firstKana) {
      setError('氏名とフリガナは必須です');
      return;
    }
    if (!form.hireDate) {
      setError('入職日は必須です');
      return;
    }
    setSaving(true);
    try {
      await upsertStaff(form);
      if (isNew) {
        navigate('/labor/staff');
      } else {
        setMessage('保存しました');
        window.scrollTo(0, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleRetire = async () => {
    const next: Staff = { ...form, status: 'retired', retireDate };
    setSaving(true);
    try {
      await upsertStaff(next);
      setForm(next);
      setRetireOpen(false);
      setMessage(`退職処理を行いました（退職日: ${retireDate}）`);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleRejoin = async () => {
    const next: Staff = { ...form, status: 'active', retireDate: '' };
    setSaving(true);
    try {
      await upsertStaff(next);
      setForm(next);
      setMessage('在職に戻しました');
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer title={isNew ? '新規職員登録' : `職員詳細: ${form.lastName} ${form.firstName}`}>
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}
      {form.status === 'retired' && (
        <Alert type="info">この職員は退職済みです（退職日: {form.retireDate || '未設定'}）</Alert>
      )}

      <form onSubmit={handleSave}>
        <Card className="mb-4">
          <h2 className="font-bold text-gray-800 mb-4">基本情報</h2>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="姓" required>
              <Input value={form.lastName} onChange={e => set('lastName', e.target.value)} />
            </Field>
            <Field label="名" required>
              <Input value={form.firstName} onChange={e => set('firstName', e.target.value)} />
            </Field>
            <Field label="セイ（カナ）" required>
              <Input value={form.lastKana} onChange={e => set('lastKana', e.target.value)} />
            </Field>
            <Field label="メイ（カナ）" required>
              <Input value={form.firstKana} onChange={e => set('firstKana', e.target.value)} />
            </Field>
            <Field label="生年月日">
              <Input type="date" value={form.birthDate} onChange={e => set('birthDate', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card className="mb-4">
          <h2 className="font-bold text-gray-800 mb-4">雇用情報</h2>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="雇用区分" required>
              <Select
                value={form.employmentType}
                onChange={e => set('employmentType', e.target.value as EmploymentType)}
              >
                {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="勤務場所">
              <Select
                value={form.workLocation}
                onChange={e => set('workLocation', e.target.value as WorkLocation | '' | 'both')}
              >
                <option value="">未設定</option>
                {Object.entries(WORK_LOCATION_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
                <option value="both">総体・海洋センター（両方）</option>
              </Select>
            </Field>
            <Field label="役職・担当">
              <Input value={form.position} onChange={e => set('position', e.target.value)} placeholder="例: 事務局長、水泳教室 指導員" />
            </Field>
            <Field label="入職日" required>
              <Input type="date" value={form.hireDate} onChange={e => set('hireDate', e.target.value)} />
            </Field>
            <Field label="保有資格">
              <Input value={form.qualifications} onChange={e => set('qualifications', e.target.value)} placeholder="例: スポーツ指導員、簿記2級" />
            </Field>
            <Field label="時給（円）">
              <Input type="number" min={0} step={10} value={form.hourlyWage || ''}
                onChange={e => set('hourlyWage', Number(e.target.value) || 0)} placeholder="時間外手当の計算に使用" />
            </Field>
          </div>
        </Card>

        <Card className="mb-4">
          <h2 className="font-bold text-gray-800 mb-4">連絡先</h2>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="電話番号">
              <Input value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
            <Field label="メールアドレス">
              <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
          </div>
          <Field label="住所">
            <Input value={form.address} onChange={e => set('address', e.target.value)} />
          </Field>
          <Field label="備考">
            <Input value={form.note} onChange={e => set('note', e.target.value)} />
          </Field>
        </Card>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>{saving ? '保存中…' : (isNew ? '登録する' : '保存する')}</Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/labor/staff')}>
              職員名簿へ戻る
            </Button>
          </div>
          {!isNew && form.status === 'active' && (
            <Button type="button" variant="danger" onClick={() => setRetireOpen(true)}>
              退職処理
            </Button>
          )}
          {!isNew && form.status === 'retired' && (
            <Button type="button" variant="secondary" onClick={handleRejoin}>
              在職に戻す
            </Button>
          )}
        </div>
      </form>

      <Modal open={retireOpen} onClose={() => setRetireOpen(false)} title="退職処理">
        <p className="text-sm text-gray-600 mb-4">
          {form.lastName} {form.firstName} さんを退職にします。退職日を指定してください。
        </p>
        <Field label="退職日" required>
          <Input type="date" value={retireDate} onChange={e => setRetireDate(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRetireOpen(false)}>キャンセル</Button>
          <Button variant="danger" onClick={handleRetire} disabled={saving}>{saving ? '処理中…' : '退職にする'}</Button>
        </div>
      </Modal>
    </PageContainer>
  );
}
