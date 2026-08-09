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

const INSTALL_ID = 'push-install-modal';
const NOTIFY_ID  = 'push-notify-modal';

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
  overlay.className = 'fixed inset-0 bg-black/50 z-[260] flex items-end justify-center';
  overlay.innerHTML = `
    <div data-sheet class="bg-white rounded-t-3xl w-full max-w-lg px-6 pt-5 pb-10 animate-fadeIn">
      <div data-sheet-handle class="flex justify-center pt-1 pb-4 -mt-2">
        <div class="w-10 h-1 bg-[#D3D6D8] rounded-full"></div>
      </div>
      ${inner}
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

// ── ① ホーム画面に追加 ──────────────────────────────────────

/**
 * @param {{onDone: function}} opts onDone は閉じたあとに必ず呼ばれる
 */
function _openInstallModal({ onDone }) {
  const ios = isIOS();
  const native = canPromptInstall();
  logEvent('pwa_prompt_shown', { ios, native });

  const guide = ios ? `
      <ol class="text-[13px] text-[#484545] leading-relaxed list-decimal pl-5 space-y-1.5 mb-4">
        <li>画面下の <span class="font-bold">共有</span> ボタン（□に↑）をタップ</li>
        <li><span class="font-bold">「ホーム画面に追加」</span>を選ぶ</li>
        <li>追加されたアイコンからイベクリを開く</li>
      </ol>
      <p class="text-[12px] text-[#0CA1E3] font-bold leading-relaxed mb-5">
        iPhone / iPad では、この手順をしないと通知を受け取れません。
      </p>`
    : native ? `
      <p class="text-[13px] text-[#484545] leading-relaxed mb-5">
        ホーム画面から1タップで開けるようになり、通知も受け取りやすくなります。
      </p>`
    : `
      <ol class="text-[13px] text-[#484545] leading-relaxed list-decimal pl-5 space-y-1.5 mb-5">
        <li>ブラウザのメニュー（⋮）を開く</li>
        <li><span class="font-bold">「アプリをインストール」</span>または「ホーム画面に追加」を選ぶ</li>
      </ol>`;

  const overlay = _sheet(INSTALL_ID, `
    <p class="text-[28px] text-center mb-2">📲</p>
    <h3 class="heading-r text-[#484545] font-bold text-center mb-2">ホーム画面に追加しませんか？</h3>
    <p class="text-[12px] text-[#A7AAAC] font-bold text-center mb-5 leading-relaxed">
      ミッションの締め切りや割り当てを<br>通知でお知らせできるようになります
    </p>
    ${guide}
    ${native ? `
      <button id="psm-install" class="w-full py-4 rounded-2xl font-bold text-[14px] text-white bg-[#0CA1E3] mb-3">
        ホーム画面に追加する
      </button>` : ''}
    <button id="psm-install-later" class="w-full py-3 text-[13px] text-[#A7AAAC] font-bold">
      ${native ? 'あとで' : 'わかりました'}
    </button>
  `);

  const finish = (installed) => { _close(INSTALL_ID); onDone(installed); };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
  document.getElementById('psm-install-later').onclick = () => {
    logEvent('pwa_prompt_dismissed', { ios });
    finish(false);
  };
  document.getElementById('psm-install')?.addEventListener('click', async () => {
    const btn = document.getElementById('psm-install');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    const r = await promptInstall();
    finish(r === 'accepted');
  });
}

// ── ② 通知の許可 ────────────────────────────────────────────

function _openNotifyModal({ onDone }) {
  const st = getPushState();
  logEvent('push_prompt_shown', { state: st, where: 'modal' });

  const body =
    st === 'denied' ? `
      <div class="bg-[#FFF7E6] border border-[#FFC300] rounded-2xl p-4 mb-5">
        <p class="text-[13px] font-bold text-[#484545] mb-1">通知がブロックされています</p>
        <p class="text-[12px] text-[#484545] leading-relaxed">
          ブラウザ（または端末）の設定で、このサイトの通知を「許可」に変更すると受け取れます。
        </p>
      </div>
      <button id="psm-notify-close" class="w-full py-4 rounded-2xl font-bold text-[14px] text-white bg-[#0CA1E3]">
        わかりました
      </button>`
    : `
      <button id="psm-notify-on" class="w-full py-4 rounded-2xl font-bold text-[14px] text-white bg-[#0CA1E3] mb-3">
        通知をオンにする
      </button>
      <button id="psm-notify-later" class="w-full py-3 text-[13px] text-[#A7AAAC] font-bold">
        あとで
      </button>`;

  const overlay = _sheet(NOTIFY_ID, `
    <p class="text-[28px] text-center mb-2">🔔</p>
    <h3 class="heading-r text-[#484545] font-bold text-center mb-2">通知を受け取りますか？</h3>
    <p class="text-[12px] text-[#A7AAAC] font-bold text-center mb-5 leading-relaxed">
      ミッションを割り当てられたときや<br>締め切りが近いときにお知らせします
    </p>
    <p id="psm-notify-error" class="text-[12px] text-[#EE3E12] font-bold text-center mb-3 hidden"></p>
    ${body}
  `);

  const finish = () => { _close(NOTIFY_ID); onDone(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { _savePreference('skipped'); finish(); } });

  document.getElementById('psm-notify-close')?.addEventListener('click', () => {
    _savePreference('skipped'); finish();
  });
  document.getElementById('psm-notify-later')?.addEventListener('click', () => {
    // ★「あとで」では enablePush() を呼ばない。
    //   一度ブロックされるとプログラムからは二度と出せなくなるため。
    _savePreference('skipped');
    finish();
  });

  // ★click ハンドラの中で直接 enablePush() を呼ぶ（手前に await を置かない）
  document.getElementById('psm-notify-on')?.addEventListener('click', () => {
    logEvent('push_enable_tap', { where: 'modal' });
    const btn = document.getElementById('psm-notify-on');
    if (btn) { btn.disabled = true; btn.textContent = '設定中…'; btn.style.opacity = '0.6'; }

    enablePush().then(async (r) => {
      if (r.ok) {
        await _savePreference('enabled');
        _close(NOTIFY_ID);
        window._app?.showToast('通知をオンにしました', 'info');
        onDone();
        state.render();   // バナーを消す
        return;
      }
      await _savePreference('skipped');
      const err = document.getElementById('psm-notify-error');
      if (err) {
        err.textContent = r.error === 'denied'
          ? '通知が許可されませんでした。あとから設定でオンにできます。'
          : '通知を設定できませんでした。あとから設定でオンにできます。';
        err.classList.remove('hidden');
      }
      if (btn) { btn.disabled = false; btn.textContent = '通知をオンにする'; btn.style.opacity = '1'; }
      setTimeout(() => { _close(NOTIFY_ID); onDone(); }, 2200);
    });
  });
}

// ── 呼び出し口 ──────────────────────────────────────────────

/**
 * 端末の状態に応じて、必要なモーダルだけを順に出す。
 *
 * 分岐:
 *   - すでに購読済み / 通知に非対応  → 何も出さない
 *   - PC またはホーム画面追加済み    → 通知モーダルだけ
 *   - iOS（未追加）                  → 追加モーダルだけ
 *     ★iOS は追加しないと許可自体できないので、通知モーダルを続けて出さない。
 *       アイコンから開き直した次回に通知モーダルが出る
 *   - Android 等（未追加）           → 追加モーダル → 通知モーダル
 *
 * @param {{source?: string}} opts 計測用の呼び出し元
 */
export async function startPushSetupFlow({ source = 'unknown' } = {}) {
  const st = getPushState();
  if (st === 'unsupported') return;
  if (await hasSubscription()) return;   // もうオンになっている

  logEvent('push_setup_started', { source, state: st });

  const needInstall = isSmallScreen() && !isStandalone();
  const done = () => { state.render(); };

  if (!needInstall) { _openNotifyModal({ onDone: done }); return; }

  _openInstallModal({
    onDone: (installed) => {
      if (isIOS()) {
        // iOS はホーム画面から開き直さない限り許可できない。ここで終わり。
        _savePreference('ios_pending');
        done();
        return;
      }
      // Android 等は追加の有無にかかわらず通知の許可は出せる
      setTimeout(() => _openNotifyModal({ onDone: done }), installed ? 600 : 250);
    },
  });
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
    <div class="bg-[#EBF7FE] border border-[#0CA1E3]/40 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
      <span class="text-[20px] flex-shrink-0">🔔</span>
      <button id="push-banner-open" class="flex-1 text-left">
        <p class="text-[13px] font-bold text-[#0CA1E3] leading-snug">通知をオンにしませんか？</p>
        <p class="text-[11px] text-[#484545] font-bold leading-snug mt-0.5">
          ${_esc(isIOS() && !isStandalone()
            ? 'ホーム画面に追加すると受け取れます'
            : '締め切りや割り当てをお知らせします')}
        </p>
      </button>
      <button id="push-banner-close" class="p-1.5 -mr-1 flex-shrink-0" aria-label="閉じる">
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
