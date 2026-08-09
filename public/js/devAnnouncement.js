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
  version: '2026-07-30-05',   // 例: '2026-07-30-01'（日付＋連番など、前回と異なる文字列であれば形式自由）
  pages: [
    {
      body: 'ミッション横の ⋯ ボタンからリンクをコピーできます。\nミッションの詳細を共有したい際にご活用ください！',
      imageUrl: '/images/announcements/announcement-image-link.webp',
    },
    {
      body: 'ミッションの詳細ページでメンバー同士のやり取りができるようになりました。',
      imageUrl: '/images/announcements/announcement-image-chat.webp',
    },
    {
      title: '〜 UIリニューアル中のお知らせ 〜',
      body: '夏休み期間中にイベクリの大規模リニューアルを検討しており、各所変更しながら進めおります。データに問題はございません。今後ともイベクリをよろしくお願いいたします。\n\n【実装予定】\n1.ビジュアルを中心としたUIリニューアル\n2.プロフィールページの追加\n3.WEB Push通知の実装',
    },
    
    // ← 伝えたいことが増えたらこの形でページを足す
    // {
    //   title: '2つ目のお知らせ',
    //   body: '本文をここに書く。\n改行も使えます。',
    //   imageUrl: '/images/announcements/',
    // },
  ],
};
