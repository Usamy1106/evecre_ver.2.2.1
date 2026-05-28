// lib/userStore.js — ユーザーコレクション操作
// MongoDB の `users` コレクションに対する CRUD。
// ドキュメント形式: { _id: user.id, username, emailLower, passwordHash, ... }
// ※ sessions, otp, passwordReset はユーザードキュメント内に保持（後方互換）
//    将来 pending_actions コレクションへ分離予定（要件 D）

'use strict';

const { getDb } = require('./db');

function col() { return getDb().collection('users'); }

// ── ドキュメント変換 ────────────────────────────────────────
/** MongoDB ドキュメント → アプリ用オブジェクト（_id → id） */
function _fromDoc(doc) {
  if (!doc) return null;
  const obj = { ...doc, id: doc._id };
  delete obj._id;
  return obj;
}

/** アプリ用オブジェクト → MongoDB ドキュメント（id → _id） */
function _toDoc(user) {
  const doc = { ...user, _id: user.id };
  delete doc.id;
  return doc;
}

// ── 検索 ──────────────────────────────────────────────────

/** ID でユーザーを取得 */
async function findById(id) {
  return _fromDoc(await col().findOne({ _id: id }));
}

/** メールアドレス（小文字）でユーザーを取得 */
async function findByEmail(emailLower) {
  return _fromDoc(await col().findOne({ emailLower }));
}

/** メールアドレス or Google Sub でユーザーを取得（Google サインイン用） */
async function findByEmailOrGoogleSub(emailLower, googleSub) {
  const conditions = [{ emailLower }];
  if (googleSub) conditions.push({ googleSub });
  return _fromDoc(await col().findOne({ $or: conditions }));
}

/** メールアドレスの重複チェック（excludeId は自分自身を除外する場合に渡す） */
async function emailExists(emailLower, excludeId = null) {
  const q = { emailLower };
  if (excludeId) q._id = { $ne: excludeId };
  return !!(await col().countDocuments(q, { limit: 1 }));
}

/** パスワードリセットトークンでユーザーを取得 */
async function findByPasswordResetToken(token) {
  return _fromDoc(await col().findOne({ 'passwordReset.token': token }));
}

/** 複数 ID でユーザーをまとめて取得（メンバー一覧表示用） */
async function findManyByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const docs = await col().find({ _id: { $in: ids } }).toArray();
  return docs.map(_fromDoc);
}

// ── 書き込み ────────────────────────────────────────────────

/** 新規ユーザーを挿入 */
async function insert(user) {
  await col().insertOne(_toDoc(user));
}

/**
 * ユーザーの指定フィールドを更新（$set）。
 * id / _id は渡してもシャットアウトする。
 * @param {string} id
 * @param {object} fields  - 更新したいフィールドの key/value
 */
async function update(id, fields) {
  const $set = { ...fields };
  delete $set._id;
  delete $set.id;
  await col().updateOne({ _id: id }, { $set });
}

module.exports = {
  findById,
  findByEmail,
  findByEmailOrGoogleSub,
  emailExists,
  findByPasswordResetToken,
  findManyByIds,
  insert,
  update,
};
