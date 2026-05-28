// ===== 定数定義 =====

export const SEED_TYPES = [
  { id: 'jack',     path: '/images/plants/seed-jack.svg',     name: 'ジャック', plantPrefix: '/images/plants/plant-jack-' },
  { id: 'baribari', path: '/images/plants/seed-baribari.svg', name: 'バリバリ', plantPrefix: '/images/plants/plant-baribari-' },
  { id: 'lucky',    path: '/images/plants/seed-lucky.svg',    name: 'ラッキー', plantPrefix: '/images/plants/plant-lucky-' },
];

export const MISSION_DESCRIPTIONS = {
  'def-1': "目的設定は、「成功の8割」を決める作業です。軸が固まれば、無駄な迷いは消えます。誰に、どんな価値を届けたいのか。私たちの「旗印」を明確にしましょう。",
  'def-2': "タイトルは参加者が最初に触れる、イベントの「第一印象」そのものです。一目で期待感が高まる名前を決定しましょう。\n\nポイント\n・言葉からイメージができるか？\n・リズムが良くキャッチーで、SNSなどでつぶやきやすいか？\n・決めた「目的」と乖離していないか？",
  'def-3': "概要は、目的を具体化し、関係者全員の認識を一致させる基盤です。「いつ、どこで、誰に、何を、どう届けるか（5W1H）」を明確にし、理想を現実に落とし込み、強固な土台を作りましょう。",
  'p1': "イベントをどこで行うか決めましょう。オンラインの場合はツール名を、対面の場合は施設名を入力します。",
  'p2': "SNSやWebサイトなど、参加者が詳細を確認できるURLを準備しましょう。",
  'p3': "イベントの顔となる画像を作成します。テーマカラーやロゴを含めると効果的です。",
  'p4': "イベントの成功を測るための指標を設定します。来場者数、満足度、SNSのシェア数など、具体的に記述しましょう。",
  'p5': "限られたリソースをどこに集中させるか決めます。会場費、広報費、制作費などの概算を出し、優先順位をつけましょう。",
  'p6': "SNSで拡散されやすい独自のタグを決めましょう。イベント名を含めると効果的です。",
  'p7': "当日の流れを時間単位で書き出し、運営メンバーの動きを可視化しましょう。",
  'p8': "配信機材、音響、PC、備品など、当日必要なものをリストアップしましょう。",
};

export const PROPOSAL_POOL = [
  { id: 'p1', title: '開催場所を決める',      tag: '企画', type: 'plan',   format: 'text',  priority: 5 },
  { id: 'p2', title: '広報リンクを挿入',       tag: '広報', type: 'public', format: 'link',  priority: 5 },
  { id: 'p3', title: 'メインビジュアルを作成', tag: '制作', type: 'create', format: 'image', priority: 5 },
  { id: 'p4', title: '数値目標（KPI）を設定する', tag: '企画', type: 'plan', format: 'text', priority: 5 },
  { id: 'p5', title: '予算配分を決める',       tag: '運営', type: 'op',     format: 'text',  priority: 5 },
  { id: 'p6', title: 'SNSハッシュタグを決定',  tag: '広報', type: 'public', format: 'text',  priority: 5 },
  { id: 'p7', title: '当日のタイムスケジュール', tag: '運営', type: 'op',   format: 'text',  priority: 5 },
  { id: 'p8', title: '必要な機材リスト作成',   tag: '制作', type: 'create', format: 'text',  priority: 5 },
];

export const LABEL_CONFIG = {
  '企画': { color: '#0CA1E3', bg: 'bg-[#0CA1E3]/10', border: 'border-[#0CA1E3]', text: 'text-[#0CA1E3]' },
  '運営': { color: '#EE3E12', bg: 'bg-[#EE3E12]/10', border: 'border-[#EE3E12]', text: 'text-[#EE3E12]' },
  '制作': { color: '#FFC300', bg: 'bg-[#FFC300]/10', border: 'border-[#FFC300]', text: 'text-[#FFC300]' },
  '広報': { color: '#9EDF05', bg: 'bg-[#9EDF05]/10', border: 'border-[#9EDF05]', text: 'text-[#9EDF05]' },
};

export const GROWTH_THRESHOLDS = [0, 30, 90, 210, 450, 930, 1890, 3810, 7650, 15330];
