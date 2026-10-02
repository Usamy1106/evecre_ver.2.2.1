// scripts/renameInitialTaskTitles.js — 既存イベントの初期タスク（def-1 目的・def-3 概要）の名前を新しい名前へ書き換える
//
// 新規イベントは state.js が新しい名前で作る。これは既存イベント用（旧 renameDef3Title.js を def-1 にも広げた）。
//   def-1：「このイベントの目的を定めよう」→「このイベントの目的・目標を決めよう」（2026-10-02）
//   def-3：「…整理しよう」など →「どのようなイベントを行うかまとめよう」（2026-09-26・10-02）
//
// ★書き換えるのは、名前が**既定の名前（OLD）のどれかと完全に一致する**ものだけ。
//   利用者が自分で付け直した名前には触れない。
// ★既定は「対象を表示するだけ」。--yes を付けたときだけ書き換える（事故防止の作法）。
// ★何度流しても安全（冪等）。書き換えたあとに、古い画面を開いたままの人が保存すると
//   LWW で古い名前に戻ることがある（保存のたびに全セルへ新しい時刻が付くため）。
//   そのときはもう一度流せば直る。
//
// 使い方:
//   node scripts/renameInitialTaskTitles.js evecre_dev          # 対象を表示するだけ
//   node scripts/renameInitialTaskTitles.js evecre_dev --yes    # 書き換える

'use strict';

require('dotenv').config();
if (process.argv[2] && !process.argv[2].startsWith('--')) process.env.MONGODB_DB = process.argv[2];
const APPLY = process.argv.includes('--yes');

const { getDb, connectDb, closeDb } = require('../lib/db');

const TASKS = [
  { id: 'def-1', NEW: 'このイベントの目的・目標を決めよう',
    OLD: ['イベントの目的を決める', 'イベントの目的を定めよう', 'このイベントの目的を定めよう'] },
  { id: 'def-3', NEW: 'どのようなイベントを行うかまとめよう',
    OLD: ['イベントの概要を決める', 'イベントの概要を定めよう', 'このイベントの概要を定めよう', 'どのようなイベントを行うか整理しよう'] },
];

(async () => {
  await connectDb();
  const db = getDb();
  const events = db.collection('events');
  console.log(`\n対象データベース: ${db.databaseName}　${APPLY ? '【書き換える】' : '（表示のみ。書き換えるには --yes）'}`);

  for (const t of TASKS) {
    const f = `missions.${t.id}.fields.title`;
    const docs = await events.find(
      { [`${f}.v`]: { $in: t.OLD }, [`missions.${t.id}.deletedAt`]: null },
      { projection: { 'fields.name.v': 1, [f]: 1 } },
    ).toArray();
    const skipped = await events.countDocuments({
      [`missions.${t.id}`]: { $exists: true },
      [`${f}.v`]: { $nin: [...t.OLD, t.NEW] },
    });

    console.log(`\n[${t.id}] → ${t.NEW}`);
    for (const d of docs) {
      console.log(`  ${d._id}  「${d.fields?.name?.v ?? '(無題)'}」  ${d.missions[t.id].fields.title.v}`);
    }
    console.log(`  書き換え対象: ${docs.length}件　／　名前を付け直していて触れないもの: ${skipped}件`);

    if (APPLY && docs.length > 0) {
      const now = Date.now();
      let changed = 0;
      for (const d of docs) {
        // ★その時点でまだ古い名前のものだけを書く（流している間に誰かが付け直していたら触れない）
        const r = await events.updateOne(
          { _id: d._id, [`${f}.v`]: { $in: t.OLD } },
          { $set: { [f]: { v: t.NEW, t: now } } },
        );
        changed += r.modifiedCount;
      }
      const left = await events.countDocuments({ [`${f}.v`]: { $in: t.OLD } });
      console.log(`  書き換えた: ${changed}件　／　古い名前のまま残っている: ${left}件`);
    }
  }
  console.log('');
  await closeDb();
})().catch(async (e) => {
  console.error(e);
  try { await closeDb(); } catch (_) { /* noop */ }
  process.exit(1);
});
