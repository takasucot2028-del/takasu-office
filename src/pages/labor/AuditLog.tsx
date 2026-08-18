// 変更履歴（誰がいつ何を変更したか）
// 勤怠や承認の記録を後から書き換えた形跡を追えるようにするための一覧。
import { useEffect, useMemo, useState } from 'react';
import { PageContainer, Card, Input, Select, Field, Table, Th, Td, Badge } from '../../components/UI';
import { listAuditLog } from '../../api/data';
import type { AuditEntry } from '../../types';

const TARGETS = ['職員', '勤怠', '時間外', '代休', '休暇', 'シフト', '会計', '文書'];

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState('');
  const [keyword, setKeyword] = useState('');
  const [from, setFrom] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listAuditLog(500);
      if (!alive) return;
      setEntries(list);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    return entries.filter(e => {
      if (target && e.target !== target) return false;
      if (from && e.at.slice(0, 10) < from) return false;
      if (kw && !`${e.actor} ${e.action} ${e.target} ${e.summary}`.includes(kw)) return false;
      return true;
    });
  }, [entries, target, keyword, from]);

  return (
    <PageContainer title="変更履歴">
      <Card className="mb-4">
        <div className="grid sm:grid-cols-4 gap-3 items-end">
          <Field label="対象">
            <Select value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">すべて</option>
              {TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="この日以降">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="キーワード">
              <Input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="操作者・操作内容・日付などで絞り込み" />
            </Field>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          直近500件を新しい順に表示しています。勤怠・時間外・休暇の承認や修正が、いつ誰の操作で行われたかを確認できます。
        </p>
      </Card>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <thead>
            <tr><Th>日時</Th><Th>操作者</Th><Th>対象</Th><Th>操作</Th><Th>内容</Th></tr>
          </thead>
          <tbody>
            {loading && <tr><Td className="text-center text-gray-400 py-8" colSpan={5}>読み込み中…</Td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><Td className="text-center text-gray-400 py-8" colSpan={5}>
                {entries.length === 0 ? '変更履歴はまだありません' : '条件に合う履歴がありません'}
              </Td></tr>
            )}
            {!loading && filtered.map(e => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-xs">{e.at}</Td>
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    {e.actor}
                    <Badge color={e.role === 'admin' ? 'blue' : 'gray'}>{e.role === 'admin' ? '事務局' : '従業員'}</Badge>
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-xs">{e.target}</Td>
                <Td className="whitespace-nowrap text-sm">{e.action}</Td>
                <Td className="text-xs text-gray-600">{e.summary}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">{filtered.length}件を表示中</p>
      )}
    </PageContainer>
  );
}
