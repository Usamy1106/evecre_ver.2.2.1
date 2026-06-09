#!/usr/bin/env node
// scripts/migrate-fs-to-atlas.js
//
// JSON ファイルストレージ（data/）から MongoDB Atlas への移行スクリプト。
//
// ── 冪等性 ──────────────────────────────────────────────────────────────
// $setOnInsert + upsert: true を使用。
// ドキュメントが既に存在する場合は何もしない（既存データを上書きしない）。
// 何度実行しても安全。
//
// ── 移行対象 ────────────────────────────────────────────────────────────
// 1. users       data/users.json → users コレクション
// 2. sessions    users[].sessions → sessions コレクション（未期限のみ）
// 3. projects    data/projects/*.json → projects コレクション
// 4. submissions project.clearedData → submissions コレクション
// 5. invites     data/invites/*.json → invites コレクション
// 6. notifications data/notifications/*.json → notifications コレクション
//
// ── 実行方法 ────────────────────────────────────────────────────────────
// MONGODB_URI=mongodb+srv://... MONGODB_DB=evecre node scripts/migrate-fs-to-atlas.js
// または .env が用意してある場合:
//   node scripts/migrate-fs-to-atlas.js
//
// ── 注意事項 ────────────────────────────────────────────────────────────
// - data/ ディレクトリが存在しない場合は対象コレクションをスキップ
// - sessions は expiresAt が過去のものはスキップ
// - invites は expiresAt が過去のものはスキップ
// - notifications の createdAt は number → BSON Date に変換（TTL 用）
// - invites / sessions の expiresAt は number → BSON Date に変換（TTL 用）
// - project の clearedData は submissions コレクションに分離後、project から除去

'use strict';

try { require('dotenv').config(); } catch (_) {}

const fs         = require('fs');
const path       = require('path');
const { MongoClient } = require('mongodb');

// ──────────────────────────────────────────────
// 設定
// ──────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB  = process.env.MONGODB_DB  || 'evecre';
const DATA_DIR    = path.resolve(__dirname, '..', 'data');

if (!MONGODB_URI) {
  console.error('[fatal] 環境変数 MONGODB_URI が設定されていません。');
  process.exit(1);
}

// ──────────────────────────────────────────────
// ユーティリティ
// ──────────────────────────────────────────────

/** JSON ファイルを読み込む。失敗したら null を返す */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** ディレクトリ内の .json ファイル一覧を返す */
function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'));
}

/**
 * ドキュメントが存在しない場合のみ挿入（冪等）。
 * $setOnInsert: doc (without _id) + upsert: true を使用。
 * matched & not modified → 既存スキップ
 * matched = 0 → 挿入
 */
async function upsertOnce(col, id, docWithoutId) {
  const result = await col.updateOne(
    { _id: id },
    { $setOnInsert: docWithoutId },
    { upsert: true }
  );
  return result.upsertedCount > 0 ? 'inserted' : 'skipped';
}

// ──────────────────────────────────────────────
// 移行処理
// ──────────────────────────────────────────────

async function migrateUsers(db) {
  const col  = db.collection('users');
  const sCol = db.collection('sessions');

  const usersFile = path.join(DATA_DIR, 'users.json');
  if (!fs.existsSync(usersFile)) {
    console.log('[users] data/users.json が見つかりません。スキップ。');
    return;
  }

  const raw   = readJson(usersFile);
  const users = raw?.users || (Array.isArray(raw) ? raw : []);
  if (users.length === 0) {
    console.log('[users] ユーザーなし。スキップ。');
    return;
  }

  let insertedUsers = 0, skippedUsers = 0;
  let insertedSessions = 0;
  const now = Date.now();

  for (const user of users) {
    const { sessions, _id, ...rest } = user; // sessions は別コレクションへ
    const id = user.id;
    if (!id) { console.warn('[users] id なし — スキップ:', user.username); continue; }

    const status = await upsertOnce(col, id, { ...rest });
    if (status === 'inserted') insertedUsers++;
    else skippedUsers++;

    // sessions の移行（未期限のもの）
    if (Array.isArray(sessions)) {
      for (const sess of sessions) {
        if (!sess.token || !sess.expiresAt) continue;
        // number か Date かどちらの形式でも対応
        const expiresAtMs = sess.expiresAt instanceof Date
          ? sess.expiresAt.getTime()
          : Number(sess.expiresAt);
        if (expiresAtMs < now) continue; // 期限切れはスキップ

        const sessStatus = await upsertOnce(sCol, `sess_${sess.token}`, {
          userId:    id,
          token:     sess.token,
          expiresAt: new Date(expiresAtMs),
        });
        if (sessStatus === 'inserted') insertedSessions++;
      }
    }
  }

  console.log(`[users] inserted=${insertedUsers}, skipped=${skippedUsers}`);
  console.log(`[sessions] inserted=${insertedSessions}`);
}

