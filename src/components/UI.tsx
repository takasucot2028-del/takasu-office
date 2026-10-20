/*
 * 画面共通の部品。
 *
 * 見た目の決まりは src/index.css のトークンに置いてある。
 * ここでは「帳簿として読める」ことを優先する。
 *  - 表は縦罫を引かず、見出しの下に強い罫を1本。行はゆったり。
 *  - 時刻・金額・時間数のセルには num クラスで桁をそろえる。
 *  - 色はクラブの緑ひとつ。赤は取り消しと警告だけ。
 *  - 文字は 12px 未満にしない（本文 14px）。
 */
import type { InputHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

// レイアウト
export function PageContainer({ children, title, wide = false }: { children: ReactNode; title?: string; wide?: boolean }) {
  return (
    <div className={`${wide ? 'max-w-6xl' : 'max-w-5xl'} mx-auto px-4 py-6 sm:py-8`}>
      {title && <h1 className="text-xl sm:text-2xl font-bold text-ink mb-5 tracking-tight">{title}</h1>}
      {children}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-rule-soft p-5 ${className}`}>
      {children}
    </div>
  );
}

/** カード内の見出し。説明文（note）と、見出し行の右端に置く要素（action）を添えられる */
export function SectionTitle({ children, note, action }: { children: ReactNode; note?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-ink">{children}</h2>
        {action}
      </div>
      {note && <p className="mt-1 text-xs text-ink-mute leading-relaxed">{note}</p>}
    </div>
  );
}

/** 数字を見せるタイル（月次集計など）。sub には内訳など小さい数字を置く */
export function Tile({ label, value, sub, tone = 'default' }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'accent' | 'quiet';
}) {
  const valueTone = tone === 'accent' ? 'text-pine' : tone === 'quiet' ? 'text-ink-soft' : 'text-ink';
  return (
    <div className="bg-white rounded-lg border border-rule-soft px-4 py-3">
      <p className="text-xs text-ink-mute mb-1 leading-tight">{label}</p>
      <p className={`num text-lg font-bold tabular-nums ${valueTone}`}>{value}</p>
      {sub && <p className="num text-xs text-ink-mute mt-0.5 tabular-nums">{sub}</p>}
    </div>
  );
}

/**
 * 並べて置く切替ボタン（ログインの従業員/事務局、勤務場所の切替など）。
 * 値と表示名の組を渡すと、選択中を緑で示す。
 */
export function SegmentedControl<T extends string>({ value, onChange, options, className = '' }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={`inline-flex rounded-md border border-rule bg-white p-0.5 ${className}`} role="tablist">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-pine/40
              ${on ? 'bg-pine text-white' : 'text-ink-soft hover:bg-paper'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// フォーム要素
interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, required, error, hint, children }: FieldProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-ink-soft mb-1.5">
        {label}
        {required && <span className="text-alert ml-1">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-ink-mute text-xs mt-1">{hint}</p>}
      {error && <p className="text-alert text-xs mt-1">{error}</p>}
    </div>
  );
}

const CONTROL_BASE =
  'border border-rule rounded-md px-3 py-2 text-sm text-ink bg-white ' +
  'placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-pine/40 focus:border-pine ' +
  'disabled:bg-paper disabled:text-ink-mute';
const CONTROL = `w-full ${CONTROL_BASE}`;
const CONTROL_INLINE = CONTROL_BASE;

/** inline を付けると幅いっぱいに広がらない（ツールバーなどで横に並べるとき） */
export function Input({ inline = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { inline?: boolean }) {
  // 数字・時刻・日付は桁をそろえて読みやすくする
  const numeric = props.type === 'number' || props.type === 'time' || props.type === 'date' || props.type === 'month';
  return (
    <input
      {...props}
      className={`${inline ? CONTROL_INLINE : CONTROL} ${numeric ? 'num' : ''} ${props.className || ''}`}
    />
  );
}

export function Select({ inline = false, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode; inline?: boolean }) {
  return (
    <select {...props} className={`${inline ? CONTROL_INLINE : CONTROL} ${props.className || ''}`}>
      {props.children}
    </select>
  );
}

/**
 * カードの中に置く注記の帯。Alert と違って下余白や左罫がないので、
 * 表やタイルのすぐ下に差し込める。
 */
export function Note({ tone = 'quiet', children, className = '' }: {
  tone?: 'quiet' | 'caution' | 'alert' | 'info'; children: ReactNode; className?: string;
}) {
  const tones = {
    quiet: 'bg-paper text-ink-soft border-rule-soft',
    caution: 'bg-caution-soft text-caution border-caution/25',
    alert: 'bg-alert-soft text-alert border-alert/25',
    info: 'bg-info-soft text-info border-info/25',
  };
  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

// ボタン
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'primary', size = 'md', children, className = '', ...props }: BtnProps) {
  const base =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors ' +
    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pine/50 ' +
    'disabled:opacity-45 disabled:cursor-not-allowed';
  // 指で押す場所は小さくしない
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3 text-base' };
  const variants = {
    primary: 'bg-pine text-white hover:bg-pine-dark',
    secondary: 'bg-white text-ink-soft border border-rule hover:bg-paper',
    danger: 'bg-alert text-white hover:brightness-90 focus:ring-alert/50',
    ghost: 'text-ink-mute hover:bg-paper hover:text-ink',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

// テーブル（帳簿として読ませる。縦罫は引かない）
export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm border-collapse ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = '', numeric = false }: { children?: ReactNode; className?: string; numeric?: boolean }) {
  return (
    <th
      className={`${numeric ? 'text-right' : 'text-left'} px-3 py-2.5 bg-paper text-ink-soft text-xs font-bold
        border-b-2 border-rule whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '', numeric = false, ...rest }: {
  children: ReactNode; className?: string; numeric?: boolean;
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`px-3 py-2.5 border-b border-rule-soft align-middle ${numeric ? 'num text-right tabular-nums' : ''} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}

// バッジ（状態を示す。色の意味は全画面で共通）
const BADGE_TONES = {
  gray: 'bg-paper text-ink-soft border-rule',
  green: 'bg-pine-soft text-pine border-pine/25',   // 承認済・完了
  red: 'bg-alert-soft text-alert border-alert/25',   // 休日・却下
  blue: 'bg-info-soft text-info border-info/25',
  yellow: 'bg-caution-soft text-caution border-caution/25', // 申請中・未承認
};

export function Badge({ children, color = 'gray', size = 'sm', className = '' }: {
  children: ReactNode; color?: keyof typeof BADGE_TONES; size?: 'sm' | 'md'; className?: string;
}) {
  // md は「6/1 勤続6か月 10日」のような長いチップ用
  const pad = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';
  return (
    <span className={`inline-block ${pad} rounded border text-xs font-medium whitespace-nowrap ${BADGE_TONES[color]} ${className}`}>
      {children}
    </span>
  );
}

// モーダル
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-rule-soft">
          <h2 className="font-bold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="閉じる" className="text-ink-mute hover:text-ink text-2xl leading-none px-1">&times;</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// メッセージ
export function Alert({ type, children }: { type: 'success' | 'error' | 'info' | 'warning'; children: ReactNode }) {
  const styles = {
    success: 'bg-pine-soft text-pine border-pine/30',
    error: 'bg-alert-soft text-alert border-alert/30',
    info: 'bg-info-soft text-info border-info/30',
    warning: 'bg-caution-soft text-caution border-caution/30',
  };
  return (
    <div className={`rounded-md border-l-4 border px-4 py-3 text-sm leading-relaxed mb-4 ${styles[type]}`}>
      {children}
    </div>
  );
}
