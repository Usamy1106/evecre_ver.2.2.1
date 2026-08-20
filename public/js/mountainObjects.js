// ===== 山に出現するオブジェクト =====
//
// ミッションを完了すると、道の横に小さなオブジェクトが1つ出る。
// 「何を完了したか」が景色として残り、期限内に終わらせると珍しいものが出ることがある。
//
// ★このファイルはサーバー（server.js）から dynamic import される共用 ESM。
//   CJS 構文（require / module.exports）を混ぜないこと。混ぜるとサーバーの
//   読み込みが落ちる。
//
// ★図鑑（収集して溜める機能）は作らない。出現するだけ。
//   2026-07-30 に廃止済みで、復活させない方針（CLAUDE.md 参照）。
//
// ★抽選は必ずサーバー側で行う（server.js の /complete）。クライアントで
//   引くと改ざんできる。期限内かどうかもサーバーの時刻で判定する
//   （TZ=Asia/Tokyo が前提）。
//
// ★一度決まったオブジェクトは submissions に保存し、以後は読むだけ。
//   描画のたびに引き直すとリロードで風景が変わり、「この山は自分たちが作った」
//   という記念碑性が消える。

/**
 * tier の意味
 *   'tag'    … ミッションのラベルから確定で決まる。外れが無い
 *   'ontime' … 期限内に完了したときだけ引ける
 *   'rare'   … 期限内かつ低確率
 *
 * icon は当面この絵文字を使う。★イラストが用意できたら差し替える前提の
 * プレースホルダーで、id さえ変えなければ表示側は無変更で済む。
 */
export const MOUNTAIN_OBJECTS = [
  // ── tier: 'tag' ── ラベルから確定で決まる。★ビルトイン4ラベルすべてに用意する
  { id: 'tent',     name: 'テント',       tier: 'tag', tag: '企画', icon: '⛺' },
  { id: 'signpost', name: '道案内看板',   tier: 'tag', tag: '運営', icon: '🪧' },
  { id: 'easel',    name: 'イーゼル',     tier: 'tag', tag: '制作', icon: '🎨' },
  { id: 'flag',     name: '旗',           tier: 'tag', tag: '広報', icon: '🚩' },
  // ★カスタムタグ・ラベル未設定はこれになる。tag:null は「該当なしの受け皿」の目印。
  //   これを消すと rollTagObject が undefined を返しうるので消さないこと。
  { id: 'stone',    name: '道しるべの石', tier: 'tag', tag: null,   icon: '🪨' },

  // ── tier: 'ontime' ── 期限内完了で引ける
  { id: 'deer',      name: 'シカ',                 tier: 'ontime', weight: 40, icon: '🦌' },
  { id: 'campfire',  name: 'キャンプファイヤー',   tier: 'ontime', weight: 20, icon: '🔥' },
  { id: 'mushroom',  name: 'きのこ',               tier: 'ontime', weight: 30, icon: '🍄' },

  // ── tier: 'rare' ── 期限内 かつ 低確率
  { id: 'bear',   name: 'クマ',     tier: 'rare', weight: 50, icon: '🐻' },
  { id: 'aurora', name: 'ご来光',   tier: 'rare', weight: 30, icon: '🌅' },
  { id: 'comet',  name: '流れ星',   tier: 'rare', weight: 20, icon: '☄️' },
];

/**
 * ★出現率の調整はここだけ触れば済む。
 *   rare を先に判定し、外れたら ontime を判定する（rare のほうが珍しい）。
 */
export const TIER_CHANCE = {
  rare:   0.05,   // 期限内完了のうち 5%
  ontime: 0.60,   // rare を外した残りのうち 60%
};

/** 星の数はアップグレード確率の係数。手強いミッションほど珍しいものが出やすい */
export const PRIORITY_MULTIPLIER = { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.3, 5: 1.6 };

const _byTier = (tier) => MOUNTAIN_OBJECTS.filter(o => o.tier === tier);

/** id から1件引く（表示側が使う）。未知の id は null */
export function findObject(id) {
  return MOUNTAIN_OBJECTS.find(o => o.id === id) || null;
}

/** weight つきの重み付き抽選 */
function _pickWeighted(list, rnd = Math.random) {
  const total = list.reduce((s, o) => s + (o.weight || 1), 0);
  if (total <= 0) return list[0] || null;
  let r = rnd() * total;
  for (const o of list) {
    r -= (o.weight || 1);
    if (r < 0) return o;
  }
  return list[list.length - 1] || null;
}

/**
 * ラベルから確定でオブジェクトを決める。
 * ★該当が無いときも必ず何か返す（undefined を返さない）。カスタムタグは
 *   ユーザーが自由に作れるので、必ずここを通る。
 * @param {string|null} tag ラベル名
 */
export function rollTagObject(tag) {
  const list = _byTier('tag');
  const hit = tag ? list.find(o => o.tag === tag) : null;
  return hit || list.find(o => o.tag === null) || list[0];
}

/**
 * 期限内に完了したときのアップグレード抽選。
 * ★期限外・期限なしのときは呼ばれても null を返す（＝ラベル確定のまま）。
 * @param {{ priority?: number, onTime?: boolean, rnd?: function }} opts
 * @returns {object|null} 引けたオブジェクト。外れたら null
 */
export function rollUpgrade({ priority = 3, onTime = false, rnd = Math.random } = {}) {
  if (!onTime) return null;
  const mul = PRIORITY_MULTIPLIER[priority] ?? 1.0;
  // ★確率が 1 を超えないよう頭打ちにする（星5×高い係数で必ず当たると壊れる）
  const rareChance   = Math.min(1, TIER_CHANCE.rare   * mul);
  const ontimeChance = Math.min(1, TIER_CHANCE.ontime * mul);

  if (rnd() < rareChance)   return _pickWeighted(_byTier('rare'), rnd);
  if (rnd() < ontimeChance) return _pickWeighted(_byTier('ontime'), rnd);
  return null;
}

/**
 * ミッションから「見るべきラベル」を取り出す。
 * ★実データは tags（複数・新）と tag（単数・後方互換）の両方を持ちうる。
 *   アプリ全体が tags[0] 優先・tag フォールバックで揃っているので、ここも同じにする。
 */
export function primaryTag(mission) {
  if (Array.isArray(mission?.tags) && mission.tags.length > 0) return mission.tags[0];
  return mission?.tag || null;
}

/**
 * 期限内に完了したか。
 * ★dates の「最終日当日」を含む（最終日のうちに完了すれば期限内）。
 * ★dates は未ソートで保存されるので、必ず並べ替えてから最終日を取る。
 * ★dates 未設定は「期限が無い」＝アップグレード対象外なので false を返す。
 * @param {string[]} dates YYYY-MM-DD の配列
 * @param {Date} now サーバーの現在時刻
 */
export function isOnTime(dates, now = new Date()) {
  if (!Array.isArray(dates) || dates.length === 0) return false;
  const last = [...dates].sort().at(-1);
  if (!last) return false;
  const [y, mo, d] = String(last).split('-').map(Number);
  if (!y || !mo || !d) return false;
  // 最終日の 23:59:59.999 まで期限内
  const deadline = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return now.getTime() <= deadline.getTime();
}
