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
    <svg class="absolute inset-0 w-full h-full" viewBox="0 0 100 ${canvasH}" preserveAspectRatio="none" style="pointer-events:none">
      <polyline points="${points.join(' ')}" fill="none" stroke="#C9CDD1" stroke-width="3"
        stroke-dasharray="1 7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;

  // マス＋完了オブジェクト（★装飾のみ。タップ不可・タイトル無し）
  const nodes = missions.map((m, i) => {
    const x = xFor(i);
    const y = yFor(i);
    const cleared = m.status === 'cleared';
    const pending = m.status === 'pending_leader_check';
    const circle = cleared
      ? `<div class="w-11 h-11 rounded-full bg-[#0CA1E3] border-4 border-[#0CA1E3]/25 flex items-center justify-center shadow-md" style="background-clip:padding-box">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
         </div>`
      : pending
        ? `<div class="w-11 h-11 rounded-full bg-[#FFC300] border-4 border-[#FFC300]/25 flex items-center justify-center shadow-md" style="background-clip:padding-box">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
           </div>`
        : `<div class="w-11 h-11 rounded-full bg-white border-[3px] border-[#C9CDD1] shadow-sm"></div>`;

    return `
      <div class="absolute -translate-x-1/2 -translate-y-1/2" style="left:${x}%;top:${y}px;pointer-events:none">
        ${circle}
      </div>`;
  }).join('');

  // 山頂（ゴール）とスタート
  const summit = `
    <div class="absolute left-1/2 -translate-x-1/2 flex flex-col items-center" style="top:${TOP_PAD - 84}px;pointer-events:none">
      ${_summitSvg()}
      <p class="text-[10px] font-bold text-[#484545] mt-0.5">${_esc(p.name || '')}</p>
    </div>`;
  const start = `
    <div class="absolute left-1/2 -translate-x-1/2 text-[9px] font-bold text-[#A7AAAC]" style="top:${canvasH - BOTTOM_PAD + 34}px;pointer-events:none">スタート</div>`;

  const emptyHint = n === 0
    ? `<p class="absolute left-1/2 -translate-x-1/2 text-[11px] font-bold text-[#A7AAAC] text-center leading-relaxed" style="top:220px;pointer-events:none">ミッションを作ると<br>山頂への道が伸びていきます</p>`
    : '';

  return `
    <div id="mountain-bg" class="fixed left-0 right-0 bottom-0 mx-auto max-w-md z-0 overflow-hidden bg-gradient-to-b from-[#EAF6FD] to-[#FDFBF8]" style="top:110px">
      <div id="mountain-canvas" class="relative will-change-transform" style="height:${canvasH}px">
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
    <div id="mountain-path-scroll" class="relative z-10 flex-1 overflow-y-auto no-scrollbar">
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

  // ヘッダー＋タブ（sticky ラッパー）の直下から画面全体に敷く
  const sticky = document.querySelector('#app .sticky') || document.querySelector('.sticky');
  if (sticky) bg.style.top = `${sticky.offsetHeight}px`;

  const sync = () => { canvas.style.transform = `translateY(${-win.scrollTop}px)`; };
  win.addEventListener('scroll', sync, { passive: true });

  if (restoreTop !== null) win.scrollTop = restoreTop;
  sync();
}
