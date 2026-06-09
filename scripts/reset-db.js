require('dotenv').config();
const { getDb, connectDb, closeDb } = require('../lib/db');

(async () => {
  await connectDb();
  const db = getDb();
  const cols = await db.listCollections().toArray();
  console.log('削除対象:', cols.map(c => c.name).join(', ') || '(なし)');

  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(r => rl.question('全データを削除します。"yes" と入力してください: ', r));
  rl.close();

  if (ans !== 'yes') {
    console.log('中止しました');
    await closeDb();
    return;
  }

  await db.dropDatabase();
  console.log('✓ DB を空にしました');
  await closeDb();
})();
