// lib/pushStore.js — Web Push 購読の保存
// MongoDB の `push_subscriptions` コレクション。
// { _id: endpoint のハッシュ, userId, endpoint, keys: {p256dh, auth}, userAgent, createdAt: Date }
//
// 1ユーザーが複数端末（iPhone / Android / PC）から購読しうるため userId は一意にしない。
// endpoint がブラウザ・端末ごとに一意なので、そちらを一意キーにして upsert する。
//
// ★CRDT 非対象。lib/crdt.js の FLAT_* に登録しないこと（notifications と同じ扱いで
//   サーバ側だけで完結する付随データ）。
//
// インデックス（db.js で作成済み）:
//   - { endpoint: 1 } unique
//   - { userId: 1 }

'use strict';

const crypto = require('crypto');
const { getDb } = require('./db');

function col() { return getDb().collection('push_subscriptions'); }

// endpoint はブラウザによっては非常に長いため、_id にはハッシュを使う
function _idFor(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
}

function _fromDoc(doc) {
  if (!doc) return null;
  return {
    id:        doc._id,
    userId:    doc.userId,
    endpoint:  doc.endpoint,
    keys:      doc.keys || {},
    userAgent: doc.userAgent || '',
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : (doc.createdAt || 0),
  };
}

// ── 書き込み ────────────────────────────────────────────────

/**
 * 購読を保存する（同じ endpoint なら上書き）。
 * 端末の購読が別ユーザーに引き継がれる場合（同じ端末で別アカウントにログイン）も
 * endpoint 一意なので userId が正しく更新される。
 * @param {string} userId
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} sub
 * @param {string} userAgent
 * @returns {Promise<boolean>} 保存できたか（endpoint / keys が不正なら false）
 */
async function saveSubscription(userId, sub, userAgent = '') {
  const endpoint = sub?.endpoint;
  const p256dh   = sub?.keys?.p256dh;
  const auth     = sub?.keys?.auth;
  if (!userId || !endpoint || !p256dh || !auth) return false;

  await col().updateOne(
    { _id: _idFor(endpoint) },
    {
      $set: { userId, endpoint, keys: { p256dh, auth }, userAgent: String(userAgent).slice(0, 300) },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  return true;
}

/** 失効した購読を削除する（送信時に 404/410 が返ったとき） */
async function deleteByEndpoint(endpoint) {
  if (!endpoint) return;
  await col().deleteOne({ _id: _idFor(endpoint) });
}

/** ユーザーの全購読を削除する（退会時など） */
async function deleteByUserId(userId) {
  if (!userId) return;
  await col().deleteMany({ userId });
}

// ── 読み取り ────────────────────────────────────────────────

/** 1ユーザーの全端末の購読 */
async function findByUserId(userId) {
  if (!userId) return [];
  const docs = await col().find({ userId }).toArray();
  return docs.map(_fromDoc);
}

/**
 * 複数ユーザー分の購読を一括取得する（定期通知で必要）。
 * 1件ずつ引くと Atlas M0 の接続プール（maxPoolSize=10）を食い潰すため、
 * 宛先が複数のときは必ずこちらを使う。
 * @param {string[]} userIds
 * @returns {Promise<object[]>}
 */
async function findByUserIds(userIds) {
  const ids = [...new Set(userIds || [])].filter(Boolean);
  if (ids.length === 0) return [];
  const docs = await col().find({ userId: { $in: ids } }).toArray();
  return docs.map(_fromDoc);
}

/** 購読している端末数（デバッグ・統計用） */
async function countAll() {
  return col().countDocuments();
}

module.exports = {
  saveSubscription,
  deleteByEndpoint,
  deleteByUserId,
  findByUserId,
  findByUserIds,
  countAll,
};
