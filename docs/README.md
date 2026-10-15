# マニュアル

| ファイル | 対象 |
|---|---|
| `事務管理システム_事務局マニュアル.docx` | 事務局（管理者）。職員名簿〜設定まで |
| `勤怠システム_職員マニュアル.docx` | 職員。打刻・出勤簿・各種申請 |

Word ファイルなので、文言の修正は Word で直接できます。
大きく作り直すときは下の手順で再生成してください。

## 再生成

```bash
npm install          # docx（devDependency）が入る
node docs/build_manuals.cjs
```

`docs/*.docx` が上書きされます。内容は次のファイルにあります。

- `docs/manual_common.cjs` … 見出し・表・注意ボックスなど共通の体裁（A4縦・Meiryo）
- `docs/manual_admin.cjs` … 事務局マニュアルの本文
- `docs/manual_staff.cjs` … 職員マニュアルの本文

## PDF にする

Word がインストールされた Windows で、PowerShell から実行します。
目次のページ番号を更新してから PDF を書き出します。

```powershell
powershell -ExecutionPolicy Bypass -File docs\to_pdf.ps1 -Dir docs
```

同じフォルダに `.pdf` ができます。

## 直すときの注意

- 章見出し（`h1`）は必ず改ページします。空の段落で改ページを作らないでください（白紙ページの原因になります）。
- 手順の番号は `steps([...])` のまとまりごとに 1 から始まります。`steps` を分けずに並べると番号が続いてしまいます。
- 注意ボックス（`note` / `warn`）と表（`table`）は、後ろの余白を含んだ配列を返します。`...note(...)` のように展開して使ってください。
- 段落に配列を渡すときは素の文字列を混ぜても構いません（`runs()` が TextRun に直します）。
