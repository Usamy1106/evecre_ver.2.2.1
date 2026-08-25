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
const SCALE_MIN = 0.20;   // いちばん奥での倍率
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
const OPACITY_CURVE = 1.1;
// ★画面上端の帯。ここに入ったマスは追加でフェードさせ、上から「にじみ出る」
//   ように現れる。遠近だけだと、上端で急に切り取られたように見えてしまう。
const FADE_IN_BAND = 140;    // 上端からこの高さ(px)でフェードイン

// ★仮想化のしきい値。可視範囲 ±1画面ぶんの外にあるマスは毎フレームの
//   書き込み対象から外す。実データは最大でも数十マスなので、いまは
//   「書き込みを間引く」ところまで。DOM から抜く実装は要らなくなるまで入れない
//   （抜くと道の破線 SVG との対応が崩れ、復帰時のちらつき対策も要る）。
const CULL_MARGIN = 1;     // 画面高の何倍まで面倒を見るか

import { findObject } from './mountainObjects.js';
import { daysUntilSigned } from './utils.js';

// ── 空の時間変化 ──────────────────────────────────────────
// 開催日までの残り日数で空の段階が変わる。色は CSS のトークン
// （foundation/_variables.css）が持ち、ここではモディファイア名だけ決める。
// ★上から順に評価し、最初に当てはまったものを使う。段階を足すときはこの表に
//   1行入れて、_mountain.css に同名のモディファイアを書けばよい。
const SKY_STAGES = [
  { min:  60, mod: 'morning'   },  // 60日〜   朝（澄んだ青）
  { min:  30, mod: 'noon'      },  // 30〜59日 昼
  { min:  14, mod: 'afternoon' },  // 14〜29日 午後
  { min:   7, mod: 'evening'   },  //  7〜13日 夕方
  { min:   1, mod: 'dusk'      },  //  1〜6日  薄暮
  { min: -Infinity, mod: 'summit' }, // 開催日当日以降 山頂に日が差す
];

// ── 背景セグメント ────────────────────────────────────────
// 一定マスごとに背景のテーマが変わる。
//
// ★セグメントの高さは必ず「マス数 × NODE_GAP」で決める。画像の元の高さを
//   使うと、マス間隔と割り切れずに重ねるたび誤差が積もり、背景とマスがずれる。
// ★SEGMENT_MASSES を変えるだけで、高さ・境界位置・テーマの区切りが全部追従する。
//   704 や 8 をコード中に直書きしないこと。
// ★これを変えると既存イベントの背景の並びも変わる（区切りが動くため）。
const SEGMENT_MASSES = 8;

// テーマと素材。★variants に文字列を足すだけでバリエーションが増える。
//   文字列は CSS 変数の接尾辞（'01' → var(--mtn-bg-01)）。
//   ファイル名・拡張子は CSS 側（foundation/_variables.css）にしか無い。
const BG_THEMES = [
  { id: 1, variants: ['01'] },
  { id: 2, variants: ['02'] },
  { id: 3, variants: ['03'] },
  { id: 4, variants: ['04'] },
  { id: 5, variants: ['05'] },
  { id: 6, variants: ['06'] },
];

// ★マス間の縦間隔。狭めるほど手前に多くのマスが並ぶ。
//   マスの見た目の高さ（--node-size × --node-squash ＝ 約64px）より
//   小さくすると重なるので、下げすぎないこと。
const NODE_GAP   = 72;
const TOP_PAD    = 96;  // 山頂マーカー分の上余白(px)
// ★下端の余白。マスがここより下には来ない。
//   #mainboard-bottom-panel（初期 top:56vh）の裏にいちばん下のマスが
//   潜り込まないよう、パネルの高さぶんの逃げを取ってある。狭めないこと。
const BOTTOM_PAD = 150;
// ── 道の曲がり方 ──────────────────────────────────────────
// 左右に振れる道を正弦カーブで滑らかに曲げる。
// ★ARC_NODES は「弧ひとつぶんのマス数」＝半周期。6 なら
//   中央 → 右端 → 中央 → 左端 → 中央 で 12 マス一巡になる（値を上げるほど緩い）。
// ★X_CENTER ± X_AMPLITUDE が手前での振れ幅。
const X_CENTER    = 50;
const X_AMPLITUDE = 26;   // 24%〜76%。マスの幅を足しても画面内に収まる
const ARC_NODES   = 6;

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

