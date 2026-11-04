/*
 * 申請の取消ボタン（職員側）。
 *
 * 取り消せるのは「まだ事務局が処理していない自分の申請」だけ。
 * 押せるかどうかの判断は呼び出し側で行い、ここでは確認と通信を担う。
 * 本人確認と状態の確認はサーバー側でもう一度行う（画面の状態が古いことがあるため）。
 */
import { useState } from 'react';
import { Button } from './UI';
import { cancelMyRequest } from '../api/data';
import type { CancelableKind } from '../types';

export function CancelRequestButton({ kind, id, what, onCancelled, onError }: {
  kind: CancelableKind;
  id: string;
  /** 確認文に出す申請の呼び名（例「休暇の申請」） */
  what: string;
  /** 取消に成功したとき。一覧から消す・再読込するなど */
  onCancelled: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!window.confirm(`${what}を取り消しますか？\n取り消すと元に戻せません。`)) return;
    setBusy(true);
    try {
      await cancelMyRequest(kind, id);
      onCancelled();
    } catch (err) {
      onError(err instanceof Error ? err.message : '申請の取消に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={run} disabled={busy}>
      {busy ? '取消中…' : '取り消す'}
    </Button>
  );
}
