// lib/chatStore.js — ミッションチャットコレクション操作
// MongoDB の `mission_chats` コレクション。
// ミッション詳細ページのチャット（メッセージ + 絵文字リアクション）を永続化する。
// CRDT の missions フィールドには含めない（イベント全体同期の肥大化を避けるため、
// submissions と同じ独立コレクション方式）。
//
// スキーマ:
// {
//   _id:       string,              // メッセージID（c_<hex>）
//   eventId:   string,
//   missionId: string,
//   userId:    string,              // 送信者
//   text:      string,
//   createdAt: number,              // 送信時刻（ms）
//   reactions: { [emoji]: string[] } // 絵文字 → リアクションした userId 配列
//   replyTo:   null | { id, userId, username, text }  // 返信元のスナップショット
//                                   // （元メッセージが削除されても引用表示を保つため送信時に確定）
// }
//
// インデックス（db.js で作成済み）:
//   - { missionId: 1, createdAt: 1 }
//   - { eventId: 1 }

'use strict';

const crypto = require('crypto');
const { getDb } = require('./db');

function col() { return getDb().collection('mission_chats'); }

function _fromDoc(doc) {
  if (!doc) return null;
  return {
    id:        doc._id,
    eventId:   doc.eventId,
    missionId: doc.missionId,
    userId:    doc.userId,
    text:      doc.text ?? '',
    createdAt: doc.createdAt ?? 0,
    reactions: doc.reactions ?? {},
    replyTo:   doc.replyTo ?? null,
  };
}

// ── 読み取り ────────────────────────────────────────────────

/** ミッションのメッセージ一覧（古い順） */
async function listForMission(eventId, missionId, limit = 500) {
  const docs = await col()
    .find({ eventId, missionId })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  return docs.map(_fromDoc);
}

/** 1件取得 */
async function getMessage(msgId) {
  const doc = await col().findOne({ _id: msgId });
  return _fromDoc(doc);
}

/** ミッションのチャット参加者（発言者）の userId 一覧（重複なし） */
async function participantIds(eventId, missionId) {
  return col().distinct('userId', { eventId, missionId });
}

// ── 書き込み ────────────────────────────────────────────────

/** メッセージ追加。追加したメッセージを返す */
async function addMessage(eventId, missionId, userId, text, replyTo = null) {
  const doc = {
    _id:       'c_' + crypto.randomBytes(8).toString('hex'),
    eventId,
    missionId,
    userId,
    text:      String(text ?? ''),
    createdAt: Date.now(),
    reactions: {},
    replyTo:   replyTo || null,
  };
  await col().insertOne(doc);
  return _fromDoc(doc);
}

/** メッセージ削除（物理削除） */
async function deleteMessage(msgId) {
  await col().deleteOne({ _id: msgId });
}

/**
 * リアクションのトグル。付いていなければ追加、付いていれば外す。
 * @returns {object|null} 更新後のメッセージ
 */
async function toggleReaction(msgId, emoji, userId) {
  const doc = await col().findOne({ _id: msgId });
  if (!doc) return null;
  const reactions = doc.reactions ?? {};
  const users = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
  if (users.includes(userId)) {
    const next = users.filter(u => u !== userId);
    if (next.length === 0) delete reactions[emoji];
    else reactions[emoji] = next;
  } else {
    reactions[emoji] = [...users, userId];
  }
  await col().updateOne({ _id: msgId }, { $set: { reactions } });
  return _fromDoc({ ...doc, reactions });
}

/** イベントに紐づく全メッセージを削除（イベント削除時） */
async function deleteAllForEvent(eventId) {
  await col().deleteMany({ eventId });
}

module.exports = {
  listForMission,
  getMessage,
  participantIds,
  addMessage,
  deleteMessage,
  toggleReaction,
  deleteAllForEvent,
};
