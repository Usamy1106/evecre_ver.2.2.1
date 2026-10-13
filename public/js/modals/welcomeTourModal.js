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
//   次に開いたとき（再ログイン・再読み込み）に出す。通知は pushSetupModal.js の checkPushPromptOnLaunch が判定する
//   （2026-10-13 に「次に通知の案内を出す」印 evecre:pushAfterSignup は廃止。未購読なら次の回に出すので印は要らない）

import { state } from '../state.js';
import { WELCOME_TOUR } from '../welcomeTour.js';
import { isStandalone, isIOS, isSmallScreen, canPromptInstall, promptInstall } from '../push.js';
import { bindPushSetupContent, recordPushSkipped, snoozePushPrompt } from './pushSetupModal.js';
import { getPushState } from '../push.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { logEvent } from '../logger.js';

export const WELCOME_TOUR_ID = 'welcome-tour-overlay';

const _key = (userId) => `evecre:welcomeTour:v1:${userId}`;

function _get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

/** アカウント作成の完了で呼ぶ（signup.js）。以後、HOME に着いたら出す */
export function markWelcomeTourPending(userId) {
  if (!userId) return;
  _set(_key(userId), 'pending');
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
  overlay.className = 'c-overlay c-overlay--center c-overlay--snug c-overlay--blur c-overlay--auto';
  document.body.appendChild(overlay);
  logEvent('welcome_tour_shown');
  _showPage(overlay, 0);
}

