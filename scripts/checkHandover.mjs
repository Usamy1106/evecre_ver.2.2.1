// scripts/checkHandover.mjs — 引き継ぎ（指示書D ＋ 返信）のサーバーの確認（2026-11-12）
//
// ★開発 DB と検証用サーバーで動かす。作ったテスト用データは最後に必ず消す。本番 DB（_dev で終わらない名前）には書かない。
//   node scripts/checkHandover.mjs --base=http://localhost:3101 --db=evecre_dev
//   後片付けだけ：node scripts/checkHandover.mjs --cleanup --db=evecre_dev

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });

const arg = (k, d = null) => {
  const a = process.argv.find(x => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : (process.argv.includes(`--${k}`) ? true : d);
};
const DB_NAME = arg('db');
const BASE = arg('base', 'http://localhost:3101');
if (!DB_NAME || !/_dev$/.test(DB_NAME)) {
  console.error('✗ --db=<名前が _dev で終わる開発 DB> を指定してください（本番 DB には書きません）');
  process.exit(2);
}
process.env.MONGODB_DB = DB_NAME;

const { connectDb, getDb, closeDb } = require(path.join(ROOT, 'lib', 'db'));
const crdt = require(path.join(ROOT, 'lib', 'crdt'));
const sig = require(path.join(ROOT, 'node_modules', 'cookie-signature'));
const SECRET = process.env.COOKIE_SECRET;

const PFX = 'xhov';
const ROLES = ['owner', 'member', 'outsider', 'stranger'];
const uid = (r) => `${PFX}u${r}`;
const EV = { src: `${PFX}_src`, tgt: `${PFX}_tgt`, pub: `${PFX}_pub`, loopA: `${PFX}_la`, loopB: `${PFX}_lb`, hidden: `${PFX}_hid`, child: `${PFX}_child` };

let passed = 0, failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${extra ? '  … ' + extra : ''}`); }
};

async function cleanup() {
  const db = getDb();
  const users = ROLES.map(uid);
  const evs = Object.values(EV);
  await db.collection('events').deleteMany({ _id: { $in: evs } });
  await db.collection('submissions').deleteMany({ eventId: { $in: evs } });
  await db.collection('notifications').deleteMany({ $or: [{ userId: { $in: users } }, { eventId: { $in: evs } }] });
  await db.collection('event_logs').deleteMany({ $or: [{ userId: { $in: users } }, { projectId: { $in: evs } }] });
  await db.collection('sessions').deleteMany({ userId: { $in: users } });
  await db.collection('users').deleteMany({ _id: { $in: users } });
}

async function sessionCookie(role) {
  const token = crypto.randomBytes(32).toString('hex');
  await getDb().collection('sessions').insertOne({ userId: uid(role), token, expiresAt: new Date(Date.now() + 3600e3) });
  return `eve_sess=${encodeURIComponent('s:' + sig.sign(`${uid(role)}.${token}`, SECRET))}`;
}

const member = (r, roles = ['member']) => ({ userId: uid(r), role: roles[0], roles, joinedAt: Date.now() });

async function insertEvent(id, owner, members, flat) {
  const ev = crdt.flatToCrdt({ id, ownerId: uid(owner), members, createdAt: Date.now(), ...flat }, Date.now());
  await getDb().collection('events').insertOne({ ...ev, _id: id });
}

const sub = (eventId, mid, o) => ({
  _id: `${eventId}:${mid}`, eventId, missionId: mid, content: '', format: 'text', images: [], files: [], title: '',
  timestamp: Date.now(), submittedBy: uid('owner'), struggle: '', solution: '', shareable: false, outcome: null,
  objectId: '', objectTier: '', ...o,
});

async function prepare() {
  const db = getDb();
  for (const r of ROLES) {
    await db.collection('users').updateOne({ _id: uid(r) },
      { $set: { username: `引継${r}さん`, emailLower: `${PFX}-${r}@example.com`, isVerified: true, onboarding: null, createdAt: new Date() } }, { upsert: true });
  }
  // 引き継ぎ元：非公開・開催前（★メンバーは開催日を問わず引き継げる）。owner と member がメンバー
  await insertEvent(EV.src, 'owner', [member('owner', ['owner']), member('member')], {
    name: '去年の文化祭', dates: ['2099-11-01', '2099-11-02'], publicBasicInfo: false,
    pillars: [{ id: 'pil_a', name: '来場者を楽しませる' }, { id: 'pil_b', name: '内輪で終わらせない' }],
    missions: [
      { id: 'def-1', title: 'このイベントの目的・目標を決めよう', status: 'cleared', createdAt: Date.now() },
      { id: 'm1', title: 'ポスターを作る', status: 'cleared', tags: ['広報'], clearFormat: 'image', dates: ['2099-10-01'], priority: 5, pillarIds: ['pil_a'], createdAt: Date.now() },
      { id: 'm2', title: '共有しない記録', status: 'cleared', tags: ['運営'], createdAt: Date.now() },
      { id: 'm3', title: '次にやるならが空', status: 'cleared', tags: ['運営'], createdAt: Date.now() },
      { id: 'mi', title: 'みんなで感想を書く', status: 'cleared', tags: ['企画'], individualClear: true, createdAt: Date.now() },
      { id: 'm4', title: '未完了のタスク', status: 'yet', tags: ['制作'], createdAt: Date.now() },
    ],
  });
  await db.collection('submissions').insertMany([
    sub(EV.src, 'def-1', { content: '地域の人に学校を開く' }),
    sub(EV.src, 'm1', { content: 'A2 で20枚刷った{{p}}費用は1万2千円{{/p}}', shareable: true, outcome: 'struggle', struggle: '印刷所の締切を過ぎた', solution: '2週間前に入稿する' }),
    sub(EV.src, 'm2', { content: '内輪の話', shareable: false, solution: '次はこうする' }),
    sub(EV.src, 'm3', { content: '書きかけ', shareable: true, solution: '' }),
    sub(EV.src, 'mi_u_' + uid('owner'), { content: 'オーナーの感想', shareable: true, outcome: 'success', solution: '早めに集める' }),
    sub(EV.src, 'mi_u_' + uid('member'), { content: 'メンバーの感想', shareable: true, outcome: 'success', solution: '紙で配る', submittedBy: uid('member') }),
  ]);
  // 取り込み先：owner（管理者）と member（一般）
  await insertEvent(EV.tgt, 'owner', [member('owner', ['owner']), member('member')], {
    name: '今年の文化祭', dates: ['2100-11-01'],
    pillars: [{ id: 'pil_x', name: '今年の柱' }],
    missions: [{ id: 'def-1', title: 'このイベントの目的・目標を決めよう', status: 'yet', createdAt: Date.now() }],
  });
  // 公開されている、他団体のイベント（owner はメンバーでない）
  await insertEvent(EV.pub, 'stranger', [member('stranger', ['owner'])], {
    name: '他団体の展示会', dates: ['2026-01-10'], publicBasicInfo: true, publicKnowledge: true, publishCheckedAt: Date.now(),
    missions: [{ id: 'p1', title: '会場を下見する', status: 'cleared', tags: ['運営'], createdAt: Date.now() }],
  });
  await db.collection('submissions').insertOne(sub(EV.pub, 'p1', { content: '下見した', shareable: true, outcome: 'success', solution: '平日に行く', submittedBy: uid('stranger') }));
  // 非公開で、owner がメンバーでない
  await insertEvent(EV.hidden, 'stranger', [member('stranger', ['owner'])], { name: '秘密のイベント', dates: ['2026-01-10'], missions: [] });
  // 系譜：child → src（前の代）／ 輪 A → B → A
  await insertEvent(EV.child, 'owner', [member('owner', ['owner'])], { name: '来年の文化祭', parentEventId: EV.src, missions: [] });
  await insertEvent(EV.loopA, 'owner', [member('owner', ['owner'])], { name: '輪A', parentEventId: EV.loopB, missions: [] });
  await insertEvent(EV.loopB, 'owner', [member('owner', ['owner'])], { name: '輪B', parentEventId: EV.loopA, missions: [] });
}

async function call(method, p, { cookie = '', body } = {}) {
  const headers = { Origin: BASE };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null, text = '';
  try { text = await r.text(); json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}
const loadFlat = async (id, cookie) => (await call('GET', '/api/data', { cookie })).json?.events?.find(e => e.id === id);

async function run() {
  const C = {};
  for (const r of ROLES) C[r] = await sessionCookie(r);

  console.log('\n[handover-source]');
  ok((await call('GET', `/api/events/${EV.src}/handover-source`)).status === 401, '未ログイン → 401');
  ok((await call('GET', `/api/events/${EV.src}/handover-source`, { cookie: C.outsider })).status === 404, 'メンバーでない → 404');
  ok((await call('GET', `/api/events/${EV.pub}/handover-source`, { cookie: C.owner })).status === 404, '公開されていてもメンバーでなければ 404（公開側は /api/explore で読む）');
  const hs = await call('GET', `/api/events/${EV.src}/handover-source`, { cookie: C.member });
  ok(hs.status === 200 && /no-store/.test('no-store'), 'メンバーは読める（一般メンバーでもよい）');
  const titles = (hs.json?.knowledge || []).map(k => k.title);
  ok(titles.includes('ポスターを作る'), '共有の記録は出る（非公開・開催前でも）');
  ok(!titles.includes('共有しない記録'), 'shareable でない記録は出ない');
  ok(!titles.includes('次にやるならが空'), 'solution が空の記録は出ない');
  ok(!titles.includes('未完了のタスク'), '未完了のタスクは出ない');
  ok(titles.filter(t => t === 'みんなで感想を書く').length === 2, '個別完了は提出物ごとに並ぶ（taskKey は同じ）');
  ok(hs.json?.purpose === '地域の人に学校を開く' && hs.json?.pillars?.length === 2, '目的と柱が読める（読ませるだけ）');
  const dump = hs.text;
  ok(!dump.includes('引継ownerさん') && !dump.includes('引継memberさん'), 'メンバー名が含まれない');
  ok(!ROLES.some(r => dump.includes(uid(r))), 'userId が含まれない');
  ok(!dump.includes('1万2千円'), '非公開テキストが含まれない');
  ok(['ok', 'id', 'status', 'basic', 'purpose', 'pillars', 'knowledge'].every(k => k in (hs.json || {})), '形は公開 API の詳細と同じ');

  const keyOf = (t) => hs.json.knowledge.find(k => k.title === t)?.taskKey;
  const kPoster = keyOf('ポスターを作る'), kIndiv = keyOf('みんなで感想を書く');

  console.log('\n[handover-import の検査]');
  const imp = (cookie, body, id = EV.tgt) => call('POST', `/api/events/${id}/handover-import`, { cookie, body });
  ok((await imp(C.member, { sourceEventId: EV.src, pick: [kPoster] })).status === 403, 'canManage の無い人 → 403');
  ok((await imp(C.outsider, { sourceEventId: EV.src, pick: [kPoster] })).status === 404, '取り込み先のメンバーでない → 404');
  ok((await imp(C.owner, { sourceEventId: EV.hidden, pick: [kPoster] })).status === 404, '非公開でメンバーでもない元 → 404');
  ok((await imp(C.owner, { sourceEventId: EV.tgt, pick: [kPoster] })).status === 400, '自分自身を元にできない');
  ok((await imp(C.owner, { sourceEventId: '{"$ne":1}', pick: [kPoster] })).status === 400, '形の不正な元 → 400');
  ok((await imp(C.owner, { sourceEventId: EV.src, pick: [] })).status === 400, '何も選んでいない → 400');
  const many = Array.from({ length: 31 }, () => crypto.randomBytes(12).toString('hex'));
  const tooMany = await imp(C.owner, { sourceEventId: EV.src, pick: many });
  ok(tooMany.status === 400 && tooMany.json?.error === 'too_many' && tooMany.json?.count === 31, '31件 → 400 too_many（件数を返す）');

  console.log('\n[handover-import の中身]');
  const before = await loadFlat(EV.tgt, C.owner);
  const r1 = await imp(C.owner, { sourceEventId: EV.src, pick: [kPoster, kIndiv] });
  ok(r1.status === 200 && r1.json?.added?.length === 2, '2タスク取り込める');
  const after = await loadFlat(EV.tgt, C.owner);
  const added = after.missions.filter(m => r1.json.added.includes(m.id));
  const poster = added.find(m => m.title === 'ポスターを作る');
  const indiv = added.find(m => m.title === 'みんなで感想を書く');
  ok(!!poster && !!indiv, 'タスク名を引き継ぐ');
  ok(added.filter(m => m.title === 'みんなで感想を書く').length === 1, '個別完了は1つのタスクにまとまる（人数ぶん作らない）');
  ok(indiv?.inherited?.records?.length === 2, '個別完了の記録は records に人数ぶん');
  ok(JSON.stringify(poster?.tags) === '["広報"]', 'タグを引き継ぐ');
  ok(poster?.status === 'yet', '未完了で入る');
  ok(Array.isArray(poster?.dates) && poster.dates.length === 0 && (poster.daysLeft === null || poster.daysLeft === undefined), '期日は空（移植しない）');
  ok(Array.isArray(poster?.pillarIds) && poster.pillarIds.length === 0, '柱の割り当ては空（継承しない）');
  ok(Array.isArray(poster?.assignees) && poster.assignees.length === 0 && !poster.assignee, '担当は空');
  ok(poster?.priority === 0, '優先度は既定値（元の 5 を使わない）');
  ok(poster?.clearFormat === 'image', 'clearFormat は元のタスクから');
  const inh = poster?.inherited || {};
  ok(inh.sourceEventId === EV.src && inh.sourceEventTitle === '去年の文化祭' && JSON.stringify(inh.sourceEventDates) === '["2099-11-01","2099-11-02"]', '元のイベント名と日程を保存');
  ok(inh.sourceKey === kPoster, 'sourceKey は元の taskKey');
  ok(inh.records?.[0]?.solution === '2週間前に入稿する' && inh.records[0].struggle === '印刷所の締切を過ぎた', '振り返りを受け取る');
  ok(!JSON.stringify(inh).includes('1万2千円'), '非公開テキストは受け取らない');
  ok(!ROLES.some(r => JSON.stringify(added).includes(`"${uid(r)}"`) && r !== 'owner') , '前の代の userId を持たない（createdBy は取り込んだ本人だけ）');
  ok(after.parentEventId === EV.src, '前の代が無ければ parentEventId を入れる');
  ok(after.pillars?.length === 1 && after.pillars[0].name === '今年の柱', '柱は継承しない（今年の柱のまま）');
  const def1 = after.missions.find(m => m.id === 'def-1');
  ok(def1?.status === 'yet' && !after.clearedData?.['def-1'], '目的は継承しない');
  ok(after.missions.length === before.missions.length + 2, '選んだものだけが増える');

  const r2 = await imp(C.owner, { sourceEventId: EV.src, pick: [kPoster] });
  ok(r2.status === 200 && r2.json?.added?.length === 0 && r2.json?.skipped === 1, '同じタスクは2回取り込めない');
  ok((await imp(C.owner, { sourceEventId: EV.src, pick: [crypto.randomBytes(12).toString('hex')] })).json?.missing === 1, '元に無い鍵は無視して数を返す');

  console.log('\n[公開されているイベントから（メンバーでない）]');
  const pubDetail = await call('GET', `/api/explore/events/${EV.pub}`);
  const kPub = pubDetail.json?.knowledge?.[0]?.taskKey;
  ok(!!kPub, '公開ページの詳細に taskKey が入っている');
  const r3 = await imp(C.owner, { sourceEventId: EV.pub, pick: [kPub] });
  ok(r3.status === 200 && r3.json?.added?.length === 1, '公開されているイベントからも取り込める');
  ok((await loadFlat(EV.tgt, C.owner)).parentEventId === EV.src, 'parentEventId が既にあれば書き換えない');

  console.log('\n[inherited はクライアントから書けない]');
  const cur = await loadFlat(EV.tgt, C.owner);
  const tampered = { ...cur, missions: cur.missions.map(m => m.id === poster.id ? { ...m, inherited: { ...m.inherited, records: [{ solution: '差し替えた' }] } } : m) };
  await call('PATCH', '/api/data', { cookie: C.owner, body: { events: [tampered] } });
  const again = (await loadFlat(EV.tgt, C.owner)).missions.find(m => m.id === poster.id);
  ok(again?.inherited?.records?.[0]?.solution === '2週間前に入稿する', 'PATCH で送った inherited は捨てる（前の値が残る）');
  const newOne = { ...cur, missions: [...cur.missions, { id: 'fake1', title: '偽', status: 'yet', inherited: { sourceEventId: EV.pub, records: [] } }] };
  await call('PATCH', '/api/data', { cookie: C.owner, body: { events: [newOne] } });
  const fake = (await loadFlat(EV.tgt, C.owner)).missions.find(m => m.id === 'fake1');
  ok(!!fake && fake.inherited === undefined, '新しいタスクにも inherited を書かせない');

  console.log('\n[lineage]');
  ok((await call('GET', `/api/events/${EV.child}/lineage`, { cookie: C.outsider })).status === 404, 'メンバーでない → 404');
  const ln = await call('GET', `/api/events/${EV.tgt}/lineage`, { cookie: C.owner });
  ok(ln.status === 200 && ln.json?.ancestors?.[0]?.id === EV.src && ln.json.ancestors[0].title === '去年の文化祭', '前の代が辿れる');
  const ls = await call('GET', `/api/events/${EV.src}/lineage`, { cookie: C.owner });
  ok(ls.json?.descendantCount === 2, 'descendantCount（このイベントから生まれた数）');
  const loop = await call('GET', `/api/events/${EV.loopA}/lineage`, { cookie: C.owner });
  ok(loop.status === 200 && loop.json.ancestors.length === 1 && loop.json.ancestors[0].id === EV.loopB, '輪（A → B → A）で止まる');
  await getDb().collection('events').updateOne({ _id: EV.child }, { $set: { 'fields.parentEventId': { v: EV.hidden, t: Date.now() } } });
  const lh = await call('GET', `/api/events/${EV.child}/lineage`, { cookie: C.owner });
  ok(lh.json?.ancestors?.[0]?.canView === false && lh.json.ancestors[0].title === null && lh.json.ancestors[0].id === null, '閲覧権限のない代は名前も id も返さない');
  ok(!lh.text.includes('秘密のイベント'), '閲覧権限のない代の名前が応答に含まれない');

  console.log('\n[公開側に出さない]');
  await getDb().collection('events').updateOne({ _id: EV.tgt }, { $set: { 'fields.publicBasicInfo': { v: true, t: Date.now() } } });
  for (const p of [`/api/public/events/${EV.tgt}`, '/api/public/events', `/api/explore/events/${EV.tgt}`, '/api/explore/events']) {
    const t = (await call('GET', p)).text;
    ok(!t.includes('inherited') && !t.includes('parentEventId') && !t.includes(EV.src), `${p} に inherited / parentEventId を出さない`);
  }
}

await connectDb();
try {
  if (arg('cleanup')) { await cleanup(); console.log('後片付けしました'); }
  else {
    if (!SECRET) throw new Error('COOKIE_SECRET が読めません');
    try { await cleanup(); await prepare(); await run(); }
    finally { await cleanup(); }
    console.log(`\n結果: ${passed} passed / ${failed} failed`);
    if (failed) process.exitCode = 1;
  }
} finally {
  await closeDb();
}
