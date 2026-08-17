// ===== 通知セットアップのモーダル（ホーム画面追加 → 通知許可） =====
//
// 3箇所から同じ導線を呼べるようにまとめてある：
//   1. アカウント作成の完了直後（HOME 着地時）
//   2. HOME の「通知をオンにする」バナーのタップ
//   3. 開発者からのお知らせのボタン（既存ユーザー向けの案内）
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
import {
  getPushState, enablePush, hasSubscription, isStandalone, isIOS, isSmallScreen,
  canPromptInstall, promptInstall,
} from '../push.js';

// バナーを閉じてから再表示するまでの日数
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

function _close(id) { document.getElementById(id)?.remove(); }

/** 共通の器（下からせり上がるシート） */
function _sheet(id, inner) {
  _close(id);
  const overlay = document.createElement('div');
  overlay.id = id;
  // スタイル: public/css/object/project/_push-setup.css
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--push-setup';
  overlay.innerHTML = `
    <div data-sheet class="p-push-setup__sheet animate-fadeIn">
      <div data-sheet-handle class="c-sheet__handle p-push-setup__handle">
        <div class="c-sheet__grip c-sheet__grip--sm"></div>
      </div>
      ${inner}
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

// ── 中身（お知らせモーダルからも埋め込めるよう、HTML と配線を分けてある）──
//
// startPushSetupFlow() は下からせり上がるシートとして出し、
// devAnnouncementModal は同じ中身をお知らせのページとして差し込む。

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
        ミッションの割り当てや締め切りをお知らせします。<br>
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
        ミッションの締め切りや割り当てを<br>通知でお知らせできるようになります
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
      <p class="p-push-setup__icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg></p>
      <h3 class="heading-r p-push-setup__title">通知がブロックされています</h3>
      <p class="p-push-setup__text p-push-setup__text--strong">
        ブラウザ（または端末）の設定で、<br>このサイトの通知を「許可」に変更すると受け取れます。
      </p>`;
  }
  return `
    <p class="p-push-setup__icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg></p>
    <h3 class="heading-r p-push-setup__title">通知を受け取りますか？</h3>
    <p class="p-push-setup__text">
      ミッションを割り当てられたときや<br>締め切りが近いときにお知らせします
    </p>
    <p data-psm="error" class="p-push-setup__error hidden"></p>
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
        err.classList.remove('hidden');
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

const SHEET_ID = 'push-setup-modal';

/**
 * 端末の状態に応じて必要な案内だけをシートで出す。
 * HOME のバナーと、アカウント作成の完了直後から呼ぶ。
 *
 * 分岐（pushSetupPhase）:
 *   done        … すでにオン。明示的に呼ばれたときだけ「オンです」と表示する
 *                 ★以前はここで黙って return していたため、バナーやボタンを
 *                   押しても無反応に見えるという不具合になっていた
 *   install     … 小画面かつ未追加 → ホーム画面への追加を案内
 *                 iOS はここで終わり（追加しないと許可自体できないため、
 *                 アイコンから開き直した次回に notify が出る）
 *   notify      … 通知の許可
 *
 * @param {{source?: string, silent?: boolean}} opts
 *   silent … 自動起動（作成直後）で、案内不要なら何も出さない
 */
export async function startPushSetupFlow({ source = 'unknown', silent = false } = {}) {
  if (state.pushSubscribed === null) await refreshPushSubscribed();
  const phase = pushSetupPhase();

  // 自動起動のときは、すでにオン／非対応なら黙って何もしない
  if (silent && (phase === 'done' || phase === 'unsupported')) return;

  logEvent('push_setup_started', { source, phase });

  const advanceable = phase === 'install' && !isIOS();   // Android 等は続けて通知へ
  const overlay = _sheet(SHEET_ID, `
    <div data-psm-body>${pushSetupContentHtml(phase)}</div>
    <button data-psm="later" class="p-push-setup__later">
      ${(phase === 'done' || phase === 'unsupported') ? '閉じる' : 'あとで'}
    </button>
  `);

  const body = overlay.querySelector('[data-psm-body]');
  const finish = () => { _close(SHEET_ID); state.render(); };

  const goNotify = () => {
    body.innerHTML = pushSetupContentHtml('notify');
    bindPushSetupContent(body, { phase: 'notify', onAdvance: finish });
  };

  bindPushSetupContent(body, {
    phase,
    onAdvance: () => {
      if (advanceable) { goNotify(); return; }
      finish();
    },
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
  overlay.querySelector('[data-psm="later"]').onclick = () => {
    if (phase !== 'done' && phase !== 'unsupported') recordPushSkipped();
    finish();
  };
}

/** いま HOME に通知バナーを出すべきか（同期判定用のキャッシュを見る） */
export function shouldShowPushBanner() {
  if (!state.currentUser) return false;
  if (getPushState() === 'unsupported') return false;
  if (state.pushSubscribed === true) return false;      // 購読済み
  if (state.pushSubscribed === null) return false;      // 未判定のうちは出さない（ちらつき防止）
  const key = `evecre:pushBanner:dismissedAt:${state.currentUser.id}`;
  const at = Number(localStorage.getItem(key) || 0);
  if (!at) return true;
  return (Date.now() - at) > BANNER_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

/** バナーを閉じた記録（BANNER_SNOOZE_DAYS 日は出さない） */
export function dismissPushBanner() {
  if (!state.currentUser) return;
  localStorage.setItem(`evecre:pushBanner:dismissedAt:${state.currentUser.id}`, String(Date.now()));
  logEvent('push_banner_dismissed');
  state.render();
}

/** HOME に出すバナーの HTML（出さないときは空文字） */
export function pushBannerHtml() {
  if (!shouldShowPushBanner()) return '';
  return `
    <div class="p-push-banner">
      <span class="p-push-banner__icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg></span>
      <button id="push-banner-open" class="p-push-banner__open">
        <p class="p-push-banner__title">通知をオンにしませんか？</p>
        <p class="p-push-banner__sub">
          ${_esc(isIOS() && !isStandalone()
            ? 'ホーム画面に追加すると受け取れます'
            : '締め切りや割り当てをお知らせします')}
        </p>
      </button>
      <button id="push-banner-close" class="p-push-banner__close" aria-label="閉じる">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>`;
}

/** バナーのイベント配線（HOME の描画後に呼ぶ） */
export function bindPushBanner() {
  document.getElementById('push-banner-open')?.addEventListener('click', () => {
    logEvent('push_banner_tapped');
    startPushSetupFlow({ source: 'home_banner' });
  });
  document.getElementById('push-banner-close')?.addEventListener('click', dismissPushBanner);
}

/**
 * 購読状態を調べて state に載せる（バナーの表示判定を同期で行えるようにする）。
 * アプリ起動時と、通知をオンにした直後に呼ぶ。
 */
export async function refreshPushSubscribed() {
  try { state.pushSubscribed = await hasSubscription(); }
  catch (_) { state.pushSubscribed = false; }
}
