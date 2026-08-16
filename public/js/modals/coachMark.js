// ===== コーチマーク（スポットライト）=====
// 画面を暗くし、対象要素の位置だけを丸くくり抜いて指し示す。
// 初期オンボーディングの②（FAB）と④（ボード3連）で共用する。
//
// ★くり抜きは box-shadow で外側を塗る方式。
//   穴の部分だけが素の画面として残るので、clip-path や mask より崩れにくい。
//
// ★位置は必ず getBoundingClientRect() で実測する。
//   window.innerHeight を基準に計算しないこと。FAB は画面下部にあり
//   env(safe-area-inset-bottom) の影響を受けるため、PWA（ホーム画面から起動）と
//   Safari のタブとで実座標が変わる（既知の不具合パターン）。
//
// ★タップの扱い：オーバーレイ全面で操作を止め、穴の上に**透明なボタン**を重ねる。
//   実要素へイベントを通そうとすると端末差で崩れるため、穴のボタンから
//   同じハンドラを呼ぶ方式にしてある。

const OVERLAY_ID = 'coach-mark-overlay';
const HOLE_PAD   = 10;     // くり抜きを対象より少し大きくする余白(px)

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** 開いていれば閉じる */
export function closeCoachMark() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) {
    el._cleanup?.();
    el.remove();
  }
}

/**
 * スポットライトを表示する。
 *
 * @param {object} o
 * @param {string} o.selector      対象要素のセレクタ（例 '[data-coach="fab"]'）
 * @param {string} o.title         見出し
 * @param {string} [o.body]        補足
 * @param {string} [o.hint]        穴のそばに出す小さな文字（例 'タップしてね'）
 * @param {boolean} [o.finger]     指アイコン＋パルスを出すか
 * @param {string} [o.counter]     '1/3' など
 * @param {'target'|'anywhere'} [o.advanceOn='target']
 *        'target'  … 穴をタップしたときだけ進む（②。出口をひとつに絞る）
 *        'anywhere'… どこをタップしても進む（④。操作を強制しない）
 * @param {function} o.onAdvance   進むときに呼ばれる
 * @returns {boolean} 表示できたら true。**対象が見つからなければ false**
 *
 * ★false を返したら、呼び出し側は状態を次へ進めること。
 *   ②は穴のタップ以外に出口が無いため、出せないまま止めると操作不能になる。
 */
export function showCoachMark(o) {
  const target = document.querySelector(o.selector);
  if (!target) return false;                 // ★フェイルセーフ：出さない

  // 画面外なら見える位置まで運ぶ（次の再計算で正しい座標になる）
  const r0 = target.getBoundingClientRect();
  if (r0.bottom < 0 || r0.top > window.innerHeight || r0.width === 0 || r0.height === 0) {
    try { target.scrollIntoView({ block: 'center' }); } catch (_) {}
  }

  closeCoachMark();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // 全面で操作を止める。既存モーダル（最大 z-400）より前に出す
  overlay.className = 'fixed inset-0 z-[420]';
  overlay.innerHTML = `
    <div data-coach-hole class="absolute rounded-full pointer-events-none"
      style="box-shadow: 0 0 0 9999px rgba(0,0,0,0.62);"></div>
    <div data-coach-pulse class="absolute rounded-full pointer-events-none border-2 border-white/70 coach-pulse"></div>
    <button data-coach-hit class="absolute rounded-full" style="background:transparent;"></button>
    <div data-coach-copy class="absolute px-6 text-center" style="left:0; right:0;">
      ${o.counter ? `<p class="text-[11px] font-bold text-white/60 mb-2">${_esc(o.counter)}</p>` : ''}
      <p class="text-[17px] font-bold text-white leading-snug mb-1">${_esc(o.title)}</p>
      ${o.body ? `<p class="text-[13px] font-bold text-white/80 leading-relaxed">${_esc(o.body)}</p>` : ''}
      ${o.finger ? `
        <div data-coach-finger class="coach-finger mt-4 flex flex-col items-center gap-1">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 11V6a2 2 0 1 1 4 0v5"/>
            <path d="M13 11V8a2 2 0 1 1 4 0v3"/>
            <path d="M17 11v-1a2 2 0 1 1 4 0v6a5 5 0 0 1-5 5h-3a6 6 0 0 1-6-6v-4a2 2 0 1 1 4 0"/>
          </svg>
          ${o.hint ? `<span class="text-[11px] font-bold text-white/70">${_esc(o.hint)}</span>` : ''}
        </div>` : (o.hint ? `<p class="text-[11px] font-bold text-white/70 mt-3">${_esc(o.hint)}</p>` : '')}
    </div>`;
  document.body.appendChild(overlay);

  const hole   = overlay.querySelector('[data-coach-hole]');
  const pulse  = overlay.querySelector('[data-coach-pulse]');
  const hit    = overlay.querySelector('[data-coach-hit]');
  const copy   = overlay.querySelector('[data-coach-copy]');

  /** 対象の実座標に穴と文言を合わせる。★端末回転・リサイズ・スクロールのたびに呼ぶ */
  const place = () => {
    const el = document.querySelector(o.selector);
    if (!el) { closeCoachMark(); return; }
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) + HOLE_PAD * 2;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (const box of [hole, pulse, hit]) {
      box.style.width  = `${size}px`;
      box.style.height = `${size}px`;
      box.style.left   = `${cx - size / 2}px`;
      box.style.top    = `${cy - size / 2}px`;
    }
    // 文言は穴の広い方の側に置く（画面下部の FAB なら上、上部の要素なら下）
    const spaceAbove = r.top;
    const spaceBelow = window.innerHeight - r.bottom;
    if (spaceAbove >= spaceBelow) {
      copy.style.top = '';
      copy.style.bottom = `${Math.max(24, window.innerHeight - r.top + 28)}px`;
    } else {
      copy.style.bottom = '';
      copy.style.top = `${r.bottom + 28}px`;
    }
  };
  place();

  const advance = () => { closeCoachMark(); o.onAdvance?.(); };

  hit.onclick = (e) => { e.stopPropagation(); advance(); };
  if (o.advanceOn === 'anywhere') {
    overlay.onclick = () => advance();
  } else {
    // ★穴以外では何も起きない（出口を FAB のタップだけに絞る）
    overlay.onclick = (e) => { e.stopPropagation(); };
  }

  const onResize = () => place();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('scroll', onResize, true);
  overlay._cleanup = () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    window.removeEventListener('scroll', onResize, true);
  };

  return true;
}

/** 表示中か */
export function isCoachMarkOpen() {
  return !!document.getElementById(OVERLAY_ID);
}
