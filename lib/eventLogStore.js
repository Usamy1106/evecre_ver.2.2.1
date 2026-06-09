// lib/eventLogStore.js — 行動ログコレクション操作
// event_logs コレクションにイベントストリームを書き込む。
// インデックス（db.js で作成済み）:
//   - { userId:1, ts:1 } / { sessionId:1, ts:1 } / { event:1, ts:1 } / { eventId:1 }
//   - TTL 180日（ts フィールド）

'use strict';

const { getDb } = require('./db');

function col() { return getDb().collection('event_logs'); }

/**
 * イベントドキュメントを一括挿入する。
 * サーバー受信時刻（ts）はここで付与済みのものを使う。
 * @param {object[]} docs  整形済みドキュメント配列
 */
async function insertEvents(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return;
  await col().insertMany(docs, { ordered: false });
}

module.exports = { insertEvents };
