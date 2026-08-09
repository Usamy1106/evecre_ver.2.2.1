// ===== 開発者からのお知らせモーダル =====
// 全ユーザーに配信する運営告知。内容は devAnnouncement.js の DEV_ANNOUNCEMENT を編集して差し替える。
// 表示済み判定は「ユーザー×version」で localStorage に保存するため、version を更新すれば
// 既に閉じたことのあるユーザーにも再配信される。判定は render() 駆動のみ（バックグラウンドタイマー厳禁、
// purposeReminderModal.js / eventDateReminderModal.js と同方針）。
//
// pages が複数あるときは「次へ」で切り替わり、最後のページで「閉じる」になる。
// 既読は「開いた時点」で記録するため、途中で閉じても同じ version は再表示されない。

import { state } from '../state.js';
import {
  pushSetupPhase, pushSetupContentHtml, bindPushSetupContent, recordPushSkipped,
} from './pushSetupModal.js';
import { DEV_ANNOUNCEMENT } from '../devAnnouncement.js';

// 画像の高さ上限。これを超える画像は縮小して全体を表示する（切り取らない）。
const IMAGE_MAX_H = '45vh';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function _storageKey(userId) {
  return `evecre:devAnnouncement:seenVersion:${userId}`;
}

/** pages 形式に正規化する（空ページは除外） */
function _getPages() {
  const pages = Array.isArray(DEV_ANNOUNCEMENT.pages) ? DEV_ANNOUNCEMENT.pages : [];
  return pages.filter(p => p && (p.title || p.body || p.imageUrl || p.action));
}

/**
 * render() から呼ばれる判定エントリポイント。
 * DEV_ANNOUNCEMENT.version が未読（＝localStorage の記録と異なる）なら表示する。
 */
export function checkDeveloperAnnouncementModal() {
  const { version } = DEV_ANNOUNCEMENT;
  if (!version || !state.currentUser) return;
  if (_getPages().length === 0) return;   // 中身が無ければ出さない
  // イベント固有のモーダルと重ねない（表示できなければフラグを立てず、次回チェック時に再判定させる）
  if (document.getElementById('dev-announcement-overlay')) return;
  if (document.getElementById('info-modal-overlay')) return;
  if (document.getElementById('purpose-reminder-overlay')) return;
  if (document.getElementById('event-date-reminder-overlay')) return;

  const key = _storageKey(state.currentUser.id);
  if (localStorage.getItem(key) === version) return;

  localStorage.setItem(key, version);
  _openModal();
}

function _openModal() {
  const pages = _getPages();

  const overlay = document.createElement('div');
  overlay.id = 'dev-announcement-overlay';
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[180] flex items-center justify-center p-5';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  _renderPage(overlay, pages, 0);
}

/**
 * 指定ページを描画する。オーバーレイは作り直さず中身だけ差し替える
 * （毎回 fadeIn させると切り替えがちらつくため）。
 */
