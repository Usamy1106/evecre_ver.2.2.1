// ===== イベクリ開発者からのお知らせ =====
// ここを書き換えて再配信したいときは version を必ず更新すること。
// version が前回と異なれば、既読済みのユーザーにも再び表示される
// （既読管理は localStorage にユーザー単位・version ごとで保存。devAnnouncementModal.js 参照）。
// version が未設定/空文字ならモーダルは表示されない（お知らせが無いときはコメントアウトせず version を消せばよい）。
//
// pages に複数の項目を並べると「次へ」で切り替わる（最後のページは「閉じる」になる）。
// 伝えたいことが1件なら pages を1件だけにすればよい。
//   title    … 見出し
//   body     … 本文（\n で改行できる）
//   imageUrl … 画像（不要なら空文字）。public/images/announcements/ 等に置いてパスを書く。
//               画像は全体が見えるように表示される（上限の高さまで縮小）。

export const DEV_ANNOUNCEMENT = {
  version: '2026-07-30-01',   // 例: '2026-07-30-01'（日付＋連番など、前回と異なる文字列であれば形式自由）
  pages: [
    {
      title: 'チャット機能を実装しました',
      body: 'ミッション完了の詳細ページでメンバー同士がやり取りできるようになりました。',
      imageUrl: '/images/announcements/evecre-beta_v.2.5.1-mission_completed.png',
    },
    // ← 伝えたいことが増えたらこの形でページを足す
    // {
    //   title: '2つ目のお知らせ',
    //   body: '本文をここに書く。\n改行も使えます。',
    //   imageUrl: '',
    // },
  ],
};
