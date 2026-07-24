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
      Overtime.tsx      時間外・休日勤務（申請→承認→実績自動計算→代休/手当＋代休残）
      Leave.tsx         有給休暇管理（付与・取得・残日数）
  types/index.ts        TypeScript型定義
  utils/
    constants.ts        雇用区分・ラベル定数
    overtime.ts         時間外の計算ロジック（基準・種別・割増・実績・手当）
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
- `#/labor/overtime` - 時間外・休日勤務
- `#/labor/leave` - 有給休暇管理

## 労務管理の仕様

### 職員
- 雇用区分: 常勤職員 / パート・アルバイト / 指導員 / 業務委託
- 勤務場所: 総体 / 海洋センター / 両方(both) / 未設定。both の職員はシフト表の両方のタブに表示される（constants の staffInLocation / workLocationLabel で判定・表示）。GAS上は workLocation 列に文字列で保存（'both' も可、スキーマ変更なし）。
- 時給(hourlyWage): 時間外手当の計算に使用（GAS staff シートの末尾に「時給」列を追加）。
- 退職処理は削除ではなくstatusをretiredに変更（記録は保持）

### 時間外・休日勤務（Overtime.tsx / utils/overtime.ts）
- 対象は**常勤職員・パート職員のみ**（isOvertimeTarget。指導員・業務委託は対象外）。
- 流れ: 申請（日付・予定時間・事由）→ 承認（status applied→approved）→ 実績を自動計算 → 代休/手当を選択（disposition）。
- 基準時間: 常勤=平日8時間／常勤の土日=0（休日勤務・実働全部が対象）／パート=その日の確定シフトの合計時間（shiftMap）。
- 実績時間 = max(0, 実働 − 基準)。実働は勤怠(Attendance)の出退勤から算出（workedHoursOf）。
- 種別: 常勤の土日=休日(holiday, ×1.5)、それ以外=時間外(overtime, ×1.25)。手当=round(実績×時給×割増)。
- 保存時に resultHours と kind を確定値として記録（saveMonthOvertime、職員×月で置換）。
- 代休残 = 承認済・代休指定の resultHours 合計 − 代休取得(CompLeaveUse)合計。取得は別途記録。有給とは別枠、1:1換算。
- **当月集計**（承認済ベース）: 平日時間外総時間・休日勤務総時間・時間外手当時間・手当金額・代休付与・当月代休消化を画面表示。
- **時間外勤務実績簿(Excel)**: 「実績簿Excel」ボタンで、当月に時間外がある職員ごとにシートを作成（保存済み resultHours ベース。listOvertimeByMonth）。
- GAS: staff に 時給列、overtime / comp_leave_use シートを追加。

### シフト（希望→確定の2段階・事務局が代理入力）
- **区分マスタ**: 早番/遅番等の区分（名称＋開始/終了時刻＋対象勤務場所）を事務局が登録。`location`（''=すべて / sotai / kaiyo）で場所限定の区分を作れる。空なら DEFAULT_SHIFT_PATTERNS（①8:30-13:00 / ②12:45-17:15 / ③17:00-21:15 は全場所、④17:00-19:15 は海洋のみ）にフォールバック。
- **月間シフト表**: 縦=職員、横=日付。勤務場所（総体/海洋）をタブで切替。各表にはその場所を主な勤務場所とする在職職員を表示。ポップアップに出る区分は「その場所で有効な区分」（validPatterns = location==='' か現在地一致）。
- **希望モード**: セルをクリックでポップアップが開き、区分を複数選択できる（空欄=希望なし）。人単位（AvailabilityRecord、staffId+date+patternId、1日複数レコード）。
- **確定モード**: 各セルをクリックでポップアップが開き、区分を複数トグルできる（1日に午前＋午後など複数可）。ポップアップ上部にその職員の希望区分を表示し、希望がある日はセルを黄色背景でヒント表示。確定は ConfirmedShift（staffId+date+location+patternId、1セルにつき複数レコード）。勤務日数は「区分が1つ以上ある日」を1日と数え、実働時間は全区分の合計。下部に日別人数、右に職員別の勤務日数・実働時間。
- 保存は「表示中の場所・月」単位で一括置換（saveMonthAvailability / saveMonthConfirmed）。Excel出力は表示中モードの表を出力。
- **印刷**: 確定モードの「印刷」ボタンで保存後、印刷専用ページ `/labor/shifts/print?month=&location=` へ。罫線付きの静的な表を表示し window.print()。index.css の @media print でヘッダー等を隠し A4横向き。
- ダッシュボードの「本日の勤務・休暇」は確定シフト（勤務場所別）＋当日の有給/代休取得者を表示（data.listAbsencesByDate、GAS getAbsencesByDate）。

### 勤怠
- 1職員×1月の出勤簿形式。日ごとに区分（出勤/有給/欠勤）・出退勤時刻・休憩を入力
- 実働 = 退勤 - 出勤 - 休憩（出勤日のみ集計）
- 勤怠の「有給」区分と有給休暇管理の取得記録は連動しない（別々に入力する）

### 有給休暇
- 付与（日単位）と取得（日/時間単位）を記録。**1日=7.5時間**（constants.LEAVE_HOURS_PER_DAY）で換算し、残を日数・時間の両方で表示。
- LeaveRecord は days と hours の両方を持つ（片方が0）。残計算は computeLeaveBalance が時間換算で合算（付与合計−取得合計）。取得時は残時間超過をチェック。
- 取得は「単位（日/時間）」を選択。時間は1時間単位。付与は日単位のみ。
- **標準付与**ボタン: 常勤=10日／パート=5日（雇用開始hireDateから6か月経過後のみ）。判定は constants.standardLeaveGrant。指導員・業務委託は対象外。手動の付与/取得フォームも併用可。
- **帳簿PDF**: 「PDF帳簿」ボタン → LeavePrint（/labor/leave/print?staffId=）。有給休暇管理簿を印刷用に表示し、印刷ダイアログの「PDFに保存」でPDF化（A4縦。@pageをページ単位で上書き）。
- GAS: 有給休暇シート末尾に「時間」列を追加。

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
