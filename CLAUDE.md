# CLAUDE.md — evecre01-node 引き継ぎノート

> このファイルは Claude Code が毎回自動で参照する引き継ぎ資料です。
> プロジェクトの「決まりごと」「ファイル配置」「重要な落とし穴」を集約しています。

## このプロジェクトは何か

イベント企画チーム向けの**プロジェクト管理アプリ**。リアルタイム同期付きで、ミッション（タスク）の作成・割当・完了・通知ができる。

- **スタック**：Node.js + Express、Vanilla JS (ES Modules)、Tailwind (CDN)、SSE
- **データ永続化**：JSONファイル（`data/` 配下）
- **認証**：bcryptjs + httpOnly Cookie + signed セッション、Google サインインに対応
- **リアルタイム同期**：CRDT (Last-Write-Wins) + SSE
- **配信**：自前の Express サーバー、ビルド不要

## 起動

```bash
npm install     # 初回のみ
npm start       # http://localhost:3000
```

任意で `.env` を作成（`.env.example` を参照）：
- `MAIL_TRANSPORT` — メール送信（OTP・パスワードリセット）
- `GOOGLE_CLIENT_ID` — Google サインイン

## ディレクトリ構成

```
evecre01-node/
├── server.js                 # Express サーバー、API 全て
├── lib/
│   ├── crdt.js               # CRDT (LWW Map) - flatToCrdt / crdtToFlat / applyPatch
│   ├── projectStore.js       # プロジェクト永続化 + members/roles 操作
│   ├── notificationStore.js  # ユーザー別通知永続化
│   ├── email.js              # nodemailer + OTP
│   └── eventBus.js           # SSE のブロードキャスト
├── data/                     # （gitignore）ユーザー・プロジェクト・通知の JSON
│   ├── users.json
│   ├── projects/<id>.json
│   ├── invites/<token>.json
│   └── notifications/<userId>.json
├── public/
│   ├── index.html
│   └── js/
│       ├── main.js           # window._app にハンドラ集約、エントリポイント
│       ├── state.js          # アプリ全体の状態
│       ├── api.js            # サーバー API ラッパー、X-Client-Id ヘッダ付き
│       ├── realtime.js       # SSE クライアント
│       ├── components.js     # Header, Tabs, Tag, UserAvatar
│       ├── constants.js      # LABEL_CONFIG, SEED_TYPES, MISSION_DESCRIPTIONS など
│       ├── utils.js          # getConsecutiveGroups, calculateDaysLeft
│       ├── clientId.js       # SSE のエコーバック抑止用 ID
│       ├── modals/
│       │   ├── mission.js              # ★ 一番大きい：作成/編集モーダル、担当者シート、タグ作成、選定モーダル
│       │   ├── helpers.js              # ★ 完了モーダル、ローカルドラフト、いいね、メンバー管理など
│       │   ├── calendar.js             # 期日カレンダー（targetで挙動切替）
│       │   ├── projectCalendarSheet.js # メインボード上部の「残り○日」シート
│       │   ├── projectActions.js       # 長押しメニュー
│       │   ├── inviteIssueModal.js     # 招待リンク発行
│       │   ├── joinByCodeModal.js      # 招待コード入力
│       │   └── verifyEmailModal.js     # メール認証
│       └── views/
│           ├── home.js                 # プロジェクト一覧、HOME
│           ├── auth.js                 # ログイン・新規登録（メールのみ）
│           ├── account.js              # アカウント設定、アバター変更
│           ├── createProject.js        # 3ステップ作成フロー
│           ├── projectSettings.js     # プロジェクト設定、ロール CRUD
│           ├── mainBoard.js            # ★ 中心：メインタブ・通知タブ・アーカイブタブ
│           └── passwordReset.js        # /reset-password/<token>
└── package.json
```

## ★必読：CRDT の形式

`projectStore.loadProject(id)` が返すプロジェクトは **CRDT 形式**：

```js
{
  id, ownerId, members: [{userId, role, roles, joinedAt}], roles, customTags,
  rev, createdAt, dates, ...
  missions: {
    "<mid>": {
      fields: {
        title:    { v: "...", t: <timestamp> },
        status:   { v: "yet", t: ... },
        assignee: { v: null,  t: ... },
        ...
      },
      deletedAt: null | <ts>
    }
  },
  proposals: { ... }     // missions と同形式
}
```

