import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, Card, Input, Button, Table, Th, Td, Alert } from '../../components/UI';
import { listShiftPatterns, saveShiftPatterns, genId } from '../../api/data';
import type { ShiftPattern } from '../../types';

/** 開始〜終了から実働時間（時間）を計算。日跨ぎは想定しない */
function durationHours(start: string, end: string): number {
  const m = /^(\d{1,2}):(\d{2})$/;
  const s = m.exec(start), e = m.exec(end);
  if (!s || !e) return 0;
  const min = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  return min > 0 ? Math.round((min / 60) * 100) / 100 : 0;
}

export default function ShiftPatterns() {
  const navigate = useNavigate();
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listShiftPatterns();
      if (!alive) return;
      setPatterns(list);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const set = (idx: number, patch: Partial<ShiftPattern>) =>
    setPatterns(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const addRow = () =>
    setPatterns(prev => [...prev, { id: genId('p'), name: '', startTime: '09:00', endTime: '17:00', order: prev.length + 1 }]);

  const removeRow = (idx: number) => setPatterns(prev => prev.filter((_, i) => i !== idx));

  const move = (idx: number, dir: -1 | 1) => {
    setPatterns(prev => {
      const next = prev.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    setError('');
    setMessage('');
    for (const p of patterns) {
      if (!p.name.trim()) { setError('区分名を入力してください'); return; }
      if (durationHours(p.startTime, p.endTime) <= 0) { setError(`「${p.name || '(無名)'}」の終了時刻は開始時刻より後にしてください`); return; }
    }
    const ordered = patterns.map((p, i) => ({ ...p, order: i + 1 }));
    setSaving(true);
    try {
      await saveShiftPatterns(ordered);
      setPatterns(ordered);
      setMessage('保存しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer title="シフト区分マスタ">
      <p className="text-sm text-gray-500 mb-4">
        シフト表で選べる区分（早番・遅番など）と時刻を登録します。ここで登録した区分が確定シフトの選択肢になります。
      </p>
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <Card className="p-0 overflow-hidden mb-4">
        <Table>
          <thead>
            <tr>
              <Th className="w-16">並び</Th>
              <Th>区分名</Th>
              <Th>開始</Th>
              <Th>終了</Th>
              <Th>実働</Th>
              <Th className="w-16"></Th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p, idx) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">
                  <button className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>
                  <button className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" disabled={idx === patterns.length - 1} onClick={() => move(idx, 1)}>↓</button>
                </Td>
                <Td><Input value={p.name} onChange={e => set(idx, { name: e.target.value })} placeholder="例: 早番 / ①" /></Td>
                <Td><Input type="time" value={p.startTime} onChange={e => set(idx, { startTime: e.target.value })} /></Td>
                <Td><Input type="time" value={p.endTime} onChange={e => set(idx, { endTime: e.target.value })} /></Td>
                <Td className="whitespace-nowrap text-gray-600">{durationHours(p.startTime, p.endTime)}h</Td>
                <Td><Button variant="ghost" size="sm" onClick={() => removeRow(idx)}>削除</Button></Td>
              </tr>
            ))}
            {patterns.length === 0 && (
              <tr>
                <Td className="text-center text-gray-400 py-8" colSpan={6}>
                  {loading ? '読み込み中…' : '区分がありません。「区分を追加」で登録してください'}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="secondary" size="sm" onClick={addRow}>＋ 区分を追加</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/labor/shifts')}>シフト表へ戻る</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存する'}</Button>
        </div>
      </div>
    </PageContainer>
  );
}
