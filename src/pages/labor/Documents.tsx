import { useEffect, useState } from 'react';
import { PageContainer, Card, Field, Input, Select, Button, Alert, Badge } from '../../components/UI';
import { listDocuments, saveDocument, deleteDocument, genId } from '../../api/data';
import { DOC_TYPE_LABELS, DOC_TYPE_ORDER } from '../../utils/constants';
import type { DocumentItem, DocType } from '../../types';

export default function Documents() {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [type, setType] = useState<DocType>('form');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listDocuments().then(d => { if (alive) { setDocs(d); setLoading(false); } });
    return () => { alive = false; };
  }, [version]);

  const resetForm = () => { setEditId(null); setType('form'); setTitle(''); setUrl(''); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setMessage('');
    if (!title.trim()) { setError('タイトルを入力してください'); return; }
    if (!url.trim()) { setError('共有リンク（URL）を入力してください'); return; }
    setSaving(true);
    try {
      await saveDocument({ id: editId ?? genId('doc'), type, title: title.trim(), url: url.trim(), createdAt: '', updatedAt: '' });
      setMessage(editId ? '更新しました' : '登録しました');
      resetForm();
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally { setSaving(false); }
  };

  const edit = (d: DocumentItem) => { setEditId(d.id); setType(d.type); setTitle(d.title); setUrl(d.url); window.scrollTo(0, 0); };
  const remove = async (id: string) => {
    if (!confirm('この文書を削除しますか？（ドライブのファイル自体は消えません）')) return;
    try { await deleteDocument(id); setVersion(v => v + 1); if (editId === id) resetForm(); }
    catch (err) { setError(err instanceof Error ? err.message : '削除に失敗しました'); }
  };

  return (
    <PageContainer title="文書管理">
      <Card className="mb-4">
        <h2 className="font-bold text-gray-800 mb-1">{editId ? '文書を編集' : '文書を登録'}</h2>
        <p className="text-xs text-gray-500 mb-3">Googleドライブ等にファイルを置き、その共有リンクを登録します（従業員はリンクを開いて閲覧・ダウンロード）。</p>
        {message && <Alert type="success">{message}</Alert>}
        {error && <Alert type="error">{error}</Alert>}
        <form onSubmit={handleSubmit} className="grid sm:grid-cols-4 gap-3 items-end">
          <Field label="種別">
            <Select value={type} onChange={e => setType(e.target.value as DocType)}>
              {DOC_TYPE_ORDER.map(t => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Field label="タイトル">
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="例: 就業規則、休暇届" />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field label="共有リンク（URL）">
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://drive.google.com/..." />
            </Field>
          </div>
          <div className="mb-4 flex gap-2">
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? '保存中…' : (editId ? '更新' : '登録')}</Button>
            {editId && <Button type="button" variant="secondary" onClick={resetForm}>取消</Button>}
          </div>
        </form>
      </Card>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : docs.length === 0 ? (
        <Alert type="info">登録された文書はありません。上のフォームから登録してください。</Alert>
      ) : (
        DOC_TYPE_ORDER.map(t => {
          const list = docs.filter(d => d.type === t);
          if (list.length === 0) return null;
          return (
            <div key={t} className="mb-4">
              <div className="mb-2"><Badge color={t === 'rule' ? 'blue' : t === 'form' ? 'green' : 'gray'}>{DOC_TYPE_LABELS[t]}</Badge></div>
              <Card className="p-0 divide-y divide-gray-100">
                {list.map(d => (
                  <div key={d.id} className="flex items-center gap-3 px-3 py-2">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex-1 text-blue-600 hover:underline text-sm truncate">{d.title}</a>
                    <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:inline">{(d.updatedAt || '').slice(0, 10)}</span>
                    <Button variant="ghost" size="sm" onClick={() => edit(d)}>編集</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(d.id)}>削除</Button>
                  </div>
                ))}
              </Card>
            </div>
          );
        })
      )}
    </PageContainer>
  );
}
