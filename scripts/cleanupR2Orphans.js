// scripts/cleanupR2Orphans.js — R2 の提出物置き場（submissions/）から、どこからも使われていないファイルを消す
//
// 残る経路（2026-09-26 時点）：
//   - 画像・PDF を送ったあと、「完了する」を押さずに離れた（送信は完了より先に1つずつ行う）
//   - 2026-09-26 より前に「未完了に戻す」「タスクの削除」をした（当時はサーバーが提出物を消していなかった）
//
// ★既定は「対象を表示するだけ」。--yes を付けたときだけ消す（事故防止の作法）。
// ★作られてから GRACE_HOURS（既定96時間＝4日）以内のものは消さない。
//   送ったばかりで、まだ「完了する」を押していない最中のファイルを消さないため。
//   アーカイブの編集モードも、画像を置いてから保存まで少し待つ。
// ★開発と本番は同じバケットを使っている（2026-09-26 に確認）。片方の DB だけ見て判断すると、
//   もう片方のファイルを消してしまう。そこで：
//   - DB を1つだけ渡したとき：その DB に無いイベントの下は「不明」として数えるだけで消さない
//   - DB をカンマ区切りで全部渡したとき（evecre,evecre_dev）：どの DB にも無いイベントの下
//     （＝削除済みのイベントの残り）も、猶予を過ぎていれば消す対象にする
// ★「使われている」の判定は広めにとる：events・submissions・mission_chats の文書の中に
//   その URL が1回でも現れたら残す（ヘッダー画像・提出物・旧形式・PDF の1ページ目・貼られたリンク）。
//   取りこぼして消すと戻せないので、迷ったら残す側に倒す。
//
// 使い方:
//   node scripts/cleanupR2Orphans.js evecre,evecre_dev             # 対象を表示するだけ（推奨：両方渡す）
//   node scripts/cleanupR2Orphans.js evecre,evecre_dev --yes       # 消す
//   node scripts/cleanupR2Orphans.js evecre_dev                    # 1つだけ（ほかの DB の分には触れない）
//   node scripts/cleanupR2Orphans.js evecre,evecre_dev --hours=168 # 猶予を変える（最低24時間）

'use strict';

require('dotenv').config();
const DBS = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (process.env.MONGODB_DB || ''))
  .split(',').map(s => s.trim()).filter(Boolean);
const APPLY = process.argv.includes('--yes');
const hoursArg = process.argv.find(a => a.startsWith('--hours='));
const GRACE_HOURS = Math.max(24, hoursArg ? Number(hoursArg.split('=')[1]) || 96 : 96);

const { MongoClient } = require('mongodb');
const r2 = require('../lib/r2');

let client = null;
const fmtMB = (b) => (b / 1024 / 1024).toFixed(2) + 'MB';

/** 文書の中に現れる R2 の URL をすべて拾ってキーにする（構造に頼らず文字列で探す） */
function collectKeys(doc, prefix, out) {
  const json = JSON.stringify(doc);
  let i = json.indexOf(prefix);
  while (i !== -1) {
    let j = i + prefix.length;
    while (j < json.length && !'"\\ \n)'.includes(json[j])) j++;
    out.add(json.slice(i + prefix.length, j).split('?')[0]);
    i = json.indexOf(prefix, j);
  }
}

(async () => {
  if (!r2.isConfigured()) { console.error('R2 が設定されていません（.env）'); process.exit(1); }
  if (DBS.length === 0) { console.error('DB 名を渡してください（例: evecre,evecre_dev）'); process.exit(1); }
  client = await MongoClient.connect(process.env.MONGODB_URI);
  const ALL = DBS.length > 1;
  const prefix = r2.publicUrlPrefix();
  console.log(`\n対象データベース: ${DBS.join(', ')}　猶予: ${GRACE_HOURS}時間　${APPLY ? '【消す】' : '（表示のみ。消すには --yes）'}`);
  if (!ALL) console.log('★DB が1つなので、ほかの DB のイベントの下には触れません（全部渡すと削除済みイベントの残りも対象になります）');
  console.log('');

  const eventIds = new Set();
  const names = {};
  const used = new Set();
  for (const name of DBS) {
    const db = client.db(name);
    for (const d of await db.collection('events').find({}, { projection: { 'fields.name.v': 1 } }).toArray()) {
      eventIds.add(String(d._id)); names[String(d._id)] = d.fields?.name?.v;
    }
    for (const col of ['events', 'submissions', 'mission_chats']) {
      for await (const doc of db.collection(col).find({})) collectKeys(doc, prefix, used);
    }
  }

  const cutoff = Date.now() - GRACE_HOURS * 3600 * 1000;
  const orphans = [];
  const stat = { total: 0, used: 0, recent: 0, unknownEvent: 0, unknownBytes: 0 };
  const unknownIds = new Set();
  for await (const o of r2.listObjects('submissions/')) {
    stat.total++;
    const eventId = o.key.split('/')[1];
    if (used.has(o.key)) { stat.used++; continue; }
    if (!eventIds.has(eventId) && !ALL) { stat.unknownEvent++; stat.unknownBytes += o.size; unknownIds.add(eventId); continue; }
    if (o.lastModified && o.lastModified.getTime() > cutoff) { stat.recent++; continue; }
    orphans.push(o);
  }

  const byEvent = {};
  for (const o of orphans) (byEvent[o.key.split('/')[1]] ||= []).push(o);
  for (const [eid, list] of Object.entries(byEvent)) {
    const label = eventIds.has(eid) ? `「${names[eid] ?? '(無題)'}」` : '（削除済みのイベント）';
    console.log(`  ${label} ${eid}  ${list.length}件 ${fmtMB(list.reduce((a, o) => a + o.size, 0))}`);
    for (const o of list) console.log(`      ${o.key}  ${o.lastModified?.toISOString().slice(0, 10)}  ${fmtMB(o.size)}`);
  }

  const orphanBytes = orphans.reduce((a, o) => a + o.size, 0);
  console.log(`\nR2 の submissions/ にあるファイル: ${stat.total}件`);
  console.log(`  使われている: ${stat.used}件`);
  console.log(`  猶予中（${GRACE_HOURS}時間以内）で残す: ${stat.recent}件`);
  if (!ALL) console.log(`  この DB に無いイベントの下（消さない）: ${stat.unknownEvent}件 ${fmtMB(stat.unknownBytes)}（イベント ${unknownIds.size}件）`);
  console.log(`  ★使われていない: ${orphans.length}件 ${fmtMB(orphanBytes)}`);

  if (APPLY && orphans.length > 0) {
    let done = 0, failed = 0;
    for (const o of orphans) {
      try { await r2.deleteObject(o.key); done++; } catch (e) { failed++; console.warn('  削除失敗:', o.key, e.message); }
    }
    console.log(`\n消した: ${done}件　失敗: ${failed}件`);
  }
  console.log('');
  await client.close();
})().catch(async (e) => {
  console.error(e);
  try { await client?.close(); } catch (_) { /* noop */ }
  process.exit(1);
});
