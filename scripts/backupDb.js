// scripts/backupDb.js — MongoDB のバックアップと復元（手動運用）
//
//   書き出し:  node scripts/backupDb.js dump evecre
//   一覧:      node scripts/backupDb.js list
//   復元:      node scripts/backupDb.js restore evecre <フォルダ名> <コレクション名> --yes
//
// ★Atlas の無料プラン（M0）には自動バックアップが無い。消えたデータは戻せないので、
//   データを壊しうる変更（保存まわり・削除まわり）を本番へ出す前に必ず流すこと。
// ★出力先はリポジトリの外（既定 ~/evecre/backups/<日時>/<DB名>/）。
//   中身は個人情報を含むので、**コミットしない・共有しない**。
// ★dump は読むだけ。restore は**コレクションを1つずつ・--yes を明示したときだけ**書き戻す
//   （まとめて戻す機能はわざと作っていない。事故の被害が大きくなるため）。
// ★分析ビュー（createAnalyticsViews.js が作る read-only ビュー）は書き出さない。
//   元データから再生成できるうえ、復元先で view に書き戻そうとすると失敗する。
'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { MongoClient } = require('mongodb');

const OUT_ROOT = process.env.BACKUP_DIR || path.join(os.homedir(), 'evecre', 'backups');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI が設定されていません（.env）');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return client;
}

/** 書き出し。コレクションごとに1つの JSON にする（件数が小さいので分割しない）*/
async function dump(dbName) {
  const client = await connect();
  try {
    const db = client.db(dbName);
    const dir = path.join(OUT_ROOT, stamp(), dbName);
    fs.mkdirSync(dir, { recursive: true });

    // ★ビューは除く（元データから再生成できる／復元先で書き戻せない）
    const cols = (await db.listCollections().toArray()).filter(c => c.type !== 'view');
    console.log(`対象データベース: ${db.databaseName}`);
    console.log(`書き出し先: ${dir}\n`);

    let total = 0;
    for (const c of cols) {
      const docs = await db.collection(c.name).find({}).toArray();
      fs.writeFileSync(path.join(dir, `${c.name}.json`), JSON.stringify(docs, null, 0));
      const kb = (fs.statSync(path.join(dir, `${c.name}.json`)).size / 1024).toFixed(0);
      console.log(`  ${c.name.padEnd(22)} ${String(docs.length).padStart(6)} 件  ${kb}KB`);
      total += docs.length;
    }
    fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify({
      db: db.databaseName, at: new Date().toISOString(), total,
      collections: cols.map(c => c.name),
    }, null, 2));
    console.log(`\n完了：${cols.length} コレクション / ${total} 件`);
    console.log('★この中身は個人情報を含む。コミットも共有もしないこと。');
  } finally {
    await client.close();
  }
}

/** 取ってあるバックアップの一覧 */
function list() {
  if (!fs.existsSync(OUT_ROOT)) { console.log(`まだ1つもありません（${OUT_ROOT}）`); return; }
  for (const stampDir of fs.readdirSync(OUT_ROOT).sort()) {
    for (const dbDir of fs.readdirSync(path.join(OUT_ROOT, stampDir))) {
      const metaPath = path.join(OUT_ROOT, stampDir, dbDir, '_meta.json');
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
      console.log(`${stampDir}  ${dbDir}  ${meta ? `${meta.collections.length} コレクション / ${meta.total} 件` : '(メタ情報なし)'}`);
    }
  }
}

/**
 * 復元。★1コレクションずつ。--yes を明示したときだけ書き戻す。
 * ★既存のドキュメントは **_id 単位で置き換える**（コレクションを消してから入れ直さない）。
 *   バックアップ後に増えたものを巻き添えで消さないため。
 */
async function restore(dbName, stampDir, colName, yes) {
  const file = path.join(OUT_ROOT, stampDir, dbName, `${colName}.json`);
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  const docs = JSON.parse(fs.readFileSync(file, 'utf8'));

  const client = await connect();
  try {
    const db = client.db(dbName);
    const now = await db.collection(colName).countDocuments({});
    console.log(`対象データベース: ${db.databaseName} / コレクション: ${colName}`);
    console.log(`バックアップ: ${docs.length} 件（${stampDir}） → 現在: ${now} 件`);
    if (!yes) {
      console.log('\n★--yes を付けたときだけ実際に書き戻します。');
      console.log('  書き戻しは _id 単位の置き換えです（現在あって、バックアップに無いものは消しません）。');
      return;
    }
    let n = 0;
    for (let i = 0; i < docs.length; i += 200) {
      const chunk = docs.slice(i, i + 200);
      await db.collection(colName).bulkWrite(
        chunk.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
        { ordered: false },
      );
      n += chunk.length;
    }
    console.log(`書き戻し完了：${n} 件（現在の件数 ${await db.collection(colName).countDocuments({})} 件）`);
  } finally {
    await client.close();
  }
}

(async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  const yes = process.argv.includes('--yes');
  if (cmd === 'dump' && a) return dump(a);
  if (cmd === 'list') return list();
  if (cmd === 'restore' && a && b && c) return restore(a, b, c, yes);
  console.log(`使い方:
  node scripts/backupDb.js dump <DB名>                         書き出し（読むだけ）
  node scripts/backupDb.js list                                取ってあるものの一覧
  node scripts/backupDb.js restore <DB名> <日時> <コレクション> [--yes]   復元（1つずつ）

出力先: ${OUT_ROOT}（BACKUP_DIR で変えられる）`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
