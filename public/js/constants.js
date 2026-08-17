// ===== 定数定義 =====

export const SEED_TYPES = [
  { id: 'jack',     path: '/images/plants/seed-jack.svg',     name: 'ジャック', plantPrefix: '/images/plants/plant-jack-' },
  { id: 'baribari', path: '/images/plants/seed-baribari.svg', name: 'バリバリ', plantPrefix: '/images/plants/plant-baribari-' },
  { id: 'lucky',    path: '/images/plants/seed-lucky.svg',    name: 'ラッキー', plantPrefix: '/images/plants/plant-lucky-' },
];

export const MISSION_DESCRIPTIONS = {
  'def-1': "目的設定は、「成功の8割」を決める作業です。軸が固まれば、無駄な迷いは消えます。誰に、どんな価値を届けたいのか。私たちの「旗印」を明確にしましょう。",
  'def-2': "タイトルは参加者が最初に触れる、イベントの「第一印象」そのものです。一目で期待感が高まる名前を決定しましょう。\n\nポイント\n・言葉からイメージができるか？\n・リズムが良くキャッチーで、SNSなどでつぶやきやすいか？\n・決めた「目的」と乖離していないか？",
  'def-3': "概要は、目的を具体化し、関係者全員の認識を一致させる基盤です。「いつ、どこで、誰に、何を、どう届けるか（5W1H）」を明確にし、理想を現実に落とし込みましょう。",
  'p1': "イベントをどこで行うか決めましょう。オンラインの場合はツール名を、対面の場合は施設名を入力します。",
  'p2': "イベントの顔となる画像を作成します。テーマカラーやロゴを含めると効果的です。",
  'p4': "イベントの成功を測るための指標を設定します。来場者数、満足度、SNSのシェア数など、具体的に記述しましょう。",
  'p5': "限られたリソースをどこに集中させるか決めます。会場費、広報費、制作費などの概算を出し、優先順位をつけましょう。",
  'p6': "SNSで拡散されやすい独自のタグを決めましょう。イベント名を含めると効果的です。",
  'p7': "当日の流れを時間単位で書き出し、運営メンバーの動きを可視化しましょう。",
  'p8': "配信機材、音響、PC、備品など、当日必要なものをリストアップしましょう。",
};

// クライアント側フォールバック候補。
// ★固定枠（p1/p2）は廃止済み。提案3枠はすべて AI 生成（失敗時は lib/proposalEngine のテンプレ）で
//   埋まる。このプールは「生成APIの呼び出し自体が失敗したとき」の最終フォールバックにのみ使う
//   （state.js の _refreshProposals の catch 節）。p1/p2 も他と同じ普通の候補として扱う。
// （p3「広報リンクを挿入する」は廃止済み。ただし components.js の getEventMainVisual() が
//   originProposalId === 'p3' の完了ミッションを旧データ用フォールバックとして参照しているので、
//   その参照は消さないこと）
export const PROPOSAL_POOL = [
  { id: 'p1', title: '開催場所を決める',         tag: '企画', format: 'text',  priority: 5,
    description: 'イベントをどこで行うか決めましょう。オンラインの場合はツール名を、対面の場合は施設名を入力します。' },
  { id: 'p2', title: 'メインビジュアルを作成する', tag: '制作', format: 'image', priority: 5,
    description: 'イベントの顔となる画像を作成します。テーマカラーやロゴを含めると効果的です。' },
  { id: 'p4', title: '数値目標（KPI）を設定する', tag: '企画', format: 'text', priority: 5,
    description: 'イベントの成功を測るための指標を設定します。来場者数・満足度・SNSシェア数など具体的に記述しましょう。' },
  { id: 'p5', title: '予算配分を決める',          tag: '運営', format: 'text',  priority: 5,
    description: '限られたリソースをどこに集中させるか決めます。会場費・広報費・制作費などの概算を出し優先順位をつけましょう。' },
  { id: 'p6', title: 'SNSハッシュタグを決定する', tag: '広報', format: 'text',  priority: 5,
    description: 'SNSで拡散されやすい独自のタグを決めましょう。イベント名を含めると効果的です。' },
  { id: 'p7', title: '当日のタイムスケジュールを作る', tag: '運営', format: 'text', priority: 5,
    description: '当日の流れを時間単位で書き出し、運営メンバーの動きを可視化しましょう。' },
  { id: 'p8', title: '必要な機材リストを作成する', tag: '制作', format: 'text', priority: 5,
    description: '配信機材・音響・PC・備品など、当日必要なものをリストアップしましょう。' },
];

