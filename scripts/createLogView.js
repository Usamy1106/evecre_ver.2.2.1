// scripts/createLogView.js
// event_logs に username / eventName / day / hour / source を付与した
// 読み取り専用ビュー event_logs_enriched を作成する（Atlas Charts 用）。
//
// 使い方:
//   node scripts/createLogView.js            # .env の MONGODB_DB に作成（既定）
//   node scripts/createLogView.js evecre     # DB名を指定して作成（本番=evecre 等）
//   node scripts/createLogView.js evecre_dev # 開発DBに作成
//
// .env の MONGODB_URI（同一クラスタ）をそのまま使う。第1引数で対象DB名を上書きできる。
// 冪等: 既にビューがあれば一度削除して作り直す。何度実行してもOK。
// 取り消したいとき:  MONGODB_DB=evecre node -e "require('dotenv').config();const{connectDb,getDb,closeDb}=require('./lib/db');(async()=>{await connectDb();await getDb().collection('event_logs_enriched').drop().catch(()=>{});await closeDb();})()"

'use strict';

try { require('dotenv').config(); } catch (_) {}

// 第1引数があれば対象DB名を上書き（lib/db を require する前に設定する必要がある）
const argDb = process.argv[2];
if (argDb) process.env.MONGODB_DB = argDb;

const { connectDb, getDb, closeDb } = require('../lib/db');

const VIEW_NAME   = 'event_logs_enriched';
const SOURCE_COLL = 'event_logs';

const PIPELINE = [
  { $lookup: { from: 'users',  localField: 'userId',    foreignField: '_id', as: '_u' } },
  { $lookup: { from: 'events', localField: 'projectId', foreignField: '_id', as: '_e' } },
  { $set: {
      username:  { $ifNull: [ { $first: '$_u.username' }, '(匿名/未ログイン)' ] },
      eventName: { $ifNull: [ { $first: '$_e.name' },     '(イベント未選択)' ] },
      source:    { $ifNull: [ '$ctx.source', 'client' ] },
      day:  { $dateTrunc: { date: '$ts', unit: 'day', timezone: 'Asia/Tokyo' } },
      hour: { $hour:      { date: '$ts',            timezone: 'Asia/Tokyo' } },
  } },
  { $project: { _u: 0, _e: 0 } },
];

(async () => {
  await connectDb();
  const db = getDb();
  console.log(`[createLogView] 対象データベース: ${db.databaseName}`);

  // 既存の同名ビュー/コレクションがあれば削除（冪等化）
  const existing = await db.listCollections({ name: VIEW_NAME }).toArray();
  if (existing.length > 0) {
    console.log(`[createLogView] 既存の ${VIEW_NAME} を削除して作り直します`);
    await db.collection(VIEW_NAME).drop();
  }

  await db.createCollection(VIEW_NAME, { viewOn: SOURCE_COLL, pipeline: PIPELINE });
  console.log(`[createLogView] ビュー ${VIEW_NAME} を作成しました（source: ${SOURCE_COLL}）`);

  // 動作確認: 先頭1件を表示
  const sample = await db.collection(VIEW_NAME).findOne({}, { projection: { event: 1, username: 1, eventName: 1, day: 1, hour: 1, source: 1 } });
  console.log('[createLogView] サンプル1件:', sample || '(ログがまだありません)');

  await closeDb();
  console.log('[createLogView] 完了');
})().catch(async (e) => {
  console.error('[createLogView] エラー:', e.message);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