async function migrateProjects(db) {
  const col  = db.collection('projects');
  const sCol = db.collection('submissions');

  const pDir = path.join(DATA_DIR, 'projects');
  const files = jsonFiles(pDir);
  if (files.length === 0) {
    console.log('[projects] プロジェクトなし。スキップ。');
    return;
  }

  let insertedProjects = 0, skippedProjects = 0;
  let insertedSubmissions = 0;

  for (const file of files) {
    const project = readJson(path.join(pDir, file));
    if (!project?.id) { console.warn('[projects] id なし — スキップ:', file); continue; }

    // clearedData を submissions に分離
    const clearedData = project.clearedData;
    if (clearedData?.fields) {
      for (const [missionId, cell] of Object.entries(clearedData.fields)) {
        if (!cell?.v) continue;
        const submission = cell.v; // { content, format, title, timestamp }
        const submId = `${project.id}:${missionId}`;
        const submStatus = await upsertOnce(sCol, submId, {
          projectId: project.id,
          missionId,
          content:   submission.content   ?? '',
          format:    submission.format    ?? 'text',
          title:     submission.title     ?? '',
          timestamp: submission.timestamp ?? 0,
        });
        if (submStatus === 'inserted') insertedSubmissions++;
      }
    }

    // MongoDB に保存するプロジェクトから clearedData を除去
    // （submissions コレクションで管理するため）
    const { _id, clearedData: _cd, ...projectFields } = project;
    const status = await upsertOnce(col, project.id, {
      ...projectFields,
      // clearedData は除去済み（CRDT フィールドとして空にする）
    });
    if (status === 'inserted') insertedProjects++;
    else skippedProjects++;
  }

  console.log(`[projects] inserted=${insertedProjects}, skipped=${skippedProjects}`);
  console.log(`[submissions] inserted=${insertedSubmissions}`);
}

async function migrateInvites(db) {
  const col = db.collection('invites');

  const iDir  = path.join(DATA_DIR, 'invites');
  const files = jsonFiles(iDir);
  if (files.length === 0) {
    console.log('[invites] 招待なし。スキップ。');
    return;
  }

  let inserted = 0, skipped = 0, expired = 0;
  const now = Date.now();

  for (const file of files) {
    const invite = readJson(path.join(iDir, file));
    const token = invite?.token || file.replace('.json', '');
    if (!token) continue;

    // expiresAt が過去のものはスキップ
    if (invite.expiresAt) {
      const expiresAtMs = invite.expiresAt instanceof Date
        ? invite.expiresAt.getTime()
        : Number(invite.expiresAt);
      if (expiresAtMs < now) { expired++; continue; }

      const { _id, token: t, ...rest } = invite;
      const status = await upsertOnce(col, token, {
        ...rest,
        token,
        expiresAt: new Date(expiresAtMs), // BSON Date（TTL 用）
      });
      if (status === 'inserted') inserted++;
      else skipped++;
    } else {
      // expiresAt なし（無期限招待）
      const { _id, token: t, ...rest } = invite;
      const status = await upsertOnce(col, token, { ...rest, token });
      if (status === 'inserted') inserted++;
      else skipped++;
    }
  }

  console.log(`[invites] inserted=${inserted}, skipped=${skipped}, expired_skipped=${expired}`);
}

async function migrateNotifications(db) {
  const col = db.collection('notifications');

  const nDir  = path.join(DATA_DIR, 'notifications');
  const files = jsonFiles(nDir);
  if (files.length === 0) {
    console.log('[notifications] 通知なし。スキップ。');
    return;
  }

  let inserted = 0, skipped = 0;

  for (const file of files) {
    const userId = file.replace('.json', '');
    const raw    = readJson(path.join(nDir, file));
    const notifs = raw?.notifications || [];

    for (const notif of notifs) {
      if (!notif.id) continue;
      const { id, _id, ...rest } = notif;

      // createdAt を BSON Date に変換（TTL インデックス用）
      const createdAtMs = typeof rest.createdAt === 'number'
        ? rest.createdAt
        : (rest.createdAt instanceof Date ? rest.createdAt.getTime() : Date.now());

      const status = await upsertOnce(col, id, {
        ...rest,
        userId,
        createdAt: new Date(createdAtMs),
      });
      if (status === 'inserted') inserted++;
      else skipped++;
    }
  }

  console.log(`[notifications] inserted=${inserted}, skipped=${skipped}`);
}

// ──────────────────────────────────────────────
// メイン
// ──────────────────────────────────────────────

async function main() {
  console.log('=== migrate-fs-to-atlas ===');
  console.log(`接続先: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
  console.log(`データベース: ${MONGODB_DB}`);
  console.log(`データディレクトリ: ${DATA_DIR}`);
  console.log('');

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`[fatal] data/ ディレクトリが見つかりません: ${DATA_DIR}`);
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize:              5,
    serverSelectionTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    console.log('[db] MongoDB 接続成功\n');
    const db = client.db(MONGODB_DB);

    console.log('── 1. ユーザー + セッション ──────────────────');
    await migrateUsers(db);

    console.log('\n── 2. プロジェクト + 提出物 ──────────────────');
    await migrateProjects(db);

    console.log('\n── 3. 招待 ────────────────────────────────────');
    await migrateInvites(db);

    console.log('\n── 4. 通知 ────────────────────────────────────');
    await migrateNotifications(db);

    console.log('\n=== 移行完了 ===');
    console.log('✅ data/ の JSON ファイルは削除せずそのまま残します。');
    console.log('   動作確認後、手動で削除または gitignore に追加してください。');
  } catch (e) {
    console.error('[fatal] 移行中にエラーが発生しました:', e);
    process.exit(1);
  } finally {
    await client.close();
    console.log('[db] 接続クローズ');
  }
}

main();