// 1セグメントの高さ。★必ずこの計算値を使う（画像の元サイズを使わない）
const SEGMENT_HEIGHT = SEGMENT_MASSES * NODE_GAP;
// セグメント間のクロスフェード幅。マス1つぶん。境界を中心に上下へ広げる。
// ★この値は CSS にも要る（マスクの抜き幅）。JS を唯一の出どころにするため、
//   --seg-overlap として背景レイヤーに書き出し、CSS はそれを参照する。
const SEGMENT_OVERLAP = NODE_GAP;

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
 * セグメントごとの背景を決める。
 *
 * ★保存しない。イベントIDとセグメント番号から決定的に導出する。
 *   - DB に持たせないので CRDT の管理対象が増えず、同時完了の競合も起きない
 *   - 既存イベントにも遡って適用されるので移行処理が要らない
 *   - 全メンバー・全デバイスで必ず同じ結果になる
 * ★Math.random() / Date.now() / ユーザーID / 完了時刻を混ぜないこと。
 *   同じイベントの同じセグメントなら、いつ誰が見ても同じでなければならない。
 * ★直前と同じテーマは避ける。8マス（＝8ミッション完了）進んだのに景色が
 *   変わらないと、進んだ手応えが消えるため。避けても導出は決定的なまま。
 *
 * @param {string} eventId
 * @param {number} count 生成するセグメント数
 * @returns {Array<{ theme:number, variant:string }>}
 */
function _backgroundPlan(eventId, count) {
  const plan = [];
  let prev = null;
  for (let k = 0; k < count; k++) {
    const pool = (prev === null || BG_THEMES.length <= 1)
      ? BG_THEMES
      : BG_THEMES.filter(t => t.id !== prev);
    const theme = pool[_hash(`${eventId}:${k}:theme`) % pool.length];
    const variant = theme.variants[_hash(`${eventId}:${k}:variant`) % theme.variants.length];
    plan.push({ theme: theme.id, variant });
    prev = theme.id;
  }
  return plan;
}

/**
 * 背景セグメントのマークアップ。
 *
 * ★#mountain-canvas の内側・最背面に置く。別レイヤーにして別々に translate
 *   すると、サブピクセルの丸めや rAF のタイミング差で必ずマスとずれる。
 *   キャンバスの transform 1つで背景もマスも同時に動くので、ずれが原理的に起きない。
 * ★セグメント k の下端は「マス i = k × SEGMENT_MASSES」の y と厳密に一致する。
 *   起点をキャンバス上端（y=0）にすると TOP_PAD のぶんずれるので、
 *   必ず canvasH - BOTTOM_PAD（＝マス i=0 の y）から数える。
 */
function _renderBgLayer(p, canvasH) {
  const base = canvasH - BOTTOM_PAD;                       // マス i=0 の y
  const count = Math.max(1, Math.ceil(base / SEGMENT_HEIGHT));
  const plan = _backgroundPlan(String(p?.id || ''), count);
  const half = SEGMENT_OVERLAP / 2;

  const segs = plan.map((seg, k) => {
    const isFirst = k === 0;
    const isLast  = k === count - 1;
    // 素の範囲（境界はマスと厳密に一致する）
    const rawTop = base - (k + 1) * SEGMENT_HEIGHT;
    // クロスフェードのぶん上下へはみ出させる。★境界の位置自体はずらさない
    const top    = rawTop - (isLast ? 0 : half);
    const bottom = base - k * SEGMENT_HEIGHT + (isFirst ? BOTTOM_PAD : half);
    return `
      <div class="p-mountain__bg-seg${isFirst ? ' p-mountain__bg-seg--first' : ''}${isLast ? ' p-mountain__bg-seg--last' : ''}"
        style="--seg-image:var(--mtn-bg-${seg.variant});top:${Math.round(top)}px;height:${Math.round(bottom - top)}px"></div>`;
  }).join('');

  // 山頂の背景。★道の先端（山頂マーカーのあたり）に敷く。下端はぼかして繋ぐ
  const summit = `
    <div class="p-mountain__bg-summit"
      style="--seg-image:var(--mtn-bg-summit);height:${TOP_PAD + NODE_GAP}px"></div>`;

  return `<div class="p-mountain__bg-layer" style="--seg-overlap:${SEGMENT_OVERLAP}px">${segs}${summit}</div>`;
}

/**
 * 空の段階を返す（'morning' | 'noon' | … | 'summit'）。
 *
 * ★開催日が未設定なら null。モディファイアを付けず、既定（昼）のままにする。
 * ★残り日数は daysUntilSigned（utils.js）で取る。calculateDaysLeft と
 *   proposalEngine._daysUntil は Math.max(0,…) で負値を潰すため、
 *   「開催日を過ぎたか」を判定できない。
 * ★dates は未ソートで保存されるので、必ず並べ替えてから初日を取る。
 */
