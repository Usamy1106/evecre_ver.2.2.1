// scripts/backfillDescription.js
// 「イベントの概要を定めよう」(def-3) をミッションとして完了したのに、イベントの
// description が空のままになっているイベントを埋め直す。
//
// なぜ必要か:
//   概要の書き込み経路は2つあり、片方だけ description を更新していなかった。
//     イベント設定 / アーカイブのペン … utils.js の setArchiveSummary が
//                                       clearedData['def-3'] と description の両方に書く
//     ミッションを完了              … /complete が clearedData にしか書かなかった（バグ）
//   description は proposalEngine の detectCategory() と AI プロンプトが読むため、
//   空だとイベントの内容が AI に伝わらず、提案の精度が落ちる。
//   ★サーバー側は 2026-09-02 に修正済み。これは既存データの穴埋め。
//
// 使い方:
//   node scripts/backfillDescription.js evecre            # 調査だけ（既定・書き込まない）
//   node scripts/backfillDescription.js evecre --yes      # 実際に書き込む
//   node scripts/backfillDescription.js evecre_dev --yes  # 開発DB
//
// ★--yes を付けない限り書き込まない（開発DBの後片付けと同じ方針）。
// ★description が既に入っているイベントには一切触らない。人が書いた文章を
//   ミッションの提出内容で上書きしないため。

'use strict';

try { require('dotenv').config(); } catch (_) {}

const argDb = process.argv[2];
if (argDb && !argDb.startsWith('--')) process.env.MONGODB_DB = argDb;
const APPLY = process.argv.includes('--yes');

const { connectDb, getDb, closeDb } = require('../lib/db');

/** CRDT セルの値を取り出す。★形は { v, t }（{ val, ts } ではない） */
const cell = (doc, field) => doc?.fields?.[field]?.v;

(async () => {
  await connectDb();
  const db = getDb();

  const events = await db.collection('events')
    .find({}, { projection: { fields: 1, missions: 1 } })
    .toArray();

  // 提出物は別コレクション（submissions）。_id は '<eventId>:<missionId>'
  const subs = await db.collection('submissions')
    .find({ missionId: 'def-3' }, { projection: { eventId: 1, content: 1, format: 1 } })
    .toArray();
  const summaryByEvent = new Map();
  for (const s of subs) {
    const text = String(s.content || '').trim();
    // ★text 形式のみ。画像やリンクを description に入れても提案の役に立たない
    if (text && (s.format || 'text') === 'text') summaryByEvent.set(s.eventId, text);
  }

  // ★短すぎる提出内容は description に入れない。
  //   実測（本番 2026-09-02）で「完了」とだけ書いて完了させた例があった。
  //   これを description に入れると、AI プロンプトに「概要: 完了」と渡ることになり、
  //   空のままより悪い（提案がイベントと無関係になる）。
  const MIN_LEN = 8;

  const targets = [];
  const tooShort = [];
  let alreadyOk = 0;
  let noSummary = 0;

  for (const ev of events) {
    const name = cell(ev, 'name') || '(名前なし)';
    const desc = String(cell(ev, 'description') || '').trim();
    const summary = summaryByEvent.get(ev._id);

    if (!summary) { noSummary++; continue; }
    if (desc) { alreadyOk++; continue; }      // ★既に入っている。触らない
    if (summary.length < MIN_LEN) { tooShort.push({ id: ev._id, name, summary }); continue; }
    targets.push({ id: ev._id, name, summary });
  }

  console.log(`DB: ${process.env.MONGODB_DB || 'evecre'}`);
  console.log(`イベント総数              : ${events.length}`);
  console.log(`def-3 の提出物がある       : ${summaryByEvent.size}`);
  console.log(`  └ description が既にある : ${alreadyOk}（触らない）`);
  console.log(`  └ ★description が空     : ${targets.length}（穴埋め対象）`);
  console.log(`  └ ★中身が短すぎる       : ${tooShort.length}（${MIN_LEN}字未満。入れない）`);
  console.log(`def-3 の提出物が無い       : ${noSummary}`);
  console.log('');

  if (tooShort.length > 0) {
    console.log('［入れないもの］提出内容が短く、概要として意味をなさないもの:');
    for (const t of tooShort) console.log(`  ${t.id}  ${t.name}  → "${t.summary}"`);
    console.log('');
  }

  if (targets.length === 0) {
    console.log('穴埋めが必要なイベントはありません。');
    await closeDb();
    return;
  }

  for (const t of targets) {
    const head = t.summary.length > 40 ? t.summary.slice(0, 40) + '…' : t.summary;
    console.log(`  ${t.id}  ${t.name}\n      → "${head}"`);
  }
  console.log('');

  if (!APPLY) {
    console.log('★調査のみ（書き込んでいません）。実行するには --yes を付けてください。');
    await closeDb();
    return;
  }

  const now = Date.now();
  let done = 0;
  for (const t of targets) {
    // ★CRDT セルとして書く。t（タイムスタンプ）を今にすることで、
    //   他端末の古い空文字に LWW で負けないようにする。
    await db.collection('events').updateOne(
      { _id: t.id },
      { $set: { 'fields.description': { v: t.summary, t: now } } },
    );
    done++;
  }
  console.log(`${done} 件の description を埋めました。`);

  await closeDb();
})().catch(async (e) => {
  console.error('エラー:', e.message);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
