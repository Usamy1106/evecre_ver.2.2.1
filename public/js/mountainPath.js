// ===== 山登りパスビジュアル（メインボード）=====
// プラント成長表示の後継。デュオリンゴの道UIを参考に、下から上へ円形マスがジグザグに
// 増えていく「山登りの道」を描く。
//
// 構成（★ビジュアルは画面全体・スクロール操作は上部領域のみ）：
// - 背景レイヤー `#mountain-bg`（position:fixed、ヘッダー/タブの下〜画面下端、z-0）に
//   道キャンバス `#mountain-canvas`（全マス分の縦長）を描画。メインタブのコンテンツ
//   （日付/お知らせ=上部固定、提案/ミッション=下部パネル、いずれも z-10 以上）の裏側で
//   画面全体に見える。
// - スクロール窓 `#mountain-path-scroll`（上部の透明領域）＝キャンバスと同じ高さのスペーサーを
//   持つだけの「スクロール操作の受け皿」。scroll イベントで背景キャンバスを translateY 同期する
//   （ネイティブ慣性がそのまま効く）。下部パネルが被さった領域はパネル側のスクロールになる。
//
// ★マスは「完了したミッションの数」だけ並び、その先に灰色のマスが1つだけ出る。
//   ＝1つ完了すると1マス色がつき、次の1マスが現れる。
//   ★未完了ミッションが何個あっても、先に見えるマスは常に1つだけ。残り全体の長さを
//     見せないことで、ミッションを追加しても「後退した」ように見えない構造にしてある。
//   ★したがってマスとミッション一覧は1対1で対応しない（意図的）。タップ不可・タイトル無し。
//
// 初期表示は最上部（山頂＝道の先端）。再レンダリングをまたぐスクロール位置保持は
// mainBoard.js が capture → initMountainPathSync(restoreTop) で復元する。

// ── 遠近感 ────────────────────────────────────────────────
// 手前（画面下）ほど大きく、奥（画面上）ほど小さく見せる。
// ★基準点は「画面下端」に固定する。画面中央を基準にすると、スクロール中に
//   マスが一度縮んでから膨らむ動きになり酔いやすい。下端基準なら
//   「手前が大きく、奥ほど小さい」が常に保たれる。
// 大きさの遠近。★手前は等倍より大きく、奥は思い切り小さくする。
//   SCALE_MAX を上げすぎるとマスが縦に重なる。上限の目安は
//   NODE_GAP ÷（--node-size × --node-squash）＝ 72 ÷ (104 × .55) ≒ 1.26。
const SCALE_MAX = 1.20;   // いちばん手前での倍率
const SCALE_MIN = 0.16;   // いちばん奥での倍率
// ★遠近の効き方のカーブ。1 で直線、大きいほど「手前は大きいまま、奥で一気に
//   小さくなる」。実際の遠近はこの形なので、直線より奥行きが強く見える。
const DEPTH_CURVE = 1.8;
// ★薄くしすぎないこと。完了マスは「登ってきた道」の記録なので、奥が見えなく
//   なると達成感が削がれる。0.35 を下限にしてある。
const OPACITY_MIN   = 0.05;  // いちばん奥での不透明度（ほぼ消える）
const OPACITY_RANGE = 0.95;  // 1.0 - OPACITY_MIN
// ★薄まり方は大きさと別のカーブにする。DEPTH_CURVE より小さい値にすると
//   早い段階から薄くなり、奥がしっかり霞む。大きさは保ったまま透明度だけ
//   落としたいので、ここは 1 前後にしてある。
const OPACITY_CURVE = 1.5;
// ★画面上端の帯。ここに入ったマスは追加でフェードさせ、上から「にじみ出る」
//   ように現れる。遠近だけだと、上端で急に切り取られたように見えてしまう。
const FADE_IN_BAND = 120;    // 上端からこの高さ(px)でフェードイン

// ★仮想化のしきい値。可視範囲 ±1画面ぶんの外にあるマスは毎フレームの
//   書き込み対象から外す。実データは最大でも数十マスなので、いまは
//   「書き込みを間引く」ところまで。DOM から抜く実装は要らなくなるまで入れない
//   （抜くと道の破線 SVG との対応が崩れ、復帰時のちらつき対策も要る）。
const CULL_MARGIN = 1;     // 画面高の何倍まで面倒を見るか

import { findObject } from './mountainObjects.js';
// ★素材の一覧は自動生成。ファイル名・拡張子・パスをこのファイルに書かないこと
//   （素材を足すたびに手で直すことになる）。URL の組み立ても bgUrl に任せる。
import { BG_ASSETS, BG_SHARED, bgUrl } from './mountainAssets.generated.js';
import { BG_THEMES } from './mountainThemes.js';

// ── 背景セグメント ────────────────────────────────────────
// 背景は「1枚の絵を、手前（下）の1枚の裏へ 22.2% 潜り込ませて重ねる」ことで
// 継ぎ目なく上へ繋がっていく。素材側がその重なりを前提に描かれている。
//
//   素材 2048 × 3600
//     └ 下 800px（22.2%）＝ 重ねしろ。次の1枚がこのぶん裏に隠れる
//     └ 送り 2800px（77.8%）＝ 1枚ぶん進む量
//
// ★手前（画面下）のセグメントが**上に重なる**こと。逆にすると重ねしろが
//   表に出て継ぎ目が見える。z-index で下のセグメントほど手前にしている。
// ★セグメントの高さと位置は CSS が幅から算出する（aspect-ratio と
//   translateY の %）。JS で px を計算すると、端末幅ごとに実描画の高さが
//   変わるため必ずずれる。JS が決めるのは「何枚出すか」と「どの絵か」だけ。
// ★かつては「マス数 × NODE_GAP」でセグメント高を決め、境界をマスと一致させて
//   いた。境界にクロスフェードの線が見えるためだったが、重ねて繋ぐ今は
//   境界そのものが無いので、その制約は外した（SEGMENT_MASSES は廃止）。
//   ★戻さないこと。固定すると画像を縦へ 12〜34% 歪めることになる
//     （端末幅ごとに実描画の高さが変わるため）。
// ── パーツから組み立てる背景 ──────────────────────────────
// 背景は完成した1枚絵ではなく、**地形（landform）のパーツを下から積み上げて**作る。
// 素材の一覧は `mountainAssets.generated.js`（自動生成）、テーマごとの積み方は
// `mountainThemes.js`（手書きの調整ファイル）が持つ。ここは物理法則だけを持つ。
//
//   素材 2049 × (1481 / 1781 / 2241)
//     └ 下 800px ＝ 塗り潰しの余白。次の1枚をこの範囲内に重ねるかぎり
//                   高さがバラバラでも隙間が出ない
//
// ★座標系は「素材px」ひとつ。画面pxへの変換は CSS の `--art-unit` が一手に担う。
//   JS で端末pxを計算すると、320px 端末と 430px 端末で景色が変わり
//   「全メンバーが同じ景色を見る」が壊れる。JS が決めるのは
//   「どの絵を・素材px でどこに置くか」だけ。
// ★手前（画面下）のパーツが**上に重なる**こと。逆にすると重ねしろが表に出て
//   継ぎ目が見える（1枚絵だった頃と同じ原則）。
// ★これは「設計上の幅」であって、素材の書き出し解像度ではない。
//   素材が何px 幅で書き出されていても、この幅に正規化してから配置する
//   （_artHeight）。だから解像度を下げても景色は1ミリも変わらない。
//   ★逆に、この値を変えると advance / sink / 雲の大きさなど art px で書いた
//     設定がすべてずれる。**触らないこと。**
const ART_W = 2049;        // 座標系の基準幅
// 地形素材は下 LF_OVERLAP px が塗り潰しの余白になっている。次の地形を
// この範囲内で重ねるかぎり、素材の高さ（1481/1781/2241）に関わらず隙間が出ない。
// ★テーマ設定の advanceMax がこの値を超えないこと（超えると地形の間が抜ける）。
const LF_OVERLAP = 800;
// ★何枚ごとにテーマを替えるか。小さくすると景色がころころ変わって落ち着かず、
//   大きくすると登っても代わり映えしない。隣り合う帯には必ず違うテーマが入る。
const THEME_RUN = 14;
// ★1イベントで積むパーツ数の上限。素材1枚が平均 247KB なので、
//   ここを上げると通信量とメモリが素直に増える。実際に必要な枚数は
//   キャンバスの高さから決まり、たいていこの上限には届かない。
const MAX_PARTS = 60;
// ★植物を植えるのは「実際に見えている地形」だけ。手前の地形に隠れて
//   ほとんど出ていない地形に植えても、正しく隠れて見えないまま DOM だけ増える。
const PLANT_MIN_STRIP = 200;   // 見えている帯がこれ未満（素材px）の地形には植えない
// ★植物の総数の上限。1本ずつは軽い SVG だが、要素数が増えるとスクロールの
//   合成コストが効いてくる。0.5CPU 環境が基準。
const MAX_PLANTS = 120;
// ★植物の横位置を引き直す回数。等分スロットに1本ずつ置く方式は「左・中・右」に
//   きれいに並んで横一列に見えたので、幅いっぱいから引いて重なりだけ避ける方式にした。
//   上げすぎると、狭い場所へ無理に押し込んで結局くっついて見える。
const PLANT_TRIES = 8;
// 植物どうしの最低すき間（素材px）。0 にすると葉が触れて1本の茂みに見える
const PLANT_GAP = 60;
// ★横に流れる要素（雲）の総数の上限。**ここを上げないこと。**
//   transform のアニメーション中は合成レイヤーに昇格するので、数がそのまま
//   メモリと合成コストになる。0.5CPU / 512MB 環境が基準。
const MAX_DRIFT = 6;

