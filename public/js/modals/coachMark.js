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
// 尻尾を吹き出しの端に寄せすぎないための余白(px)。角丸から飛び出すのを防ぐ
const TAIL_INSET = 22;

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
 * @param {string} [o.cta]         文言の下に出すボタン（例 'はじめる'）。押すと必ず進む
 * @param {'target'|'anywhere'} [o.advanceOn='target']
 *        'target'  … 穴をタップしたときだけ進む（②。出口をひとつに絞る）
 *        'anywhere'… どこをタップしても進む（④。操作を強制しない）
 * @param {function} o.onAdvance   進むときに呼ばれる
 * @param {function} [o.onDismiss] advanceOn:'target' のとき、穴の**外**をタップして
 *        閉じた場合に呼ばれる。渡さなければ外タップでは何も起きない（従来どおり）。
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
  // スタイル: public/css/object/component/_coach-mark.css
  overlay.className = 'c-coach-mark';
  overlay.innerHTML = `
    <div data-coach-hole class="c-coach-mark__hole"></div>
    <div data-coach-pulse class="c-coach-mark__pulse c-coach-pulse"></div>
    <button type="button" data-coach-hit class="c-coach-mark__hit"></button>
    <!-- ★文字は必ず吹き出しの中に入れる。暗幕の上に直接置いていた頃は、
         穴の中身（明るいカードや画像）と重なると読めなかった。 -->
    <div data-coach-copy class="c-coach-mark__copy">
      <div data-coach-bubble class="c-coach-mark__bubble">
        ${o.counter ? `<p class="c-coach-mark__counter">${_esc(o.counter)}</p>` : ''}
        <p class="c-coach-mark__title">${_esc(o.title)}</p>
        ${o.body ? `<p class="c-coach-mark__text">${_esc(o.body)}</p>` : ''}
        ${(!o.finger && o.hint) ? `<p class="c-coach-mark__hint">${_esc(o.hint)}</p>` : ''}
        ${o.cta ? `<button type="button" data-coach-cta class="c-coach-mark__cta">${_esc(o.cta)}</button>` : ''}
      </div>
    </div>
    ${o.finger ? `
      <!-- ★指は穴に隣接させる。コピー文の中に置くと穴から離れて「どこを指しているか」が伝わらない -->
      <div data-coach-finger class="c-coach-mark__finger">
        <svg class="c-coach-finger" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
          style="filter: drop-shadow(0 2px 6px rgba(0,0,0,.5));">
          <path d="M9 11V6a2 2 0 1 1 4 0v5"/>
          <path d="M13 11V8a2 2 0 1 1 4 0v3"/>
          <path d="M17 11v-1a2 2 0 1 1 4 0v6a5 5 0 0 1-5 5h-3a6 6 0 0 1-6-6v-4a2 2 0 1 1 4 0"/>
        </svg>
        ${o.hint ? `<span class="c-coach-mark__finger-hint">${_esc(o.hint)}</span>` : ''}
      </div>` : ''}`;
  document.body.appendChild(overlay);

  const hole   = overlay.querySelector('[data-coach-hole]');
  const finger = overlay.querySelector('[data-coach-finger]');
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
    // ★指は穴のすぐ隣に置き、指先が穴を向くように回す。
    //   FAB は画面最下部にあり下に余白が無いことが多いので、下 → 左 → 右 の順で場所を選ぶ。
    //   アイコンは「人差し指が上を向いた手」なので、下に置くときは無回転でそのまま穴を指す。
    if (finger) {
      const FW = 44, FH = 56;                       // 指＋ヒントのおおよその大きさ
      const below = window.innerHeight - (cy + size / 2);
      const left  = cx - size / 2;
      if (below >= FH + 8) {
        finger.style.left = `${cx - FW / 2}px`;
        finger.style.top  = `${cy + size / 2 + 6}px`;
        finger.style.transform = 'none';
      } else if (left >= FW + 8) {
        // 左に置き、指先が右上（穴）を向くように傾ける
        finger.style.left = `${cx - size / 2 - FW - 6}px`;
        finger.style.top  = `${cy - FH / 2 + 6}px`;
        finger.style.transform = 'rotate(35deg)';
      } else {
        finger.style.left = `${cx + size / 2 + 6}px`;
        finger.style.top  = `${cy - FH / 2 + 6}px`;
        finger.style.transform = 'rotate(-35deg)';
      }
    }

    // 文言は穴の広い方の側に置く（画面下部の FAB なら上、上部の要素なら下）
    // ★吹き出しの尻尾の向きは、置いた側と必ず揃える。
    //   穴の**上**に置いたら尻尾は**下**向き（＝穴を指す）、下に置いたら上向き。
    //   ここを固定にすると、片方の配置で尻尾が穴と反対を向いて意味が壊れる。
    const spaceAbove = r.top;
    const spaceBelow = window.innerHeight - r.bottom;
    if (spaceAbove >= spaceBelow) {
      copy.style.top = '';
      copy.style.bottom = `${Math.max(24, window.innerHeight - r.top + 28)}px`;
      copy.classList.add('c-coach-mark__copy--above');
      copy.classList.remove('c-coach-mark__copy--below');
    } else {
      copy.style.bottom = '';
      copy.style.top = `${r.bottom + 28}px`;
      copy.classList.add('c-coach-mark__copy--below');
      copy.classList.remove('c-coach-mark__copy--above');
    }
    // 尻尾は穴の**中心の真下／真上**に置く。吹き出し自体は画面幅いっぱいなので、
    // 尻尾だけを穴のx座標へ寄せる（左右端の要素でも指し先がずれない）。
    // ★clamp で吹き出しの内側に収める。角丸から尻尾がはみ出すと形が崩れる。
    const bub = copy.querySelector('[data-coach-bubble]');
    if (bub) {
      const br = bub.getBoundingClientRect();
      const min = br.left + TAIL_INSET;
      const max = br.right - TAIL_INSET;
      bub.style.setProperty('--tail-x', `${Math.min(Math.max(cx, min), max) - br.left}px`);
    }
  };
  place();

  const advance = () => { closeCoachMark(); o.onAdvance?.(); };

  hit.onclick = (e) => { e.stopPropagation(); advance(); };
  // ★CTA は advanceOn に関わらず必ず進める（④の最後の「はじめる」用）
  overlay.querySelector('[data-coach-cta]')?.addEventListener('click', (e) => {
    e.stopPropagation(); advance();
  });
  if (o.advanceOn === 'anywhere') {
    overlay.onclick = () => advance();
  } else if (o.onDismiss) {
    // ★穴の外をタップしたら「やらずに閉じる」。onAdvance（穴をタップ＝実行）とは
    //   区別したいので、別のコールバックにしてある。
    //   これが無いと、対象をタップする以外に逃げ道が無く操作不能に見える。
    overlay.onclick = (e) => { e.stopPropagation(); closeCoachMark(); o.onDismiss(); };
  } else {
    // ★穴以外では何も起きない（出口を対象のタップだけに絞る）
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
