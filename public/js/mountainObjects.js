// ===== 山登りオブジェクトカタログ（クライアント・サーバー共用）=====
// ミッション作成時に priority に応じた重み付き抽選でオブジェクトが決まり（rollMountainObject）、
// ミッション完了でイベント全メンバーの図鑑（user_collections）に登録される。
// ★このファイルは server.js からも dynamic import で読み込まれる単一ソース。
//   CJS 構文（require/module.exports）を混ぜないこと。
// 画像は後日支給予定。それまでは components.js の MountainObjectIcon が
// レアリティ色の正方形プレースホルダーを描画する（imageUrl フィールドを足して差し替え予定）。

export const MOUNTAIN_OBJECTS = [
  // common
  { id: 'signpost',   name: '道案内看板',        rarity: 'common' },
  { id: 'boots',      name: '登山靴',            rarity: 'common' },
  { id: 'canteen',    name: '水筒',              rarity: 'common' },
  { id: 'trailstone', name: '道しるべの石',      rarity: 'common' },
  { id: 'wildflower', name: '高山植物',          rarity: 'common' },
  // rare
  { id: 'tent',       name: 'テント',            rarity: 'rare' },
  { id: 'campfire',   name: 'キャンプファイヤー', rarity: 'rare' },
  { id: 'cablecar',   name: 'ロープウェイ',      rarity: 'rare' },
  { id: 'eagle',      name: 'イヌワシ',          rarity: 'rare' },
  // epic
  { id: 'summitflag', name: '山頂の旗',          rarity: 'epic' },
  { id: 'aurora',     name: 'ご来光',            rarity: 'epic' },
  { id: 'crystal',    name: '山の水晶',          rarity: 'epic' },
];

// レアリティごとの表示色（プレースホルダー正方形・図鑑で使用）
export const RARITY_CONFIG = {
  common: { label: 'コモン', color: '#9EDF05' },
  rare:   { label: 'レア',   color: '#0CA1E3' },
  epic:   { label: 'エピック', color: '#FFC300' },
};

// priority（星1〜5）→ レアリティの出現重み（仮の値。後日調整する）
export const RARITY_WEIGHTS = {
  1: { common: 90, rare: 9,  epic: 1 },
  2: { common: 80, rare: 17, epic: 3 },
  3: { common: 65, rare: 28, epic: 7 },
  4: { common: 50, rare: 38, epic: 12 },
  5: { common: 35, rare: 45, epic: 20 },
};

/**
 * priority に応じてオブジェクトを1つ抽選する。
 * @param {number} priority 1〜5（範囲外は丸める）
 * @returns {{id: string, rarity: string}}
 */
export function rollMountainObject(priority) {
  const p = Math.min(5, Math.max(1, Math.round(Number(priority) || 1)));
  const weights = RARITY_WEIGHTS[p];
  const total = weights.common + weights.rare + weights.epic;
  let r = Math.random() * total;
  let rarity = 'common';
  for (const key of ['common', 'rare', 'epic']) {
    r -= weights[key];
    if (r < 0) { rarity = key; break; }
  }
  const pool = MOUNTAIN_OBJECTS.filter(o => o.rarity === rarity);
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return { id: picked.id, rarity: picked.rarity };
}
