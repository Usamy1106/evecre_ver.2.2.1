// lib/collectionStore.js — 図鑑（山登りオブジェクトコレクション）永続化
// MongoDB の `user_collections` コレクション。
// ミッションが cleared になった時点のイベント全メンバーに、そのミッションの
// rewardObject（山登りオブジェクト）を登録する。ユーザー単位の実績なので
// ★イベント削除時にも消さない（server.js のイベント削除ループの消去対象に含めない）。
//
// スキーマ:
// {
//   _id:     string,   // userId
//   objects: {
//     [objectId]: { count: number, firstAt: number, lastEventId: string, lastMissionId: string }
//   }
// }
//
// cleared → 未完了に戻す → 再 cleared は count 再加算（許容仕様）。

'use strict';

const { getDb } = require('./db');

function col() { return getDb().collection('user_collections'); }

/**
 * 複数ユーザーの図鑑にオブジェクトを1件登録する。
 * count を +1、firstAt は初回のみ記録（aggregation pipeline update で原子的に行う）。
 * @param {string[]} userIds
 * @param {string} objectId  MOUNTAIN_OBJECTS の id
 * @param {{eventId?: string, missionId?: string}} ctx
 */
async function addToUsers(userIds, objectId, ctx = {}) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0 || !objectId) return;
  const now = Date.now();
  const path = `objects.${objectId}`;
  await Promise.all(ids.map(userId =>
    col().updateOne(
      { _id: userId },
      [{
        $set: {
          [`${path}.count`]:         { $add: [{ $ifNull: [`$${path}.count`, 0] }, 1] },
          [`${path}.firstAt`]:       { $ifNull: [`$${path}.firstAt`, now] },
          [`${path}.lastEventId`]:   ctx.eventId   ?? null,
          [`${path}.lastMissionId`]: ctx.missionId ?? null,
        },
      }],
      { upsert: true },
    )
  ));
}

/** ユーザーの図鑑を取得。{ [objectId]: {count, firstAt, ...} }（未登録なら空オブジェクト） */
async function getForUser(userId) {
  const doc = await col().findOne({ _id: userId });
  return doc?.objects ?? {};
}

module.exports = {
  addToUsers,
  getForUser,
};
