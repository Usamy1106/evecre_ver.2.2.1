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
const SCALE_MIN   = 0.5;   // いちばん奥での倍率
const SCALE_RANGE = 0.5;   // 1.0 - SCALE_MIN
// ★薄くしすぎないこと。完了マスは「登ってきた道」の記録なので、奥が見えなく
//   なると達成感が削がれる。0.35 を下限にしてある。
const OPACITY_MIN   = 0.35;  // いちばん奥での不透明度
const OPACITY_RANGE = 0.65;  // 1.0 - OPACITY_MIN

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

const NODE_GAP   = 88;  // マス間の縦間隔(px)
const TOP_PAD    = 96;  // 山頂マーカー分の上余白(px)
const BOTTOM_PAD = 56;  // スタート地点の下余白(px)
// ── 道の曲がり方 ──────────────────────────────────────────
// 左右に振れる道だが、折れ線ではなく正弦カーブで滑らかに曲げる
// （Duolingo の学習パスと同じ見え方）。
// ★ARC_NODES は「弧ひとつぶんのマス数」＝半周期。4 なら
//   中央 → 右端 → 中央 → 左端 → 中央 で 8 マス一巡になる。
// ★X_CENTER ± X_AMPLITUDE が振れ幅。以前の折れ線（32%〜68%）と同じ幅に
//   合わせてあるので、道が画面外へはみ出すことはない。
const X_CENTER    = 50;
const X_AMPLITUDE = 18;
const ARC_NODES   = 4;

/** i 番目（小数可）のマスの x 座標（%）。道の描画では小数の i も使う */
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

// 小さな山＋旗の山頂マーカー（インラインSVG）
function _summitSvg(size = 44) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none">
      <path d="M6 40 L24 10 L42 40 Z" fill="#8A9BB8"/>
      <path d="M24 10 L30 20 L27 18 L24 21 L21 18 L18 20 Z" fill="#FDFBF8"/>
      <line x1="24" y1="10" x2="24" y2="1" stroke="#484545" stroke-width="2"/>
      <path d="M24 1 L33 4 L24 7 Z" fill="#EE3E12"/>
    </svg>`;
}

/**
 * 背景レイヤー（画面全体のビジュアル本体）。メインタブのときだけ描画する。
 * top はヘッダー高に依存するため initMountainPathSync が実測でセットする。
 * @param {object} p イベント（flat 形式）
 */
export function renderMountainBg(p) {
  const { missionCount, cleared, clearedCount, n, canvasH, xFor, yFor } = _layout(p);
  const stage = _skyStage(p);

  // 道（マスを結ぶ破線。マスが無い場合はスタート→山頂の直線）
  // ★マスの位置だけを結ぶと、カーブが折れ線に見えてしまう。マスとマスの間も
  //   同じ式で刻んで点を打ち、なめらかな弧として描く。
  const points = [];
  if (n > 1) {
    const STEP = 1 / 8;   // マス1つぶんを8分割
    for (let t = 0; t <= n - 1 + 1e-9; t += STEP) {
      const i = Math.min(t, n - 1);
      points.push(`${_xAt(i).toFixed(2)},${(canvasH - BOTTOM_PAD - i * NODE_GAP).toFixed(1)}`);
    }
  } else {
    points.push(`${X_CENTER},${canvasH - BOTTOM_PAD}`);
  }
  points.push(`${X_CENTER},${TOP_PAD - 30}`); // 最後は山頂へ
  const trail = `
    <svg class="p-mountain__trail" viewBox="0 0 100 ${canvasH}" preserveAspectRatio="none">
      <polyline points="${points.join(' ')}" fill="none" stroke="#C9CDD1" stroke-width="3"
        stroke-dasharray="1 7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;

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
    // ★色だけで状態を分けない。完了にはチェックのアイコンも入れる
    const circle = isDone
      ? `<div class="p-mountain__node p-mountain__node--cleared">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
         </div>`
      : `<div class="p-mountain__node"></div>`;

    // ★data-node-y はスクロール時の遠近計算が読む。毎フレーム DOM から
    //   位置を読み直さずに済むよう、描画時に確定した値を持たせておく
    //   （読み取りと書き込みを混ぜるとレイアウトスラッシングが起きる）。
    return `
      <div class="p-mountain__pin" data-node-y="${y}" style="left:${x}%;top:${y}px">
        ${circle}${objHtml}
      </div>`;
  }).join('');

  // 山頂（ゴール）とスタート
  const summit = `
    <div class="p-mountain__pin p-mountain__pin--center p-mountain__summit" style="top:${TOP_PAD - 84}px">
      ${_summitSvg()}
      <p class="p-mountain__summit-label">${_esc(p.name || '')}</p>
    </div>`;
  const start = `
    <div class="p-mountain__pin p-mountain__pin--center p-mountain__start" style="top:${canvasH - BOTTOM_PAD + 34}px">スタート</div>`;

  const emptyHint = missionCount === 0
    ? `<p class="p-mountain__pin p-mountain__pin--center p-mountain__empty" style="top:220px">ミッションを作ると<br>山頂への道が伸びていきます</p>`
    : '';

  return `
    <!-- ★top はヘッダー＋タブの実測高に合わせて initMountainPathSync が設定する -->
    <div id="mountain-bg" class="p-mountain${stage ? ` p-mountain--${stage}` : ''}" style="top:110px">
      <div id="mountain-canvas" class="p-mountain__canvas" style="height:${canvasH}px">
        ${_renderBgLayer(p, canvasH)}
        ${trail}
        ${summit}
        ${nodes}
        ${start}
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
  const pins = Array.from(canvas.querySelectorAll('[data-node-y]'))
    .map(el => ({ el, y: parseFloat(el.dataset.nodeY) || 0 }));

  // 画面の寸法はスクロール中に変わらない。ここで測って使い回す
  // （毎フレーム getBoundingClientRect を呼ぶと読み書きが交互になる）。
  let bgTop = 0, viewH = 1;
  const measure = () => {
    bgTop = bg.getBoundingClientRect().top;
    viewH = Math.max(1, window.innerHeight || 640);
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
      const dist = viewH - screenY;                 // 下端からの距離
      // 0=手前（画面下端）〜 1=奥。★倍率と透過を同じ t から出す。
      //   ループを分けないこと（マスの数だけ走るので2周させない）。
      const t = Math.min(1, Math.max(0, dist / viewH));
      const scale   = Math.max(SCALE_MIN,   1 - t * SCALE_RANGE);
      const opacity = Math.max(OPACITY_MIN, 1 - t * OPACITY_RANGE);
      // ★translate(-50%, -50%) は CSS 側が持つ。ここは倍率だけ渡して合成させる
      //   （transform をまるごと書くと中央寄せが消える）。
      //   opacity も transform と同じく GPU 合成されるので追加コストは小さい。
      pins[i].el.style.setProperty('--node-scale', scale.toFixed(3));
      pins[i].el.style.setProperty('--node-opacity', opacity.toFixed(3));
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
  // 初回は rAF を待たずに描く（1フレーム分マスが素の大きさで見えるのを防ぐ）
  paint();
}

// 前回の配線を外すための後始末。initMountainPathSync が毎回呼ぶ。
let _teardownFns = [];
function _teardown() {
  for (const fn of _teardownFns) { try { fn(); } catch (_) {} }
  _teardownFns = [];
}