クライアント側は **flat 形式**（`mission.title`）でやり取りする。サーバー側で **必ず**
`crdt.crdtToFlat(p)` で変換してから返す。`/api/data` のレスポンスでは members に
username/avatarUrl も合成して返している（クライアントの表示用）。

**重要な落とし穴**：CRDT 形式の値は `{ v, t }`（v=value, t=timestamp）。
過去に `{ val, ts }` と勘違いして書いたバグ複数あり。`server.js` の
`_missionToFlat` / `_setMissionField` ヘルパが正解。

### CRDT 対象外（server優先で保持）のフィールド
- `members` 配列
- `roles` 配列
- `customTags` 配列

→ `crdt.js` の `mergeProject` で `server.X || incoming.X` で明示的に保持されている。

### FLAT_MISSION_FIELDS（CRDT 同期されるフィールド一覧）
```js
['title', 'tag', 'tags', 'daysLeft', 'type', 'isDeletable', 'dates',
 'clearFormat', 'status', 'priority', 'note',
 'originProposalId', 'assignee', 'checklist',
 'description', 'selfClaim', 'leaderCheck',
 'claimMode', 'claimDeadline', 'claimApplicants', 'claimClosed', 'assignees']
```
**新フィールドを mission に追加するときは必ず `lib/crdt.js` のこの配列に追加すること**。
忘れるとサーバーで保存されない（or 同期で消える）。

## データモデル

### Project
```ts
{
  id: string, name: string, description: string,
  seedType: string, dates: string[], daysLeft: number | null,
  isCompleted: boolean, progress: number,
  ownerId: string,
  members: [{userId, role, roles: string[], joinedAt}],
  roles: [{id, name, canManage: boolean, builtIn: boolean}],
  customTags: [{id, name, color}],
  missions: Mission[],
  clearedData: { [mid]: { content, timestamp, title, format } },
  proposals: [{id, title, tag, description}],
  likes: number, hasLiked: boolean,
}
```

### Mission
```ts
{
  id, title, tag, tags: string[],            // tag は後方互換、新は tags
  description: string,
  dates: string[], daysLeft: number,
  status: 'yet' | 'pending_leader_check' | 'cleared',
  clearFormat: 'text' | 'image' | 'url',
  priority: number, isDeletable: boolean,
  createdAt: number,
  // 担当
  assignee: { type: 'user', userId } | { type: 'role', roleId } | null,
  assignees: string[],                        // 複数担当（multi/selection）
  selfClaim: boolean,
  claimMode: 'first' | 'multi' | 'selection',
  claimDeadline: number | null,
  claimApplicants: string[],
  claimClosed: boolean,
  // 詳細設定
  checklist: string[],                        // 完了時にチェック必須
  leaderCheck: boolean,                       // 完了後リーダー承認待ちに
}
```

### Notification (`data/notifications/<userId>.json`)
```ts
{
  notifications: [{
    id, type, message, createdAt, read,
    projectId, missionId, actorId, actorName
  }]
}
```

通知タイプ：
- `assigned_to_me` — 自分に割り当てられた
- `mission_cleared` — メンバーが完了した
- `someone_claimed` — 申告制ミッションに応募者が出た（管理者へ）
- `assignment_decided` — 担当が決定した（全メンバーへ）
- `pending_leader_check` — リーダー承認待ちが発生（管理者へ）
- `leader_approved` / `leader_rejected` — リーダー判定結果（提出者へ）

## API エンドポイント一覧

### 認証
| Method | Path | 用途 |
|---|---|---|
| POST | `/api/auth/register`              | 新規登録（ユーザー名重複OK、メール一意） |
| POST | `/api/auth/login`                  | メールアドレスでログイン（identifierも後方互換）|
| GET  | `/api/auth/me`                     | セッション確認 |
| POST | `/api/auth/logout`                 | |
| POST | `/api/auth/resend-verification`    | OTP再送 |
| POST | `/api/auth/verify-email`           | メール認証 |
| POST | `/api/auth/google`                 | Google サインイン |
| GET  | `/api/config`                      | googleClientId / googleEnabled |
| POST | `/api/auth/password-reset/request` | パスワードリセット要求 |
| GET  | `/api/auth/password-reset/verify/:token` | トークン検証 |
| POST | `/api/auth/password-reset/confirm` | 新パスワード適用（全セッション無効化）|

