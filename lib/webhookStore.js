// lib/webhookStore.js — Discord / Slack の Incoming Webhook の連携設定
// MongoDB の `event_webhooks` コレクション。1イベント1件（_id = eventId）。
//
// {
//   _id: eventId,
//   kind: 'discord' | 'slack',
//   url: string,                 // ★秘密情報。クライアントへ生で返さない（toClient で伏せ字にする）
//   origin: string,              // 投稿内リンクの基点（登録時の `${protocol}://${host}`）
//   notify: { created, cleared, deadline },   // boolean。既定はすべて true
//   status: 'ok' | 'broken',     // broken は 401/403/404 が返ったとき。以後の自動投稿を止める
//   lastError: string | null, lastErrorAt: Date | null,
//   createdBy, createdAt: Date, updatedAt: Date,
// }
//
// ★CRDT 非対象。lib/crdt.js の FLAT_* に登録しないこと。URL を知っている人は誰でも
//   そのチャンネルへ投稿できるので、/api/data・SSE・公開データの経路に絶対に載せない。
// インデックスは不要（_id で引く）。

'use strict';

const { getDb } = require('./db');

function col() { return getDb().collection('event_webhooks'); }

const DEFAULT_NOTIFY = Object.freeze({ created: true, cleared: true, deadline: true });

/** notify を boolean 3つに整える（未指定は既定 true／既存値を引き継ぐ） */
function normalizeNotify(input, base = DEFAULT_NOTIFY) {
  const out = { ...DEFAULT_NOTIFY, ...(base || {}) };
  if (input && typeof input === 'object') {
    for (const k of Object.keys(DEFAULT_NOTIFY)) {
      if (typeof input[k] === 'boolean') out[k] = input[k];
    }
  }
  return out;
}

async function get(eventId) {
  if (!eventId) return null;
  return col().findOne({ _id: String(eventId) });
}

/** 作成または更新。fields に url を含めたら status は ok に戻す */
async function upsert(eventId, fields) {
  const now = new Date();
  const $set = { ...fields, updatedAt: now };
  if (fields.url) { $set.status = 'ok'; $set.lastError = null; $set.lastErrorAt = null; }
  await col().updateOne(
    { _id: String(eventId) },
    { $set, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return get(eventId);
}

async function setStatus(eventId, status, lastError = null) {
  await col().updateOne(
    { _id: String(eventId) },
    { $set: {
      status,
      lastError:   status === 'ok' ? null : (lastError || null),
      lastErrorAt: status === 'ok' ? null : new Date(),
      updatedAt:   new Date(),
    } },
  );
}

async function remove(eventId) {
  if (!eventId) return;
  await col().deleteOne({ _id: String(eventId) });
}

/** 締切のまとめ投稿の対象（締切の投稿がオン・壊れていない） */
async function listForDeadline() {
  return col().find({ 'notify.deadline': true, status: 'ok' }).toArray();
}

/** URL の伏せ字。ホストとパスの頭だけ見せ、末尾4文字を残す */
function maskUrl(url) {
  const s = String(url || '');
  const tail = s.slice(-4);
  if (/^https:\/\/hooks\.slack\.com\//.test(s)) return `https://hooks.slack.com/services/…/…${tail}`;
  const m = /^https:\/\/([^/]+)\//.exec(s);
  return `https://${m ? m[1] : '…'}/api/webhooks/…/…${tail}`;
}

/** クライアントへ返す形。★url は含めない */
function toClient(doc) {
  if (!doc) return null;
  return {
    kind:        doc.kind,
    maskedUrl:   maskUrl(doc.url),
    notify:      normalizeNotify(doc.notify),
    status:      doc.status || 'ok',
    lastError:   doc.lastError || null,
    lastErrorAt: doc.lastErrorAt instanceof Date ? doc.lastErrorAt.getTime() : null,
    updatedAt:   doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : null,
  };
}

module.exports = {
  DEFAULT_NOTIFY, normalizeNotify,
  get, upsert, setStatus, remove, listForDeadline,
  maskUrl, toClient,
};
