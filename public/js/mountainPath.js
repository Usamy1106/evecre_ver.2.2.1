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
// ★円形マスはミッションと連動しない装飾：タップ不可・タイトル無し。ただしマス数はミッション数に
//   応じて増え、完了ミッション相当のマスは塗りつぶしで進捗が分かる。
//
// 初期表示は最上部（山頂＝道の先端）。再レンダリングをまたぐスクロール位置保持は
// mainBoard.js が capture → initMountainPathSync(restoreTop) で復元する。

const NODE_GAP   = 88;  // マス間の縦間隔(px)
const TOP_PAD    = 96;  // 山頂マーカー分の上余白(px)
const BOTTOM_PAD = 56;  // スタート地点の下余白(px)
const X_LEFT     = 32;  // ジグザグの左側 x（%）
const X_RIGHT    = 68;  // ジグザグの右側 x（%）

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// マス列とキャンバス寸法（背景・スクロール窓で共有）
function _layout(p) {
  const missions = [...(p.missions || [])]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const n = missions.length;
  const canvasH = Math.max(
    (typeof window !== 'undefined' ? window.innerHeight : 640) - 120, // 画面全体に見せる最低高
    TOP_PAD + Math.max(n - 1, 0) * NODE_GAP + BOTTOM_PAD + 44,
  );
  const xFor = i => (i % 2 === 0 ? X_LEFT : X_RIGHT);
  const yFor = i => canvasH - BOTTOM_PAD - i * NODE_GAP;
  return { missions, n, canvasH, xFor, yFor };
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
  const { missions, n, canvasH, xFor, yFor } = _layout(p);

  // 道（マスを結ぶ破線。マスが無い場合はスタート→山頂の直線）
  const points = n > 0
    ? missions.map((m, i) => `${xFor(i)},${yFor(i)}`)
    : [`50,${canvasH - BOTTOM_PAD}`];
  points.push(`50,${TOP_PAD - 30}`); // 最後は山頂へ
  const trail = `
    <svg class="p-mountain__trail" viewBox="0 0 100 ${canvasH}" preserveAspectRatio="none">
      <polyline points="${points.join(' ')}" fill="none" stroke="#C9CDD1" stroke-width="3"
        stroke-dasharray="1 7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;

  // マス＋完了オブジェクト（★装飾のみ。タップ不可・タイトル無し）
  const nodes = missions.map((m, i) => {
    const x = xFor(i);
    const y = yFor(i);
    const cleared = m.status === 'cleared';
    const pending = m.status === 'pending_leader_check';
    // ★色だけで状態を分けない。完了はチェック、確認待ちは時計のアイコンも入れる
    const circle = cleared
      ? `<div class="p-mountain__node p-mountain__node--cleared">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
         </div>`
      : pending
        ? `<div class="p-mountain__node p-mountain__node--pending">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
           </div>`
        : `<div class="p-mountain__node"></div>`;

    return `
      <div class="p-mountain__pin" style="left:${x}%;top:${y}px">
        ${circle}
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

  const emptyHint = n === 0
    ? `<p class="p-mountain__pin p-mountain__pin--center p-mountain__empty" style="top:220px">ミッションを作ると<br>山頂への道が伸びていきます</p>`
    : '';

  return `
    <!-- ★top はヘッダー＋タブの実測高に合わせて initMountainPathSync が設定する -->
    <div id="mountain-bg" class="p-mountain" style="top:110px">
      <div id="mountain-canvas" class="p-mountain__canvas" style="height:${canvasH}px">
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
    <div id="mountain-path-scroll" class="p-mountain__scroll no-scrollbar">
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

  const sync = () => { canvas.style.transform = `translateY(${-win.scrollTop}px)`; };
  win.addEventListener('scroll', sync, { passive: true });

  if (restoreTop !== null) win.scrollTop = restoreTop;
  sync();
}
