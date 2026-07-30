// lib/pushClient.js — Web Push の送信
// 「閉じている間の呼び戻し」を担う。開いている間の同期は SSE（lib/eventBus.js）が担当。
//
// 設計上の約束：
//  - VAPID 未設定の環境では黙って no-op（鍵の投入前でもアプリは通常動作すること）
//  - 送信失敗でリクエスト本体を落とさない（通知はベストエフォート）
//  - 404 / 410（購読が失効）が返ったら購読を削除して掃除する
//  - 宛先が複数のときは findByUserIds で一括取得する（Atlas M0 の maxPoolSize=10 を守る）

'use strict';

const webpush   = require('web-push');
const pushStore = require('./pushStore');

// 一度に走らせる送信の上限。Atlas M0（共有CPU）と 512MB インスタンスを考慮し、
// 数百件を Promise.all に投げない（§8-5 の方針をここでも守る）。
const SEND_CHUNK = 20;

let _configured = null; // null=未判定 / true / false

/** VAPID 設定を初回だけ適用する。未設定なら false を返す（呼び出し側は no-op にする） */
function _ensureConfigured() {
  if (_configured !== null) return _configured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn('[push] VAPID 未設定のため push 送信は無効（VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT）');
    _configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    _configured = true;
  } catch (e) {
    console.error('[push] VAPID 設定が不正:', e.message);
    _configured = false;
  }
  return _configured;
}

/** push が使える状態か（診断用） */
function isConfigured() {
  return _ensureConfigured();
}

/**
 * 購読1件へ送信する。失効していれば購読を削除する。
 * @returns {Promise<'sent'|'expired'|'failed'>}
 */
async function _sendToSubscription(sub, payloadJson) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      payloadJson,
    );
    return 'sent';
  } catch (err) {
    // 404 Not Found / 410 Gone = 購読が無効。掃除する。
    if (err.statusCode === 404 || err.statusCode === 410) {
      await pushStore.deleteByEndpoint(sub.endpoint).catch(() => {});
      return 'expired';
    }
    console.error('[push] 送信失敗', err.statusCode, String(err.body || err.message).slice(0, 200));
    return 'failed';
  }
}

/** 購読配列へチャンク分割して送信する */
async function _sendToSubscriptions(subs, payload) {
  const json = JSON.stringify(payload);
  const result = { sent: 0, expired: 0, failed: 0 };
  for (let i = 0; i < subs.length; i += SEND_CHUNK) {
    const chunk = subs.slice(i, i + SEND_CHUNK);
    const outcomes = await Promise.all(chunk.map(s => _sendToSubscription(s, json)));
    for (const o of outcomes) result[o]++;
  }
  return result;
}

/**
 * 1ユーザーの全端末へ送信する。
 * @param {string} userId
 * @param {{title: string, body?: string, url?: string, tag?: string}} payload
 * @returns {Promise<{sent:number, expired:number, failed:number}>}
 */
async function sendPushToUser(userId, payload) {
  const empty = { sent: 0, expired: 0, failed: 0 };
  if (!_ensureConfigured() || !userId) return empty;
  const subs = await pushStore.findByUserId(userId);
  if (subs.length === 0) return empty;
  return _sendToSubscriptions(subs, payload);
}

/**
 * 複数ユーザーへ同じ内容を送信する。
 * 購読は findByUserIds で一括取得する（1ユーザーずつ引かない）。
 * @param {string[]} userIds
 * @param {{title: string, body?: string, url?: string, tag?: string}} payload
 */
async function sendPushToUsers(userIds, payload) {
  const empty = { sent: 0, expired: 0, failed: 0 };
  const ids = [...new Set(userIds || [])].filter(Boolean);
  if (!_ensureConfigured() || ids.length === 0) return empty;
  const subs = await pushStore.findByUserIds(ids);
  if (subs.length === 0) return empty;
  return _sendToSubscriptions(subs, payload);
}

module.exports = {
  isConfigured,
  sendPushToUser,
  sendPushToUsers,
};
