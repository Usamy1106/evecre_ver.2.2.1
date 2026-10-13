// ===== 通知セットアップ（ホーム画面追加のバナー・通知許可のモーダル） =====
//
// ★2026-10-13：通知より先に「イベクリをホームに置こう」。
//   1. HOME のバナー「イベクリをホームに置こう」→ ホームに置いておこう のモーダル（welcomeTourModal.js の openHomeAddModal）
//   2. 通知の許可は、次に開いたとき（再ログイン・再読み込み）にモーダルで聞く（checkPushPromptOnLaunch → openPushSetupTour）
//   3. 開発者からのお知らせのボタン（既存ユーザー向けの案内。下の pushSetupContentHtml を埋め込む）
//
// ★オンボーディングの途中では出さない。iOS はホーム画面に追加しないと
//   通知の許可自体ができず、作成途中に Safari の共有シートへ誘導すると
//   流れが切れてしまうため、アカウントができてから案内する。
//
// ★enablePush() は必ずボタンの click ハンドラから同期的に呼ぶこと。
//   手前に await を挟むとユーザー操作起点とみなされず iOS で無反応になる。

import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { openPushSetupTour, openHomeAddModal, homeAddVariant } from './welcomeTourModal.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import {
  getPushState, enablePush, hasSubscription, isStandalone, isIOS, isSmallScreen,
  canPromptInstall, promptInstall,
} from '../push.js';

// バナー・通知の案内を閉じてから再表示するまでの日数
export const BANNER_SNOOZE_DAYS = 7;

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 意向を保存する（オンボーディングの進行は動かさない＝step を送らない） */
async function _savePreference(value) {
  try { await api.saveOnboarding({ notificationPreference: value }); }
  catch (e) { console.warn('[push-setup] 意向の保存に失敗:', e); }
}

// ── 中身（お知らせモーダルからも埋め込めるよう、HTML と配線を分けてある）──
//
// 通知のモーダルは welcomeTourModal.js の openPushSetupTour（④⑤と同じ見た目）。
// devAnnouncementModal は下の中身をお知らせのページとして差し込む。

/** いまこの端末で案内すべき段階 */
export function pushSetupPhase() {
  if (state.pushSubscribed === true) return 'done';          // もうオンになっている
  if (getPushState() === 'unsupported') return 'unsupported';
  if (isSmallScreen() && !isStandalone()) return 'install';  // 先にホーム画面へ追加
  return 'notify';
}

/**
 * 案内の中身（見出し・説明・ボタン）を返す。
 * @param {'install'|'notify'|'done'|'unsupported'} phase
 */
export function pushSetupContentHtml(phase) {
  if (phase === 'done') {
    return `
      <p class="p-push-setup__icon">✅</p>
      <h3 class="heading-r p-push-setup__title">通知はオンになっています</h3>
      <p class="p-push-setup__text">
        担当の割り当てや締め切りをお知らせします。<br>
        アカウント設定からいつでも変更できます。
      </p>`;
  }
  if (phase === 'unsupported') {
    return `
      <p class="p-push-setup__icon">🔔</p>
      <h3 class="heading-r p-push-setup__title">通知について</h3>
      <p class="p-push-setup__text">
        このブラウザは通知に対応していません。<br>
        Chrome や Safari でお試しください。
      </p>`;
  }

  if (phase === 'install') {
    const ios = isIOS();
    const native = canPromptInstall();
    const guide = ios ? `
        <ol class="p-push-setup__steps">
          <li>画面下の <span class="p-push-setup__strong">共有</span> ボタン（□に↑）をタップ</li>
          <li><span class="p-push-setup__strong">「ホーム画面に追加」</span>を選ぶ</li>
          <li>追加されたアイコンからイベクリを開く</li>
        </ol>
        <p class="p-push-setup__note">
          iPhone / iPad では、この手順をしないと通知を受け取れません。
        </p>`
      : native ? `
        <p class="p-push-setup__lead">
          ホーム画面から1タップで開けるようになり、通知も受け取りやすくなります。
        </p>`
      : `
        <ol class="p-push-setup__steps p-push-setup__steps--roomy">
          <li>ブラウザのメニュー（⋮）を開く</li>
          <li><span class="p-push-setup__strong">「アプリをインストール」</span>または「ホーム画面に追加」を選ぶ</li>
        </ol>`;
    return `
      <p class="p-push-setup__icon">📲</p>
      <h3 class="heading-r p-push-setup__title">ホーム画面に追加しませんか？</h3>
      <p class="p-push-setup__text p-push-setup__text--tight">
        やることの締め切りや割り当てを<br>通知でお知らせできるようになります
      </p>
      ${guide}
      ${native ? `
        <button data-psm="install" class="c-button c-button--primary p-push-setup__primary">
          ホーム画面に追加する
        </button>` : ''}`;
  }

  // notify
  const st = getPushState();
  if (st === 'denied') {
    return `
      <p class="p-push-setup__icon"><img src="/images/icon/icon-notification-default.svg" width="20" height="20" alt=""></p>
      <h3 class="heading-r p-push-setup__title">通知がブロックされています</h3>
      <p class="p-push-setup__text p-push-setup__text--strong">
        ブラウザ（または端末）の設定で、<br>このサイトの通知を「許可」に変更すると受け取れます。
      </p>`;
  }
  return `
    <p class="p-push-setup__icon"><img src="/images/icon/icon-notification-default.svg" width="20" height="20" alt=""></p>
    <h3 class="heading-r p-push-setup__title">通知を受け取りますか？</h3>
    <p class="p-push-setup__text">
      やることを割り当てられたときや<br>締め切りが近いときにお知らせします
    </p>
    <p data-psm="error" class="p-push-setup__error u-hidden"></p>
    <button data-psm="enable" class="c-button c-button--primary p-push-setup__primary">
      通知をオンにする
    </button>`;
}

