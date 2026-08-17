# public/css — スタイルの置き場所

**「この見た目を変えたい」→「このファイルのこのクラス」** を迷わず辿れる状態を保つための規約。

- ビルド工程は無い。素の CSS ＋ `@import` だけで動く（`npm start` のみ）
- 読み込みは `index.html` の `<link rel="stylesheet" href="/css/style.css">` **1本だけ**
- `style.css` には **`@import` 以外を書かない**。順番＝詳細度の弱い順で、**入れ替えるとカスケードが壊れる**
- パーシャルは `_` 始まり（単体では読み込まないファイルの目印。ビルドが無いので機能的な意味は無く、規約として統一している）

> **移行中**：Tailwind CDN と並走している。撤去は Phase 5。
> それまでは同じ見た目が「Tailwind のユーティリティ」と「ここの CSS」の両方から当たっている箇所がある。

---

## 1. どこに書くか（判断の順序）

| レイヤー | 接頭辞 | 書くもの | 判断基準 |
|---|---|---|---|
| Foundation | なし（要素セレクタ／CSS 変数） | reset、トークン、素の要素、タイプスケール、共有 `@keyframes` | 「アプリ全体の前提」か？ |
| Layout | `l-` | ヘッダー、タブ、`#app`、固定フッター、ローディング | **1画面に1つしか存在しない領域**か？ |
| Component | `c-` | ボタン、入力、カード、タグ、シート、モーダル | **2画面以上で使い回す**か？ 中身に依存せず単体で成立するか？ |
| Project | `p-` | 各画面固有のブロック・並び | 特定の画面だけで意味を持つか？ |
| Utility | `u-` | `u-hidden` など単一目的 | **他で表現できないときの最後の手段。安易に増やさない** |

**迷ったら**：まず `c-` を疑い、1画面でしか使わないと確信できたら `p-`。
`u-` を作りたくなったら、`c-` の modifier で表現できないかを先に考える。

### 守ること

- **Component は自身の外側の余白（margin）と位置を持たない。** 配置は親（`l-` / `p-`）が決める
- **Project から Component の中身を直接上書きしない。** 必要なら `c-` 側に modifier を足す
  - ✗ `.p-home .c-card__title { font-size: 20px; }`
  - ✓ `.c-card--feature .c-card__title { font-size: 20px; }`
- **`!important` は禁止**（例外は下記2つだけ。どちらも Tailwind 撤去で解消予定）
- **CSS Nesting は使わない。** 1セレクタ1ブロックで書く
- **`id` にスタイルを当てない。** `#app` / `#loading-screen` も `.l-app` / `.l-loading` を併記してある
- **色・サイズを直書きしない。** `foundation/_variables.css` に名前を付けてから使う

---

## 2. 早見表 — 変えたい見た目 → 触るファイル

