// ===== 山登りパスビジュアル（メインボード）=====
// プラント成長表示の後継。デュオリンゴの道UIを参考に、下から上へミッションごとに
// 円形マスがジグザグに増えていく「山登りの道」を描く。
// - ノード＝全ミッション（cleared 含む）。createdAt 昇順で下（スタート）→上（山頂）。
// - 完了ノードは塗りつぶし＋道の横に rewardObject（正方形プレースホルダー）が出現する。
// - コンテナは固定高・内部スクロール（id: mountain-path-scroll）。ページは縦に伸ばさない。
//   再レンダリングをまたぐスクロール位置保持は mainBoard.js 側で capture → restore する。
// - ノードタップは openMissionDetail（全カードタップ可の方針と同じ）。

import { Components } from './components.js';

const NODE_GAP   = 88;  // ノード間の縦間隔(px)
const TOP_PAD    = 96;  // 山頂マーカー分の上余白(px)
const BOTTOM_PAD = 56;  // スタート地点の下余白(px)
const X_LEFT     = 32;  // ジグザグの左側 x（%）
const X_RIGHT    = 68;  // ジグザグの右側 x（%）

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
 * 山登りパスの HTML を返す（固定高・内部スクロール）
 * @param {object} p イベント（flat 形式）
 * @param {{height?: number}} opts
 */
export function renderMountainPath(p, opts = {}) {
  const height = opts.height || 320;
  const missions = [...(p.missions || [])]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const n = missions.length;
  const canvasH = Math.max(height, TOP_PAD + Math.max(n - 1, 0) * NODE_GAP + BOTTOM_PAD + 44);

  // i=0（最古）が一番下、最新が一番上（山頂の直下）
  const xFor = i => (i % 2 === 0 ? X_LEFT : X_RIGHT);
  const yFor = i => canvasH - BOTTOM_PAD - i * NODE_GAP;

  // 道（ノードを結ぶ破線。ノードが無い場合はスタート→山頂の直線）
  const points = n > 0
    ? missions.map((m, i) => `${xFor(i)},${yFor(i)}`)
    : [`50,${canvasH - BOTTOM_PAD}`];
  points.push(`50,${TOP_PAD - 30}`); // 最後は山頂へ
  const trail = `
    <svg class="absolute inset-0 w-full h-full" viewBox="0 0 100 ${canvasH}" preserveAspectRatio="none" style="pointer-events:none">
      <polyline points="${points.join(' ')}" fill="none" stroke="#C9CDD1" stroke-width="3"
        stroke-dasharray="1 7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;

  // ノード＋完了オブジェクト
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

    // 完了で道の横にオブジェクトが現れる（ジグザグの外側に置く）
    const objSide = x <= 50 ? 'left:-44px' : 'right:-44px';
    const objHtml = cleared && m.rewardObject?.id
      ? `<div class="absolute top-1/2 -translate-y-1/2 animate-fadeIn" style="${objSide}">
           ${Components.MountainObjectIcon(m.rewardObject.id, { size: 30 })}
         </div>`
      : '';

    return `
      <div class="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer active:scale-90 transition-transform"
        style="left:${x}%;top:${y}px"
        onclick="window._app.openMissionDetail('${m.id}')" data-log="mountain_node_tap">
        <div class="relative">
          ${circle}
          ${objHtml}
        </div>
        <p class="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[9px] font-bold text-[#A7AAAC] whitespace-nowrap max-w-[110px] overflow-hidden text-center" style="text-overflow:ellipsis">${_esc(m.title)}</p>
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
    ? `<p class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] font-bold text-[#A7AAAC] text-center leading-relaxed" style="pointer-events:none">ミッションを作ると<br>山頂への道が伸びていきます</p>`
    : '';

  return `
    <div id="mountain-path-scroll" class="relative bg-gradient-to-b from-[#EAF6FD] to-[#F4F1EC] border border-[#D3D6D8] rounded-2xl overflow-y-auto no-scrollbar shadow-inner"
      style="height:${height}px">
      <div class="relative" style="height:${canvasH}px">
        ${trail}
        ${summit}
        ${nodes}
        ${start}
        ${emptyHint}
      </div>
    </div>`;
}

/**
 * ミッション一覧の裏に敷く装飾の道（薄いジグザグSVG、非インタラクティブ）。
 * 山登りビジュアルの道が一覧の裏側にも続いている演出。
 */
export function renderTrailBackdrop() {
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(`${i % 2 === 0 ? 30 : 70},${i * 100}`);
  return `
    <svg class="absolute inset-0 w-full h-full" viewBox="0 0 100 1200" preserveAspectRatio="none"
      style="pointer-events:none;opacity:0.07" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none" stroke="#484545" stroke-width="3"
        stroke-dasharray="1 7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
}
