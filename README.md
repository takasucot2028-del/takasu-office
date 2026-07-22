# たかすスポーツクラブ 事務管理システム

一般社団法人たかすスポーツクラブの事務局内部業務を管理するウェブアプリケーション。
会員管理システム（takasu-member）とは独立した別システム。

現在は労務管理モジュール（職員名簿・シフト管理・勤怠管理・有給休暇管理）を実装。

## 開発

```bash
npm install
npm run dev   # http://localhost:5174
```

事務局デモアカウント（デモモード時）: `admin@takasu-sc.jp` / `admin123`

データ保存は2モード：
- **デモモード**（既定）: ブラウザの localStorage（この端末のみ）
- **共有モード**: GAS + Google スプレッドシート（全端末で共有・認証はサーバー側で検証）

共有モードへの切り替え手順は [gas/SETUP.md](gas/SETUP.md) を参照。

## デプロイ

`main` ブランチへの push で GitHub Actions が自動ビルドし、GitHub Pages に公開する。

詳細な仕様は [CLAUDE.md](CLAUDE.md) を参照。
