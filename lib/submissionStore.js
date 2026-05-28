// lib/submissionStore.js — ミッション完了提出物コレクション操作
// MongoDB の `submissions` コレクション。
// 旧来の project.clearedData（CRDT 内に格納）から分離し、画像は R2 URL として保持。
//
// スキーマ:
// {
//   _id:       "<projectId>:<missionId>",  // 複合キー（1ミッション1提出）
//   projectId: string,
//   missionId: string,
//   content:   string,   // テキスト / R2 URL / 外部 URL（base64 は R2 upload 後に置換）
//   format:    string,   // 'text' | 'image' | 'url' | 'link'
//   title:     string,   // ミッションタイトル（スナップショット）
//   timestamp: number,   // 提出時刻（ms）
// }
//
// インデックス（db.js で作成済み）:
//   - { projectId: 1, missionId: 1 }

'use strict';

const { getDb } = require('./db');

function col() { return getDb().collection('submissions'); }

/** _id を生成する複合キー */
function _compoundId(projectId, missionId) {
  return `${projectId}:${missionId}`;
}

function _toDoc(projectId, missionId, data) {
  return {
    _id:       _compoundId(projectId, missionId),
    projectId,
    missionId,
    content:   data.content   ?? '',
    format:    data.format    ?? 'text',
    title:     data.title     ?? '',
    timestamp: data.timestamp ?? Date.now(),
  };
}

function _fromDoc(doc) {
  if (!doc) return null;
  return {
    content:   doc.content   ?? '',
    format:    doc.format    ?? 'text',
    title:     doc.title     ?? '',
    timestamp: doc.timestamp ?? 0,
  };
}

// ── 読み取り ────────────────────────────────────────────────

/**
 * 特定のミッションの提出物を1件取得。
 * @returns {{ content, format, title, timestamp } | null}
 */
async function getSubmission(projectId, missionId) {
  const doc = await col().findOne({ _id: _compoundId(projectId, missionId) });
  return _fromDoc(doc);
}

/**
 * プロジェクトの全提出物を取得し、旧 clearedData 形式のオブジェクトで返す。
 * @returns {{ [missionId]: { content, format, title, timestamp } }}
 */
async function getSubmissionsForProject(projectId) {
  const docs = await col().find({ projectId }).toArray();
  const result = {};
  for (const doc of docs) {
    result[doc.missionId] = _fromDoc(doc);
  }
  return result;
}

// ── 書き込み ────────────────────────────────────────────────

/**
 * 提出物を保存（upsert）。
 * @param {string} projectId
 * @param {string} missionId
 * @param {{ content, format, title, timestamp }} data
 */
async function saveSubmission(projectId, missionId, data) {
  const doc = _toDoc(projectId, missionId, data);
  await col().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

/**
 * 提出物を削除（差し戻し・reject 時）。
 */
async function deleteSubmission(projectId, missionId) {
  await col().deleteOne({ _id: _compoundId(projectId, missionId) });
}

/**
 * プロジェクトに紐づく全提出物を削除（プロジェクト削除時）。
 */
async function deleteAllForProject(projectId) {
  await col().deleteMany({ projectId });
}

module.exports = {
  getSubmission,
  getSubmissionsForProject,
  saveSubmission,
  deleteSubmission,
  deleteAllForProject,
};