function _renderPage(overlay, pages, index, opts = {}) {
  const page   = pages[index];
  const isLast = index === pages.length - 1;
  const multi  = pages.length > 1;

  // 通知セットアップの差し込みページ（お知らせのページ数には数えない）
  const pushMode = !!opts.pushSetup;

  const dots = !multi ? '' : `
    <div class="flex items-center justify-center gap-1.5 mb-4">
      ${pages.map((_, i) => `<div class="w-1.5 h-1.5 rounded-full ${i === index ? 'bg-[#0CA1E3]' : 'bg-[#D3D6D8]'}"></div>`).join('')}
    </div>`;

  if (pushMode) {
    const phase = pushSetupPhase();
    overlay.innerHTML = `
      <div data-ann-card class="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col text-center"
        style="max-height:92vh">
        <div class="p-6 pt-6 overflow-y-auto flex-1">
          <div data-psm-body>${pushSetupContentHtml(phase)}</div>
        </div>
        <div class="px-6 pb-6 pt-1 flex-shrink-0">
          ${dots}
          <button data-action="next" class="w-full py-3 rounded-xl text-[13px] font-bold text-[#484545] bg-white border border-[#E1DFDC]">
            ${isLast ? '閉じる' : '次へ'}
          </button>
        </div>
      </div>`;

    const body = overlay.querySelector('[data-psm-body]');
    const advance = () => {
      if (isLast) { overlay.remove(); return; }
      _renderPage(overlay, pages, index + 1);
    };
    bindPushSetupContent(body, {
      phase,
      onAdvance: () => {
        // ホーム画面追加のあとは、同じ枠で通知の許可へ切り替える（iOS を除く）
        if (phase === 'install' && !_isIOSLike()) {
          body.innerHTML = pushSetupContentHtml('notify');
          bindPushSetupContent(body, { phase: 'notify', onAdvance: advance });
          return;
        }
        advance();
      },
    });
    overlay.querySelector('[data-action="next"]').onclick = () => {
      if (phase !== 'done' && phase !== 'unsupported') recordPushSkipped();
      advance();
    };
    // ★このページはスワイプさせない（誤操作で案内を飛ばさないため）
    _bindSwipe(overlay, null);
    return;
  }

  const image = page.imageUrl ? `
    <div class="w-full bg-[#F5F3F0] flex items-center justify-center" style="max-height:45vh">
      <img src="${_esc(page.imageUrl)}" alt=""
        class="w-full h-auto object-contain" style="max-height:45vh">
    </div>` : '';

  overlay.innerHTML = `
    <div data-ann-card class="bg-white rounded-3xl w-full max-w-sm shadow-2xl ${opts.enterFrom ? '' : 'animate-fadeIn'} overflow-hidden flex flex-col text-center"
      style="max-height:92vh">
      ${image}
      <div class="p-6 pt-5 overflow-y-auto flex-1">
        ${page.title ? `<h3 class="heading-m text-[#484545] mb-3 font-bold">${_esc(page.title)}</h3>` : ''}
        ${page.body ? `<p class="text-rs text-[#484545] font-medium leading-relaxed whitespace-pre-wrap text-left">${_esc(page.body)}</p>` : ''}
      </div>
      <div class="px-6 pb-6 pt-1 flex-shrink-0">
        ${dots}
        ${page.action === 'push-setup' ? `
          <!-- 押すと同じモーダルの中で通知セットアップに切り替わり、
               「次へ」で続きのお知らせに戻る（overlay は閉じない） -->
          <button data-action="push-setup" class="btn-primary w-full py-3 heading-rs font-bold mb-2">
            ${_esc(page.actionLabel || '通知を設定する')}
          </button>` : ''}
        <button data-action="next" class="${page.action ? 'w-full py-3 rounded-xl text-[13px] font-bold text-[#484545] bg-white border border-[#E1DFDC]' : 'btn-primary w-full py-3 heading-rs font-bold'}">
          ${isLast ? '閉じる' : '次へ'}
        </button>
        ${!isLast && !page.action ? `
          <button data-action="close" class="w-full pt-3 text-[12px] font-bold text-[#A7AAAC]">
            スキップ
          </button>` : ''}
      </div>
    </div>`;

  overlay.querySelector('[data-action="next"]').onclick = () => {
    if (isLast) { overlay.remove(); return; }
    _renderPage(overlay, pages, index + 1);
  };
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => overlay.remove());

  // 同じモーダル内で通知セットアップに切り替える（お知らせは閉じない）
  overlay.querySelector('[data-action="push-setup"]')?.addEventListener('click', () => {
    _renderPage(overlay, pages, index, { pushSetup: true });
  });

  // 左右のドラッグでページを移動（ページ単位で無効にできる）
  _bindSwipe(overlay, _swipeEnabled(page) ? {
    canNext: !isLast,
    canPrev: index > 0,
    // 送り出した向きと逆側から新しいカードが入ってくる
    onNext: () => _renderPage(overlay, pages, index + 1, { enterFrom: 'right' }),
    onPrev: () => _renderPage(overlay, pages, index - 1, { enterFrom: 'left' }),
  } : null);

  if (opts.enterFrom) _slideIn(overlay, opts.enterFrom);
}

/** iOS 判定（push.js を import すると循環参照になるのでここで簡易判定する） */
function _isIOSLike() {
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  const looksMac = navigator.platform === 'MacIntel' || /Macintosh|Mac OS X/i.test(ua);
  return looksMac && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * このページでスワイプ移動を許すか。
 * ページの swipe が優先、無ければ DEV_ANNOUNCEMENT.swipe、既定は true。
 */
function _swipeEnabled(page) {
  if (page && page.swipe !== undefined) return !!page.swipe;
  if (DEV_ANNOUNCEMENT?.swipe !== undefined) return !!DEV_ANNOUNCEMENT.swipe;
  return true;
}

/**
 * 左右のドラッグでページを切り替える（指に追従して動き、離した位置で決まる）。
 * handlers が null ならドラッグ無効。
 *
 * ★縦スクロールを邪魔しないこと。
 *   - カードに touch-action: pan-y を付け、縦はブラウザに任せる
 *   - 最初の数px で「横か縦か」を判定し、縦だったらドラッグを取りやめる
 * ★これ以上ページが無い方向は抵抗を強くして（ラバーバンド）、行き止まりだと分かるようにする。
 */
function _bindSwipe(overlay, handlers) {
  const card = overlay.querySelector('[data-ann-card]');
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
 * @param {HTMLElement} overlay
 * @param {'left'|'right'} from
 */
function _slideIn(overlay, from) {
  const card = overlay.querySelector('[data-ann-card]');
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
