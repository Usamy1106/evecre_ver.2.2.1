// ===== アカウント作成後のオンボーディング（文言と画像のパス）=====
//
// アカウント作成の完了後に出す5枚（機能紹介3枚 → ホームに置いておこう（Android か iOS のどちらか））。
// 表示と遷移は modals/welcomeTourModal.js。**このファイルはデータだけ**（文言・画像を差し替えるのはここ）。
//
// ★画像のパス（logo / art / benefits[].icon / steps[].art）は空文字なら出さない（仮画像を置かない）。
//   用意できたら `/images/...` のパスを入れるだけで表示される。枠の大きさは CSS が決めている
//   （object/project/_welcome-tour.css の --welcome-art-*）。
// ★見出し（title）・説明文（body）は**1行ずつの配列**。改行の位置をここで決める。
// ★文言に HTML は書かない（表示側がエスケープする）。

export const WELCOME_TOUR = {
  // 全モーダル共通のロゴ（いちばん上）。空文字なら出さない
  logo: '/images/icon/evecre-icon-192.png',

  // ── 機能紹介（1 → 2 → 3）──────────────────────────────
  // next … 右下のボタン。最後の1枚は「はじめる」＝ここで機能紹介を終え、ホームに置いておこうへ進む
  pages: [
    // 2026-10-12 に文面を差し替え（①仲間と一緒に／②提案／③振り返り）
    {
      id: 'team',
      art: '/images/onboarding/onboarding-together.webp',
      title: ['仲間と一緒に', 'ミッションを進めよう'],
      body: [
        '役割を分担し、やることを共有。',
        'みんなで協力して目標を目指そう。',
      ],
      next: '次へ',
    },
    {
      id: 'proposal',
      art: '/images/onboarding/onboarding-suggests.webp',
      title: ['提案を活用しよう'],
      body: [
        '活動に合わせたアイデアや',
        '進め方のヒントを見つけよう。',
      ],
      next: '次へ',
    },
    {
      id: 'reflect',
      art: '/images/onboarding/onboarding-inheriting.webp',
      title: ['振り返りを、', '次のイベントに活かそう'],
      body: [
        'できたことや気づきを記録して、',
        '次のイベントづくりにつなげよう。',
      ],
      next: 'はじめる',
    },
  ],

  // ── ホームに置いておこう（端末で出し分ける）──────────────────
  // ★すでにホーム画面から開いている（追加済み）なら、どちらも出さない
  homeAdd: {
    // Android / Chrome など、ブラウザからインストールの確認を出せる環境
    android: {
      id: 'home-android',
      art: '/images/onboarding/onboarding-addhome.webp',
      title: ['イベクリをホームに置いておこう'],
      body: ['ホーム画面に追加すると、', 'タスクやお知らせを', 'すぐにチェックできます。'],
      // メリット（横並び4つ）。icon は空文字なら出さない
      benefits: [
        { icon: '', label: ['タスクを', 'すぐ確認'] },
        { icon: '', label: ['お知らせを', '受け取りやすい'] },
        { icon: '', label: ['開催までの', '進み具合を確認'] },
        { icon: '', label: ['アプリのように', 'すぐ開ける'] },
      ],
      primary: 'ホームに追加する',
      later: 'あとで',
      // ブラウザがインストールの確認を出せなかったとき（Firefox など）にモーダルの中に出す案内
      fallback: 'ブラウザのメニュー（︙）から「ホーム画面に追加」または「アプリをインストール」を選んでください',
    },
    // iPhone / Safari。ブラウザから直接追加できないので、手順を案内する
    ios: {
      id: 'home-ios',
      art: '/images/onboarding/onboarding-addhome.webp',
      title: ['イベクリをホームに置いておこう'],
      body: ['ホーム画面に追加すると、', 'タスクの通知や開催までの進み具合を', 'すぐにチェックできます。'],
      stepsTitle: 'ホーム画面への追加方法',
      // art … 各 STEP の操作説明の画像。空文字なら出さない
      // ★画面の写真は iPhone の Safari のもの（Android 向けの④には出さない）。下に3列で横並び。
      // ★ファイル名の番号と手順の順番は一致しない（screen2＝共有、screen1＝ホーム画面に追加、screen3＝追加）
      steps: [
        { art: '/images/onboarding/onboarding-addhome-screen2.webp', label: '共有ボタンをタップ' },
        { art: '/images/onboarding/onboarding-addhome-screen1.webp', label: '「ホーム画面に追加」を選択' },
        { art: '/images/onboarding/onboarding-addhome-screen3.webp', label: '「追加」をタップ' },
      ],
      primary: 'やり方を確認する',
      later: 'あとで',
      // 「やり方を確認する」で開く説明のページ（動画など）。空文字なら、既存の追加方法の案内（pushSetupModal）を開く
      guideUrl: '',
    },
  },
};
