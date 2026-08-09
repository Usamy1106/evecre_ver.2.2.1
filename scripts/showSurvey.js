// scripts/showSurvey.js — アカウント作成時アンケートの集計をターミナルに表示する
//
// MongoDB Charts を開かなくても結果を確認できるようにしたもの。
// 集計そのものは survey_summary ビューが持っているので、ここは表示するだけ。
//
// 使い方:
//   node scripts/showSurvey.js              # .env の MONGODB_DB（既定 evecre）
//   node scripts/showSurvey.js evecre_dev   # 対象DBを指定
//
// ★ビューが無い場合は先に作ること:
//   node scripts/createAnalyticsViews.js <db>

'use strict';

require('dotenv').config();
if (process.argv[2]) process.env.MONGODB_DB = process.argv[2];

const { getDb, connectDb, closeDb } = require('../lib/db');

const BAR_WIDTH = 28;

function bar(percent) {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  return '█'.repeat(filled) + '·'.repeat(BAR_WIDTH - filled);
}

(async () => {
  await connectDb();
  const db = getDb();
  console.log(`\n対象データベース: ${db.databaseName}\n`);

  const exists = await db.listCollections({ name: 'survey_summary' }).toArray();
  if (exists.length === 0) {
    console.error('survey_summary ビューがありません。先に次を実行してください:');
    console.error(`  node scripts/createAnalyticsViews.js ${db.databaseName}`);
    await closeDb();
    process.exit(1);
  }

  // 回答者の内訳（現役 / 退会済み）
  const byStatus = await db.collection('survey_responses_all').aggregate([
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]).toArray();
  const active  = byStatus.find(x => x._id === 'active')?.n  || 0;
  const deleted = byStatus.find(x => x._id === 'deleted')?.n || 0;
  console.log(`回答者: ${active + deleted} 人（現役 ${active} / 退会済み ${deleted}）`);
  console.log('─'.repeat(60));

  const rows = await db.collection('survey_summary').find({}).toArray();
  if (rows.length === 0) {
    console.log('\nまだ回答がありません。');
    await closeDb();
    return;
  }

  // 設問ごとにまとめて表示
  const byQuestion = new Map();
  for (const r of rows) {
    if (!byQuestion.has(r.question)) byQuestion.set(r.question, { label: r.questionLabel, total: r.total, rows: [] });
    byQuestion.get(r.question).rows.push(r);
  }

  for (const [, q] of byQuestion) {
    console.log(`\n■ ${q.label}　(n=${q.total})`);
    for (const r of q.rows.sort((a, b) => b.count - a.count)) {
      const label = String(r.answerLabel).padEnd(18, '　').slice(0, 18);
      console.log(`   ${label} ${bar(r.percent)} ${String(r.count).padStart(3)}人 ${String(r.percent).padStart(5)}%`);
    }
  }

  // 「その他」の自由記述は選択肢に丸められないので、そのまま並べる
  const others = await db.collection('survey_responses_all')
    .find({ acquisitionChannelOther: { $ne: null } }, { projection: { acquisitionChannelOther: 1, _id: 0 } })
    .toArray();
  if (others.length > 0) {
    console.log(`\n■ 「その他」の自由記述　(${others.length}件)`);
    for (const o of others) console.log(`   ・${o.acquisitionChannelOther}`);
  }

  console.log('');
  await closeDb();
})().catch(async (e) => {
  console.error('エラー:', e.message);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