// ── 山頂の看板 ────────────────────────────────────────────
// 開催の最終日以降だけ、積み上げた地形のいちばん上に立てる。
// ★横位置は中央固定（抽選しない）。山頂は1つしかない目印なので、
//   イベントごとに左右へ動くと「頂上に着いた」感じが薄れる。
// ★絵そのものは CSS 変数（foundation/_variables.css の --summit-board-N）。
//   ここに置くのは「何種類あるか」だけ。ファイル名を手書きの JS に書かないこと。
const SUMMIT_BOARD_COUNT = 2;
// 看板の幅（素材px）と、最上段の地形の上端からどれだけ下げて立てるか。
// ★下げないと空中に浮いて見える。地形に少し刺さっているほうが自然。
const SUMMIT_W = 1100;
const SUMMIT_SINK = 420;
// 標高＝完了ミッション数 × これ。マスの数と一致させてある
const METERS_PER_CLEAR = 100;

/** どちらの看板を立てるか。★イベントIDから決定的に決める（全メンバーが同じ絵を見る） */
function _pickSummitBoard(eventId) {
  const i = (_hash(`${eventId}:summit`) % SUMMIT_BOARD_COUNT) + 1;
  return `var(--summit-board-${i})`;
}

// ★マス間の縦間隔。狭めるほど手前に多くのマスが並ぶ。
//   マスの見た目の高さ（--node-size × --node-squash ＝ 約64px）より
//   小さくすると重なるので、下げすぎないこと。
const NODE_GAP   = 86;
const TOP_PAD    = 96;  // 道の先端より上に取る余白(px)。★山頂マーカーも山頂背景も撤去済みだが、
                        //   先端のマスがキャンバス上端に貼り付かないようにこの余白は残す。
// ★下端の余白。マスがここより下には来ない。
//   #mainboard-bottom-panel（通常 top:62vh）の裏にいちばん下のマスが
//   潜り込まないよう、パネルの高さぶんの逃げを取ってある。狭めないこと。
const BOTTOM_PAD = 393;
// ★下部パネルの上端に乗っている波の装飾（images/front/…svg）の高さ。
//   パネルの矩形上端より上に波が張り出すぶん、実際にマスが隠れ始める高さが
//   変わる。遠近の基準帯と初期スクロールの両方でこのぶんを補正する。
//   ★CSS の --panel-wave-h と必ず同じ値にすること（片方だけ変えるとずれる）。
//   補正は波の中心線（高さの半分）で取る。谷と山の平均がいちばん破綻しない。
const PANEL_WAVE_H = 38;

// ★いちばん新しいマスを、下部パネルのどれだけ上まで持ってこられるようにするか。
//   スクロールを最後まで送ったとき、最新のマスがここに来る。
//   これが無いとスクロールが上限に当たり、最新のマスが画面中ほどの小さいまま
//   止まってしまう（＝手前の大きさで見られない）。
const NEAR_MARGIN = 56;
// ── 道の曲がり方 ──────────────────────────────────────────
// 左右に振れる道を正弦カーブで滑らかに曲げる。
// ★ARC_NODES は「弧ひとつぶんのマス数」＝半周期。6 なら
//   中央 → 右端 → 中央 → 左端 → 中央 で 12 マス一巡になる（値を上げるほど緩い）。
// ★X_CENTER ± X_AMPLITUDE が手前での振れ幅。
const X_CENTER    = 50;
const X_AMPLITUDE = 28;   // 24%〜76%。マスの幅を足しても画面内に収まる
const ARC_NODES   = 5;

// ★振れ幅は「画面のどこにいるか」で決まる。画面下ほど大きく振れ、
//   上へ行くほど中央に寄る（大きさ・不透明度と同じ軸で遠近を作る）。
//   AMP_MIN は画面上端での倍率。
//   ★キャンバス上の位置ではなく画面位置で決めるので、スクロールすると
//     マスは横にも動く。paint() の中で毎フレーム計算する。
const AMP_MIN = 0.22;