// ===== イベント作成フローの選択肢 =====
// eventType はミッション提案のカテゴリ判定に直結する（サーバー側 lib/proposalEngine.js の
// EVENT_TYPE_TO_CATEGORY で music/exhibit/sports/business/party/general に写す）。
// ★ここに選択肢を足すときは EVENT_TYPE_TO_CATEGORY にも必ず対応を足すこと。
// 未定義だと general にフォールバックし、カテゴリ固有のテンプレが選ばれなくなる。
export const EVENT_TYPES = [
  { id: 'exhibit',          label: '作品展示会・展覧会',   hint: 'アート・デザイン・制作物の展示' },
  { id: 'festival_market',  label: 'フェス・マーケット',   hint: '物販・飲食の出店がある' },
  { id: 'live_performance', label: 'ライブ・公演',         hint: '音楽・演劇・パフォーマンス' },
  { id: 'contest',          label: '大会・コンテスト',     hint: 'スポーツ・競技・コンペ' },
  { id: 'social',           label: '交流会・パーティー',   hint: '懇親会・打ち上げ・歓迎会' },
  { id: 'other',            label: 'その他',               hint: 'シークレットな企み' },
];

// 「規模感は？」ではなく「どのくらいの人に来てほしい？」と聞く。
// 規模は結果だが、来てほしい人数は意志なので、何も決まっていない段階でも答えられる。
export const EXPECTED_SCALES = [
  { id: 'small',  label: '身内だけで楽しむ',   hint: '5〜30人' },
  { id: 'medium', label: '学校全体を巻き込む', hint: '100〜500人' },
  { id: 'large',  label: '地域や一般客も呼ぶ', hint: '1,000人〜' },
];

// リーダーの意気込み（複数選択可）。カード0件でも作成を完了できる。
// ★「なぜこのイベントをやりたいか」ではなく「リーダーとしてどう臨むか」を聞く。
//   参加が承認された直後にメンバーへ見せ、🔥で応援してもらうための言葉なので、
//   イベントの動機ではなく“この人がどういう姿勢でやるか”が伝わる文にしている。
// ★server.js の _MOTIVATION_LABELS と1対1で対応させること（id を変えたら両方直す）。
export const MOTIVATION_CARDS = [
  { id: 'lead',      label: 'みんなを引っ張っていく' },
  { id: 'listen',    label: '一人ひとりの声を聞く' },
  { id: 'enjoy',     label: 'まず自分が全力で楽しむ' },
  { id: 'finish',    label: '最後までやりきる' },
  { id: 'challenge', label: '新しいことに挑戦する' },
  { id: 'trust',     label: '仲間を信じて任せる' },
];

// キャッチコピーの例文。白紙から捻り出させないための出し分け。
// ★ここで AI を呼ばないこと（イベント作成のたびに Cloudflare の Neurons を消費するため）。
// eventType の6種ぶんだけ持ち、expectedScale では出し分けない（18通りはメンテが重い）。
export const CATCHPHRASE_EXAMPLES = {
  exhibit:          ['つくる、をみせる。', 'ここにしかない一点もの', '見て、感じて、持ち帰って'],
  festival_market:  ['食べて、買って、笑って。', '一日限りの街がひらく', 'お腹も心も満たされる日'],
  live_performance: ['音が鳴る、その一瞬に。', '本気のステージ、見逃すな', '今日だけの熱を浴びに'],
  contest:          ['てっぺんは、ひとつ。', '全力でぶつかる一日', '勝つのは、誰だ'],
  social:           ['はじめまして、をたくさん。', '話せば、仲間になる', 'つながる夜がはじまる'],
  other:            ['まだ、誰も知らない。', 'その日、何かが起こる', 'とりあえず、来てみて'],
};

