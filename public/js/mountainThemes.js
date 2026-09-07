// ===== 山の背景テーマの調整テーブル =====
//
// 背景は完成した1枚絵ではなく、地形（landform）・植物（plant）・気象（phenomenon）・
// 雲（cloud）のパーツからその場で組み立てる。**その組み立て方をテーマごとに決めるのが
// このファイル**。景色の印象を変えたいときは、ここの数字だけを触ればよい。
//
// ★ここは手書き。素材の一覧（枚数・寸法・色）は `mountainAssets.generated.js` が持つ。
//   ファイル名をこのファイルに書かないこと（素材を足すたびに手で直すことになる）。
// ★`lib/pushRules.js` と同じ「宣言的テーブル」の作り。テーマを増やすときは
//   配列に1エントリ足すだけで、`mountainPath.js` は書き換えない。
// ★`id` は `public/images/bg/<id>/` のフォルダ名と一致させること。
//   一致しないテーマは素材が引けないので、生成時に黙って飛ばされる。
//
// ── 単位について ──────────────────────────────────────────
// 距離・大きさはすべて**素材px**（landform の原寸幅 2049 を基準にした座標系）。
// 画面pxではない。実寸への変換は CSS の `--art-scale` が一手に引き受ける。
// ★ここに画面pxやvhを書かないこと。端末幅で景色が変わり、
//   「全メンバーが同じ景色を見る」が壊れる。

export const BG_THEMES = [
  {
    id: 'MorningMeadow',

    // ── 地形 ────────────────────────────────────────────
    // 次の地形を「前の地形の下端から何px上」に置くか。毎回この範囲で抽選する。
    // ★advanceMax は素材の重ねしろ（下の塗り潰し 800px）を超えないこと。
    //   超えると地形の間に隙間が空く。
    // ★小さくするほど地形が密に重なって険しく、大きくするほど間延びして
    //   なだらかに見える。同時に**1画面あたりの枚数＝通信量**も変わる。
    landform: { advanceMin: 420, advanceMax: 720 },

    // ── 植物 ────────────────────────────────────────────
    // every: 「見えている地形」N 枚につき1枚に植える（雲の every と同じ考え方）
    //        ★これが本数を決める一番効く摘み。使わないテーマは `WorldSpawnedObjects: null`。
    // count: 選ばれた1枚に植える本数（この範囲で毎回抽選）
    //
    // ★密度の目安：**地形1枚あたりの本数 ≒ (countMin + countMax) ÷ 2 ÷ every**
    //     every:4 / count 1〜2 → 0.375 本（＝地形 2.7 枚に1本）
    //     every:3 / count 1〜2 → 0.5   本（＝地形 2 枚に1本）
    //     every:1              → 全部の地形に植わり、1イベント100本超の密林になる
    //   1 にしないこと。3〜4 を目安に。
    // size : 描画後の幅（素材px）。素材の縦横比は保つので、細長い草と
    //        横広の茂みが同じ幅で並ぶ
    // sink : 地形の上端（稜線）から**下へ**何px のところに根元を置くか。
    //        ★0 に近づけると稜線から浮き、大きくすると地形に埋もれる。
    //          素材ごとに稜線の高さが違うので、実機を見ながら詰める値
    // ★横位置は幅いっぱいから自由に散らし、重なったときだけ引き直す。
    //   置き場所が見つからなかった1本は諦めるので、countMax を上げても
    //   際限なく詰まることはない（無理に詰めると結局くっついて見える）。
    // ★sink の幅を狭くすると、同じ地形の2本が同じ高さに並んで横一列に見える。
    //   ある程度は開けておくこと。
    WorldSpawnedObjects: { every: 3, countMin: 1, countMax: 2,
             sizeMin: 280, sizeMax: 560, sinkMin: 150, sinkMax: 430 },

    // ── 気象 ────────────────────────────────────────────
    // 素材が無いテーマは null。★フォルダが空でも null と同じ扱いになる。
    phenomenon: null,

    // ── 雲 ──────────────────────────────────────────────
    // every: 地形 N 枚につき1つ出す（大きいほどまばら）
    // speed: 画面を横切りきるのにかかる秒数の範囲。大きいほどゆっくり
    // dir  : 'rtl'（右→左）/ 'ltr'（左→右）/ 'both'（1つずつ抽選）
    // size : 描画後の幅（素材px）
    // sky  : 地形の上端から**上へ**何px のところに浮かべるか
    //
    // ★このテーマで雲を出したくないときは **`cloud: null`** と書く。
    //   （`dir: null` や `every: 0` でも止まるが、意図が読み取れる null に揃える。
    //     植物を使わないテーマの `phenomenon: null` と同じ書き方）
    //   影の濃さ・ぼかしは CSS 側（_mountain.css の --cloud-shadow-*）。
    //
    // ★雲は地形の**裏**を流れる。手前に出すと道とマスに被って読みにくくなる。
    // ★動く要素は合成レイヤーを増やす。総数の上限は mountainPath.js の MAX_DRIFT。
    cloud: { every: 5, speed: [90, 160], dir: 'rtl',
             sizeMin: 520, sizeMax: 900, skyMin: 200, skyMax: 900 },
  },

  {
    id: 'WindyMeadow',
    // ★「風」のテーマなので地形は間隔を広めに取り、雲を多く・速く流す。
    landform: { advanceMin: 460, advanceMax: 760 },
    WorldSpawnedObjects: { every: 3, countMin: 1, countMax: 2,
             sizeMin: 240, sizeMax: 520, sinkMin: 160, sinkMax: 470 },
    phenomenon: null,
    cloud: { every: 3, speed: [55, 100], dir: 'both',
             sizeMin: 460, sizeMax: 820, skyMin: 150, skyMax: 1000 },
  },

  {
    id: 'SnowyMountain',
    // ★雪山。地形をやや詰めて険しく見せる。草木は生えないので
    //   WorldSpawnedObjects フォルダを空にしてある（設定も null）。
    landform: { advanceMin: 400, advanceMax: 700 },
    WorldSpawnedObjects: null,
    phenomenon: null,
    // 空気が澄んでいる想定で、雲は少なめ・ゆっくり
    cloud: { every: 6, speed: [110, 190], dir: 'rtl',
             sizeMin: 500, sizeMax: 880, skyMin: 250, skyMax: 1100 },
  },
];

/** テーマ設定を id で引く。未知の id は null（呼び出し側で読み飛ばす） */
export function themeConfig(id) {
  return BG_THEMES.find(t => t.id === id) || null;
}
