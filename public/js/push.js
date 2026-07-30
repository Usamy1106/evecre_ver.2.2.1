// ===== Web Push（購読とタップ遷移）=====
// 「閉じている間の呼び戻し」を担う。開いている間のリアルタイム同期は SSE（realtime.js）が担当し、
// こちらとは役割が別。realtime.js には手を入れない。
//
// ★iOS の制約：
//   - PWA（ホーム画面に追加）でないと許可ダイアログすら出ない
//   - 許可リクエストはユーザー操作（ボタンのタップ）を起点にしないと無反応
//   このため enablePush() は必ず click ハンドラから呼ぶこと。読み込み時に自動実行しない。

import { logEvent } from './logger.js';

// ── 環境判定 ────────────────────────────────────────────────

/** ホーム画面から起動された PWA か（iOS は navigator.standalone、他は display-mode） */
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/** iOS（iPadOS のデスクトップ表示も含む。auth.js の判定と同じ方式） */
export function isIOS() {
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS 13+ は Macintosh を騙るのでタッチ有無で見分ける
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

/** この環境で push を購読できる可能性があるか（許可状態は見ない） */
export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * 通知 UI の出し方を決める。account.js の表示分岐で使う。
 * @returns {'unsupported'|'ios-needs-install'|'granted'|'denied'|'available'}
 */
export function getPushState() {
  if (isIOS() && !isStandalone()) return 'ios-needs-install'; // 先に判定（iOS Safari は PushManager を持たない）
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';
  return 'available';
}

// ── Service Worker ──────────────────────────────────────────

let _swReg = null;

/** SW を登録する（アプリ起動時に1回。失敗してもアプリの動作は妨げない） */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    _swReg = await navigator.serviceWorker.register('/sw.js');
    return _swReg;
  } catch (e) {
    console.warn('[push] SW 登録失敗:', e.message);
    return null;
  }
}

// ── 購読 ────────────────────────────────────────────────────

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * 通知を有効化する。★必ずユーザーのタップから呼ぶこと（iOS の必須条件）。
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function enablePush() {
  if (!isPushSupported()) return { ok: false, error: 'unsupported' };

  try {
    const res = await fetch('/api/push/vapid-public-key', { credentials: 'include' });
    const { enabled, publicKey } = await res.json();
    if (!enabled || !publicKey) {
      console.warn('[push] VAPID 鍵が未設定（サーバ側）');
      return { ok: false, error: 'not_configured' };
    }

    // 許可ダイアログ。iOS はここがユーザー操作起点でないと無反応になる。
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      logEvent('push_denied', { permission });
      return { ok: false, error: 'denied' };
    }

    const reg = _swReg || await navigator.serviceWorker.ready;
    // 既存購読があれば使い回す（重複購読を作らない）
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(publicKey),
      });
    }

    const saveRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    const saved = await saveRes.json();
    if (!saved?.ok) return { ok: false, error: saved?.error || 'save_failed' };

    logEvent('push_enabled', { standalone: isStandalone(), ios: isIOS() });
    return { ok: true };
  } catch (e) {
    console.error('[push] 有効化に失敗:', e);
    return { ok: false, error: e.message || 'failed' };
  }
}

/** 通知を無効化する（この端末の購読だけ削除。他端末は残る） */
export async function disablePush() {
  try {
    const reg = _swReg || await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
    logEvent('push_disabled');
    return { ok: true };
  } catch (e) {
    console.error('[push] 無効化に失敗:', e);
    return { ok: false, error: e.message };
  }
}

/** この端末が購読済みか（設定 UI の表示切替用） */
export async function hasSubscription() {
  if (!isPushSupported()) return false;
  try {
    const reg = _swReg || await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch (_) {
    return false;
  }
}

// ── 通知タップ後の遷移 ──────────────────────────────────────
// 通知の url は既存のディープリンク形式（/m/<eventId>/<missionId> または /）。
// - コールドスタート：state.init() が pathname を読んで pendingMissionLink に積む（既存実装）
// - ウォームスタート：sw.js が postMessage(PUSH_NAVIGATE) を送るのでここで受ける

/**
 * SW からの遷移指示を受け取る配線（main.js のエントリで1回呼ぶ）。
 * @param {(url: string) => void} onNavigate
 */
export function initPushNavigation(onNavigate) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data?.type) return;

    // 診断：push は届いているのに OS が通知を出さないケースを切り分ける。
    // アプリを開いたままテスト送信するとこれが飛ぶ（閉じていれば誰も受け取らない）。
    if (data.type === 'PUSH_RECEIVED') {
      console.log('[push] 受信しました:', data.title, data.body);
      window._app?.showToast?.('通知を受信しました（OSの表示は端末設定によります）');
      return;
    }
    if (data.type === 'PUSH_SHOW_FAILED') {
      console.error('[push] 通知の表示に失敗:', data.error);
      window._app?.showToast?.('通知の表示に失敗しました', 'error');
      return;
    }

    if (data.type !== 'PUSH_NAVIGATE' || !data.url) return;
    try {
      onNavigate(data.url);
    } catch (e) {
      console.error('[push] 遷移に失敗:', e);
    }
  });
}

/**
 * 通知まわりの診断情報（届かない原因の切り分け用）。
 * @returns {Promise<object>}
 */
export async function getPushDiagnostics() {
  const diag = {
    state:        getPushState(),
    permission:   (typeof Notification !== 'undefined') ? Notification.permission : '(なし)',
    standalone:   isStandalone(),
    ios:          isIOS(),
    swSupported:  'serviceWorker' in navigator,
    swController: !!navigator.serviceWorker?.controller,
    swActive:     false,
    subscribed:   false,
  };
  try {
    const reg = await navigator.serviceWorker?.ready;
    diag.swActive   = !!reg?.active;
    diag.subscribed = !!(await reg?.pushManager?.getSubscription());
  } catch (_) {}
  return diag;
}
