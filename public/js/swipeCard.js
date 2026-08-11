// ===== カードの左右スワイプ（ページ送り）共通処理 =====
// 開発者からのお知らせ（devAnnouncementModal）と参加申請フォーム（joinFormModal）で共用する。
// ★挙動を確実に揃えるため、各モーダルで実装を複製しないこと。
//
// 指に追従して動き、離した位置で「進む／戻る／元に戻す」が決まる。
//
// ★縦スクロールを邪魔しないこと。
//   - カードに touch-action: pan-y を付け、縦はブラウザに任せる
//   - 最初の数px で「横か縦か」を判定し、縦だったらドラッグを取りやめる
// ★これ以上ページが無い方向は抵抗を強くして（ラバーバンド）、行き止まりだと分かるようにする。

/**
 * 左右のドラッグでページを切り替える。
 * @param {HTMLElement} root      オーバーレイ（カードを内包する要素）
 * @param {string} cardSelector   カード本体のセレクタ（例 '[data-ann-card]'）
 * @param {null|{canPrev:boolean, canNext:boolean, onPrev:function, onNext:function}} handlers
 *        null ならドラッグ無効（touch-action だけ設定して抜ける）
 */
export function bindCardSwipe(root, cardSelector, handlers) {
  const card = root.querySelector(cardSelector);
  if (!card) return;
  // 縦スクロールはブラウザに任せ、横だけこちらで扱う
  card.style.touchAction = 'pan-y';
  if (!handlers) return;

  const width = () => card.getBoundingClientRect().width || 320;
  const threshold = () => Math.min(90, width() * 0.28);

  let x0 = 0, y0 = 0, dx = 0;
  let dragging = false;   // ポインタが押されている
  let decided  = false;   // 横方向のドラッグだと確定した

  const setX = (v, animate) => {
    card.style.transition = animate
      ? 'transform .28s cubic-bezier(.2,.8,.3,1), opacity .28s ease'
      : 'none';
    card.style.transform = `translateX(${v}px)`;
    // 動かすほど少し薄くして、切り替わる予感を出す
    card.style.opacity = String(Math.max(0.55, 1 - Math.abs(v) / (width() * 1.6)));
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0;
    dragging = true; decided = false;
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const mx = e.clientX - x0, my = e.clientY - y0;

    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;   // まだ方向が分からない
      if (Math.abs(mx) <= Math.abs(my)) { dragging = false; return; }  // 縦スクロールに譲る
      decided = true;
      card.setPointerCapture?.(e.pointerId);   // カードの外へ指が出ても追従させる
    }

    dx = mx;
    // 行き止まりの方向は動きを鈍くする
    if ((dx > 0 && !handlers.canPrev) || (dx < 0 && !handlers.canNext)) dx *= 0.32;
    setX(dx, false);
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (!decided) return;

    const toNext = dx < 0;
    const canGo  = Math.abs(dx) > threshold() && (toNext ? handlers.canNext : handlers.canPrev);

    if (!canGo) { setX(0, true); return; }   // 届かなかったので元に戻す

    // 画面外へ送り出してから中身を差し替える（新しいカードは反対側から入ってくる）
    setX(toNext ? -width() * 1.1 : width() * 1.1, true);
    setTimeout(() => (toNext ? handlers.onNext() : handlers.onPrev()), 170);
  };
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
  card.addEventListener('lostpointercapture', release);
}

/**
 * 差し替えた直後のカードを、指定方向から滑り込ませる。
 * @param {HTMLElement} root
 * @param {string} cardSelector
 * @param {'left'|'right'} from  'right' ＝ 次へ進んだとき（右から入ってくる）
 */
export function slideInCard(root, cardSelector, from) {
  const card = root.querySelector(cardSelector);
  if (!card) return;
  card.classList.remove('animate-fadeIn');   // フェードと二重にしない
  const w = card.getBoundingClientRect().width || 320;
  card.style.transition = 'none';
  card.style.transform = `translateX(${from === 'right' ? w : -w}px)`;
  card.style.opacity = '0.55';
  requestAnimationFrame(() => {
    card.style.transition = 'transform .3s cubic-bezier(.2,.8,.3,1), opacity .3s ease';
    card.style.transform = 'translateX(0)';
    card.style.opacity = '1';
  });
}
