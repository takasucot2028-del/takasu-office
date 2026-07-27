import { useEffect, useState } from 'react';
import { PageContainer, Card, Badge, Alert } from '../../components/UI';
import { listDocuments } from '../../api/data';
import { DOC_TYPE_LABELS, DOC_TYPE_ORDER } from '../../utils/constants';
import type { DocumentItem } from '../../types';

export default function StaffDocuments() {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listDocuments().then(d => { if (alive) { setDocs(d); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return (
    <PageContainer title="文書・様式">
      <p className="text-sm text-gray-500 mb-4">タイトルをタップすると、Googleドライブ等で文書を開けます（閲覧・ダウンロード）。</p>
      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : docs.length === 0 ? (
        <Alert type="info">閲覧できる文書はまだありません。</Alert>
      ) : (
        DOC_TYPE_ORDER.map(t => {
          const list = docs.filter(d => d.type === t);
          if (list.length === 0) return null;
          return (
            <div key={t} className="mb-4">
              <div className="mb-2"><Badge color={t === 'rule' ? 'blue' : t === 'form' ? 'green' : 'gray'}>{DOC_TYPE_LABELS[t]}</Badge></div>
              <Card className="p-0 divide-y divide-gray-100">
                {list.map(d => (
                  <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-3 hover:bg-gray-50">
                    <span className="flex-1 text-blue-600 text-sm">{d.title}</span>
                    <span className="text-gray-300 text-xs">開く ↗</span>
                  </a>
                ))}
              </Card>
            </div>
          );
        })
      )}
    </PageContainer>
  );
}