| 変えたいもの | ファイル |
|---|---|
| 色・余白・角丸・影・z-index の値そのもの | `foundation/_variables.css` |
| 画面全体の背景色・基本フォント | `foundation/_base.css` |
| 見出し・本文の文字サイズ（`heading-*` / `text-*`） | `foundation/_typography.css` |
| アニメーションの動き方（`@keyframes`） | `foundation/_animation.css` |
| 要素の初期化（`box-sizing` など） | `foundation/_reset.css` |
| アプリの最大幅・中央寄せ | `layout/_app.css` |
| ヘッダー（HOME / イベント） | `layout/_header.css` |
| タブ（メインボード・通知・アーカイブ）とアクティブ表示 | `layout/_tabs.css` |
| メインボード下部のパネル・FAB | `layout/_fixed-bottom.css` |
| 起動時のローディング画面 | `layout/_loading.css` |
| 画面切り替え時のフェード | `layout/_page.css` |
| ボタン（`c-button--primary` / `--secondary` / `--danger` / `--muted` / `--block`） | `object/component/_button.css` |
| 入力欄（`c-input`） | `object/component/_input.css` |
| ラベルタグの色・形（`c-tag`） | `object/component/_tag.css` |
| ユーザーアイコン（`c-avatar`） | `object/component/_avatar.css` |
| イベントのサムネイル（`c-thumbnail`） | `object/component/_thumbnail.css` |
| ペンなどアイコンだけのボタン | `object/component/_icon-button.css` |
| 進捗のドット（`c-step-indicator`） | `object/component/_step-indicator.css` |
| メール未認証などの告知バナー | `object/component/_banner.css` |
| モーダル・シートの暗幕（`c-overlay`） | `object/component/_overlay.css` |
| ボトムシートの開閉（`c-sheet` / `.is-open`） | `object/component/_sheet.css` |
| 確認ダイアログ（`c-dialog`） | `object/component/_dialog.css` |
| トースト（`c-toast`） | `object/component/_toast.css` |
| 色付きの囲みメッセージ（`c-notice`） | `object/component/_notice.css` |
| フォームの1項目（ラベル・エラー・`is-error`） | `object/component/_field.css` |
| 読み込み中のくるくる（`c-spinner`） | `object/component/_spinner.css` |
| 招待の中身（参加中メンバー・意気込み） | `object/component/_invite-preview.css` |
| ワンタイムコードのマス目入力 | `object/component/_otp-input.css` |
| 設定の1項目（カード型・一覧型どちらも） | `object/component/_settings-card.css` |
| 長押し・右クリックのメニュー | `object/component/_context-menu.css` |
| リアクションの絵文字を選ぶシート | `object/component/_emoji-picker.css` |
| コーチマークの脈動・指の動き | `object/component/_coach-mark.css` |
| 利用規約・プライバシーポリシー（本文の見出し・表も） | `object/project/_legal.css` |
| プロジェクト（フォルダ）詳細 | `object/project/_project-detail.css` |
| ホーム（イベント一覧・プロジェクト一覧・承認待ちカード） | `object/project/_home.css` |
| ログイン・アカウント作成・パスワードリセット | `object/project/_auth.css` |
| アカウント設定（プロフィール・通知・退会） | `object/project/_account.css` |
| イベント作成フロー（STEP 1〜7・開催日カレンダー） | `object/project/_create-event.css` |
| ミッション詳細（完了入力・チャット・吹き出し） | `object/project/_mission-detail.css` |
| イベント設定（イベント管理・メンバー・ロール・脱退） | `object/project/_event-settings.css` |
| メインボードのメインタブ（日付チップ・提案・ミッションカード） | `object/project/_main-board.css` |
| アーカイブタブ（概要カード・ミッションの記録） | `object/project/_archive.css` |
| 通知タブ（応募待ち・確認待ち・通知一覧） | `object/project/_notification.css` |
| アカウント作成フロー（STEP 0〜8） | `object/project/_signup.css` |
| モーダルのフェードイン（`animate-fadeIn`） | `object/utility/_animation.css` |
| ノッチ・ホームインジケータの回避 | `object/utility/_safe-area.css` |
| スクロールバーを隠す（`no-scrollbar`） | `object/utility/_scroll.css` |

---

## 3. 命名規則

**形式**: `接頭辞 + Block__Element--Modifier`（英語・小文字・ケバブケース）

```
.c-mission-card                  Block
.c-mission-card__title           Element
.c-mission-card__title--long     Modifier
.c-mission-card--completed       Block の Modifier
```

- Element の入れ子で `__` を重ねない（`__a__b` にしない）。深くなるなら別 Block に切り出す
- **1要素のクラスは原則3個まで**（Block ＋ modifier ＋ `js-`）。超えるなら Block を切り出す

### 状態は `is-` 接頭辞

単独では定義せず、**必ず対象クラスと連結して書く**。

```css
.c-sheet.is-open { transform: translateY(0); }   /* ✓ */
.is-open { ... }                                  /* ✗ */
```

使う語彙は統一する：
`is-open` / `is-hidden` / `is-active` / `is-selected` / `is-disabled` / `is-loading` / `is-error` / `is-expanded`

### JS から掴む目印は `js-` か `data-*`

**`js-` にはスタイルを一切当てない。** スタイルと JS フックを同じクラスに兼ねさせると、
見た目の都合でクラスを消したときに機能が無言で壊れる。

```html
<div class="c-notice-card js-notif-swipe-card" data-notif-id="...">
```

**現在ある `js-` フック**（クラス名を変えるときは対になる JS も直すこと）:

