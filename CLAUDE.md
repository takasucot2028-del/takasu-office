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
- データストア: localStorage（デモモード）。将来はGAS + Googleスプレッドシートに接続予定
- コスト: 完全無料構成

## 開発環境セットアップ

```bash
npm install
npm run dev   # http://localhost:5174 （会員管理の5173と共存できるよう5174）
```

事務局デモアカウント: admin@takasu-sc.jp / admin123

## ディレクトリ構成

```
src/
  components/
    AuthContext.tsx     認証コンテキスト（sessionStorage、事務局のみ）
    Header.tsx          ヘッダー・ナビゲーション
    UI.tsx              共通UIコンポーネント（会員管理システムと同一）
  pages/
    Login.tsx           事務局ログイン
    Dashboard.tsx       モジュール一覧ダッシュボード
    labor/
      StaffList.tsx     職員名簿・検索・Excel出力
      StaffDetail.tsx   職員詳細・編集・退職処理（/labor/staff/new で新規登録）
      Shifts.tsx        シフト管理（日別のシフト入力・削除）
      Attendance.tsx    勤怠管理（月別出勤簿・実働集計・Excel出力）
      Leave.tsx         有給休暇管理（付与・取得・残日数）
  types/index.ts        TypeScript型定義
  utils/
    constants.ts        雇用区分・ラベル定数
    store.ts            デモ用localStorageデータストア（キーは tof_ プレフィックス）
  App.tsx               ルーティング定義
  main.tsx              エントリーポイント
```

## ルーティング（HashRouter）

- `#/` - 事務局ログイン
- `#/dashboard` - ダッシュボード（要認証）
- `#/labor/staff` - 職員名簿
- `#/labor/staff/new` - 新規職員登録
- `#/labor/staff/:id` - 職員詳細・編集
- `#/labor/shifts` - シフト管理
- `#/labor/attendance` - 勤怠管理
- `#/labor/leave` - 有給休暇管理

## 労務管理の仕様

### 職員
- 雇用区分: 常勤職員 / パート・アルバイト / 指導員 / 業務委託
- 勤務場所: 総体 / 海洋センター（未設定も可。職員の「主な勤務場所」でシフト入力時の初期値になる）
- 退職処理は削除ではなくstatusをretiredに変更（記録は保持）

### シフト
- 日別に「職員×勤務場所×開始〜終了」を登録（同一職員が1日に複数シフト可）
- ダッシュボードの「本日の勤務」に、当日のシフトを勤務場所別に表示
- 職員を選ぶとその職員の主な勤務場所が初期値として入る

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

## 今後の開発予定

1. 労務管理の動作確認・UI改善（給与計算連携・シフト管理など）
2. 会計管理モジュール
3. GASバックエンド接続・GitHub Pagesデプロイ
