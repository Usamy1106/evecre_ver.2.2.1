// ===== ツールチップ・ツアー =====
// 対象要素のそばに吹き出しを出し、[次へ] で順に進める。
// 初期オンボーディングの③（ミッション作成モーダル）で使う。
//
// ★②のスポットライトと違い、背景操作は禁止しない（出口が複数あってよい）。
//   ここで詰まると「ミッションを作る」という本来の目的が達成できなくなるため、
//   右上に [スキップ] を常設し、吹き出しの外をタップしても次へ進める。
//
// ★対象要素が見つからないステップはスキップして次へ進む（止まらないこと）。

const OVERLAY_ID = 'tooltip-tour-overlay';
const GAP = 12;   // 対象と吹き出しの間隔(px)

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function closeTooltipTour() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) { el._cleanup?.(); el.remove(); }
}

export function isTooltipTourOpen() {
  return !!document.getElementById(OVERLAY_ID);
}

/**
 * ツアーを開始する。
 * @param {object} o
 * @param {Array<{selector:string, title:string, body:string}>} o.steps
 * @param {string} [o.lastLabel='はじめる'] 最後のステップのボタン文言
 * @param {function} [o.onStep]     ステップ表示のたびに呼ばれる（index は1始まり）
 * @param {function} [o.onSkip]     スキップされたとき
 * @param {function} [o.onFinish]   最後まで進んだとき
 * @returns {boolean} 出せるステップが1つでもあれば true
 */
export function startTooltipTour(o) {
  // ★対象が存在するステップだけに絞る（無いものは最初から除く＝番号も詰まる）
  const steps = (o.steps || []).filter(s => document.querySelector(s.selector));
  if (steps.length === 0) return false;

  closeTooltipTour();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // 背景は暗くしない（操作を止めないため）。ミッション作成モーダル(z-200前後)より前に出す
  overlay.className = 'fixed inset-0 z-[430]';
  overlay.style.pointerEvents = 'none';
  document.body.appendChild(overlay);

  let idx = 0;

  const finish = (skipped) => {
    closeTooltipTour();
    if (skipped) o.onSkip?.(); else o.onFinish?.();
  };

  const render = () => {
    const step = steps[idx];
    const el = document.querySelector(step.selector);
    if (!el) { next(); return; }                 // 途中で消えたら飛ばす

    try { el.scrollIntoView({ block: 'center' }); } catch (_) {}

    const isLast = idx === steps.length - 1;
    overlay.innerHTML = `
      <div data-tt-card class="absolute bg-white rounded-2xl shadow-2xl p-4 max-w-[280px]"
        style="pointer-events:auto;">
        <button data-tt="skip"
          class="absolute top-2 right-2 text-[10px] font-bold text-[#A7AAAC] px-2 py-1">スキップ</button>
        <p class="text-[10px] font-bold text-[#0CA1E3] mb-1">${idx + 1}/${steps.length}</p>
        <p class="text-[14px] font-bold text-[#484545] mb-1 pr-10">${_esc(step.title)}</p>
        <p class="text-[11px] font-bold text-[#A7AAAC] leading-relaxed mb-3">${_esc(step.body)}</p>
        <button data-tt="next"
          class="w-full py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#0CA1E3]">${
            isLast ? _esc(o.lastLabel || 'はじめる') : '次へ'}</button>
      </div>
      <!-- 吹き出しの外をタップしても次へ進む（詰まらせない） -->
      <div data-tt="outside" class="absolute inset-0 -z-10" style="pointer-events:auto;"></div>`;

    const card = overlay.querySelector('[data-tt-card]');
    place(el, card);

    overlay.querySelector('[data-tt="next"]').onclick = (e) => { e.stopPropagation(); next(); };
    overlay.querySelector('[data-tt="skip"]').onclick = (e) => { e.stopPropagation(); finish(true); };
    overlay.querySelector('[data-tt="outside"]').onclick = () => next();

    o.onStep?.(idx + 1);
  };

  /** 対象の下（入らなければ上）に吹き出しを置く。★座標は実測のみ */
  const place = (el, card) => {
    if (!el || !card) return;
    const r = el.getBoundingClientRect();
    const cw = card.offsetWidth  || 280;
    const ch = card.offsetHeight || 140;
    // 横：対象の中央に寄せつつ、画面からはみ出さない
    const left = Math.min(Math.max(8, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 8);
    // 縦：下に入らなければ上へ
    const below = window.innerHeight - r.bottom;
    const raw = (below >= ch + GAP) ? r.bottom + GAP : r.top - ch - GAP;
    // ★対象が画面外にあっても吹き出しだけは必ず画面内に置く。
    //   出ているのに見えない状態が一番わかりにくいため。
    const top = Math.min(Math.max(8, raw), Math.max(8, window.innerHeight - ch - 8));
    card.style.left = `${left}px`;
    card.style.top  = `${top}px`;
  };

  const next = () => {
    idx += 1;
    if (idx >= steps.length) { finish(false); return; }
    render();
  };

  const onResize = () => {
    const step = steps[idx];
    const el = step && document.querySelector(step.selector);
    const card = overlay.querySelector('[data-tt-card]');
    if (el && card) place(el, card);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  overlay._cleanup = () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  };

  render();
  return true;
}
