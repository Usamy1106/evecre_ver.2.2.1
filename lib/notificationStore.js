// lib/notificationStore.js — 通知コレクション操作（MongoDB 版）
// MongoDB の `notifications` コレクション。
// { _id: notifId(hex), userId, type, message, eventId, missionId,
//   actorId, actorName, createdAt: Date, read: bool }
//
// インデックス（db.js で作成済み）:
//   - { userId: 1, createdAt: -1 }
//   - { createdAt: 1 } TTL 90日

'use strict';

const { getDb } = require('./db');
const crypto = require('crypto');

// 1ユーザー当たりの最大保持件数
const MAX_PER_USER = 100;

function col() { return getDb().collection('notifications'); }

// ── ドキュメント変換 ────────────────────────────────────────

function _fromDoc(doc) {
  if (!doc) return null;
  return {
    id:        String(doc._id),
    type:      doc.type,
    message:   doc.message   || '',
    eventId:   doc.eventId   || null,
    missionId: doc.missionId || null,
    actorId:   doc.actorId   || null,
    actorName: doc.actorName || null,
    // createdAt: TTL 用に Date 型で保存、クライアントへはミリ秒 number で返す
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : (doc.createdAt || 0),
    read:      !!doc.read,
  };
}

// ── 読み取り ────────────────────────────────────────────────

/**
 * ユーザーの通知一覧を取得（新しい順・最大 MAX_PER_USER 件）。
 * server.js との互換性のため { notifications: [...] } 形式で返す。
 */
async function loadNotifications(userId) {
  const docs = await col()
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(MAX_PER_USER)
    .toArray();
  return { notifications: docs.map(_fromDoc) };
}

// ── 書き込み ────────────────────────────────────────────────

/**
 * 通知を1件追加。
 * 上限（MAX_PER_USER）を超えた場合は最古のものを削除。
 * @param {string} userId
 * @param {{ type, message, eventId?, missionId?, actorId?, actorName? }} notif
 */
async function addNotification(userId, notif) {
  if (!userId) return;
  const id = crypto.randomBytes(8).toString('hex');
  await col().insertOne({
    _id:       id,
    userId,
    type:      notif.type,
    message:   notif.message   || '',
    eventId:   notif.eventId   || null,
    missionId: notif.missionId || null,
    actorId:   notif.actorId   || null,
    actorName: notif.actorName || null,
    createdAt: new Date(),   // BSON Date（TTL インデックス用）
    read: false,
  });

  // 上限超えを削除（TTL とは別に件数制限）
  const count = await col().countDocuments({ userId });
  if (count > MAX_PER_USER) {
    const oldest = await col()
      .find({ userId })
      .sort({ createdAt: 1 })
      .limit(count - MAX_PER_USER)
      .project({ _id: 1 })
      .toArray();
    if (oldest.length > 0) {
      await col().deleteMany({ _id: { $in: oldest.map(d => d._id) } });
    }
  }
}

/** 複数ユーザーに同じ通知を一括送信（並列） */
async function notifyAll(userIds, notif) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  await Promise.all(userIds.map(uid => addNotification(uid, notif)));
}

/** 全件既読（eventId 指定時はそのイベントの通知のみ） */
async function markAllRead(userId, eventId = null) {
  const filter = { userId, read: false };
  if (eventId) filter.eventId = eventId;
  await col().updateMany(filter, { $set: { read: true } });
}

/** 指定 ID の通知を既読 */
async function markRead(userId, notifId) {
  await col().updateOne({ _id: notifId, userId }, { $set: { read: true } });
}

/** 指定 ID の通知を削除 */
async function deleteNotification(userId, notifId) {
  await col().deleteOne({ _id: notifId, userId });
}

/** ユーザーの全通知を削除 */
async function clearAll(userId) {
  await col().deleteMany({ userId });
}

/** 指定イベントに紐づく全ユーザーの通知を削除（イベント削除時のクリーンアップ） */
async function deleteByEventId(eventId) {
  if (!eventId) return;
  await col().deleteMany({ eventId });
}

module.exports = {
  loadNotifications,
  addNotification,
  notifyAll,
  markRead,
  markAllRead,
  deleteNotification,
  clearAll,
  deleteByEventId,
};