/**
 * 上の HTML に対してボタンを配線する。
 * @param {HTMLElement} root  中身を差し込んだ要素
 * @param {{phase: string, onAdvance: function}} opts
 *   onAdvance(次に進んでよいか) … 許可/追加のあとに呼ばれる
 */
export function bindPushSetupContent(root, { phase, onAdvance }) {
  // ホーム画面への追加（Android/Chrome のネイティブ確認）
  root.querySelector('[data-psm="install"]')?.addEventListener('click', async () => {
    const btn = root.querySelector('[data-psm="install"]');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    const r = await promptInstall();
    if (r === 'accepted') window._app?.showToast('ホーム画面に追加しました', 'info');
    onAdvance?.(r === 'accepted');
  });

  // ★通知の許可は click ハンドラの中で直接 enablePush() を呼ぶ。
  //   手前に await を挟むとユーザー操作起点とみなされず iOS で無反応になる。
  root.querySelector('[data-psm="enable"]')?.addEventListener('click', () => {
    logEvent('push_enable_tap', { where: 'modal', phase });
    const btn = root.querySelector('[data-psm="enable"]');
    if (btn) { btn.disabled = true; btn.textContent = '設定中…'; btn.style.opacity = '0.6'; }

    enablePush().then(async (r) => {
      if (r.ok) {
        state.pushSubscribed = true;
        await _savePreference('enabled');
        window._app?.showToast('通知をオンにしました', 'info');
        onAdvance?.(true);
        return;
      }
      await _savePreference('skipped');
      const err = root.querySelector('[data-psm="error"]');
      if (err) {
        err.textContent = r.error === 'denied'
          ? '通知が許可されませんでした。あとから設定でオンにできます。'
          : '通知を設定できませんでした。あとから設定でオンにできます。';
        err.classList.remove('u-hidden');
      }
      if (btn) { btn.disabled = false; btn.textContent = '通知をオンにする'; btn.style.opacity = '1'; }
    });
  });
}

/** 「あとで」を選んだときの記録 */
export function recordPushSkipped() {
  // ★ここで enablePush() を呼ばない。一度ブロックされると二度と出せなくなるため。
  _savePreference(isIOS() && !isStandalone() ? 'ios_pending' : 'skipped');
}

// ── 呼び出し口 ──────────────────────────────────────────────

// ── 通知の案内を「次に開いたとき」に出す（2026-10-13）─────────────────────
// ★HOME のバナーは通知ではなく「イベクリをホームに置こう」（下の homeAddBannerHtml）。
//   通知の許可は、ページを開き直したとき（再ログイン・再読み込み・ホーム画面のアイコンから開いた）に
//   モーダルで1回だけ聞く。アカウントを作ったその回とオンボーディングの途中は出さない（state.js が弾く）
// ★出すのは「いまこの端末で許可を求められる」ときだけ（phase === 'notify' かつ拒否されていない）。
//   iPhone をブラウザのまま開いているときは許可できないので出さない（先にホームに置いてもらう）
// ★「あとで」から7日間は出さない（snoozePushPrompt）。アカウント設定で自分でオフにした直後も同じ
const PUSH_PROMPT_SNOOZE_KEY = (uid) => `evecre:pushBanner:dismissedAt:${uid}`;   // ★キー名は旧バナーのまま（既存の「あとで」を引き継ぐ）

