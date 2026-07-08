// lib/db.js — MongoDB 接続の単一エントリポイント
// プロセス全体で MongoClient を 1 つだけ生成し、再利用する。
// 使い方：
//   const { getDb, connectDb, closeDb } = require('./lib/db');
//   await connectDb();          // サーバー起動時に 1 度だけ呼ぶ
//   const db = getDb();         // 以降はどこからでも同期的に取得可能

'use strict';

const { MongoClient } = require('mongodb');

// ──────────────────────────────────────────────
// 設定
// ──────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB  = process.env.MONGODB_DB || 'evecre';

// 通知の TTL（秒）：90 日
const NOTIF_TTL_SEC = 60 * 60 * 24 * 90;

// 行動ログ TTL（秒）：180 日
const EVENTS_TTL_SEC = 60 * 60 * 24 * 180;

// pending_actions（OTP / メール変更 / パスワードリセット）の TTL（秒）：1 時間
const PENDING_TTL_SEC = 60 * 60;

// セッション TTL（秒）：30 日
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

// ──────────────────────────────────────────────
// シングルトン
// ──────────────────────────────────────────────
/** @type {MongoClient | null} */
let _client = null;

/** @type {import('mongodb').Db | null} */
let _db = null;

/**
 * 接続済みの Db インスタンスを返す。
 * connectDb() を呼ぶ前に使うと Error を投げる。
 * @returns {import('mongodb').Db}
 */
function getDb() {
  if (!_db) throw new Error('[db] MongoDB に未接続。connectDb() を先に呼んでください。');
  return _db;
}

/**
 * MongoClient を接続し、インデックスを冪等に作成する。
 * サーバー起動時に 1 度だけ呼ぶ。
 */
async function connectDb() {
  if (_db) return; // 二重接続防止

  if (!MONGODB_URI) {
    throw new Error('[db] 環境変数 MONGODB_URI が設定されていません。');
  }

  _client = new MongoClient(MONGODB_URI, {
    // Atlas 推奨オプション
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });

  await _client.connect();
  _db = _client.db(MONGODB_DB);

  console.log(`[db] MongoDB 接続成功: ${MONGODB_DB}`);

  await _ensureIndexes(_db);
}

/**
 * MongoClient を閉じる。SIGTERM ハンドラから呼ぶ。
 */
async function closeDb() {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
    console.log('[db] MongoDB 接続クローズ');
  }
}

// ──────────────────────────────────────────────
// インデックス作成（冪等）
// ──────────────────────────────────────────────
async function _ensureIndexes(db) {
  // ── users ──────────────────────────────────
  const users = db.collection('users');
  await users.createIndex({ emailLower: 1 }, { unique: true, name: 'emailLower_unique' });

  // ── sessions ───────────────────────────────
  const sessions = db.collection('sessions');
  await sessions.createIndex({ token: 1 }, { unique: true, name: 'token_unique' });
  // TTL インデックス：expiresAt を Date 型で保存する前提
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'sessions_ttl' });

  // ── events（イベント本体）─────────────────
  const events_col = db.collection('events');
  await events_col.createIndex({ 'members.userId': 1 }, { name: 'members_userId' });
  await events_col.createIndex({ ownerId: 1 },           { name: 'ownerId' });
  await events_col.createIndex({ createdAt: -1 },        { name: 'createdAt_desc' });
  await events_col.createIndex({ folderId: 1 },          { name: 'folderId', sparse: true });

  // ── projects（フォルダ）──────────────────
  const projects_col = db.collection('projects');
  await projects_col.createIndex({ ownerId: 1 },           { name: 'ownerId' });
  await projects_col.createIndex({ 'members.userId': 1 }, { name: 'members_userId' });
  await projects_col.createIndex({ createdAt: -1 },       { name: 'createdAt_desc' });

  // ── invites ────────────────────────────────
  const invites = db.collection('invites');
  await invites.createIndex({ token: 1 }, { unique: true, name: 'token_unique' });
  // TTL：expiresAt を Date 型で保存
  await invites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'invites_ttl' });

  // ── notifications ──────────────────────────
  const notifications = db.collection('notifications');
  await notifications.createIndex({ userId: 1, createdAt: -1 }, { name: 'userId_createdAt' });
  // TTL：createdAt から NOTIF_TTL_SEC 秒後に自動削除
  await notifications.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: NOTIF_TTL_SEC, name: 'notifications_ttl' }
  );

  // ── pending_actions ────────────────────────
  // OTP / メール変更 / パスワードリセット / ユーザー名変更
  const pending = db.collection('pending_actions');
  await pending.createIndex({ userId: 1, type: 1 }, { name: 'userId_type' });
  // TTL：expiresAt を Date 型で保存
  await pending.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'pending_ttl' });

  // ── submissions ────────────────────────────
  // ミッションの完了データ（旧 clearedData）
  const submissions = db.collection('submissions');
  await submissions.createIndex({ eventId: 1, missionId: 1 }, { name: 'event_mission' });

  // ── mission_chats（ミッションチャット）─────
  const mission_chats = db.collection('mission_chats');
  await mission_chats.createIndex({ missionId: 1, createdAt: 1 }, { name: 'mission_createdAt' });
  await mission_chats.createIndex({ eventId: 1 },                 { name: 'eventId' });

  // ── event_logs（行動ログ）─────────────────
  const event_logs = db.collection('event_logs');
  await event_logs.createIndex({ userId: 1, ts: 1 },    { name: 'userId_ts' });
  await event_logs.createIndex({ sessionId: 1, ts: 1 }, { name: 'sessionId_ts' });
  await event_logs.createIndex({ event: 1, ts: 1 },     { name: 'event_ts' });
  // イベント紐付けは projectId フィールド（findByProject / deleteByProject 用）
  await event_logs.createIndex({ projectId: 1 },         { name: 'projectId', sparse: true });
  await event_logs.createIndex(
    { ts: 1 },
    { expireAfterSeconds: EVENTS_TTL_SEC, name: 'event_logs_ttl' }
  );

  console.log('[db] インデックス確認済み');
}

// ──────────────────────────────────────────────
// ヘルパ：ping（/healthz 用）
// ──────────────────────────────────────────────
async function pingDb() {
  if (!_db) return false;
  try {
    await _db.command({ ping: 1 });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { getDb, connectDb, closeDb, pingDb };
