// scripts/cleanupCollectionData.js — 図鑑（コレクション）機能の残骸データを削除する
//
// 図鑑機能を廃止したため、以下を消す：
//   1. user_collections コレクション（丸ごと drop）
//   2. events 内の全ミッションの rewardObject フィールド（CRDT の fields から $unset）
//
// ★使い捨てスクリプト。実行後は削除してよい。
//
// 使い方:
//   node scripts/cleanupCollectionData.js            # 対象を表示するだけ（dry-run）
//   node scripts/cleanupCollectionData.js --apply    # 実際に削除する
//   node scripts/cleanupCollectionData.js --apply evecre   # DB名を明示（既定は .env の MONGODB_DB）

'use strict';

try { require('dotenv').config(); } catch (_) {}

const { MongoClient } = require('mongodb');

const APPLY  = process.argv.includes('--apply');
const dbArg  = process.argv.slice(2).find(a => !a.startsWith('--'));
const DB_NAME = dbArg || process.env.MONGODB_DB || 'evecre';

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('[fatal] MONGODB_URI が未設定です');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(DB_NAME);

  console.log(`DB: ${DB_NAME}   モード: ${APPLY ? '★実行（削除する）' : 'dry-run（表示のみ）'}\n`);

  // ── 1. user_collections ────────────────────────────────
  const cols = (await db.listCollections().toArray()).map(c => c.name);
  if (cols.includes('user_collections')) {
    const n = await db.collection('user_collections').countDocuments();
    console.log(`[1] user_collections: ${n} 件のドキュメント`);
    if (APPLY) {
      await db.collection('user_collections').drop();
      console.log('    → drop しました');
    } else {
      console.log('    → --apply で drop されます');
    }
  } else {
    console.log('[1] user_collections: 存在しません（対応不要）');
  }

  // ── 2. missions.*.fields.rewardObject ──────────────────
  // CRDT 形式なので missions は { <missionId>: { fields: { rewardObject: {v,t} } } } という入れ子。
  // フィールド名が動的なため、ドキュメントごとに $unset のパスを組み立てる。
  const events = await db.collection('events')
    .find({}, { projection: { missions: 1 } })
    .toArray();

  let affectedEvents = 0, affectedMissions = 0;
  const ops = [];
  for (const ev of events) {
    const unset = {};
    for (const [mid, m] of Object.entries(ev.missions || {})) {
      if (m?.fields?.rewardObject !== undefined) {
        unset[`missions.${mid}.fields.rewardObject`] = '';
        affectedMissions++;
      }
    }
    if (Object.keys(unset).length > 0) {
      affectedEvents++;
      ops.push({ updateOne: { filter: { _id: ev._id }, update: { $unset: unset } } });
    }
  }

  console.log(`[2] rewardObject を持つミッション: ${affectedMissions} 件（${affectedEvents} イベント）`);
  if (affectedMissions === 0) {
    console.log('    → 対応不要');
  } else if (APPLY) {
    const res = await db.collection('events').bulkWrite(ops);
    console.log(`    → ${res.modifiedCount} イベントを更新しました`);
  } else {
    console.log('    → --apply で $unset されます');
  }

  await client.close();
  console.log(`\n${APPLY ? '完了' : 'dry-run 終了。実際に削除するには --apply を付けてください'}`);
})().catch(e => { console.error('[error]', e.message); process.exit(1); });
