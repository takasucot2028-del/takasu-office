# たかすスポーツクラブ 事務管理システム

## プロジェクト概要

一般社団法人たかすスポーツクラブの事務局内部業務を管理するウェブアプリケーション。
会員管理システム（../takasu-member）とは独立した別システム。モジュール構成で拡張していく。

- 労務管理（実装済み）: 職員名簿・シフト管理・勤怠管理・有給休暇管理
- 会計管理（予定）
- 文書管理（予定）
- 備品・施設管理（予定）

## 技術スタック

会員管理システムと同一構成。

- フロントエンド: React 19 + TypeScript + Tailwind CSS v4（@tailwindcss/vite）
- ビルド: Vite
- ルーティング: react-router-dom（HashRouter）
- Excel出力: SheetJS (xlsx)
- データストア: 統一データ層 `src/api/data.ts` が `VITE_GAS_URL` の有無で切り替え。
  未設定=localStorage（デモモード・端末内）、設定時=GAS + Googleスプレッドシート（全端末で共有）
- バックエンド: Google Apps Script（`gas/Code.gs`）。SHA-256ハッシュ＋トークンセッションで認証
- コスト: 完全無料構成

## 開発環境セットアップ

```bash
npm install
npm run dev   # http://localhost:5174 （会員管理の5173と共存できるよう5174）
```

事務局デモアカウント（デモモード時）: admin@takasu-sc.jp / admin123

## ディレクトリ構成

```
src/
  api/
    data.ts             統一データ層。全ページはここだけを参照（全関数 async/Promise）。
                        VITE_GAS_URL で localStorage(store.ts) / GAS(client.ts) を切り替え
    client.ts           GAS Web App 通信レイヤー（data.ts からのみ呼ぶ）
  components/
    AuthContext.tsx     認証コンテキスト（sessionStorage、事務局のみ・tof_token）
    Header.tsx          ヘッダー・ナビゲーション
    UI.tsx              共通UIコンポーネント（会員管理システムと同一）
  pages/
    Login.tsx           事務局ログイン（data.adminLogin）
    Dashboard.tsx       モジュール一覧＋本日の勤務
    Settings.tsx        パスワード変更（認証強化）
    labor/
      StaffList.tsx     職員名簿・検索・Excel出力
      StaffDetail.tsx   職員詳細・編集・退職処理（/labor/staff/new で新規登録）
      Shifts.tsx        シフト表（月間・希望/確定モード・場所タブ・Excel出力）
      ShiftPatterns.tsx シフト区分マスタ（早番/遅番等の名称・時刻）
      Attendance.tsx    勤怠管理（月別出勤簿・実働集計・Excel出力）
      Leave.tsx         有給休暇管理（付与・取得・残日数）
  types/index.ts        TypeScript型定義
  utils/
    constants.ts        雇用区分・ラベル定数
    store.ts            デモ用localStorageデータストア（キーは tof_ プレフィックス）
  App.tsx               ルーティング定義
  main.tsx              エントリーポイント
gas/
  Code.gs               GASバックエンド（職員・勤怠・有給・シフト・認証）
  SETUP.md              GAS接続手順（スプレッドシート作成〜VITE_GAS_URL 設定）
```

## GAS接続の切り替え

- 全ページは `src/api/data.ts` の async 関数だけを呼ぶ（バックエンド差異を意識しない）。
- `VITE_GAS_URL` 未設定 → localStorage（`store.ts`）。設定 → GAS（`client.ts` 経由）。
- GAS 側は会員システムと同じ設計: 日本語見出しシート＋列位置で内部キー対応、
  SHA-256 パスワードハッシュ、CacheService のトークンセッション（TTL6時間）、adminLogin 以外は管理者トークン必須。
- 時刻("09:00")・年月の自動変換を防ぐため GAS はデータ列をテキスト書式に固定する。
- 接続手順は [gas/SETUP.md](gas/SETUP.md) を参照。

## ルーティング（HashRouter）

- `#/` - 事務局ログイン
- `#/dashboard` - ダッシュボード（要認証）
- `#/labor/staff` - 職員名簿
- `#/labor/staff/new` - 新規職員登録
- `#/labor/staff/:id` - 職員詳細・編集
- `#/labor/shifts` - シフト表（月間・希望/確定）
- `#/labor/shift-patterns` - シフト区分マスタ
- `#/labor/attendance` - 勤怠管理
- `#/labor/leave` - 有給休暇管理

## 労務管理の仕様

### 職員
- 雇用区分: 常勤職員 / パート・アルバイト / 指導員 / 業務委託
- 勤務場所: 総体 / 海洋センター（未設定も可。職員の「主な勤務場所」でシフト入力時の初期値になる）
- 退職処理は削除ではなくstatusをretiredに変更（記録は保持）

### シフト（希望→確定の2段階・事務局が代理入力）
- **区分マスタ**: 早番/遅番等の区分（名称＋開始/終了時刻）を事務局が登録。空なら constants の DEFAULT_SHIFT_PATTERNS（①8:30-13:00 / ②12:45-17:15 / ③17:00-21:15）にフォールバック。
- **月間シフト表**: 縦=職員、横=日付。勤務場所（総体/海洋）をタブで切替。各表にはその場所を主な勤務場所とする在職職員を表示。
- **希望モード**: 各セルをクリックで 空欄→○（入れる）→×（入れない）を循環。人単位（AvailabilityRecord、staffId+date）。
- **確定モード**: 各セルをクリックで区分を循環（空→区分①→②…→空）。希望の○×を背景色でヒント表示。確定は ConfirmedShift（staffId+date+location→patternId）。下部に日別人数、右に職員別の勤務日数・実働時間。
- 保存は「表示中の場所・月」単位で一括置換（saveMonthAvailability / saveMonthConfirmed）。Excel出力は表示中モードの表を出力。
- ダッシュボードの「本日の勤務」は確定シフトを区分の時刻とともに勤務場所別に表示。

### 勤怠
- 1職員×1月の出勤簿形式。日ごとに区分（出勤/有給/欠勤）・出退勤時刻・休憩を入力
- 実働 = 退勤 - 出勤 - 休憩（出勤日のみ集計）
- 勤怠の「有給」区分と有給休暇管理の取得記録は連動しない（別々に入力する）

### 有給休暇
- 付与と取得を記録し、残日数 = 付与合計 - 取得合計
- 0.5日単位で入力可。取得時は残日数超過をチェック

## コーディング規約

会員管理システム（../takasu-member/CLAUDE.md）と同じ。

- 関数コンポーネント + hooks、状態はContext + ローカルstate
- UIコンポーネントは src/components/UI.tsx に集約
- 日本語UIテキストはコンポーネント内に直接記述
- CSSはTailwind utilityクラスのみ

## デプロイ

GitHub Pages（`main` への push で自動）。公開URL: https://takasucot2028-del.github.io/takasu-office/
ビルド時に GitHub Actions の Variable `VITE_GAS_URL` が反映される（未設定ならデモモードでビルド）。

## 今後の開発予定

1. GAS接続（データ共有・認証強化）… 実装済み。運用開始は gas/SETUP.md の手順が必要
2. 労務管理のUI改善（給与計算連携など）
3. 会計管理モジュール
