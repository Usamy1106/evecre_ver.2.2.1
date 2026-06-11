// lib/eventStore.js — イベント（旧プロジェクト）永続化（MongoDB 版）
// MongoDB の `events` コレクション。
// { _id: event.id(string), members, missions(CRDT), proposals(CRDT), ... }
//
// ★ クライアント保存（PUT /api/data）は applyPatch による MongoDB 原子操作で処理する。
//   ミッション操作系エンドポイント（claim 等）は load → mutate → saveEvent(replaceOne) のままで、
//   並行更新には弱い（既知の設計制約）。
//
// 招待（invites）は lib/inviteStore.js に分離済み。

'use strict';

const { getDb } = require('./db');
const crypto = require('crypto');
const crdt = require('./crdt');

function col() { return getDb().collection('events'); }

// ── ドキュメント変換 ────────────────────────────────────────

function _toDoc(event) {
  return { ...event, _id: event.id };
}

function _fromDoc(doc) {
  if (!doc) return null;
  const obj = { ...doc, id: doc._id };
  delete obj._id;
  return obj;
}

// ── CRUD ──────────────────────────────────────────────────

/**
 * イベントを1件取得。
 * 旧フラット形式（fields なし）が残っていた場合は CRDT 形式に昇格して再保存。
 */
async function loadEvent(eventId) {
  const doc = await col().findOne({ _id: eventId });
  if (!doc) return null;
  const p = _fromDoc(doc);

  // 旧形式（fields がない or missions が配列）なら CRDT 形式へ昇格して再保存
  if (!p.fields && Array.isArray(p.missions)) {
    const upgraded = crdt.migrateFlatToCrdt(p);
    upgraded.members   = p.members   || [];
    upgraded.ownerId   = p.ownerId   || (p.members?.[0]?.userId);
    upgraded.createdAt = p.createdAt || Date.now();
    upgraded.rev       = p.rev       || 0;
    await saveEvent(upgraded);
    return upgraded;
  }
  return p;
}

/** イベントを保存（upsert） */
async function saveEvent(event) {
  const doc = _toDoc(event);
  await col().replaceOne({ _id: doc._id }, doc, { upsert: true });
}

/** イベントを削除 */
async function deleteEvent(eventId) {
  await col().deleteOne({ _id: eventId });
}

// ── CRDT パッチ（原子操作版）──────────────────────────────

/**
 * missions / proposals の各エントリに対する bulkWrite オペレーションを生成する。
 *
 * 各 LWW フィールドは独立した updateOne で更新。
 * 条件: 現在の t が新しい t より小さい場合のみ書き込む（または未存在）。
 * これにより並行書き込みでも「タイムスタンプが大きい方が勝つ」LWW セマンティクスを保証。
 *
 * @param {string} eventId    MongoDB _id
 * @param {string} mapName    'missions' | 'proposals'
 * @param {object} itemsObj   CRDT 形式のマップ { id: { id, createdAt, deletedAt, fields } }
 * @param {string[]} deletionIds  tombstone を立てる id の配列
 * @param {number} ts         更新タイムスタンプ
 * @returns {object[]}  MongoDB bulkWrite 用の操作配列
 */