| クラス | 掴んでいる場所 | 用途 |
|---|---|---|
| `js-mountain-sticky` | `mountainPath.js` | ヘッダー＋タブの下端を測り、山ビジュアルの上端を合わせる |
| `[data-otp-box]` | `views/signup.js` | ワンタイムコードのマスを引く（旧 `.flex > div`）|
| `notif-swipe-card` | `views/mainBoard.js` | 通知の横スワイプ削除の対象 |
| `announce-chevron` | `views/mainBoard.js` | アナウンス折りたたみの矢印を回す |
| `archive-section-body` / `-arrow` | `main.js` | アーカイブのカテゴリ折りたたみ |

---

## 4. ファイルの書き方

**先頭に必ずヘッダーコメントを置き、使用箇所を書く。** JS 側からも対応する CSS を辿れるよう、
マークアップ生成関数の直前にも `スタイル: public/css/...` と書く（**双方向に辿れる状態を作る**）。

```css
/* ==========================================================================
   c-mission-card — ミッションカード
   使用箇所: views/mainBoard.js, views/missionDetail.js
   ========================================================================== */

.c-mission-card {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

/* 完了済み：淡く沈ませる */
.c-mission-card.is-completed {
  opacity: .5;
}
```

- **1コンポーネント＝1ファイル。1画面＝1ファイル**
- 200行を超えたら分割を検討する
- **新しいファイルを作ったら `style.css` の `@import` とこの README の早見表を同時に更新する**

### インライン `style` を許可する場合

**JS が計算した値（座標・高さ・ユーザーが選んだ色）だけ**。静的な値は CSS に置く。

```js
// ✓ getBoundingClientRect() の実測値（coachMark.js / tooltipTour.js）
finger.style.left = `${cx - FW / 2}px`;
// ✓ ユーザーが選んだタグ色
`<span class="c-tag" style="--tag-color:${custom.color}">`
// ✗ 静的な値
`<div style="padding: 16px">`
```

---

## 5. `!important` を使っている箇所（Tailwind 撤去で解消する）

| 箇所 | 理由 |
|---|---|
| `object/utility/_safe-area.css` の `u-fab-safe` / `u-pb-safe` | Tailwind の `bottom-10` / `pb-32` に勝たせるため。Phase 5 で外す |

Phase 5 で `u-hidden` を追加する際は、**JS が表示制御に使うため `!important` を許容する**
（唯一の恒久的な例外になる予定）。

---

## 6. 全体構成（計画）

Phase が進むにつれてファイルが増える。**まだ存在しないものは「未作成」**。