/** i 番目のマスの x 座標（%）。これは画面下端にいるときの位置 */
function _xAt(i) {
  return X_CENTER + X_AMPLITUDE * Math.sin((Math.PI * i) / ARC_NODES);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// マス列とキャンバス寸法（背景・スクロール窓で共有）
// ★n は「完了数 + 1」。ミッション数ではない（先に見えるマスは常に1つだけ）。
function _layout(p) {
  const missions = p.missions || [];
  // ★完了した順ではなく作成順に並べる。完了のたびに既存のマスが入れ替わると
  //   「登ってきた道」が作り直されてしまう。
  const cleared = missions
    .filter(m => m.status === 'cleared')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const clearedCount = cleared.length;
  const n = clearedCount + 1;   // 完了マス + 1個先の灰色マス
  const canvasH = Math.max(
    (typeof window !== 'undefined' ? window.innerHeight : 640) - 120, // 画面全体に見せる最低高
    TOP_PAD + Math.max(n - 1, 0) * NODE_GAP + BOTTOM_PAD + 44,
  );
  const xFor = i => _xAt(i);
  const yFor = i => canvasH - BOTTOM_PAD - i * NODE_GAP;
  return { missionCount: missions.length, cleared, clearedCount, n, canvasH, xFor, yFor };
}

/**
 * 山頂に着いているか。
 *
 * ★「開催の最終日を迎えたら、進み具合に関わらず必ず山頂を出す」。
 *   完了数で決めないのは、片付けの段階に入ったチームに「まだ着いていない」と
 *   言っても仕方がないため（フェーズの自動遷移と同じ考え方）。
 * ★最終日「当日」から出す（過ぎてからではない）。その日が登り切る日なので。
 * ★開催日が未設定なら出さない（基準が無い）。
 * @param {object} p flat 形式のイベント
 */
function _isSummit(p) {
  const dates = Array.isArray(p?.dates) ? [...p.dates].filter(Boolean).sort() : [];
  const last = dates.at(-1);
  if (!last) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return today >= last;
}

/**
 * 背景で覆いきる必要のある高さ（素材px）。
 *
 * ★実際の配置は CSS（--art-unit）なので、ここは「どこまで積めば足りるか」だけを出す。
 *   足りないと上端に背景の無い帯ができるが、余っても切られるだけで害はない。
 * ★幅を 448px（アプリ幅の上限 --layout-max-width）で頭打ちにする。
 *   実際の幅がこれより狭ければ1枚あたりの見かけの送りが小さくなり、
 *   必要な高さは増える＝必ず足りる側に倒れる。
 */
function _needTopArt(canvasH) {
  const w = Math.min((typeof window !== 'undefined' ? window.innerWidth : 400) || 400, 448);
  const viewH = (typeof window !== 'undefined' ? window.innerHeight : 640) || 640;
  const unit = w / ART_W;              // 素材1px が画面で何px になるか
  // キャンバスぶん＋1画面ぶん（headroom で下へずらす量の逃げ）
  return (canvasH + viewH) / unit;
}

/**
 * 文字列 → 32bit の非負整数（FNV-1a）。
 * ★暗号用途ではない。「同じ入力なら必ず同じ出力」であればよい。
 */
function _hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 決定的な整数の抽選（[min, max] の両端を含む）。
 * ★Math.random() を使わないこと。同じ seed なら誰がいつ見ても同じ値になる。
 */
function _rndInt(seed, min, max) {
  if (!(max > min)) return min;
  return min + (_hash(seed) % (max - min + 1));
}

/**
 * 山札から count 枚を配る。**同じキーが2回続かない**ように取る。
 *
 * ★保存しない。seedBase（イベントIDなど）から決定的に導出する。
 *   - DB に持たせないので CRDT の管理対象が増えず、同時完了の競合も起きない
 *   - 既存イベントにも遡って適用されるので移行処理が要らない
 *   - 全メンバー・全デバイスで必ず同じ結果になる
 * ★Math.random() / Date.now() / ユーザーID / 完了時刻 / **完了数**を混ぜないこと。
 *   完了数を混ぜると、1つ完了しただけで山全体が作り直される。
 * ★独立ハッシュ（_hash(id:k) % 残り枚数）で毎回引く方式に戻さないこと。
 *   1枚も出ない素材や、同じ絵が3回出るイベントが実際にできた（実測）。
 *
 * @param {Array} cards   配る対象
 * @param {string} seedBase
 * @param {number} count
 * @param {(c:any)=>string} keyOf 「同じ」とみなす基準（テーマIDや色）
 * @param {string|null} prevKey 直前に出たキー（帯をまたいで続けるときに渡す）
 */
function _dealDeck(cards, seedBase, count, keyOf, prevKey = null) {
  const out = [];
  if (!Array.isArray(cards) || cards.length === 0) return out;
  let deck = [];
  let cycle = 0;
  const draw = () => _shuffleDeck(cards, `${seedBase}:${cycle++}`);

  for (let k = 0; k < count; k++) {
    // ★山札が尽きたら切り直す。1巡で全部が必ず1回ずつ出るので出番が偏らない。
    if (deck.length === 0) deck = draw();

    let idx = deck.findIndex(c => keyOf(c) !== prevKey);
    if (idx < 0) {
      // ★山札の残りが全部「直前と同じキー」だった場合。ここを手当てしないと、
      //   1巡の切れ目でだけ同じものが2回続く（実測で発生した）。
      deck = deck.concat(draw());
      idx = deck.findIndex(c => keyOf(c) !== prevKey);
      if (idx < 0) idx = 0;   // 候補が1種類しか無いときだけ
    }
    const pick = deck.splice(idx, 1)[0];
    out.push(pick);
    prevKey = keyOf(pick);
  }
  return out;
}

/**
 * 素材の高さを ART_W（設計上の幅）に正規化する。
 *
 * ★これがあるおかげで、**書き出し解像度を自由に変えられる**。
 *   2049px 幅で書き出しても 900px 幅で書き出しても、縦横比が同じなら
 *   まったく同じ景色になる（配置の計算は正規化後の値だけを使う）。
 * ★解像度を下げるのは通信量とデコード量を減らすため。1枚のデコード量は
 *   幅の2乗に効くので、900px にすると約1/5になる。
 * ★植物と雲は「描画後の幅」を設定で決め、高さは w:h の比から出しているので、
 *   もともと解像度に依存しない（ここを通す必要は無い）。
 */
function _artHeight(a) {
  return a.w > 0 ? Math.round(a.h * ART_W / a.w) : a.h;
}

/** 設定と素材が両方そろっているテーマだけを使う（片方だけのものは黙って飛ばす） */
function _usableThemes() {
  return BG_THEMES.filter(t => (BG_ASSETS[t.id]?.landform || []).length > 0);
}

/**
 * 地形を下から積む計画を立てる。
 *
 * 座標 y は**キャンバス下端からの素材px**。パーツ k の下端が y_k、上端が y_k + h_k。
 * 次のパーツは「前の下端から advance px 上」に置く。advance ≤ LF_OVERLAP なので、
 * 各パーツの下 LF_OVERLAP px（塗り潰しの余白）が途切れずに繋がり、
 * 素材の高さがバラバラでも隙間が出ない。
 *
 * ★needTopArt はパーツの**枚数**にしか影響しない。k 番目の中身は eventId と k だけで
 *   決まるので、ミッションが完了してキャンバスが伸びても既存のパーツは動かない
 *   （上に足されるだけ）。ここを崩すと1つ完了するたびに山全体が変わる。
 * ★テーマは THEME_RUN 枚ごとの帯で交代し、隣り合う帯は必ず違うテーマになる。
 */
function _landformPlan(eventId, needTopArt) {
  const themes = _usableThemes();
  if (themes.length === 0) return [];

  // 帯の並び。★MAX_PARTS ぶんを賄えるだけ用意する（needTopArt に依存させない）
  const bands = _dealDeck(themes, `${eventId}:band`, Math.ceil(MAX_PARTS / THEME_RUN) + 1, t => t.id);

  const parts = [];
  let y = 0;
  let prevKey = null;   // ★色の連続を帯をまたいで避ける（色が無いテーマは通し番号で代用）

  for (let b = 0; b < bands.length; b++) {
    const theme = bands[b];
    const list = BG_ASSETS[theme.id].landform;
    // ★seed に帯の番号 b を必ず入れる。テーマIDだけだと、同じテーマが再登場した
    //   帯で**まったく同じ並び**が繰り返される（bands.indexOf で書いて踏んだ）。
    // ★「同じ色」はテーマの中でだけ意味を持つ。色サフィックスは全テーマ共通の
    //   a / b / c なので、テーマ名で修飾しないと「MorningMeadow の b」と
    //   「WindyMeadow の b」が同じ色とみなされ、帯の境目で無関係に候補が弾かれる。
    const colorKey = (a) => `${theme.id}:${a.c || a.n}`;
    const picks = _dealDeck(list, `${eventId}:lf:${b}`, THEME_RUN, colorKey, prevKey);

    for (const a of picks) {
      // ★手前の地形の上端より上にはみ出したぶんが、この地形の見える帯。
      //   高さがバラバラなので、送りが小さいと丸ごと隠れる地形も出る（想定内）。
      const prev = parts.at(-1);
      // ★素材の実ピクセルではなく、ART_W に正規化した高さで配置する
      const h = _artHeight(a);
      const strip = prev ? (y + h) - (prev.y + prev.h) : h;
      parts.push({ theme: theme.id, file: a.f, v: a.v, y, h, strip });
      prevKey = colorKey(a);
      // ★覆いきったら止める。塗り潰しの余白の上端まで届いていれば隙間は出ない
      if (y + LF_OVERLAP >= needTopArt) return parts;
      if (parts.length >= MAX_PARTS) return parts;
      y += _rndInt(`${eventId}:adv:${parts.length}`,
        theme.landform.advanceMin, Math.min(theme.landform.advanceMax, LF_OVERLAP));
    }
  }
  return parts;
}

/**
 * 決定的にシャッフルした山札を作る（Fisher-Yates）。
 * ★Math.random() を使わないこと。イベントIDと巡目だけから決まるので、
 *   全メンバーで必ず同じ並びになり、リロードでも変わらない。
 */
function _shuffleDeck(cards, seed) {
  const d = cards.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = _hash(`${seed}:${i}`) % (i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/**
 * どの地形に何を植えるかを決める。
 *
 * ★「地形1枚ごとに植える」のは**やめた**（1イベントで100本を超え、密林になった）。
 *   まず「実際に見えている地形」を候補として洗い出し、そこから `every` 枚おきに選ぶ。
 *   ★`every` で間引くのは候補の側。生の通し番号 k で間引くと、選ばれた地形が
 *     たまたま隠れていたときに長い区間まるごと植物が消える。
 *
 * ★横位置は**自由に散らす**。等分したスロットに1本ずつ置く方式は、重なりこそ
 *   起きないが「左・中・右」にきれいに並んで**横一列に見える**（実際にそうなって
 *   作り直した）。ここでは幅いっぱいから候補を引き、既に置いたものと重なったら
 *   別の候補を引き直す。決定的なハッシュから引くので結果は毎回同じ。
 * ★縦位置も1本ごとに散らす。同じ地形の2本が同じ高さに並ぶと、それだけで
 *   「横並び」に見えてしまう。
 * ★座標は地形の要素の中（左下が原点）。親と一緒に動くので、
 *   稜線から浮くことが原理的に起きない。
 *
 * @returns {Map<number, Array>} 地形の添字 → その地形に植える植物
 */
function _plantingPlan(eventId, parts) {
  const out = new Map();

  // 候補＝「素材があるテーマ」かつ「実際に見えている」地形
  const cands = [];
  for (let k = 0; k < parts.length; k++) {
    const theme = BG_THEMES.find(t => t.id === parts[k].theme);
    const cfg = theme?.WorldSpawnedObjects;
    if (!cfg || !(cfg.every > 0)) continue;
    if ((BG_ASSETS[parts[k].theme]?.WorldSpawnedObjects || []).length === 0) continue;
    // ★ほとんど隠れている地形に植えても、正しく隠れて見えないまま DOM が増える
    if (parts[k].strip < PLANT_MIN_STRIP) continue;
    cands.push({ k, cfg });
  }

  let budget = MAX_PLANTS;
  for (let i = 0; i < cands.length; i++) {
    const { k, cfg } = cands[i];
    if (i % cfg.every !== 0) continue;      // ★候補の並びで間引く
    if (budget <= 0) break;

    const part = parts[k];
    const list = BG_ASSETS[part.theme].WorldSpawnedObjects;
    const count = Math.min(_rndInt(`${eventId}:pc:${k}`, cfg.countMin, cfg.countMax), budget);
    if (count <= 0) continue;

    const picks = _dealDeck(list, `${eventId}:pl:${k}`, count, x => x.n);
    const placed = [];

    for (let j = 0; j < picks.length; j++) {
      const x0 = picks[j];
      const w = _rndInt(`${eventId}:pw:${k}:${j}`, cfg.sizeMin, cfg.sizeMax);
      const h = Math.max(1, Math.round(w * x0.h / x0.w));
      const sink = _rndInt(`${eventId}:ps:${k}:${j}`, cfg.sinkMin, cfg.sinkMax);
      const y = Math.max(0, part.h - sink);

      // ★重ならない位置が見つかるまで引き直す。見つからなければその1本は諦める
      //   （無理に詰めると等分スロットと同じ「並んだ」見た目に戻る）。
      let x = -1;
      for (let t = 0; t < PLANT_TRIES; t++) {
        const cand = _rndInt(`${eventId}:px:${k}:${j}:${t}`, 0, Math.max(0, ART_W - w));
        const hit = placed.some(q => cand < q.x + q.w + PLANT_GAP && q.x < cand + w + PLANT_GAP);
        if (!hit) { x = cand; break; }
      }
      if (x < 0) continue;

      placed.push({ file: x0.f, v: x0.v, x, y, w, h });
    }

    if (placed.length === 0) continue;
    out.set(k, placed);
    budget -= placed.length;
  }
  return out;
}

/**
 * 横に流れる要素（雲）を決める。
 *
 * ★地形の**裏**を流れる（z を地形の間に差し込む）。手前に出すと道とマスに被る。
 * ★総数は MAX_DRIFT まで。候補が多いときは間引くが、下から順ではなく
 *   山全体に散らす（下だけ賑やかで上が空になるのを避ける）。
 * ★開始位相を負の animation-delay でずらす。これが無いと全部の雲が
 *   同じタイミングで画面を横切り、作り物に見える。
 * ★動きの向きは JS が --cl-x0 / --cl-x1（素材px）で渡し、CSS は1つの
 *   @keyframes で両方向を賄う。向きごとに keyframes を分けないこと。
 */
function _driftPlan(eventId, parts) {
  const list = BG_SHARED.cloud || [];
  if (list.length === 0) return [];

  // どの地形に添えるかの候補を先に洗い出す
  const cands = [];
  for (let k = 0; k < parts.length; k++) {
    const cfg = BG_THEMES.find(t => t.id === parts[k].theme)?.cloud;
    if (!cfg || !cfg.dir || !(cfg.every > 0)) continue;
    if (k % cfg.every !== 0) continue;
    cands.push({ k, cfg });
  }
  if (cands.length === 0) return [];

  // ★上限を超えるときは等間隔で間引く（山全体に散らす）
  const step = Math.max(1, Math.ceil(cands.length / MAX_DRIFT));
  const chosen = cands.filter((_, i) => i % step === 0).slice(0, MAX_DRIFT);

  const picks = _dealDeck(list, `${eventId}:cl`, chosen.length, a => a.n);

  return chosen.map(({ k, cfg }, i) => {
    const a = picks[i];
    const part = parts[k];
    const w = _rndInt(`${eventId}:cw:${k}`, cfg.sizeMin, cfg.sizeMax);
    const h = Math.max(1, Math.round(w * a.h / a.w));
    // 地形の上端から上へ。素材px なので端末幅によらず同じ高さに浮かぶ
    const y = part.y + part.h + _rndInt(`${eventId}:cy:${k}`, cfg.skyMin, cfg.skyMax);

    const rtl = cfg.dir === 'rtl' || (cfg.dir === 'both' && _rndInt(`${eventId}:cd:${k}`, 0, 1) === 1);
    // 画面の外から外へ抜けきる。ART_W が入れ物の幅（素材px）
    const x0 = rtl ? ART_W : -w;
    const x1 = rtl ? -w : ART_W;

    const dur = _rndInt(`${eventId}:cs:${k}`, cfg.speed[0], cfg.speed[1]);
    // ★負の delay で開始位相をずらす。0〜1周ぶんの範囲で散らす
    const delay = -_rndInt(`${eventId}:cp:${k}`, 0, Math.max(1, dur - 1));

    return { k, file: a.f, v: a.v, y, w, h, x0, x1, dur, delay, z: 2 * (parts.length - k) - 1 };
  });
}

// ── 読み込み ──────────────────────────────────────────────
// ★地形は <img> ではなく **background-image** で敷く。ここは何度も失敗して
//   戻ってきた設計なので、変えるときは経緯を読むこと：
//
//   1. `<img loading="lazy">` … キャンバスは position:fixed のコンテナの中で
//      transform で動かしているため、端末によっては lazy が発火せず
//      **マスだけ出て絵が1枚も出ない**。
//   2. JS で「見えているぶんだけ eager にする」… 解放しないとデコード済み
//      ビットマップが積み上がり（1枚 約12.8MB）、**スクロール中にタブごと落ちる**。
//   3. 枚数に上限を付けて範囲外を解放 … 今度は**解放したところが白く抜ける**。
//
//   → background-image なら、ブラウザが「描画するときだけラスタライズし、
//     画面外のデコード結果は自分で捨てる」。上限管理も lazy の発火判定も要らない。
//     1枚絵だった頃はこの方式で問題が出ていなかった。
//
// ★代償：全パーツの画像を取りに行く（1イベントあたり最大 10MB 前後）。
//   `immutable` 配信なので2回目以降はネットワークに出ないが、初回は重い。
//   **減らす正しい手当ては素材の解像度を下げること**（表示幅は最大 448px なのに
//   素材は 2049px ＝ 約4.6倍の過剰解像度。900px 幅にすれば通信もデコードも約1/5）。
// ★<img> に戻さないこと。上の1〜3をもう一度踏むことになる。

// ── 背景 DOM の使い回し ───────────────────────────────────
// ★mainBoard.js は再描画のたび container.innerHTML を丸ごと差し替える。背景は
//   <img> が 100 個以上あるので、素直に作り直すと毎回すべて再取得・再デコードされ、
//   一瞬白くなる（0.5CPU 環境では体感できるほど遅い）。
//   中身が変わっていなければ、DOM ごと元の要素に差し戻す。
// ★効くのは2つの場面：
//   1. SSE の再描画（同じ画面のまま作り直される）
//   2. **ミッション詳細など他のページから戻ってきたとき**。退避を持ち続けるので、
//      戻った瞬間に既に読み込み済みの絵がそのまま出る（＝背景が遅れて現れない）
// ★流れている雲のアニメーションも途切れずに済む（作り直すと毎回先頭に戻る）。
let _bgKeep = null;

/**
 * 今の背景を退避する。innerHTML を差し替える**前**と、描画し終えた**後**に呼ぶ。
 * ★背景が見つからないときは、前の退避をそのまま持ち続ける。
 *   他のページを開いている間は #mountain-bg が DOM に無いので、ここで捨てると
 *   「戻ってきたときに使い回す」が成立しない。
 */
export function captureBgLayer() {
  const el = document.querySelector('#mountain-bg .p-mountain__bg-layer');
  if (el && el.dataset.bgSig) _bgKeep = { sig: el.dataset.bgSig, el };
}

/** 差し替えた**後**に呼ぶ。署名が同じなら退避した背景に戻す */
export function restoreBgLayer() {
  const keep = _bgKeep;
  if (!keep) return;
  const fresh = document.querySelector('#mountain-bg .p-mountain__bg-layer');
  if (!fresh) return;
  if (fresh.dataset.bgSig !== keep.sig) {
    _bgKeep = null;               // ★中身が変わった。抱え込まずに手放す
    return;
  }
  fresh.replaceWith(keep.el);
}

/**
 * 背景（積み上げた地形）のマークアップ。
 *
 * ★#mountain-canvas の内側・最背面に置く。別レイヤーにして別々に translate
 *   すると、サブピクセルの丸めや rAF のタイミング差で必ずマスとずれる。
 *   キャンバスの transform 1つで背景もマスも同時に動くので、ずれが原理的に起きない。
 * ★位置と大きさは CSS が --art-unit（素材1px の画面px）を掛けて決める。
 *   JS が渡すのは素材px の数値だけ。ここで画面px を計算しないこと。
 * ★下（手前）ほど z-index を大きくする。DOM 順のままだと後に描かれる上のパーツが
 *   手前に来て、重ねしろが表に出て継ぎ目が見える。
 *   ★z を 2 刻みにしてあるのは、雲や気象をパーツの**間**に差し込めるようにするため。
 * ★<img> で出す（background-image では loading="lazy" が効かない）。
 *   画面外のぶんはブラウザがデコード済みビットマップを捨てられる。
 */
function _renderBgLayer(p, canvasH, isSummit, clearedCount) {
  const parts = _landformPlan(String(p?.id || ''), _needTopArt(canvasH));
  const n = parts.length;

  const eventId = String(p?.id || '');
  const planting = _plantingPlan(eventId, parts);

  const lf = parts.map((pt, k) => {

    // ★植物は地形の**子**にする。親と一緒に動くので稜線から浮かない。
    //   座標は地形の中（左下が原点）なので、地形の位置計算とは独立している。
    //   ★どの地形に植えるかは _plantingPlan がまとめて決める（地形1枚ごとではない）。
    const plantHtml = (planting.get(k) || []).map(pl => `
        <img class="p-mountain__plant" src="${bgUrl(pt.theme, 'WorldSpawnedObjects', pl.file, pl.v)}" alt=""
          loading="lazy" decoding="async" fetchpriority="low"
          style="--pl-x:${pl.x};--pl-y:${pl.y};--pl-w:${pl.w};--pl-h:${pl.h}">`).join('');

    // ★地形の絵はこの <div> の background-image。<img> にしないこと（上の経緯を参照）。
    //   位置と大きさを持つこの入れ物が、そのまま植物の親にもなる
    //   （入れ物ごと動くので、植物が稜線からずれることが原理的に起きない）。
    return `
      <div class="p-mountain__lf"
        style="--lf-y:${pt.y};--lf-h:${pt.h};--lf-img:url('${bgUrl(pt.theme, 'landform', pt.file, pt.v)}');z-index:${2 * (n - k)}">
        ${plantHtml}
      </div>`;
  }).join('');

  // ★山頂。開催の最終日以降だけ、積み上げた地形のいちばん上に**看板**を立てる。
  //   ★地形はそのまま（専用の1枚絵は使わない）。最後の地形が山頂に見える。
  //   ★横位置は中央固定。ここだけは抽選しない（山頂は1つしかない目印なので、
  //     イベントごとに左右へ動くと「頂上に着いた」感じが薄れる）。
  //   ★どちらの看板が出るかはイベントIDから決定的に決める。全メンバーが同じ絵を見る。
  //   ★ここまでスクロールで登れるよう、initMountainPathSync が上端の余白（headroom）
  //     を広げている。片方だけ直すと看板が永久に画面へ入らない。
  const topY = parts.length ? parts[n - 1].y + parts[n - 1].h : 0;
  // 最上段の地形の稜線あたりに立てる。少し下げて、地形に刺さって見えるようにする
  const summitY = Math.max(0, topY - SUMMIT_SINK);
  let summitHtml = '';
  if (isSummit) {
    const board = _pickSummitBoard(eventId);
    // 標高＝完了ミッション数 × 100m。マスの数と一致するので「ここまで登ってきた」が伝わる
    const meters = clearedCount * METERS_PER_CLEAR;
    summitHtml = `
      <div class="p-mountain__summit" style="--lf-y:${summitY};--summit-img:${board};z-index:${2 * n + 1}">
        <p class="p-mountain__summit-title">${_esc(p?.name || 'イベント')}山頂</p>
        <p class="p-mountain__summit-alt">${meters}m</p>
      </div>`;
  }
  const summit = summitHtml;

  // ★雲は地形と同じ入れ物（bg-layer）に、地形の**間**の z で差し込む。
  //   地形の子にすると、親の高さで切られたり親ごと transform されたりして
  //   「山と一緒にスクロールしつつ、横に流れる」が両立しない。
  const clouds = _driftPlan(eventId, parts).map(c => `
      <img class="p-mountain__cloud" src="${bgUrl(null, 'cloud', c.file, c.v)}" alt=""
        loading="lazy" decoding="async" fetchpriority="low"
        style="--cl-y:${c.y};--cl-w:${c.w};--cl-h:${c.h};--cl-x0:${c.x0};--cl-x1:${c.x1};--cl-dur:${c.dur}s;--cl-delay:${c.delay}s;z-index:${c.z}">`).join('');

  // ★署名。SSE の再描画で「中身が同じなら DOM ごと使い回す」判定に使う
  //   （captureBgLayer / restoreBgLayer）。背景の中身を決める入力を全部含めること。
  const sig = `${eventId}:${n}:${isSummit ? 1 : 0}`;

  return {
    html: `<div class="p-mountain__bg-layer" data-bg-sig="${sig}">${lf}${clouds}${summit}</div>`,
    summitY,
  };
}

/**
 * そのミッションで出たオブジェクトを引く。
 * ★保存先は submissions（clearedData）。ミッション本体（CRDT）には持たせていない。
 *   個別完了は `<missionId>_u_<userId>` の複合キーで人数分あるので、
 *   代表として自分のぶん → 無ければ最初に見つかったものを使う。
 */
function _objectFor(p, mission) {
  if (!mission) return null;
  const cd = p.clearedData || {};
  let rec = cd[mission.id];
  if (!rec?.objectId && mission.individualClear) {
    const prefix = `${mission.id}_u_`;
    const mine = cd[`${prefix}${(typeof window !== 'undefined' && window.state?.currentUser?.id) || ''}`];
    rec = mine?.objectId ? mine
        : Object.entries(cd).find(([k, v]) => k.startsWith(prefix) && v?.objectId)?.[1];
  }
  return rec?.objectId ? findObject(rec.objectId) : null;
}

/**
 * 背景レイヤー（画面全体のビジュアル本体）。メインタブのときだけ描画する。
 * top はヘッダー高に依存するため initMountainPathSync が実測でセットする。
 * @param {object} p イベント（flat 形式）
 */
export function renderMountainBg(p, opts = {}) {
  const { missionCount, cleared, clearedCount, n, canvasH, xFor, yFor } = _layout(p);
  const isSummit = _isSummit(p);
  const bg = _renderBgLayer(p, canvasH, isSummit, clearedCount);

  // ★ミッション完了の演出。完了すると clearedCount が 1 増えるので、
  //   「今しがた色がついたマス」＝ clearedCount - 1、「新しく現れた灰色のマス」＝ n - 1。
  //   データ側は既にこの形になっているので、ここは印を付けるだけでよい。
  //   演出を出さないときは -1（どのマスにも一致しない）。
  const popIdx    = opts.celebrate && clearedCount > 0 ? clearedCount - 1 : -1;
  const appearIdx = opts.celebrate ? n - 1 : -1;

  // マス（★装飾のみ。タップ不可・タイトル無し）
  // 下から順に「完了したぶん」を塗り、いちばん上の1つだけ灰色（＝次の1マス）にする。
  // ★背景としてだけ見せるモード（アーカイブ・通知タブ）。景色だけを出し、
  //   マス（道）は出さない。マスの遠近は paint() が毎フレーム書くもので、
  //   スクロール窓の無いタブでは配線されず、等倍・不透明のまま並んでしまう。
  const backdrop = !!opts.backdrop;

  const nodes = backdrop ? '' : Array.from({ length: n }, (_, i) => {
    const x = xFor(i);
    const y = yFor(i);
    const isDone = i < clearedCount;
    // ★完了したマスの横に、そのミッションで出たオブジェクトを置く。
    //   何を完了したかが景色として残る。抽選はサーバーが完了時に1回だけ行い、
    //   結果は clearedData（submissions）に入っている。ここは読むだけ。
    const obj = isDone ? _objectFor(p, cleared[i]) : null;
    // 道の外側（中央から遠い側）へ置く。道やマスと重ならないようにするため
    const objHtml = obj
      ? `<span class="p-mountain__object${x < X_CENTER ? ' p-mountain__object--left' : ''}${i === popIdx ? ' p-mountain__object--pop' : ''}"
             role="img" aria-label="${_esc(obj.name)}" title="${_esc(obj.name)}">${obj.icon}</span>`
      : '';
    // ★円盤（傾ける）とチェック（傾けない）を分けている。1つにまとめると
    //   チェックまで潰れて斜めになり、読めなくなる。
    // 完了の演出。★アニメーションを載せるのは円盤（子）であって .p-mountain__pin ではない。
    //   pin の transform は paint() が毎フレーム --node-scale / --node-dx で書き換えるので、
    //   ここで transform を持つアニメーションを付けると遠近と喧嘩して跳ねる。
    const pop    = i === popIdx    ? ' p-mountain__node--pop'    : '';
    const appear = i === appearIdx ? ' p-mountain__node--appear' : '';
    const disc = `<div class="p-mountain__node${isDone ? ' p-mountain__node--cleared' : ''}${pop}${appear}"></div>`;
    const check = isDone
      ? `<svg class="p-mountain__check${i === popIdx ? ' p-mountain__check--pop' : ''}" width="32" height="32" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : '';

    // ★data-node-y はスクロール時の遠近計算が読む。毎フレーム DOM から
    //   位置を読み直さずに済むよう、描画時に確定した値を持たせておく
    //   （読み取りと書き込みを混ぜるとレイアウトスラッシングが起きる）。
    // ★data-node-dx は「中央からのずれ幅（%）」。paint() が画面位置に応じて
    //   これを縮め、奥ほど中央へ寄せる。毎フレーム DOM を読まずに済ませるため
    //   描画時に持たせておく。
    return `
      <div class="p-mountain__pin" data-node-y="${y}" data-node-dx="${(x - X_CENTER).toFixed(2)}"
        style="left:${x}%;top:${y}px">
        ${disc}${check}${objHtml}
      </div>`;
  }).join('');

  // ★プログレスマップの上には文字もイラストも置かない。
  //   山頂のイラストとイベント名、下端の「スタート」はいずれも撤去した。
  //   背景イラストの上に載ると読みづらく、地図としても情報が増えすぎるため。

  const emptyHint = (!backdrop && missionCount === 0)
    ? `<p class="p-mountain__pin p-mountain__pin--center p-mountain__empty" style="top:220px">ミッションを作ると<br>山頂への道が伸びていきます</p>`
    : '';

  return `
    <!-- ★top はヘッダー＋タブの実測高に合わせて initMountainPathSync が設定する -->
    <!-- ★data-summit は initMountainPathSync が読む（山頂までスクロールできるよう
         上端の余白を広げるため）。JS から再判定せず、描画時の結果を渡す。 -->
    <div id="mountain-bg" class="p-mountain${backdrop ? ' p-mountain--backdrop' : ''}" style="top:110px"
      data-summit="${isSummit ? '1' : '0'}" data-summit-y="${bg.summitY}">
      <div id="mountain-canvas" class="p-mountain__canvas" style="height:${canvasH}px">
        ${bg.html}
        ${nodes}
        ${emptyHint}
      </div>
      <!-- ★お試し：画面上ほど白くかすませて奥行きを出すレイヤー。
           キャンバスの**外**に置くこと。中に入れるとスクロールで一緒に動いてしまい、
           「画面の上ほど」ではなく「道の上ほど」になる（＝スクロールすると霞が流れる）。
           キャンバスより後に置いてあるので、背景もマスもまとめて霞ませる。
           不要になったらこの1行と _mountain.css の .p-mountain__haze を消すだけ。 -->
      <div class="p-mountain__haze" aria-hidden="true"></div>
    </div>`;
}

/**
 * スクロール窓（透明・上部領域を埋める flex-1）。中身はキャンバスと同じ高さのスペーサーのみ。
 * このウィンドウ内のスクロールで山を遡れる（下部パネルが被さった領域はパネル側のスクロール）。
 */
export function renderMountainScrollWindow(p) {
  const { canvasH } = _layout(p);
  return `
    <div id="mountain-path-scroll" class="p-mountain__scroll u-no-scrollbar">
      <!-- ★スクロール量を決めるスペーサー。initMountainPathSync が上端の余白
           （headroom）ぶんを足して高さを書き換えるので、目印を消さないこと。 -->
      <div data-mtn-spacer style="height:${canvasH}px"></div>
    </div>`;
}

/**
 * レンダリング後の配線（mainBoard.js から呼ぶ）：
 * - 背景レイヤーの top をヘッダー/タブの実測高に合わせる
 * - スクロール窓の scroll → 背景キャンバスの translateY 同期
 * @param {number|null} restoreTop 再レンダリング前のスクロール位置（null なら最上部＝道の先端）
 */
/**
 * 背景としてだけ見せるときの配線（アーカイブ・通知タブ）。
 *
 * スクロール窓が無いので initMountainPathSync は使えない（先頭で return する）。
 * ここでやるのは2つだけ：
 *   - ヘッダー＋タブの実測下端に合わせて top を置く
 *   - 素材px → 画面px の換算（--art-unit）を実測で書く
 * ★スクロールもマスも無いので、paint() もリスナーも要らない。
 *   ここに毎フレームの処理を足さないこと（背景は動かない）。
 */
export function syncMountainBackdrop() {
  const bg = document.getElementById('mountain-bg');
  const canvas = document.getElementById('mountain-canvas');
  if (!bg || !canvas) return;

  const sticky = document.querySelector('#app .js-mountain-sticky')
              || document.querySelector('.js-mountain-sticky');
  if (sticky) bg.style.top = `${Math.round(sticky.getBoundingClientRect().bottom)}px`;

  // ★CSS にも初期値はあるが、448〜640px の幅では実際の幅と食い違う
  //   （--layout-max-width が 100% から 448px に切り替わる境目）。実測で上書きする。
  const w = bg.getBoundingClientRect().width || canvas.clientWidth || 0;
  if (w > 0) canvas.style.setProperty('--art-unit', `${w / ART_W}px`);
}

export function initMountainPathSync(restoreTop = null) {
  // ★前回の配線を必ず外す。この関数は再描画のたびに呼ばれるので、
  //   window に張ったリスナーが積み上がる（scroll は要素と一緒に消えるが
  //   resize / orientationchange は残る）。
  _teardown();

  const bg     = document.getElementById('mountain-bg');
  const canvas = document.getElementById('mountain-canvas');
  const win    = document.getElementById('mountain-path-scroll');
  if (!bg || !canvas || !win) return;

  // ヘッダー＋タブ（sticky ラッパー）の直下から画面全体に敷く。
  // ★offsetHeight（要素の高さ）ではなく getBoundingClientRect().bottom（画面上の実位置）を使う。
  //   standalone では viewport-fit=cover によりステータスバー領域が加わるため、
  //   「高さ」と「下端の位置」が一致しない場合がある。
  // ★目印は js-mountain-sticky（views/mainBoard.js のヘッダー＋タブのラッパー）。
  //   以前は Tailwind の .sticky を掴んでいたため、ユーティリティを外した瞬間に
  //   山の上端がずれる状態だった。スタイルではなく JS フック用のクラスを見ること。
  const sticky = document.querySelector('#app .js-mountain-sticky')
              || document.querySelector('.js-mountain-sticky');
  if (sticky) bg.style.top = `${Math.round(sticky.getBoundingClientRect().bottom)}px`;

  // ── 毎フレームの書き込み対象を先に集める ──────────────────
  // ★ここでまとめて読み、以後スクロール中は一切読まない。
  const pins = Array.from(canvas.querySelectorAll('[data-node-y]')).map(el => ({
    el,
    y: parseFloat(el.dataset.nodeY) || 0,
    // 中央からのずれ幅（%）。奥へ行くほどこれを縮めて中央に寄せる
    dx: parseFloat(el.dataset.nodeDx) || 0,
  }));

  // 画面の寸法はスクロール中に変わらない。ここで測って使い回す
  // （毎フレーム getBoundingClientRect を呼ぶと読み書きが交互になる）。
  // ★キャンバス上端に足す余白。スクロールを最後まで送ったときに、いちばん新しい
  //   マスが下部パネルのすぐ上（＝いちばん手前・いちばん大きい位置）まで下りてくる量。
  //   canvas ごと下へずらすので、背景もマスも一緒に動く＝ずれない。
  const spacer  = win.querySelector('[data-mtn-spacer]');
  const canvasH = parseFloat(canvas.style.height) || canvas.offsetHeight || 0;

  let bgTop = 0, viewH = 1, canvasW = 0, depthBottom = 1, depthSpan = 1, headroom = 0;
  const measure = () => {
    const r = bg.getBoundingClientRect();
    bgTop = r.top;
    // 振れ幅を px で出すのに要る（data-node-dx は % のため）
    canvasW = r.width || canvas.clientWidth || 0;
    viewH = Math.max(1, window.innerHeight || 640);
    // ★遠近の基準は「実際に見えている帯」＝ヘッダー下端 〜 下部パネル上端。
    //   画面全体を基準にすると、いちばん手前の倍率はパネルの裏でしか出ず、
    //   見えている範囲は中途半端な大きさばかりになる。
    const pTop = _panelVeilTop(viewH);
    depthBottom = (pTop > bgTop + 40) ? pTop : viewH;
    depthSpan = Math.max(1, depthBottom - bgTop);

    // ★上端の余白は実測から決める。「スクロールを送りきったとき、いちばん最後の
    //   **完了済み**マスがパネルのすぐ上に来る」ぶんだけキャンバスを下へずらす。
    //   ★先頭（いちばん上）のマスは「次にやる灰色の1マス」で、まだ完了していない。
    //     そこを基準にすると、最後の完了マスがパネルの裏に隠れてしまう。
    //   ここは初回と resize のときだけ書く（スクロール中には書かない）。
    const targetY = _lastClearedY(pins);
    headroom = Math.max(0, Math.round((depthBottom - NEAR_MARGIN) - bgTop - targetY));

    // ★山頂が出ているときは、そこまでスクロールで登れるように上端の余白を広げる。
    //   山頂の絵はキャンバス上端より「送り（画像高の77.8%）」ぶん上に立っている。
    //   この余白が足りないと、絵は敷かれているのに永久に画面へ入らない。
    //   ★幅は実測（canvasW）を使う。素材は幅いっぱいに伸縮されるので、
    //     端末ごとに必要な余白が変わる。
    // ★山頂の絵はキャンバス上端より上へはみ出す。その分だけ余白を足さないと、
    //   絵は敷かれているのに永久に画面へ入らない。
    //   高さは実測する（素材の縦横比を JS に書かないため）。背景画像＋aspect-ratio
    //   なので、画像の読み込みを待たずにレイアウトは確定している。
    const summitEl = bg.querySelector('.p-mountain__summit');
    if (summitEl && canvasW > 0) {
      const unit = canvasW / ART_W;
      const summitTop = (+bg.dataset.summitY || 0) * unit + summitEl.getBoundingClientRect().height;
      headroom += Math.max(0, Math.round(summitTop - canvasH));
    }

    // ★素材px → 画面px の換算はこの1変数に集約する。**ここ（初回と resize）でだけ書く。**
    //   paint() に足すと毎フレーム全パーツのレイアウトが起きて確実に落ちる。
    // ★幅が測れなかったときは**書かない**。0 を入れると全ての地形が
    //   height:0 / bottom:0 になり、マスだけ残して**背景が丸ごと消える**。
    //   CSS 側に初期値（画面幅から算出）があるので、書かなければそちらが効く。
    //   必ずフェールセーフの向きにすること。
    if (canvasW > 0) canvas.style.setProperty('--art-unit', `${canvasW / ART_W}px`);

    canvas.style.marginTop = `${headroom}px`;
    if (spacer && canvasH) spacer.style.height = `${canvasH + headroom}px`;
  };
  measure();

  // ── 1フレーム1回だけ書く ─────────────────────────────────
  // ★scroll ハンドラから直接 DOM を触らない。iOS の慣性スクロールは
  //   1フレームに何度も scroll を発火させるため、そのまま書くと確実に落ちる。
  let scheduled = false;
  const paint = () => {
    scheduled = false;
    const top = win.scrollTop;

    // 道全体を動かすのは transform だけ（レイアウトを起こさない）
    canvas.style.transform = `translateY(${-top}px)`;

    // マスの遠近。画面下端からの距離で倍率を決める
    const margin = viewH * CULL_MARGIN;
    for (let i = 0; i < pins.length; i++) {
      // ★canvas は headroom ぶん下にずれているので、画面上の位置にも足す
      const screenY = bgTop + headroom + (pins[i].y - top);
      // 可視範囲 ±1画面の外は書かない（見えないものに毎フレーム書かない）
      if (screenY < -margin || screenY > viewH + margin) continue;
      // 0=手前（帯の下端＝パネルの上）〜 1=奥（帯の上端）。
      // ★倍率・透過・振れ幅を同じ t から出す。ループを分けないこと
      //   （マスの数だけ走るので2周させない）。
      const t = Math.min(1, Math.max(0, (depthBottom - screenY) / depthSpan));
      // ★カーブをかける。手前は大きいまま保ち、奥で一気に落とす
      const d = Math.pow(t, DEPTH_CURVE);
      const scale = Math.max(SCALE_MIN, SCALE_MAX - d * (SCALE_MAX - SCALE_MIN));
      // 遠近ぶんの薄さ。★大きさとは別のカーブ（奥をより霞ませる）
      const od = Math.pow(t, OPACITY_CURVE);
      let opacity = Math.max(OPACITY_MIN, 1 - od * OPACITY_RANGE);
      // ★上端の帯でさらに薄くする。★基準は画面の上端ではなく山の上端（bgTop）。
      //   山はヘッダーの下から始まるので、そこから にじみ出るように現れる。
      const fromTop = screenY - bgTop;
      if (fromTop < FADE_IN_BAND) {
        opacity *= Math.min(1, Math.max(0, fromTop / FADE_IN_BAND));
      }
      // ★振れ幅も同じ t から。画面下ほど大きく振れ、上へ行くほど中央に寄る。
      //   横位置は left（レイアウト）ではなく transform で動かす。
      const amp = AMP_MIN + (1 - AMP_MIN) * (1 - d);
      const dx = -(1 - amp) * (pins[i].dx / 100) * canvasW;
      // ★translate(-50%, -50%) は CSS 側が持つ。ここは倍率・ずらし量・透過だけを
      //   渡して合成させる（transform をまるごと書くと中央寄せが消える）。
      //   どれも GPU 合成されるので追加コストは小さい。
      pins[i].el.style.setProperty('--node-scale', scale.toFixed(3));
      pins[i].el.style.setProperty('--node-opacity', opacity.toFixed(3));
      pins[i].el.style.setProperty('--node-dx', `${dx.toFixed(1)}px`);
    }
  };
  const request = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(paint);
  };

  const onResize = () => { measure(); request(); };
  win.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  _teardownFns = [
    () => win.removeEventListener('scroll', request),
    () => window.removeEventListener('resize', onResize),
    () => window.removeEventListener('orientationchange', onResize),
  ];

  if (restoreTop !== null) win.scrollTop = restoreTop;
  else win.scrollTop = _initialScrollTop(win, pins, bgTop + headroom, viewH);

  // 初回は rAF を待たずに描く（1フレーム分マスが素の大きさで見えるのを防ぐ）
  paint();
}

/**
 * 「見えている帯」の下端＝下部パネルに隠され始める高さ。
 *
 * ★パネルの矩形上端そのものではなく、波の中心線を返す。パネルの背景は
 *   上端に波の装飾が乗っており、矩形上端はいちばん高い所ではないため、
 *   矩形上端をそのまま使うと帯を波1つぶん狭く見積もることになる。
 * @param {number} fallback パネルが無いときの値（＝画面下端）
 */
function _panelVeilTop(fallback) {
  const panel = document.getElementById('mainboard-bottom-panel');
  if (!panel) return fallback;
  return panel.getBoundingClientRect().top + PANEL_WAVE_H / 2;
}

/**
 * スクロールで手前まで持ってきたいマスの y。
 *
 * ★いちばん上のマスは「次にやる灰色の1マス」（未完了）。そこを基準にすると
 *   最後の完了マスがパネルの裏に隠れるので、**その1つ下（＝最後の完了マス）**を
 *   基準にする。完了が0件のときは灰色の1マスしかないので、それを使う。
 * @param {Array<{y:number}>} pins DOM 順（i 昇順＝下から上）
 */
function _lastClearedY(pins) {
  if (pins.length === 0) return 0;
  const i = pins.length >= 2 ? pins.length - 2 : pins.length - 1;
  return pins[i].y;
}

/**
 * 初回表示のスクロール位置。
 *
 * ★いちばん新しいマス（＝次にやる灰色の1マス）を、下部パネルより上の
 *   「見えている帯」の中に入れる。これを入れないとマスがキャンバスの
 *   最下部に置かれたままで、下部パネル（#mainboard-bottom-panel、通常 top:62vh）
 *   の裏に完全に隠れてしまう。
 * ★測るのはここ1回だけ。スクロール中には測らない。
 */
function _initialScrollTop(win, pins, bgTop, viewH) {
  if (pins.length === 0) return 0;
  // 見えている帯の下端＝下部パネルの上端（無ければ画面下端）
  const panelTop = _panelVeilTop(viewH);
  const visibleBottom = Math.min(viewH, panelTop > bgTop ? panelTop : viewH);
  // 帯の下寄り（62%）に置く。真ん中だと上に無駄な空きが出て、
  // 下端ちょうどだとパネルの縁に接して窮屈に見える
  const target = bgTop + (visibleBottom - bgTop) * 0.62;
  const max = Math.max(0, (win.scrollHeight || 0) - (win.clientHeight || 0));
  return Math.min(max, Math.max(0, Math.round(bgTop + _lastClearedY(pins) - target)));
}

// 前回の配線を外すための後始末。initMountainPathSync が毎回呼ぶ。
let _teardownFns = [];
function _teardown() {
  for (const fn of _teardownFns) { try { fn(); } catch (_) {} }
  _teardownFns = [];
}