function _mapBulkOps(eventId, mapName, itemsObj, deletionIds, ts) {
  const ops = [];
  const allIds = new Set([...Object.keys(itemsObj || {}), ...(deletionIds || [])]);

  for (const id of allIds) {
    const item = itemsObj?.[id];

    // ── 新規エントリの初期化（$exists: false の場合のみ）──────
    // アイテムが存在しない場合のみ、メタ情報（id / createdAt / deletedAt / fields: {}）を作る。
    // 既存の場合は no-op になるため、二重実行しても安全。
    if (item && item.deletedAt == null) {
      ops.push({
        updateOne: {
          filter: { _id: eventId, [`${mapName}.${id}`]: { $exists: false } },
          update: {
            $set: {
              [`${mapName}.${id}`]: {
                id,
                createdAt: item.createdAt || ts,
                deletedAt: null,
                fields: {},
              },
            },
            $inc: { rev: 1 },
          },
        },
      });
    }

    // ── フィールド単位の LWW 原子更新 ────────────────────────
    for (const [field, cell] of Object.entries(item?.fields || {})) {
      ops.push({
        updateOne: {
          filter: {
            _id: eventId,
            $or: [
              { [`${mapName}.${id}.fields.${field}.t`]: { $lt: cell.t } },
              { [`${mapName}.${id}.fields.${field}`]: { $exists: false } },
            ],
          },
          update: {
            $set: { [`${mapName}.${id}.fields.${field}`]: cell },
            $inc: { rev: 1 },
          },
        },
      });
    }

    // ── トゥームストーン（options.deletionIds 経由） ─────────
    if (deletionIds?.includes(id)) {
      ops.push({
        updateOne: {
          filter: {
            _id: eventId,
            $or: [
              { [`${mapName}.${id}.deletedAt`]: null },
              { [`${mapName}.${id}.deletedAt`]: { $lt: ts } },
            ],
          },
          update: {
            $set: { [`${mapName}.${id}.deletedAt`]: ts },
            $inc: { rev: 1 },
          },
        },
      });
    }

    // ── トゥームストーン（CRDT の deletedAt が明示されている場合） ──
    if (item?.deletedAt != null) {
      ops.push({
        updateOne: {
          filter: {
            _id: eventId,
            $or: [
              { [`${mapName}.${id}.deletedAt`]: null },
              { [`${mapName}.${id}.deletedAt`]: { $lt: item.deletedAt } },
            ],
          },
          update: {
            $set: { [`${mapName}.${id}.deletedAt`]: item.deletedAt },
            $inc: { rev: 1 },
          },
        },
      });
    }
  }
  return ops;
}

/**
 * クライアントから受け取った flat event を原子的にマージし保存。
 *
 * 各 LWW セル `{v, t}` の更新を「現在の t より新しいときだけ書き込む」
 * MongoDB bulkWrite に変換することで、並行書き込みの競合を解消する。
 * （旧: load → merge → save 方式は廃止）
 *
 * @param {string} eventId
 * @param {object} flatPatch  クライアントが送ってきた flat 形式のイベント
 * @param {object} options    { timestamp, missionDeletions, proposalDeletions }
 * @returns {object|null} 更新後の CRDT event（再取得）
 */
async function applyPatch(eventId, flatPatch, options = {}) {
  const ts = options.timestamp || Date.now();
  const c  = col();

  // イベントの存在確認（member 権限チェックは呼び出し元が行う）
  const exists = await c.countDocuments({ _id: eventId }, { limit: 1 });
  if (!exists) return null;

  // flat → CRDT（各フィールドに { v, t } を付与）
  const incoming = crdt.buildPatchFromFlat(flatPatch, ts);

  const bulkOps = [];

  // ── A. イベント共通フィールド（LWW）────────────────────
  for (const [field, cell] of Object.entries(incoming.fields || {})) {
    bulkOps.push({
      updateOne: {
        filter: {
          _id: eventId,
          $or: [
            { [`fields.${field}.t`]: { $lt: cell.t } },
            { [`fields.${field}`]: { $exists: false } },
          ],
        },
        update: {
          $set: { [`fields.${field}`]: cell },
          $inc: { rev: 1 },
        },
      },
    });
  }

  // ── B. customTags（CRDT 対象外：non-empty で送ってきた場合のみ上書き）──
  // roles / members は専用エンドポイントで管理するためここでは更新しない。
  if (Array.isArray(flatPatch.customTags) && flatPatch.customTags.length > 0) {
    bulkOps.push({
      updateOne: {
        filter: { _id: eventId },
        update: { $set: { customTags: flatPatch.customTags }, $inc: { rev: 1 } },
      },
    });
  }

  // ── C. ミッション ────────────────────────────────────────
  bulkOps.push(
    ..._mapBulkOps(eventId, 'missions',  incoming.missions,  options.missionDeletions,  ts)
  );

  // ── D. 提案 ──────────────────────────────────────────────
  bulkOps.push(
    ..._mapBulkOps(eventId, 'proposals', incoming.proposals, options.proposalDeletions, ts)
  );

  // ── E. clearedData フィールド（LWW）──────────────────────
  for (const [field, cell] of Object.entries(incoming.clearedData?.fields || {})) {
    bulkOps.push({
      updateOne: {
        filter: {
          _id: eventId,
          $or: [
            { [`clearedData.fields.${field}.t`]: { $lt: cell.t } },
            { [`clearedData.fields.${field}`]: { $exists: false } },
          ],
        },
        update: {
          $set: { [`clearedData.fields.${field}`]: cell },
          $inc: { rev: 1 },
        },
      },
    });
  }

  // ── F. 実行 ─────────────────────────────────────────────
  if (bulkOps.length > 0) {
    // ordered: true — 新規ミッションの初期化→フィールド更新の順序を保証
    await c.bulkWrite(bulkOps, { ordered: true });
  }

  // 最新状態を再取得して返す（rev 等が確定した値）
  return loadEvent(eventId);
}

