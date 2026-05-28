# evecre01-node

イベント企画チーム向けプロジェクト管理アプリ。リアルタイム同期付きで、ミッション（タスク）を作成・割当・完了し、進捗をメンバーで共有できます。

## クイックスタート

```bash
npm install
npm start
# → http://localhost:3000
```

ブラウザで開くと、ログイン画面が出ます。アカウントを作成（メール + パスワード）してください。
※ メール送信を設定していない場合、認証コードはサーバーログに出力されます（開発用フォールバック）。

## 必要環境

- **Node.js 18+**
- メール送信を使うなら SMTP の認証情報（任意）
- Google サインインを使うなら Google Cloud Console から OAuth Client ID を取得（任意）

## 環境変数（任意・`.env`）

`.env.example` をコピーして編集：

```bash
cp .env.example .env
```

| 変数 | 用途 | デフォルト |
|---|---|---|
| `PORT`               | サーバーポート                | 3000 |
| `MAIL_TRANSPORT`     | 'console' / 'smtp' / 'gmail'   | console |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP 設定（MAIL_TRANSPORT=smtp 時）| - |
| `GMAIL_USER`, `GMAIL_PASS` | Gmail 用（MAIL_TRANSPORT=gmail 時）| - |
| `GOOGLE_CLIENT_ID`   | Google サインイン有効化       | 未設定なら無効 |

`MAIL_TRANSPORT=console`（デフォルト）の場合、メール本文がサーバーログに出るだけです。
本番運用ではSMTP設定をお願いします。

## 主な機能

### プロジェクト
- 作成（3ステップ：名前 → 開催日時（任意）→ 招待リンク）
- メンバー招待リンク（管理可能ロール所持者なら誰でも発行可）
- メンバー管理、複数ロール割り当て

### ミッション
- 作成・編集・削除・並び替え
- 複数タグ + カスタムタグ（色パレットから選択）
- 期日、優先度、担当者、説明、チェック項目
- 完了形式：テキスト / 画像 / URL

### 担当者の割当方法
- **直接指定**：作成者がメンバーまたはロールを選択
- **申告制（先着1名）**：最初に「やる」と申告した人に確定
- **申告制（複数人可）**：応募者多数 → 期限 or 管理者の締切で確定
- **申告制（選定あり）**：応募者 → 管理者が選定して割当

### リーダーチェック
ON にしたミッションは完了後すぐにアーカイブされず、リーダー（管理可能ユーザー）の承認待ちに。承認するとアーカイブへ、差し戻すと提出者に再提出を依頼。

### 通知
タブで「メインボード／通知／アーカイブ」切替。通知タイプ：
- 自分への担当割当
- メンバーがミッションを完了
- 申告制への応募
- 担当が決定
- リーダー承認待ち / 承認 / 差し戻し

### その他
- リアルタイム同期（SSE + CRDT）
- ローカルドラフト（完了モーダル入力中に閉じても復元）
- パスワードリセット（メール 30 分有効）
- Google サインイン（任意）
- アバター（手動アップロード or Google プロフィール画像）

## ディレクトリ構成

詳細は `CLAUDE.md` を参照。要点：

```
evecre01-node/
├── server.js                 # Express サーバー、API 全て
├── lib/                      # CRDT, projectStore, notificationStore, email, eventBus
├── public/                   # フロントエンド（Vanilla JS, Tailwind CDN）
├── data/                     # （gitignore）永続化 JSON
└── CLAUDE.md                 # 開発・引き継ぎ用の詳細ノート
```

## API エンドポイント

詳細一覧は `CLAUDE.md` の「API エンドポイント一覧」セクション参照。

## トラブルシューティング

### 「読み込み中…」のままになる
JS の構文エラーがある可能性。ブラウザの DevTools → Console を確認。
`Uncaught SyntaxError` が出ていれば、該当ファイルを確認してください。

### Google サインインが効かない
`.env` に `GOOGLE_CLIENT_ID` を設定して再起動。起動時ログに
`🔵 Google サインイン: 有効/無効` が出ます。

### メール認証コードが届かない
`MAIL_TRANSPORT=console`（デフォルト）の場合、メールは送信されません。
サーバーのコンソールに本文が出力されるので、そこからコードを取得してください。
本番では `MAIL_TRANSPORT=smtp` か `gmail` に設定してください。

### `npm start` が失敗する
- Node.js のバージョンを確認（18+ 必須）
- `data/` ディレクトリへの書き込み権限があるか確認
- ポート 3000 が既に使われていれば `PORT=3001 npm start`

### データを全部リセットしたい
```bash
rm -rf data/users.json data/.secret data/projects data/invites data/notifications
npm start
```

## 開発

### 構文チェック
```bash
node --check server.js
for f in public/js/**/*.js; do node --check "$f" || echo "FAIL: $f"; done
```

### 動作確認
1. `npm start` でサーバー起動
2. ブラウザで `http://localhost:3000` を**強制リロード**（Cmd/Ctrl+Shift+R）
3. Console のエラーをチェック

### コードを変更したら
- データモデル変更時は `lib/crdt.js` の `FLAT_MISSION_FIELDS` も更新
- 詳細は `CLAUDE.md` 参照

## ライセンス

私的利用。
