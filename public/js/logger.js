// ===== 行動ログ軽量ロガー =====
// - 5件または10秒ごとに /api/log へバッチ送信（fire-and-forget）
// - 離脱時は sendBeacon でフラッシュ
// - 同意（localStorage）がなければ一切動作しない
// - state.js への import を避けるため projectId は外部から注入
//   main.js で setProjectIdGetter(() => state.selectedEventId) を呼ぶこと

import { clientId } from './clientId.js';

const APP_VERSION    = '1.0';
const BATCH_SIZE     = 5;
const FLUSH_INTERVAL = 10_000;

let _sessionId       = null;
let _sessionStart    = null;
let _queue           = [];
let _flushTimer      = null;
let _projectIdGetter = () => null;

// ── 公開 API ──────────────────────────────────────────────────

/** state.selectedEventId を取得する関数を登録する（循環 import 回避）*/
export function setProjectIdGetter(fn) { _projectIdGetter = fn; }

/** ロガーを起動する（main.js の起動フックから呼ぶ） */
export function initLogger() {
  if (_sessionId) return; // 二重起動防止

  _sessionId    = crypto.randomUUID();
  _sessionStart = Date.now();

  logEvent('session_started');

  // 離脱時フラッシュ
  document.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('beforeunload', _onBeforeUnload);

  // 定期フラッシュ
  _flushTimer = setInterval(_flushFetch, FLUSH_INTERVAL);
}

/**
 * イベントをキューに積む。
 * @param {string} name  snake_case のイベント名
 * @param {object} [props]  軽量な追加データ（本文・画像は入れない）
 */
export function logEvent(name, props = {}) {
  if (!_sessionId) return;

  _queue.push({
    event:     name,
    clientTs:  new Date().toISOString(),
    sessionId: _sessionId,
    projectId: _projectIdGetter(),
    props,
    ctx: {
      ua:         navigator.userAgent,
      viewport:   `${window.innerWidth}x${window.innerHeight}`,
      appVersion: APP_VERSION,
      clientId,
    },
  });

  if (_queue.length >= BATCH_SIZE) _flushFetch();
}

// ── 内部処理 ──────────────────────────────────────────────────

function _onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    if (_sessionStart !== null) {
      logEvent('session_ended', { durationSec: Math.round((Date.now() - _sessionStart) / 1000) });
      _sessionStart = null;
    }
    _flushBeacon();
  } else if (document.visibilityState === 'visible' && _sessionStart === null) {
    // 再フォアグラウンド
    _sessionStart = Date.now();
    logEvent('session_started');
  }
}

function _onBeforeUnload() { _flushBeacon(); }

function _flushFetch() {
  if (_queue.length === 0) return;
  const batch = _queue.splice(0);
  fetch('/api/log', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ events: batch }),
  }).catch(() => {}); // fire-and-forget
}

function _flushBeacon() {
  if (_queue.length === 0) return;
  const batch = _queue.splice(0);
  try {
    const sent = navigator.sendBeacon(
      '/api/log',
      new Blob([JSON.stringify({ events: batch })], { type: 'application/json' })
    );
    if (!sent) { _queue.push(...batch); _flushFetch(); }
  } catch (_) {
    _queue.push(...batch); _flushFetch();
  }
}