// ── ユーザーが属するイベント一覧 ────────────────────────

/** userId が members に含まれる全イベントを新しい順で返す */
async function listEventsForUser(userId) {
  const docs = await col()
    .find({ 'members.userId': userId })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(_fromDoc);
}

// ── 同期ヘルパ（in-memory event オブジェクトに対して動作）────

function isMember(event, userId) {
  return !!(event?.members || []).find(m => m.userId === userId);
}

/** 後方互換: 単一ロールを返す（複数ある場合は先頭）*/
function getRole(event, userId) {
  return getMemberRoleIds(event, userId)[0] || null;
}

/** メンバーのロール ID 配列を取得（新形式 m.roles / 旧形式 m.role 両対応） */
function getMemberRoleIds(event, userId) {
  const m = (event?.members || []).find(x => x.userId === userId);
  if (!m) return [];
  if (Array.isArray(m.roles) && m.roles.length > 0) return m.roles.slice();
  if (m.role) return [m.role];
  return [];
}

/** メンバーのロール ID 配列を更新（後方互換フィールド m.role も維持） */
function setMemberRoleIds(event, userId, roleIds) {
  const m = (event?.members || []).find(x => x.userId === userId);
  if (!m) return false;
  m.roles = Array.isArray(roleIds) ? roleIds.slice() : [];
  m.role  = m.roles[0] || null;
  return true;
}

// ── ロール定義 ────────────────────────────────────────────

function defaultRoles() {
  return [
    { id: 'owner',  name: 'オーナー', canManage: true,  builtIn: true },
    { id: 'admin',  name: '管理者',   canManage: true,  builtIn: true },
    { id: 'member', name: 'メンバー', canManage: false, builtIn: true },
  ];
}

function getRoles(event) {
  if (!event) return defaultRoles();
  if (!Array.isArray(event.roles) || event.roles.length === 0) return defaultRoles();
  // 既存ロールに組み込み 3 つが揃っているか保証
  const existing = event.roles.slice();
  const ids = new Set(existing.map(r => r.id));
  for (const def of defaultRoles()) {
    if (!ids.has(def.id)) existing.push(def);
  }
  return existing;
}

function setRoles(event, roles) {
  event.roles = roles;
}

function getRoleDef(event, roleId) {
  return getRoles(event).find(r => r.id === roleId) || null;
}

/**
 * ユーザーが管理者権限を持つかどうか。
 * 自分のロール定義のうちいずれか1つでも canManage=true なら true。
 */
function canManage(event, userId) {
  const ids = getMemberRoleIds(event, userId);
  if (ids.length === 0) return false;
  const roles = getRoles(event);
  return ids.some(rid => {
    const def = roles.find(r => r.id === rid);
    return !!(def && def.canManage);
  });
}

function newRoleId() {
  return 'role_' + crypto.randomBytes(6).toString('hex');
}

/** 招待トークン生成（後方互換: inviteStore にも同じ関数あり） */
function newInviteToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * イベントの folderId を更新する（CRDT 外・専用API用）。
 * @param {string} eventId
 * @param {string|null} folderId
 */
async function setFolderId(eventId, folderId) {
  await col().updateOne(
    { _id: eventId },
    { $set: { folderId: folderId || null } }
  );
}

/**
 * 指定フォルダに所属するイベント一覧を取得。
 * @param {string} folderId
 */
async function listByFolder(folderId) {
  const docs = await col().find({ folderId }).toArray();
  return docs.map(_fromDoc);
}

module.exports = {
  // async CRUD
  loadEvent,
  saveEvent,
  deleteEvent,
  applyPatch,
  listEventsForUser,
  setFolderId,
  listByFolder,
  // 同期ヘルパ
  isMember,
  getRole,
  getMemberRoleIds,
  setMemberRoleIds,
  getRoles,
  setRoles,
  getRoleDef,
  canManage,
  newRoleId,
  defaultRoles,
  newInviteToken,
};