// ── 共通の枠 ────────────────────────────────────────────────
function _frame({ id, art, title, body, extra = '', footer }) {
  return `
    <div class="p-welcome-tour u-animate-fade" role="dialog" aria-modal="true" aria-labelledby="welcome-tour-title" data-welcome-page="${_esc(id)}">
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
  _renderHomeAdd(overlay, variant, 'welcome', (reason) => _finish(overlay, reason));
}

/**
 * ホームに置いておこう の1枚（④ Android／⑤ iPhone）。ようこそ画面と HOME のバナーで共用する。
 * @param {string} source  計測用（welcome / home_banner）
 * @param {(reason: string) => void} done  閉じるとき
 * ★2026-10-13：iPhone のボタンは「わかった」（閉じるだけ）。以前は通知のセットアップを開いており、
 *   同じ「ホームに置いておこう」がもう一度出ていた。guideUrl があればそのページを開く
 */
function _renderHomeAdd(overlay, variant, source, done) {
  const d = WELCOME_TOUR.homeAdd[variant];
  logEvent('home_add_prompt_shown', { variant, source });
  overlay.innerHTML = _frame({
    id: d.id, art: d.art, title: d.title, body: d.body, extra: _homeAddExtra(variant),
    footer: `
      <div class="p-welcome-tour__actions">
        <button type="button" class="c-button c-button--primary c-modal__button p-welcome-tour__primary" data-welcome-primary>${_esc(d.primary)}</button>
        <button type="button" class="p-welcome-tour__later" data-welcome-later>${_esc(d.later)}</button>
      </div>`,
  });

  overlay.querySelector('[data-welcome-later]').onclick = () => {
    logEvent('home_add_later', { variant, source });
    done('later');
  };
  overlay.querySelector('[data-welcome-primary]').onclick = async () => {
    logEvent('home_add_tapped', { variant, source });
    if (variant === 'android') {
      // ★ユーザー操作の中で呼ぶ（インストールの確認はタップ起点でないと出ない）
      const outcome = await promptInstall();
      if (outcome === 'accepted' || outcome === 'dismissed') { done(`install_${outcome}`); return; }
      // 確認を出せないブラウザ：モーダルの中に手順を出して、閉じない（あとでで抜けられる）
      overlay.querySelector('[data-welcome-fallback]')?.classList.remove('u-hidden');
      return;
    }
    // iOS：説明のページがあれば開く。無ければ閉じる（手順はこの画面の写真で伝えてある）
    if (d.guideUrl) {
      window.open(d.guideUrl, '_blank', 'noopener');
      return;
    }
    done('ios_ok');
  };
}

// ── HOME のバナー「イベクリをホームに置こう」から開く（2026-10-13）─────────────
// ★通知より先に、ホーム画面への追加を勧める。通知の許可は次に開いたときに自動で聞く
//   （pushSetupModal.js の checkPushPromptOnLaunch。iPhone は追加したアイコンから開かないと許可できない）
export const HOME_ADD_ID = 'home-add-modal';

export function openHomeAddModal({ source = 'home_banner' } = {}) {
  const variant = homeAddVariant();
  if (!variant) return;
  document.getElementById(HOME_ADD_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = HOME_ADD_ID;
  overlay.className = 'c-overlay c-overlay--center c-overlay--snug c-overlay--blur c-overlay--auto';
  document.body.appendChild(overlay);
  _renderHomeAdd(overlay, variant, source, () => {
    overlay.remove();
    state.render();
  });
}

/** ④⑤の補足（Android＝メリット4つ／iPhone＝操作の写真3枚を3列で） */
function _homeAddExtra(variant) {
  const d = WELCOME_TOUR.homeAdd[variant];
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
  return extra;
}

function _finish(overlay, reason) {
  const uid = state.currentUser?.id;
  if (uid) _set(_key(uid), 'done');
  logEvent('welcome_tour_finished', { reason });
  overlay.remove();
  state.render();
}

// ── 通知のセットアップ（次に開いたときに自動で出す。2026-10-13）─────────────────
// 旧・下からせり上がるシート（p-push-setup__sheet）の後継。④⑤と同じ見た目のモーダルで、通知をオンにする1枚だけ。
// ★2026-10-13：以前の1枚目「ホームに置いておこう」は外した（ホーム画面への追加は HOME のバナー openHomeAddModal が担う）
// ★iPhone / iPad をブラウザのまま開いているときは、通知の許可そのものができない（ホーム画面に追加が必須）。
//   ボタンを出さず、追加したアイコンから開くよう案内する
// ★通知の許可（enablePush）はボタンの click から同期で呼ぶ（bindPushSetupContent が担う）
// ★「あとで」は7日間出さない（snoozePushPrompt）
export const PUSH_SETUP_ID = 'push-setup-modal';

/**
 * @param {{ source?: string, phase: 'install'|'notify'|'done'|'unsupported' }} o
 */
export function openPushSetupTour({ source = 'unknown', phase }) {
  document.getElementById(PUSH_SETUP_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = PUSH_SETUP_ID;
  // ★c-overlay--push-setup：次に開いたときに自動で出るので、ほかの画面より前に重ねる（旧シートと同じ）
  overlay.className = 'c-overlay c-overlay--center c-overlay--snug c-overlay--blur c-overlay--auto c-overlay--push-setup';
  document.body.appendChild(overlay);

  const close = (reason) => {
    logEvent('push_setup_closed', { source, reason });
    overlay.remove();
    state.render();
  };
  const later = () => {
    if (phase !== 'done' && phase !== 'unsupported') { recordPushSkipped(); snoozePushPrompt(); }
    close('later');
  };

  const n = WELCOME_TOUR.notify;
  const iosBrowser = isIOS() && !isStandalone();
  const st = getPushState();
  const msg = phase === 'done' ? n.done
    : phase === 'unsupported' ? n.unsupported
    : iosBrowser ? n.iosNotInstalled
    : st === 'denied' ? n.denied
    : null;
  const canEnable = !msg;
  overlay.innerHTML = _frame({
    id: 'push-notify', art: n.art, title: n.title, body: msg || n.body,
    extra: canEnable ? '<p data-psm="error" class="p-welcome-tour__note u-hidden"></p>' : '',
    footer: `
      <div class="p-welcome-tour__actions">
        ${canEnable
          ? `<button type="button" class="c-button c-button--primary c-modal__button p-welcome-tour__primary" data-psm="enable">${_esc(n.primary)}</button>
             <button type="button" class="p-welcome-tour__later" data-push-later>${_esc(n.later)}</button>`
          : `<button type="button" class="c-button c-button--primary c-modal__button p-welcome-tour__primary" data-push-close>${_esc(n.close)}</button>`}
      </div>`,
  });
  overlay.querySelector('[data-push-later]')?.addEventListener('click', later);
  overlay.querySelector('[data-push-close]')?.addEventListener('click', () => {
    // ★iPhone のブラウザのままは「あとで」と同じく、追加してから入れる人として記録する
    if (iosBrowser && phase !== 'done' && phase !== 'unsupported') { recordPushSkipped(); snoozePushPrompt(); }
    close('closed');
  });
  if (canEnable) {
    bindPushSetupContent(overlay, { phase: 'notify', onAdvance: () => close('enabled') });
  }

  logEvent('push_setup_shown', { source, phase });
}
