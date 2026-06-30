# evecre01-node

イベント企画チーム向けイベント管理アプリ。リアルタイム同期付きで、ミッション（タスク）を作成・割当・完了し、進捗をメンバーで共有できます。

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
| `CF_ACCOUNT_ID`      | Cloudflare アカウントID（AI提案生成）| 未設定なら `R2_ACCOUNT_ID` を流用 |
| `CF_AI_API_TOKEN`    | Cloudflare Workers AI トークン | 未設定ならテンプレ提案にフォールバック |
| `CF_AI_MODEL`        | 提案生成モデル                | `@cf/qwen/qwen3-30b-a3b-fp8` |

`MAIL_TRANSPORT=console`（デフォルト）の場合、メール本文がサーバーログに出るだけです。
本番運用ではSMTP設定をお願いします。

### AI ミッション提案（Cloudflare Workers AI）

イベントを開くと、前回生成から **12時間** 経過していれば、イベントのタイトル・説明・既存ミッション・
フェーズを踏まえた **そのイベント固有のミッション提案**（タイトル＋説明）を Cloudflare Workers AI が生成します。

セットアップ:
1. Cloudflare ダッシュボード → **AI → Workers AI**。アカウントIDを控える（R2 と同じ）。
2. **My Profile → API Tokens** で、権限 `Account › Workers AI › Edit` を持つトークンを発行。
3. `.env` に `CF_AI_API_TOKEN`（＋必要なら `CF_ACCOUNT_ID`）を設定。

未設定でも動作します（その場合は内蔵のテンプレートエンジンが提案を生成）。LLM 失敗・タイムアウト時も
自動でテンプレにフォールバックするため、提案が空になることはありません。無料枠（10,000 Neurons/日）の範囲で
小規模運用（同時20イベント程度・1イベント1日2回まで）はほぼ $0 で収まります。

## 主な機能

### イベント
- 作成（3ステップ：名前 → 開催日時（任意）→ 招待リンク）
- メンバー招待リンク（管理者権限ロール所持者なら誰でも発行可）
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
ON にしたミッションは完了後すぐにアーカイブされず、リーダー（管理者権限ユーザー）の承認待ちに。承認するとアーカイブへ、差し戻すと提出者に再提出を依頼。

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

## ログ分析（MongoDB Charts）

行動ログ（`event_logs`）と状態データを **MongoDB Charts（Atlas の Visualization）** で可視化できます。
Charts が扱いやすいよう、整形済みの **読み取り専用ビュー** を1コマンドで作成します：

```bash
node scripts/createAnalyticsViews.js evecre       # 本番DBに作成
node scripts/createAnalyticsViews.js evecre_dev   # 開発DBに作成
```

作成される5ビュー（冪等・再実行可。クエリ時に最新を反映）：

| ビュー | 単位 | 用途 |
|---|---|---|
| `event_logs_enriched` | 1ログ | ユーザー名/イベント名/日時を付与した行動ログ |
| `mission_analytics`   | 1ミッション | 作成者・完了者・完了日数・詳細設定の使用状況 |
| `session_flow`        | 1セッション | 「誰が・いつ・何を順番にしたか」の操作フロー |
| `event_summary`       | 1イベント | 行動量×ミッション成果の掛け合わせ |
| `user_summary`        | 1ユーザー | 活動量×作成/完了ミッション数の掛け合わせ |

Atlas Charts の **Data Sources** でこれらのビューを選び、ダッシュボードを作成します。詳細は `CLAUDE.md` の
「ログ分析基盤」セクション参照。

## ディレクトリ構成

詳細は `CLAUDE.md` を参照。要点：

```
evecre01-node/
├── server.js                 # Express サーバー、API 全て
├── lib/                      # CRDT, eventStore, notificationStore, email, eventBus
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
rm -rf data/users.json data/.secret data/events data/invites data/notifications
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