### アカウント
| Method | Path | 用途 |
|---|---|---|
| POST | `/api/account/change-avatar`        | 256x256 JPEG dataURL |
| POST | `/api/account/change-username/*`   | request/confirm |
| POST | `/api/account/change-email/*`      | request/confirm |
| POST | `/api/account/change-password/*`   | request/confirm |

### プロジェクト・メンバー
| Method | Path | 用途 |
|---|---|---|
| GET    | `/api/data`                                    | 自分の全プロジェクト |
| PUT    | `/api/data`                                    | 全プロジェクト保存（管理権限チェック）|
| GET    | `/api/projects/:id`                            | 単一プロジェクト |
| PUT    | `/api/projects/:id`                            | 単一プロジェクト保存（CRDTパッチ）|
| GET    | `/api/projects/:id/members`                    | メンバー一覧 + roles + ownerId |
| PUT    | `/api/projects/:id/members/:userId/role`       | 単一ロール変更（後方互換）|
| PUT    | `/api/projects/:id/members/:userId/roles`      | 複数ロール変更 |
| DELETE | `/api/projects/:id/members/:userId`            | 脱退/除名 |
| GET/POST/PUT/DELETE | `/api/projects/:id/roles[/:roleId]` | ロール定義 CRUD |

### ミッション操作
| Method | Path | 用途 |
|---|---|---|
| POST   | `/api/projects/:id/missions/:mid/claim`         | 応募・申告（モード依存）|
| DELETE | `/api/projects/:id/missions/:mid/claim`         | 応募取り消し |
| POST   | `/api/projects/:id/missions/:mid/close-claims`  | multi：応募締切 |
| POST   | `/api/projects/:id/missions/:mid/select-claims` | selection：選定確定 |
| POST   | `/api/projects/:id/missions/:mid/approve`       | リーダー承認 |
| POST   | `/api/projects/:id/missions/:mid/reject`        | リーダー差し戻し |

### 招待
| Method | Path | 用途 |
|---|---|---|
| GET    | `/invite/:token`                          | Cookieセット→/リダイレクト |
| GET    | `/api/projects/:id/invites`               | 一覧（**管理可能**）|
| POST   | `/api/projects/:id/invites`               | 発行（**管理可能**）|
| DELETE | `/api/projects/:id/invites/:token`        | 取消（**管理可能**）|
| GET    | `/api/invites/:token`                     | プレビュー（誰でも）|
| POST   | `/api/invites/:token/accept`              | 受諾 |

### 通知
| Method | Path | 用途 |
|---|---|---|
| GET    | `/api/notifications`            | 自分の通知一覧 |
| POST   | `/api/notifications/read-all`   | 全件既読 |
| POST   | `/api/notifications/:id/read`   | 個別既読 |
| DELETE | `/api/notifications/:id`        | 削除 |
| DELETE | `/api/notifications`            | 全削除 |

### SSE
| Method | Path | 用途 |
|---|---|---|
| GET    | `/api/events?cid=&projects=`    | リアルタイム購読 |

## 規約とパターン

### 1. 権限チェック
- `projectStore.isMember(p, userId)` — メンバーか
- `projectStore.canManage(p, userId)` — 管理可能ロールを1つでも持つか
- クライアントは `state.canManageCurrentProject()`、`ownerId === currentUser.id` のフォールバック付き

### 2. ハンドラ登録
全てのクライアントハンドラは `public/js/main.js` の `window._app` オブジェクトに集約。
HTML から `onclick="window._app.xxx()"` で呼ぶ。

### 3. レンダリング
- 状態変更 → `state.render()` → `renderRenderer(state.currentView)`（main.js で登録）
- ミッションモーダルだけ独立して `renderMissionModalContent()` で部分再描画

### 4. SSE と CRDT
- 全クライアントが自分の `X-Client-Id` を送信
- サーバーは送信元クライアント以外に `projectUpdated` をブロードキャスト
- クライアントは受信したら `state.applyServerProject(...)` で取り込む

### 5. メンバーロール（複数対応）
- メンバーは `roles: string[]` を持つ（後方互換で `role` も保持）
- `canManage` 判定は「いずれか1つでも canManage:true」
- 「owner」だけは特別扱い：owner ロールは付け外し禁止、削除拒否