```
public/css/
├─ style.css                    エントリ。@import のみ
├─ README.md                    このファイル
│
├─ foundation/
│  ├─ _variables.css            ✅ デザイントークン
│  ├─ _reset.css                ✅ 要素の初期化
│  ├─ _base.css                 ✅ html / body / data-sheet-handle
│  ├─ _animation.css            ✅ 共有 @keyframes
│  └─ _typography.css           ✅ heading-* / text-*
│
├─ layout/
│  ├─ _app.css                  ✅ .l-app（#app）
│  ├─ _loading.css              ✅ .l-loading（#loading-screen）
│  ├─ _page.css                 ✅ .page-transition
│  ├─ _header.css               ✅ .l-header（--home / --event）／.l-header-stack
│  ├─ _tabs.css                 ✅ .l-tabs（.is-active）
│  └─ _fixed-bottom.css         ✅ .l-bottom-panel / .l-fab
│
├─ object/component/
│  ├─ _button.css               ✅ c-button（--primary/--secondary/--danger/--muted/--block）
│  ├─ _input.css                ✅ c-input
│  ├─ _tag.css                  ✅ c-tag（色は --tag-color）
│  ├─ _avatar.css               ✅ c-avatar（大きさは --avatar-size）
│  ├─ _thumbnail.css            ✅ c-thumbnail
│  ├─ _icon-button.css          ✅ c-icon-button（PenIcon）
│  ├─ _step-indicator.css       ✅ c-step-indicator（.is-active / .is-done）
│  ├─ _banner.css               ✅ c-banner（VerifyBanner）
│  ├─ _overlay.css              ✅ c-overlay（用途別に z-index を持つ）
│  ├─ _sheet.css                ✅ c-sheet（.is-open）
│  ├─ _dialog.css               ✅ c-dialog（dialog.js）
│  ├─ _toast.css                ✅ c-toast
│  ├─ _notice.css               ✅ c-notice（--info/--danger/--warning/--muted）
│  ├─ _field.css                ✅ c-field / c-input--block / .is-error
│  ├─ _spinner.css              ✅ c-spinner
│  ├─ _invite-preview.css       ✅ c-invite-members / c-invite-motivation
│  ├─ _otp-input.css            ✅ c-otp（[data-otp-box]）
│  ├─ _settings-card.css        ✅ c-settings-card / c-settings-list
│  ├─ _context-menu.css         ✅ c-context-menu
│  ├─ _emoji-picker.css         ✅ c-emoji-picker
│  ├─ _coach-mark.css           ✅ coachMark.js
│  ├─ _card.css                 ⬜ Phase 3 — 各画面のカードを見てから切り出す
│  ├─ _empty.css                ⬜ Phase 3 — 空状態
│  └─ _tooltip.css              ⬜ Phase 4 — tooltipTour.js
│
├─ object/project/              （1画面1ファイル）
│  ├─ _legal.css                ✅ 法務ドキュメント（markdown.js の出力もここ）
│  ├─ _project-detail.css       ✅ プロジェクト詳細
│  ├─ _home.css                 ✅ ホーム
│  ├─ _auth.css                 ✅ ログイン前の画面（auth / passwordReset）
│  ├─ _account.css              ✅ アカウント設定
│  ├─ _create-event.css         ✅ イベント作成フロー
│  ├─ _mission-detail.css       ✅ ミッション詳細
│  ├─ _event-settings.css       ✅ イベント設定
│  ├─ _main-board.css           ✅ メインタブ・バナー・アナウンス
│  ├─ _archive.css              ✅ アーカイブタブ
│  ├─ _notification.css         ✅ 通知タブ
│  ├─ _signup.css               ✅ アカウント作成フロー
│  └─ _main-board / _mission-modal / │     _event-settings / _signup / │     _calendar / _invite / _mountain / _onboarding      ⬜ Phase 3〜4
│
└─ object/utility/
   ├─ _animation.css            ✅ animate-fadeIn
   ├─ _safe-area.css            ✅ u-fab-safe / u-pb-safe
   ├─ _scroll.css               ✅ no-scrollbar
   ├─ _display.css              ⬜ Phase 5 — u-hidden
   ├─ _text.css                 ⬜ Phase 5
   └─ _spacing.css              ⬜ Phase 5
```

> **空ファイルは先に作らない方針にしている。** `@import` 1本ごとに HTTP リクエストが増え、
> `.css` は `no-cache`（毎回 ETag 再検証）で配信されるため、中身の無いファイルを並べると
> 表示のたびに無駄な往復が増えるため。**構成の全体像はこの節で示し、実体は各 Phase で作る。**

---

## 7. 旧クラス名からの対応（移行中）

| 旧 | 新 | 状況 |
|---|---|---|
| `#loading-screen` | `.l-loading` | ✅ Phase 0 |
| `.hide`（ローディング） | `.is-hidden` | ✅ Phase 0（`state.js` / `main.js` も同時に修正済み） |
| `.fab-safe` | `.u-fab-safe` | ✅ Phase 0 |
| `.pb-safe` | `.u-pb-safe` | ✅ Phase 0 |
| `.sticky`（`mountainPath.js` のフック） | `.js-mountain-sticky` | ✅ Phase 1 |
| `.fab-safe`（FAB） | `.l-fab` に統合 | ✅ Phase 1 |
| `.btn-primary` / `.btn-secondary` | `.c-button--primary` / `--secondary` | ✅ Phase 2 |
| `.input-field` | `.c-input` | ✅ Phase 2 |
| `translate-y-full`（シート開閉） | `.c-sheet` ＋ `.is-open` | ✅ Phase 2 |
| `LABEL_CONFIG` の `bg`/`border`/`text` | 削除（未使用だった） | ✅ Phase 2 |
| `.heading-*` / `.text-*` | 判断待ち | ⬜ Phase 5 |
| `.no-scrollbar` | `.u-no-scrollbar` | ⬜ Phase 5 |
| `.animate-fadeIn` | `.u-fade-in`（判断待ち） | ⬜ Phase 5 |
| Tailwind の `hidden` | `.u-hidden` | ⬜ Phase 5 |