function _isPushPromptSnoozed(uid) {
  try {
    const at = Number(localStorage.getItem(PUSH_PROMPT_SNOOZE_KEY(uid)) || 0);
    return !!at && (Date.now() - at) <= BANNER_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch (_) { return false; }
}

/**
 * 通知の案内を BANNER_SNOOZE_DAYS 日ぶん出さないようにする（記録のみ）。
 * ★アカウント設定から自分でオフにした直後にも使う。自分で切ったそばから
 *   「オンにしよう」と出すと、操作を否定されたように見えるため。
 */
export function snoozePushPrompt() {
  if (!state.currentUser) return;
  try { localStorage.setItem(PUSH_PROMPT_SNOOZE_KEY(state.currentUser.id), String(Date.now())); } catch (_) {}
}

/**
 * ページを開いたときに1回だけ呼ぶ（state.js）。出せないとき（ほかのモーダルが出ている）は false を返し、次の render で呼び直させる
 * @returns {Promise<boolean>} 判定を終えたか
 */
export async function checkPushPromptOnLaunch() {
  const uid = state.currentUser?.id;
  if (!uid) return true;
  if (state.pushSubscribed === null) await refreshPushSubscribed();
  if (pushSetupPhase() !== 'notify' || getPushState() === 'denied') return true;
  if (_isPushPromptSnoozed(uid)) return true;
  if (document.getElementById('push-setup-modal')) return true;
  if (isAnyAutoModalOpen('push-setup-modal') || document.querySelector('.c-overlay')) return false;
  logEvent('push_setup_started', { source: 'next_session', phase: 'notify' });
  openPushSetupTour({ source: 'next_session', phase: 'notify' });
  return true;
}

// ── HOME のバナー「イベクリをホームに置こう」（2026-10-13。旧「通知をオンにしませんか？」）──────
// ★出すのは、ホーム画面に追加できる端末で、まだホーム画面から開いていないとき（homeAddVariant が null でない）
// ★× で7日間出さない（evecre:homeBanner:dismissedAt:{userId}）
const HOME_BANNER_KEY = (uid) => `evecre:homeBanner:dismissedAt:${uid}`;

function shouldShowHomeAddBanner() {
  if (!state.currentUser) return false;
  if (!homeAddVariant()) return false;
  try {
    const at = Number(localStorage.getItem(HOME_BANNER_KEY(state.currentUser.id)) || 0);
    if (!at) return true;
    return (Date.now() - at) > BANNER_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch (_) { return true; }
}

/** HOME に出すバナーの HTML（出さないときは空文字） */
export function homeAddBannerHtml() {
  if (!shouldShowHomeAddBanner()) return '';
  return `
    <div class="p-push-banner">
      <span class="p-push-banner__icon"><span class="c-icon p-push-banner__icon-image" style="--icon:url('/images/icon/icon-home-default.svg')" aria-hidden="true"></span></span>
      <button id="home-banner-open" class="p-push-banner__open" data-log="home_banner_open">
        <p class="p-push-banner__title">イベクリをホームに置こう</p>
        <p class="p-push-banner__sub">アプリのようにすぐ開けて、お知らせも受け取れます</p>
      </button>
      <button id="home-banner-close" class="p-push-banner__close" aria-label="閉じる">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>`;
}

/** バナーのイベント配線（HOME の描画後に呼ぶ） */
export function bindHomeAddBanner() {
  document.getElementById('home-banner-open')?.addEventListener('click', () => {
    openHomeAddModal({ source: 'home_banner' });
  });
  document.getElementById('home-banner-close')?.addEventListener('click', () => {
    if (!state.currentUser) return;
    try { localStorage.setItem(HOME_BANNER_KEY(state.currentUser.id), String(Date.now())); } catch (_) {}
    logEvent('home_banner_dismissed');
    state.render();
  });
}

/**
 * 通知が「実際に届く状態か」を調べて state に載せる
 * （バナーの表示判定を同期で行えるようにする）。
 *
 * ★購読オブジェクトの有無だけでは足りない。ブラウザや OS の設定から通知を
 *   オフにされても PushSubscription は残るため、hasSubscription() は true を
 *   返し続ける。そのまま信じると「通知が来ないのにバナーも出ない」人が生まれる。
 *   許可（Notification.permission）が granted であることも必ず確認する。
 *
 * アプリ起動時と、通知をオン／オフした直後に呼ぶ。
 */
export async function refreshPushSubscribed() {
  try {
    state.pushSubscribed = (getPushState() === 'granted') && await hasSubscription();
  } catch (_) { state.pushSubscribed = false; }
}
