// ===== イベクリ開発者からのお知らせ =====
// ここを書き換えて再配信したいときは version を必ず更新すること。
// version が前回と異なれば、既読済みのユーザーにも再び表示される
// （既読管理は localStorage にユーザー単位・version ごとで保存。devAnnouncementModal.js 参照）。
// version が未設定/空文字ならモーダルは表示されない（お知らせが無いときはコメントアウトせず version を消せばよい）。

export const DEV_ANNOUNCEMENT = {
  version: '2026-07-12-02',   // 例: '2026-07-12-01'（日付＋連番など、前回と異なる文字列であれば形式自由）
  title: 'チャット機能を実装しました',     // 例: 'ミッションチャット機能を実装しました'
  body: 'ミッション完了の詳細ページでメンバー同士がやり取りできるようになりました。',      // 例: 'ミッション詳細ページでメンバー同士がやり取りできるようになりました。\n返信やリアクションにも対応しています。'
  imageUrl: '/images/announcements/evecre-beta_v.2.5.1-mission_completed.png',  // 例: '/images/announcements/2026-07-chat.png'（不要なら空文字のまま）
};