// ===== 参加申請フォームのスキルタグ =====
// ★保存は英数キー（id）のみ。表示名は必ずこのマスタから引くこと。
//   日本語ラベルを直接保存すると、あとで文言を変えられなくなる。
// ★server.js の _SKILL_LABELS と1対1で対応させること（通知の文面で使う）。
// 状態は「得意」「やってみたい」の2つだけ。「苦手」「まかせたい」に相当する
// 選択肢は置かない（消極的な宣言を強いないため。選ばれなかったタグ＝未選択で
// 同じ情報が取れる）。
export const SKILL_TAGS = [
  { id: 'design',      label: 'デザイン' },
  { id: 'planning',    label: '企画' },
  { id: 'pr',          label: '広報・SNS' },
  { id: 'writing',     label: '文章' },
  { id: 'finance',     label: 'お金の管理' },
  { id: 'negotiation', label: '交渉・外部対応' },
  { id: 'mc',          label: '司会・人前' },
  { id: 'photo',       label: '写真・映像' },
  { id: 'equipment',   label: '機材・設営' },
  { id: 'admin',       label: '事務作業' },
  { id: 'onsite',      label: '当日運営' },
  { id: 'physical',    label: '力仕事' },
];

// ミッションのラベル → 参加申請フォームのスキルタグ（担当者の「おすすめ」に使う）
// ★キーは LABEL_CONFIG のビルトイン4種と一致させること。
//   カスタムタグはここに無いので、名前が SKILL_TAGS のラベルと一致すれば拾う
//   （utils.js の suggestAssignees を参照）。
// ★並び順に意味は無い（一致した数で採点する）。増やしすぎると誰でも当たって
//   おすすめが機能しなくなるので、その担当が実際に手を動かすものだけを入れる。
export const TAG_SKILL_HINTS = {
  '企画': ['planning', 'writing', 'negotiation'],
  '運営': ['onsite', 'admin', 'equipment', 'physical', 'finance', 'mc'],
  '制作': ['design', 'photo', 'equipment', 'writing'],
  '広報': ['pr', 'writing', 'design', 'photo'],
};

// 参加申請フォームの意気込み欄のプレースホルダー（順に切り替えて書き出しを促す）
export const JOIN_MESSAGE_EXAMPLES = [
  'みんなで最高の一日にしたい',
  'はじめてだけど頑張ります',
  '得意なことで力になれたら',
  '楽しみにしています！',
];

// ★bg / border / text（Tailwind のクラス文字列）は 2026-08-17 に削除した。
//   全参照箇所（components.js / mainBoard.js / mission.js / eventCalendarSheet.js）が
//   読んでいたのは color だけで、この3つはどこからも使われていなかった。
//   ★color は消さないこと。カスタムタグのカラーパレットと突き合わせて
//     「そのタグ色が既にビルトインで使われていないか」を判定している。
//   タグの見た目は public/css/object/component/_tag.css（色は --tag-color で渡す）。
export const LABEL_CONFIG = {
  '企画': { color: '#0CA1E3' },
  '運営': { color: '#EE3E12' },
  '制作': { color: '#FFC300' },
  '広報': { color: '#9EDF05' },
};

// ===== 規約への同意 =====
// アカウント作成の STEP 0 で同意を取った時点の版数を users.consentVersion に記録する。
// ★public/legal/*.md を実質的に改訂したら、この値も上げること
//   （上げないと「どの版に同意したユーザーか」が追えなくなる。誤字修正では上げなくてよい）。
export const CONSENT_VERSION = 'v1.0';

