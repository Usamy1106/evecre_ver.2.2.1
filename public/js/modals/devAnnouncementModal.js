// ===== 開発者からのお知らせモーダル =====
// 全ユーザーに配信する運営告知。内容は devAnnouncement.js の DEV_ANNOUNCEMENT を編集して差し替える。
// 表示済み判定は「ユーザー×version」で localStorage に保存するため、version を更新すれば
// 既に閉じたことのあるユーザーにも再配信される。判定は render() 駆動のみ（バックグラウンドタイマー厳禁、
// purposeReminderModal.js / eventDateReminderModal.js と同方針）。
//
// pages が複数あるときは「次へ」で切り替わり、最後のページで「閉じる」になる。
// 既読は「開いた時点」で記録するため、途中で閉じても同じ version は再表示されない。

import { state } from '../state.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import {
  pushSetupPhase, pushSetupContentHtml, bindPushSetupContent, recordPushSkipped,
} from './pushSetupModal.js';
import { DEV_ANNOUNCEMENT } from '../devAnnouncement.js';
import { bindCardSwipe, slideInCard } from '../swipeCard.js';

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
  // 他の自動表示モーダルが開いていたら、フラグを立てずに持ち越す（次の render() で再判定）。
  // ★列挙は modalGuard.js に集約してある。ここに個別のIDを書き足さないこと
  if (isAnyAutoModalOpen()) return;

  const key = _storageKey(state.currentUser.id);
  if (localStorage.getItem(key) === version) return;

  localStorage.setItem(key, version);
  _openModal();
}

function _openModal() {
  const pages = _getPages();

  const overlay = document.createElement('div');
  overlay.id = 'dev-announcement-overlay';
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
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
    <div class="p-announcement__dots">
      ${pages.map((_, i) => `<div class="p-announcement__dot${i === index ? ' is-active' : ''}"></div>`).join('')}
    </div>`;

  if (pushMode) {
    const phase = pushSetupPhase();
    overlay.innerHTML = `
      <div data-ann-card class="p-announcement"
        style="max-height:92vh">
        <div class="p-announcement__body p-announcement__body--roomy">
          <div data-psm-body>${pushSetupContentHtml(phase)}</div>
        </div>
        <div class="p-announcement__footer">
          ${dots}
          <button data-action="next" class="p-announcement__secondary">
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
    <div class="p-announcement__figure" style="max-height:45vh">
      <img src="${_esc(page.imageUrl)}" alt=""
        class="p-announcement__image" style="max-height:45vh">
    </div>` : '';

  overlay.innerHTML = `
    <div data-ann-card class="p-announcement ${opts.enterFrom ? '' : 'u-animate-fade'}"
      style="max-height:92vh">
      ${image}
      <div class="p-announcement__body">
        ${page.title ? `<h3 class="p-announcement__title">${_esc(page.title)}</h3>` : ''}
        ${page.body ? `<p class="p-announcement__text">${_esc(page.body)}</p>` : ''}
      </div>
      <div class="p-announcement__footer">
        ${dots}
        ${page.action === 'push-setup' ? `
          <!-- 押すと同じモーダルの中で通知セットアップに切り替わり、
               「次へ」で続きのお知らせに戻る（overlay は閉じない） -->
          <button data-action="push-setup" class="c-button c-button--primary p-announcement__primary">
            ${_esc(page.actionLabel || '通知を設定する')}
          </button>` : ''}
        <button data-action="next" class="${page.action ? 'p-announcement__secondary' : 'c-button c-button--primary p-announcement__primary'}">
          ${isLast ? '閉じる' : '次へ'}
        </button>
        ${!isLast && !page.action ? `
          <button data-action="close" class="p-announcement__skip">
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

// 左右スワイプとスライドインは ../swipeCard.js に共通化した。
// ★お知らせと参加申請フォームで挙動を揃えるため、ここに再実装しないこと。
function _bindSwipe(overlay, handlers) {
  bindCardSwipe(overlay, '[data-ann-card]', handlers);
}

function _slideIn(overlay, from) {
  slideInCard(overlay, '[data-ann-card]', from);
}
