// ===== アカウント作成後のオンボーディング（5枚）=====
//
// ① 仲間と一緒にミッションを進めよう → ② AIが… → ③ いつでも、どこでも…（はじめる）
//   → ④ ホームに置いておこう（Android）か ⑤ 同（iOS）。ホーム画面から開いている（追加済み）なら④⑤は出さない。
//
// ★文言と画像のパスは welcomeTour.js（データ）。ここはレイアウトと遷移だけ。
// ★1つの枠（#welcome-tour-overlay）の中身を差し替えて進む（モーダルを開き直さない）。
//   並び：ロゴ → イラスト → 見出し → 説明文 → 補足（メリット・手順）→ ページネーション → メインボタン → あとで
// ★出すかどうかは localStorage の `evecre:welcomeTour:v1:{userId}`：
//   'pending'（アカウント作成を完了した）→ 'done'（最後まで進んだ／あとで）。
//   ★pending をアカウント作成の完了で立てるので、途中で再読み込みしても最初から出直せる。
// ★通知許可とお知らせ（devAnnouncement）は、アカウント作成直後には出さない（state.js）。
//   次に開いたとき（再ログイン・再読み込み）に出す。ここは「次に通知の案内を出す」印を立てるだけ。

import { state } from '../state.js';
import { WELCOME_TOUR } from '../welcomeTour.js';
import { isStandalone, isIOS, isSmallScreen, canPromptInstall, promptInstall } from '../push.js';
import { startPushSetupFlow } from './pushSetupModal.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { logEvent } from '../logger.js';

export const WELCOME_TOUR_ID = 'welcome-tour-overlay';

const _key = (userId) => `evecre:welcomeTour:v1:${userId}`;
// 通知の案内を「次に開いたとき」に出す印（state.js が読む）
export const PUSH_AFTER_SIGNUP_KEY = (userId) => `evecre:pushAfterSignup:v1:${userId}`;

function _get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

/** アカウント作成の完了で呼ぶ（signup.js）。以後、HOME に着いたら出す */
export function markWelcomeTourPending(userId) {
  if (!userId) return;
  _set(_key(userId), 'pending');
  _set(PUSH_AFTER_SIGNUP_KEY(userId), '1');
}

