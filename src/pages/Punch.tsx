// 打刻専用画面（事務所のタブレット等に置く）
// ログインは不要。PINを入れて出勤／退勤を押すだけ。打刻後はすぐ初期状態に戻るので、
// 次の人がそのまま続けて打刻できる。
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { punchByPin } from '../api/data';
import type { PunchResult } from '../api/client';
import { WEEKDAY_LABELS } from '../utils/constants';

const PIN_MAX = 8;          // PINの最大桁数
const RESULT_MS = 3500;     // 結果を表示してから初期状態に戻るまで
const ERROR_MS = 5000;

export default function Punch() {
  const [pin, setPin] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const timer = useRef<number | null>(null);

  // 画面の時計（1秒ごと）
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const clearTimer = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clearTimer, []);

  /** 初期状態（次の人が使える状態）に戻す */
  const reset = () => {
    clearTimer();
    setPin(''); setResult(null); setError(''); setSending(false);
  };

  const push = (n: string) => {
    if (sending) return;
    setError('');
    setPin(p => (p.length >= PIN_MAX ? p : p + n));
  };
  const back = () => { if (!sending) setPin(p => p.slice(0, -1)); };

  const doPunch = async (type: 'in' | 'out') => {
    if (sending) return;
    if (!pin) { setError('PINを入力してください'); return; }
    clearTimer();
    setSending(true); setError(''); setResult(null);
    try {
      const r = await punchByPin(pin, type);
      setResult(r);
      setPin('');
      timer.current = window.setTimeout(reset, RESULT_MS);   // すぐ初期画面に戻す
    } catch (err) {
      setError(err instanceof Error ? err.message : '打刻に失敗しました');
      setPin('');
      timer.current = window.setTimeout(reset, ERROR_MS);
    } finally {
      setSending(false);
    }
  };

  // 物理キーボード（テンキー）でも入力できるようにする
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') push(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Escape') reset();
      else if (e.key === 'Enter') doPunch('in');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, sending]);

  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAY_LABELS[now.getDay()]}）`;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 select-none">
      <div className="w-full max-w-md">
        {/* 日付と時計 */}
        <div className="text-center mb-4">
          <p className="text-gray-500 text-sm">{dateLabel}</p>
          <p className="text-5xl font-bold text-gray-800 tabular-nums leading-tight">{hhmm}</p>
          <p className="text-xs text-gray-400 mt-1">たかすスポーツクラブ　打刻</p>
        </div>

        {/* 結果・エラー（打刻後はここだけを大きく見せる） */}
        {result && (
          <div className="bg-white border-2 border-emerald-500 rounded-xl p-6 text-center shadow">
            <p className="text-2xl font-bold text-gray-800">{result.staffName} さん</p>
            <p className="text-4xl font-bold text-emerald-600 mt-2">
              {result.punchType === 'in' ? '出勤' : '退勤'} {result.time}
            </p>
            {result.already && (
              <p className="text-sm text-amber-700 mt-2">
                すでに出勤が記録されていました。最初の打刻（{result.time}）のままにしています。
              </p>
            )}
            <p className="text-xs text-gray-400 mt-3">記録しました。まもなく元の画面に戻ります</p>
            <button onClick={reset} className="mt-3 px-4 py-2 text-sm rounded-md bg-gray-100 text-gray-700">
              次の人へ
            </button>
          </div>
        )}

        {error && !result && (
          <div className="bg-white border-2 border-red-500 rounded-xl p-6 text-center shadow">
            <p className="text-xl font-bold text-red-700">{error}</p>
            <button onClick={reset} className="mt-4 px-4 py-2 text-sm rounded-md bg-gray-100 text-gray-700">
              やり直す
            </button>
          </div>
        )}

        {!result && !error && (
          <>
            {/* PIN表示 */}
            <div className="bg-white rounded-xl shadow p-4 mb-3">
              <p className="text-xs text-gray-500 text-center mb-2">PINを入力してください</p>
              <div className="h-12 flex items-center justify-center gap-2">
                {pin.length === 0
                  ? <span className="text-gray-300 text-lg">— — — —</span>
                  : pin.split('').map((_, i) => (
                    <span key={i} className="w-4 h-4 rounded-full bg-gray-800 inline-block" />
                  ))}
              </div>
            </div>

            {/* テンキー */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => (
                <button key={n} onClick={() => push(n)} disabled={sending}
                  className="h-16 text-2xl font-bold bg-white rounded-xl shadow active:bg-gray-200 disabled:opacity-50">
                  {n}
                </button>
              ))}
              <button onClick={reset} disabled={sending}
                className="h-16 text-sm font-medium bg-white rounded-xl shadow text-gray-500 active:bg-gray-200 disabled:opacity-50">
                消す
              </button>
              <button onClick={() => push('0')} disabled={sending}
                className="h-16 text-2xl font-bold bg-white rounded-xl shadow active:bg-gray-200 disabled:opacity-50">
                0
              </button>
              <button onClick={back} disabled={sending}
                className="h-16 text-xl bg-white rounded-xl shadow text-gray-500 active:bg-gray-200 disabled:opacity-50">
                ←
              </button>
            </div>

            {/* 出勤・退勤 */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => doPunch('in')} disabled={sending || !pin}
                className="h-20 text-2xl font-bold text-white bg-blue-600 rounded-xl shadow active:bg-blue-700 disabled:opacity-40">
                {sending ? '記録中…' : '出勤'}
              </button>
              <button onClick={() => doPunch('out')} disabled={sending || !pin}
                className="h-20 text-2xl font-bold text-white bg-gray-600 rounded-xl shadow active:bg-gray-700 disabled:opacity-40">
                {sending ? '記録中…' : '退勤'}
              </button>
            </div>

            <p className="text-center text-xs text-gray-400 mt-4">
              PINが分からない場合は事務局にお問い合わせください。
              <Link to="/" className="text-blue-600 underline ml-2">通常のログイン</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
