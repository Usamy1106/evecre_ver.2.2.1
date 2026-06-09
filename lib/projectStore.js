// lib/projectStore.js — フォルダ（プロジェクト）永続化
// フェーズ2で新設。複数のイベントを束ねる「プロジェクト」フォルダを管理する。
// 旧 projectStore.js は lib/eventStore.js にリネーム済み（まったくの別物）。

'use strict';

const { getDb } = require('./db');
const crypto = require('crypto');

function col() { return getDb().collection('projects'); }

function _fromDoc(doc) {
  if (!doc) return null;
  const obj = { ...doc, id: doc._id };
  delete obj._id;
  return obj;
}

/**
 * フォルダを新規作成する。
 * @param {{ name: string, description: string, ownerId: string }} opts
 */
async function create({ name, description, ownerId }) {
  const id  = crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  const doc = {
    _id: id,
    name: String(name).trim(),
    description: String(description || '').trim(),
    ownerId,
    createdAt: now,
    members: [{ userId: ownerId, role: 'owner', joinedAt: now }],
  };
  await col().insertOne(doc);
  return _fromDoc(doc);
}

/** @param {string} id */
async function getById(id) {
  const doc = await col().findOne({ _id: id });
  return _fromDoc(doc);
}

/**
 * 名前・説明を更新する。
 * @param {string} id
 * @param {{ name?: string, description?: string }} patch
 */
async function update(id, { name, description } = {}) {
  const set = {};
  if (name        !== undefined) set.name        = String(name).trim();
  if (description !== undefined) set.description = String(description || '').trim();
  if (Object.keys(set).length) await col().updateOne({ _id: id }, { $set: set });
}

/**
 * フォルダを削除する。所属イベントの folderId は null に戻す。
 * @param {string} id
 */
async function remove(id) {
  await getDb().collection('events').updateMany({ folderId: id }, { $set: { folderId: null } });
  await col().deleteOne({ _id: id });
}

/**
 * ユーザーが所属するフォルダ一覧を取得（作成日降順）。
 * @param {string} userId
 */
async function listForUser(userId) {
  const docs = await col().find({ 'members.userId': userId }).sort({ createdAt: -1 }).toArray();
  return docs.map(_fromDoc);
}

/**
 * @param {{ members: Array }} project
 * @param {string} userId
 */
function isMember(project, userId) {
  return (project.members || []).some(m => m.userId === userId);
}

module.exports = { create, getById, update, remove, listForUser, isMember };
