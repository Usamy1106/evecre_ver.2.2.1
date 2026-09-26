// scripts/renameDef3Title.js — 既存イベントの初期タスク def-3 の名前を新しい名前へ書き換える（1回限り）
//
// 2026-09-26、def-3 を「どのようなイベントを行うか整理しよう」に改名した（アーカイブの概要を
// タスクから切り離したため）。新規イベントは state.js が新しい名前で作る。これは既存イベント用。
//
// ★書き換えるのは、名前が**既定の3種類のどれかと完全に一致する**ものだけ。
//   利用者が自分で付け直した名前には触れない。
// ★既定は「対象を表示するだけ」。--yes を付けたときだけ書き換える（事故防止の作法）。
// ★何度流しても安全（冪等）。書き換えたあとに、古い画面を開いたままの人が保存すると
//   LWW で古い名前に戻ることがある（保存のたびに全セルへ新しい時刻が付くため）。
//   そのときはもう一度流せば直る。
//
// 使い方:
//   node scripts/renameDef3Title.js evecre_dev          # 対象を表示するだけ
//   node scripts/renameDef3Title.js evecre_dev --yes    # 書き換える

'use strict';

require('dotenv').config();
if (process.argv[2] && !process.argv[2].startsWith('--')) process.env.MONGODB_DB = process.argv[2];
const APPLY = process.argv.includes('--yes');

const { getDb, connectDb, closeDb } = require('../lib/db');

const NEW_TITLE  = 'どのようなイベントを行うか整理しよう';
const OLD_TITLES = ['イベントの概要を決める', 'イベントの概要を定めよう', 'このイベントの概要を定めよう'];

(async () => {
  await connectDb();
  const db = getDb();
  const events = db.collection('events');
  console.log(`\n対象データベース: ${db.databaseName}　${APPLY ? '【書き換える】' : '（表示のみ。書き換えるには --yes）'}\n`);

  const docs = await events.find(
    { 'missions.def-3.fields.title.v': { $in: OLD_TITLES }, 'missions.def-3.deletedAt': null },
    { projection: { 'fields.name.v': 1, 'missions.def-3.fields.title': 1 } },
  ).toArray();

  const skipped = await events.countDocuments({
    'missions.def-3': { $exists: true },
    'missions.def-3.fields.title.v': { $nin: [...OLD_TITLES, NEW_TITLE] },
  });

  for (const d of docs) {
    console.log(`  ${d._id}  「${d.fields?.name?.v ?? '(無題)'}」  ${d.missions['def-3'].fields.title.v} → ${NEW_TITLE}`);
  }
  console.log(`\n書き換え対象: ${docs.length}件　／　名前を付け直していて触れないもの: ${skipped}件`);

  if (APPLY && docs.length > 0) {
    const now = Date.now();
    let changed = 0;
    for (const d of docs) {
      // ★その時点でまだ古い名前のものだけを書く（流している間に誰かが付け直していたら触れない）
      const r = await events.updateOne(
        { _id: d._id, 'missions.def-3.fields.title.v': { $in: OLD_TITLES } },
        { $set: { 'missions.def-3.fields.title': { v: NEW_TITLE, t: now } } },
      );
      changed += r.modifiedCount;
    }
    console.log(`書き換えた: ${changed}件`);
    const left = await events.countDocuments({ 'missions.def-3.fields.title.v': { $in: OLD_TITLES } });
    console.log(`古い名前のまま残っている: ${left}件`);
  }
  console.log('');
  await closeDb();
})().catch(async (e) => {
  console.error(e);
  try { await closeDb(); } catch (_) { /* noop */ }
  process.exit(1);
});
