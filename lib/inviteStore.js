// lib/inviteStore.js — 招待コレクション操作
// MongoDB の `invites` コレクション。
// { _id: token(hex), projectId, createdBy, createdAt, expiresAt: Date, maxUses, usedBy: [] }
// token フィールドを _id として使用（unique 保証 + 高速検索）。
// expiresAt は BSON Date → TTL インデックスで自動削除。

'use strict';

const { getDb } = require('./db');
const crypto = require('crypto');

function col() { return getDb().collection('invites'); }

/** 48文字の hex トークンを生成 */
function newInviteToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ── ドキュメント変換 ────────────────────────────────────────

function _toDoc(invite) {
  const doc = { ...invite, _id: invite.token };
  // expiresAt は BSON Date に変換（TTL インデックス用）
  if (doc.expiresAt && !(doc.expiresAt instanceof Date)) {
    doc.expiresAt = new Date(doc.expiresAt);
  }
  return doc;
}

function _fromDoc(doc) {
  if (!doc) return null;
  return {
    ...doc,
    token:     String(doc._id),  // _id → token に戻す
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : doc.expiresAt,
  };
}

// ── 操作 ──────────────────────────────────────────────────

/** トークンで招待を取得 */
async function loadInvite(token) {
  return _fromDoc(await col().findOne({ _id: token }));
}

/** 招待を保存（upsert） */
async function saveInvite(invite) {
  const doc = _toDoc(invite);
  await col().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

/** トークンで招待を削除 */
async function deleteInvite(token) {
  await col().deleteOne({ _id: token });
}

/**
 * プロジェクトに属する有効な招待リストを返す。
 * - expiresAt が過ぎているものは MongoDB の TTL に任せるが、
 *   TTL バックグラウンドジョブが遅延する可能性があるため、アプリ側でも弾く。
 * - 使用上限を超えているものも除外。
 */
async function listInvitesForProject(projectId) {
  const now = new Date();
  const docs = await col()
    .find({
      projectId,
      $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }],
    })
    .sort({ createdAt: -1 })
    .toArray();

  return docs
    .map(_fromDoc)
    .filter(inv => !inv.maxUses || (inv.usedBy || []).length < inv.maxUses);
}

module.exports = {
  newInviteToken,
  loadInvite,
  saveInvite,
  deleteInvite,
  listInvitesForProject,
};