export function isWelcomeTourPending(userId) {
  return !!userId && _get(_key(userId)) === 'pending';
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const _lines = (arr) => (Array.isArray(arr) ? arr : [arr]).map(_esc).join('<br>');
const _img = (src, cls, alt = '') => (src ? `<img src="${_esc(src)}" class="${cls}" alt="${_esc(alt)}">` : '');

/**
 * ホームに置いておこう のどちらを出すか。出さないなら null。
 * ★ホーム画面から開いている（追加済み）なら出さない。
 * ★iOS は⑤。ブラウザがインストールの確認を出せる環境（Android の Chrome など）と、Android の小さい画面は④。
 *   それ以外（PC で確認を出せないブラウザ）は出さない。
 */
export function homeAddVariant() {
  if (isStandalone()) return null;
  if (isIOS()) return 'ios';
  const android = /android/i.test(navigator.userAgent || '');
  if (canPromptInstall() || (android && isSmallScreen())) return 'android';
  return null;
}

/** HOME の render() から呼ぶ（state.js）。出せる状態でなければ何もしない（次の render で再判定） */
export function checkWelcomeTour() {
  const uid = state.currentUser?.id;
  if (!uid || !isWelcomeTourPending(uid)) return;
  if (state.currentView !== 'HOME') return;
  // ★招待リンクから来た人は、参加申請の確認を先に済ませてもらう（開いている間は待つ）
  if (state.pendingJoinConfirm || document.querySelector('.c-overlay:not(#' + WELCOME_TOUR_ID + ')')) return;
  if (document.getElementById(WELCOME_TOUR_ID) || isAnyAutoModalOpen(WELCOME_TOUR_ID)) return;
  openWelcomeTour();
}

export function openWelcomeTour() {
  if (document.getElementById(WELCOME_TOUR_ID)) return;
  const overlay = document.createElement('div');
  overlay.id = WELCOME_TOUR_ID;
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  document.body.appendChild(overlay);
  logEvent('welcome_tour_shown');
  _showPage(overlay, 0);
}

// ── 共通の枠 ────────────────────────────────────────────────
function _frame({ id, art, title, body, extra = '', footer }) {
  return `
    <div class="p-welcome-tour u-animate-fade" role="dialog" aria-modal="true" aria-labelledby="welcome-tour-title" data-welcome-page="${_esc(id)}">
      ${_img(WELCOME_TOUR.logo, 'p-welcome-tour__logo', 'イベクリ')}
      <div class="p-welcome-tour__art">${_img(art, 'p-welcome-tour__art-image')}</div>
      <h2 id="welcome-tour-title" class="p-welcome-tour__title">${_lines(title)}</h2>
      <p class="p-welcome-tour__body">${_lines(body)}</p>
      ${extra}
      ${footer}
    </div>`;
}

// ── ①〜③ 機能紹介 ──────────────────────────────────────────
function _showPage(overlay, idx) {
  const pages = WELCOME_TOUR.pages;
  const pg = pages[idx];
  const dots = pages.map((_, i) =>
    `<span class="p-welcome-tour__dot${i === idx ? ' is-active' : ''}" aria-hidden="true"></span>`).join('');
  const isLast = idx === pages.length - 1;
  overlay.innerHTML = _frame({
    id: pg.id, art: pg.art, title: pg.title, body: pg.body,
    footer: `
      <div class="p-welcome-tour__footer">
        <div class="p-welcome-tour__dots" role="img" aria-label="${idx + 1} / ${pages.length}">${dots}</div>
        <button type="button" class="p-welcome-tour__next${isLast ? ' p-welcome-tour__next--start' : ''}" data-welcome-next>
          ${_esc(pg.next)}${isLast ? '' : ' <span aria-hidden="true">→</span>'}
        </button>
      </div>`,
  });
  overlay.querySelector('[data-welcome-next]').onclick = () => {
    logEvent('welcome_tour_page', { page: idx + 1, id: pg.id });
    if (!isLast) { _showPage(overlay, idx + 1); return; }
    // ③の「はじめる」で機能紹介は終わり。ホームに置いておこう へ（追加済み・対象外なら閉じる）
    const variant = homeAddVariant();
    if (variant) _showHomeAdd(overlay, variant);
    else _finish(overlay, 'no_home_add');
  };
}

// ── ④⑤ ホームに置いておこう ─────────────────────────────────
function _showHomeAdd(overlay, variant) {
  const d = WELCOME_TOUR.homeAdd[variant];
  logEvent('home_add_prompt_shown', { variant });
  let extra = '';
  if (variant === 'android') {
    extra = `
      <ul class="p-welcome-tour__benefits">
        ${d.benefits.map(b => `
          <li class="p-welcome-tour__benefit">
            ${_img(b.icon, 'p-welcome-tour__benefit-icon')}
            <span class="p-welcome-tour__benefit-label">${_lines(b.label)}</span>
          </li>`).join('')}
      </ul>
      <p class="p-welcome-tour__note u-hidden" data-welcome-fallback>${_esc(d.fallback)}</p>`;
  } else {
    extra = `
      <div class="p-welcome-tour__howto">
        <p class="p-welcome-tour__howto-title">${_esc(d.stepsTitle)}</p>
        <ol class="p-welcome-tour__steps">
          ${d.steps.map((st, i) => `
            <li class="p-welcome-tour__step">
              ${_img(st.art, 'p-welcome-tour__step-image')}
              <span class="p-welcome-tour__step-num">STEP ${i + 1}</span>
              <span class="p-welcome-tour__step-label">${_esc(st.label)}</span>
            </li>`).join('')}
        </ol>
      </div>`;
  }
  overlay.innerHTML = _frame({
    id: d.id, art: d.art, title: d.title, body: d.body, extra,
    footer: `
      <div class="p-welcome-tour__actions">
        <button type="button" class="c-button c-button--primary c-modal__button p-welcome-tour__primary" data-welcome-primary>${_esc(d.primary)}</button>
        <button type="button" class="p-welcome-tour__later" data-welcome-later>${_esc(d.later)}</button>
      </div>`,
  });

  overlay.querySelector('[data-welcome-later]').onclick = () => {
    logEvent('home_add_later', { variant });
    _finish(overlay, 'later');
  };
  overlay.querySelector('[data-welcome-primary]').onclick = async () => {
    logEvent('home_add_tapped', { variant });
    if (variant === 'android') {
      // ★ユーザー操作の中で呼ぶ（インストールの確認はタップ起点でないと出ない）
      const outcome = await promptInstall();
      if (outcome === 'accepted' || outcome === 'dismissed') { _finish(overlay, `install_${outcome}`); return; }
      // 確認を出せないブラウザ：モーダルの中に手順を出して、閉じない（あとでで抜けられる）
      overlay.querySelector('[data-welcome-fallback]')?.classList.remove('u-hidden');
      return;
    }
    // iOS：説明のページがあれば開き、無ければ既存の追加方法の案内を出す
    if (d.guideUrl) {
      window.open(d.guideUrl, '_blank', 'noopener');
      return;
    }
    _finish(overlay, 'ios_guide');
    startPushSetupFlow({ source: 'welcome_ios_guide' });
  };
}

function _finish(overlay, reason) {
  const uid = state.currentUser?.id;
  if (uid) _set(_key(uid), 'done');
  logEvent('welcome_tour_finished', { reason });
  overlay.remove();
  state.render();
}