function _skyStage(p) {
  const dates = Array.isArray(p?.dates) ? [...p.dates].filter(Boolean).sort() : [];
  if (dates.length === 0) return null;
  const left = daysUntilSigned(dates[0]);
  if (left === null) return null;
  return (SKY_STAGES.find(s => left >= s.min) || SKY_STAGES[SKY_STAGES.length - 1]).mod;
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
export function renderMountainBg(p) {
  const { missionCount, cleared, clearedCount, n, canvasH, xFor, yFor } = _layout(p);
  const stage = _skyStage(p);

  // マス（★装飾のみ。タップ不可・タイトル無し）
  // 下から順に「完了したぶん」を塗り、いちばん上の1つだけ灰色（＝次の1マス）にする。
  const nodes = Array.from({ length: n }, (_, i) => {
    const x = xFor(i);
    const y = yFor(i);
    const isDone = i < clearedCount;
    // ★完了したマスの横に、そのミッションで出たオブジェクトを置く。
    //   何を完了したかが景色として残る。抽選はサーバーが完了時に1回だけ行い、
    //   結果は clearedData（submissions）に入っている。ここは読むだけ。
    const obj = isDone ? _objectFor(p, cleared[i]) : null;
    // 道の外側（中央から遠い側）へ置く。道やマスと重ならないようにするため
    const objHtml = obj
      ? `<span class="p-mountain__object${x < X_CENTER ? ' p-mountain__object--left' : ''}"
             role="img" aria-label="${_esc(obj.name)}" title="${_esc(obj.name)}">${obj.icon}</span>`
      : '';
    // ★円盤（傾ける）とチェック（傾けない）を分けている。1つにまとめると
    //   チェックまで潰れて斜めになり、読めなくなる。
    const disc = `<div class="p-mountain__node${isDone ? ' p-mountain__node--cleared' : ''}"></div>`;
    const check = isDone
      ? `<svg class="p-mountain__check" width="22" height="22" viewBox="0 0 24 24" fill="none"
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

  const emptyHint = missionCount === 0
    ? `<p class="p-mountain__pin p-mountain__pin--center p-mountain__empty" style="top:220px">ミッションを作ると<br>山頂への道が伸びていきます</p>`
    : '';

  return `
    <!-- ★top はヘッダー＋タブの実測高に合わせて initMountainPathSync が設定する -->
    <div id="mountain-bg" class="p-mountain${stage ? ` p-mountain--${stage}` : ''}" style="top:110px">
      <div id="mountain-canvas" class="p-mountain__canvas" style="height:${canvasH}px">
        ${_renderBgLayer(p, canvasH)}
        ${nodes}
        ${emptyHint}
      </div>
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
      <div style="height:${canvasH}px"></div>
    </div>`;
}

/**
 * レンダリング後の配線（mainBoard.js から呼ぶ）：
 * - 背景レイヤーの top をヘッダー/タブの実測高に合わせる
 * - スクロール窓の scroll → 背景キャンバスの translateY 同期
 * @param {number|null} restoreTop 再レンダリング前のスクロール位置（null なら最上部＝道の先端）
 */
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
  let bgTop = 0, viewH = 1, canvasW = 0, depthBottom = 1, depthSpan = 1;
  const measure = () => {
    const r = bg.getBoundingClientRect();
    bgTop = r.top;
    // 振れ幅を px で出すのに要る（data-node-dx は % のため）
    canvasW = r.width || canvas.clientWidth || 0;
    viewH = Math.max(1, window.innerHeight || 640);
    // ★遠近の基準は「実際に見えている帯」＝ヘッダー下端 〜 下部パネル上端。
    //   画面全体を基準にすると、いちばん手前の倍率はパネルの裏でしか出ず、
    //   見えている範囲は中途半端な大きさばかりになる。
    const panel = document.getElementById('mainboard-bottom-panel');
    const pTop = panel ? panel.getBoundingClientRect().top : viewH;
    depthBottom = (pTop > bgTop + 40) ? pTop : viewH;
    depthSpan = Math.max(1, depthBottom - bgTop);
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
      const screenY = bgTop + (pins[i].y - top);
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
  else win.scrollTop = _initialScrollTop(win, pins, bgTop, viewH);
  // 初回は rAF を待たずに描く（1フレーム分マスが素の大きさで見えるのを防ぐ）
  paint();
}

/**
 * 初回表示のスクロール位置。
 *
 * ★いちばん新しいマス（＝次にやる灰色の1マス）を、下部パネルより上の
 *   「見えている帯」の中に入れる。これを入れないとマスがキャンバスの
 *   最下部に置かれたままで、下部パネル（#mainboard-bottom-panel、初期 top:56vh）
 *   の裏に完全に隠れてしまう。
 * ★測るのはここ1回だけ。スクロール中には測らない。
 */
function _initialScrollTop(win, pins, bgTop, viewH) {
  if (pins.length === 0) return 0;
  // 見えている帯の下端＝下部パネルの上端（無ければ画面下端）
  const panel = document.getElementById('mainboard-bottom-panel');
  const panelTop = panel ? panel.getBoundingClientRect().top : viewH;
  const visibleBottom = Math.min(viewH, panelTop > bgTop ? panelTop : viewH);
  // 帯の下寄り（62%）に置く。真ん中だと上に無駄な空きが出て、
  // 下端ちょうどだとパネルの縁に接して窮屈に見える
  const target = bgTop + (visibleBottom - bgTop) * 0.62;
  const newestY = pins[pins.length - 1].y;   // DOM 順 = i 昇順なので最後が最新
  const max = Math.max(0, (win.scrollHeight || 0) - (win.clientHeight || 0));
  return Math.min(max, Math.max(0, Math.round(bgTop + newestY - target)));
}

// 前回の配線を外すための後始末。initMountainPathSync が毎回呼ぶ。
let _teardownFns = [];
function _teardown() {
  for (const fn of _teardownFns) { try { fn(); } catch (_) {} }
  _teardownFns = [];
}