### 6. UI コンポーネント
- `Components.Tag(name)` — タグ表示（builtIn → customTags の順に色解決）
- `Components.UserAvatar(user, opts)` — アバター（Google画像対応、referrerpolicy="no-referrer"、頭文字フォールバック）
- `Components.Tabs(active)` — メイン・通知・アーカイブ
- `Components.Header(...)` — ナビゲーションヘッダ

### 7. ローカルドラフト
完了モーダルは入力途中で × を押しても、再度開けば復元される。
`localStorage` の key 形式: `evecre:clearDraft:v1:{userId}:{projectId}:{missionId}`。
**ユーザーごとに別**。`submitMissionClear` 成功時に破棄。

### 8. メインボードのミッション表示フィルタ
管理権限がないユーザーは:
- `status: 'cleared' | 'pending_leader_check'` → 非表示
- 申告制で**確定済み**かつ自分が含まれない → 非表示
- 申告制で**募集中** → 表示（応募できる）

## 既知の落とし穴

### 1. CRDT の `{v, t}` を間違える
`{val, ts}` と書きがち。`server.js` の `_missionToFlat` / `_setMissionField` を必ず参照。

### 2. 新規プロジェクト作成直後の `canManage`
ローカル `state.projects` に push した `newProject` に `members` がないと、
`canManageCurrentProject()` が false を返し、ボタンが消える。
→ `state.js` の `_createProjectAndReturnId` で `members: [{userId, role:'owner', roles:['owner']}]` を明示的に含め、
保存後に `api.load()` で再取得している。

### 3. 提案カードや「+」ボタンの非表示
`state.canManageCurrentProject()` で囲んでいる。
管理権限ないと提案カードが消える、ミッション追加ボタンも消える。
誤って「自分なのにボタンがない」と感じる原因のほとんどは `members` 未取得が原因。

### 4. Google サインインで avatarUrl が変わらない
既存ユーザーの初回 Google サインイン時、`user.avatarUrl` を Google の picture URL で更新。
ただし `data:` で始まる（手動アップロード）は尊重して上書きしない。
URL は `=s96-c` を `=s256-c` に置換して高解像度で取得。

### 5. projectSettings.js の構文エラー
過去に閉じタグの取り残しで全体が壊れたことあり。
**変更後は必ず `node --check public/js/views/projectSettings.js` + curl でブラウザ視点の配信確認**。

### 6. メンバー username
クライアント側の表示用に `/api/data` レスポンスで members 配列に username/avatarUrl を合成している。
データファイル（`data/projects/*.json`）には userId のみ保存。

### 7. data/ ディレクトリ
`data/users.json`, `data/projects/`, `data/invites/`, `data/notifications/`, `data/.secret`
は **gitignore**。プロジェクトを zip 化するときは除外する。

## よく使うデバッグ・確認コマンド

```bash
# 構文チェック
node --check server.js
node --check public/js/main.js

# 全 JS の構文チェック（一括）
for f in server.js lib/*.js public/js/**/*.js; do node --check "$f" || echo "FAIL: $f"; done

# ブラウザに配信される JS の取得（壊れていないか）
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" http://localhost:3000/js/main.js

# サーバーログ
tail -f /tmp/s.log    # nohup 起動時
# または直接 npm start のフォアグラウンド

# データ確認
ls data/projects/
cat data/projects/p1.json | jq .
cat data/notifications/<userId>.json | jq .
```

## 開発の進め方（推奨）

1. **新機能追加**：
   - データモデル変更が必要なら `lib/crdt.js` の `FLAT_MISSION_FIELDS` か、CRDT対象外なら `mergeProject` 修正
   - サーバー API 追加 → クライアント API ラッパー (`api.js`) → ハンドラ (`main.js`) → UI
2. **必ず動作確認**：
   - `npm start` してブラウザで強制リロード（Cmd/Ctrl+Shift+R）
   - Console のエラーをチェック
3. **構文チェックは並列で**：上のスニペット
4. **CRDT を絡む変更時はE2Eテスト**：
   - 2人ユーザーで操作 → サーバー側のデータが期待通り保存されているか確認

## このノートの更新

新しい機能を追加・規約を変えた時は、このファイルを更新してください。
Claude Code はこのファイルを毎回読み直すので、ここを正確に保つことが
**未来のあなた自身を救う一番の方法**です。
