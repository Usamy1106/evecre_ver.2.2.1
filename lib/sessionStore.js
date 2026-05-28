// lib/sessionStore.js — セッションコレクション操作
// MongoDB の `sessions` コレクション。
// { _id: ObjectId, userId, token, expiresAt: Date }
// token フィールドに unique インデックスあり（db.js で作成）。
// expiresAt は BSON Date → TTL インデックスで自動削除。

'use strict';

const { getDb } = require('./db');

function col() { return getDb().collection('sessions'); }

/**
 * セッションを作成。
 * @param {string} userId
 * @param {string} token  - crypto.randomBytes(32).toString('hex')
 * @param {number} expiresAtMs - ミリ秒タイムスタンプ
 */
async function createSession(userId, token, expiresAtMs) {
  await col().insertOne({
    userId,
    token,
    expiresAt: new Date(expiresAtMs),  // TTL インデックス用 BSON Date
  });
}

/**
 * トークンでセッションを検索。
 * @param {string} token
 * @returns {{ userId: string, token: string, expiresAt: number } | null}
 */
async function findByToken(token) {
  const doc = await col().findOne({ token });
  if (!doc) return null;
  return {
    userId:    doc.userId,
    token:     doc.token,
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : doc.expiresAt,
  };
}

/** トークンでセッションを削除（ログアウト） */
async function deleteByToken(token) {
  await col().deleteOne({ token });
}

/** ユーザーの全セッションを削除（パスワードリセット後など） */
async function deleteAllForUser(userId) {
  await col().deleteMany({ userId });
}

/**
 * 指定トークン以外のセッションを削除。
 * パスワード変更後に「現在のセッションだけ残す」用途で使う。
 * @param {string} userId
 * @param {string} keepToken - 残すセッションのトークン
 */
async function deleteAllExceptToken(userId, keepToken) {
  await col().deleteMany({ userId, token: { $ne: keepToken } });
}

module.exports = {
  createSession,
  findByToken,
  deleteByToken,
  deleteAllForUser,
  deleteAllExceptToken,
};
