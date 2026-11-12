// scripts/checkExplore.mjs — 公開ページ（/explore）の API の確認（2026-11-12。指示書05 §10）
//
// ★開発 DB と、検証用に立てたサーバーで動かす。作ったテスト用データは最後に必ず消す。
//   本番 DB（名前が _dev で終わらないもの）には書かない。
//
// 使い方：
//   1) node scripts/checkExplore.mjs --prepare --db=evecre_dev
//        … オブザーバー役のユーザーを作る（サーバーは起動時にオブザーバーを解決するので、先に要る）
//   2) 検証用サーバーを立てる（開発 DB・オブザーバーのメールを渡す）：
//        PORT=3101 MONGODB_DB=evecre_dev DEV_OBSERVER_EMAILS=xchk-observer@example.com npm start
//   3) node scripts/checkExplore.mjs --base=http://localhost:3101 --db=evecre_dev
//        … データを作る → 確かめる → 消す（失敗しても消す）
//   後片付けだけ：node scripts/checkExplore.mjs --cleanup --db=evecre_dev

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
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const sig = require(path.join(ROOT, 'node_modules', 'cookie-signature'));

const PFX = 'xchk';
const EMAIL = (r) => `${PFX}-${r}@example.com`;
const PASSWORD = 'Xchk-Pass-123';
const ROLES = ['owner', 'member', 'outsider', 'unverified', 'observer'];
const uid = (r) => `${PFX}u${r}`;
const EV = { priv: `${PFX}_priv`, basic: `${PFX}_basic`, know: `${PFX}_know` };
const SECRET = process.env.COOKIE_SECRET;

let passed = 0, failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${extra ? '  … ' + extra : ''}`); }
};

// ── データ ─────────────────────────────────────────

async function cleanup() {
  const db = getDb();
  const users = ROLES.map(uid);
  const evs = Object.values(EV);
  await db.collection('public_likes').deleteMany({ $or: [{ eventId: { $in: evs } }, { voterKey: { $in: users.map(u => `u:${u}`) } }] });
  await db.collection('public_comments').deleteMany({ $or: [{ eventId: { $in: evs } }, { userId: { $in: users } }] });
  await db.collection('events').deleteMany({ _id: { $in: evs } });
  await db.collection('submissions').deleteMany({ eventId: { $in: evs } });
  await db.collection('notifications').deleteMany({ $or: [{ userId: { $in: users } }, { eventId: { $in: evs } }] });
  await db.collection('event_logs').deleteMany({ $or: [{ userId: { $in: users } }, { projectId: { $in: evs } }] });
  await db.collection('sessions').deleteMany({ userId: { $in: users } });
  await db.collection('users').deleteMany({ _id: { $in: users } });
}

async function ensureUser(role, { verified = true } = {}) {
  const db = getDb();
  await db.collection('users').updateOne({ _id: uid(role) }, {
    $set: {
      username: `検証${role}さん`, emailLower: EMAIL(role), isVerified: verified,
      passwordHash: await bcrypt.hash(PASSWORD, 4), createdAt: new Date(), onboarding: null,
    },
  }, { upsert: true });
}

async function sessionCookie(role) {
  const token = crypto.randomBytes(32).toString('hex');
  await getDb().collection('sessions').insertOne({ userId: uid(role), token, expiresAt: new Date(Date.now() + 3600e3) });
  return `eve_sess=${encodeURIComponent('s:' + sig.sign(`${uid(role)}.${token}`, SECRET))}`;
}

function visitorCookie(v) {
  return `evecre_vid=${encodeURIComponent('s:' + sig.sign(v, SECRET))}`;
}

async function insertEvent(id, flat) {
  const ev = crdt.flatToCrdt({
    id, ownerId: uid('owner'),
    members: [
      { userId: uid('owner'), role: 'owner', roles: ['owner'], joinedAt: Date.now() },
      { userId: uid('member'), role: 'member', roles: ['member'], joinedAt: Date.now() },
    ],
    createdAt: Date.now(),
    ...flat,
  }, Date.now());
  await getDb().collection('events').insertOne({ ...ev, _id: id });
}

async function setFlag(id, key, value) {
  await getDb().collection('events').updateOne({ _id: id }, { $set: { [`fields.${key}`]: { v: value, t: Date.now() } } });
}

async function prepareData() {
  for (const r of ROLES) await ensureUser(r, { verified: r !== 'unverified' });
  await insertEvent(EV.priv, { name: '検証・非公開', dates: ['2026-01-10'], publicBasicInfo: false, missions: [] });
  await insertEvent(EV.basic, { name: '検証・告知だけ', dates: ['2099-01-10'], publicBasicInfo: true, missions: [] });
  await insertEvent(EV.know, {
    name: '検証・ナレッジ', dates: ['2026-01-10'], publicBasicInfo: true, publicKnowledge: true, publishCheckedAt: Date.now(),
    missions: [{ id: 'm1', title: '会場の下見', status: 'cleared', tags: ['運営'], createdAt: Date.now() }],
  });
  await getDb().collection('submissions').insertOne({
    _id: `${EV.know}:m1`, eventId: EV.know, missionId: 'm1', content: '下見をした', format: 'text', images: [], files: [],
    title: '会場の下見', timestamp: Date.now(), submittedBy: uid('member'),
    struggle: '鍵の場所が分からなかった', solution: '前日に管理人へ連絡する', shareable: true, outcome: 'struggle',
    objectId: '', objectTier: '',
  });
}

// ── HTTP ──────────────────────────────────────────

async function call(method, p, { cookie = '', body } = {}) {
  const headers = { Origin: BASE };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined || method === 'POST') headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : (method === 'POST' ? '{}' : undefined), redirect: 'manual' });
  let json = null; let text = '';
  try { text = await r.text(); json = JSON.parse(text); } catch (_) {}
  const setCookies = r.headers.getSetCookie?.() || [];
  return { status: r.status, json, text, headers: r.headers, setCookies };
}
const likeCount = async (id) => (await call('GET', `/api/explore/events/${id}`)).json?.likeCount;
const cookieFrom = (setCookies, name) => {
  const c = setCookies.find(x => x.startsWith(name + '='));
  return c ? c.split(';')[0] : null;
};

// ── 確認 ──────────────────────────────────────────

async function run() {
  const C = {};
  for (const r of ROLES) C[r] = await sessionCookie(r);

  console.log('\n[非公開・存在しない・形の不正]');
  const list = await call('GET', '/api/explore/events');
  ok(list.status === 200 && Array.isArray(list.json?.events), '一覧が取れる');
  const ids = (list.json?.events || []).map(e => e.id);
  ok(!ids.includes(EV.priv), '非公開のイベントは一覧に出ない');
  ok(ids.includes(EV.basic) && ids.includes(EV.know), '公開のイベントは一覧に出る');
  ok((list.json?.events || []).every(e => typeof e.likeCount === 'number'), '一覧の各件に likeCount');
  ok(/no-store/.test(list.headers.get('cache-control') || ''), 'Cache-Control: no-store');
  ok(!list.headers.get('access-control-allow-origin'), 'CORS のヘッダーを付けない');
  for (const [p, label] of [
    [`/api/explore/events/${EV.priv}`, '非公開の詳細'],
    ['/api/explore/events/no_such_zz', '存在しない id'],
    [`/api/explore/events/${encodeURIComponent('{"$ne":null}')}`, '形の不正な id'],
  ]) {
    const r = await call('GET', p);
    ok(r.status === 404 && r.json?.error === 'not_found', `${label} → 404 not_found`);
  }
  ok((await call('POST', `/api/explore/events/${EV.priv}/like`)).status === 404, '非公開のいいね → 404');
  ok((await call('GET', `/api/explore/events/${EV.priv}/comments`)).status === 404, '非公開のコメント → 404');

  console.log('\n[告知だけのイベント]');
  const b = await call('GET', `/api/explore/events/${EV.basic}`);
  ok(b.status === 200 && b.json?.knowledge === null, '詳細が取れ、knowledge は null');
  ok(b.json?.viewer?.canComment === false, 'canComment は false');
  const bl = await call('POST', `/api/explore/events/${EV.basic}/like`);
  ok(bl.status === 200 && bl.json?.liked === true, '告知でもいいねできる');
  ok((await call('GET', `/api/explore/events/${EV.basic}/comments`)).status === 404, 'コメントは 404');

  console.log('\n[匿名のいいね]');
  await getDb().collection('public_likes').deleteMany({ eventId: EV.know });
  const first = await call('POST', `/api/explore/events/${EV.know}/like`);
  const vidCookie = cookieFrom(first.setCookies, 'evecre_vid');
  ok(!!vidCookie, '初めていいねしたとき匿名 ID の Cookie を発行する');
  const raw = first.setCookies.find(x => x.startsWith('evecre_vid=')) || '';
  ok(/HttpOnly/i.test(raw) && /SameSite=Lax/i.test(raw) && /Path=\//i.test(raw), 'Cookie は httpOnly・SameSite=Lax・Path=/');
  ok(/^evecre_vid=s%3A/.test(vidCookie || ''), 'Cookie は署名付き');
  ok(!cookieFrom((await call('GET', `/api/explore/events/${EV.know}`)).setCookies, 'evecre_vid'), '見ただけでは Cookie を発行しない');
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: vidCookie });
  ok(await likeCount(EV.know) === 1, '同じ匿名 ID で2回いいね → 1件のまま');
  ok((await call('GET', `/api/explore/events/${EV.know}`, { cookie: vidCookie })).json?.liked === true, 'liked は true');
  const un = await call('DELETE', `/api/explore/events/${EV.know}/like`, { cookie: vidCookie });
  ok(un.json?.liked === false && un.json?.likeCount === 0, '取り消し → 0件');
  await call('POST', `/api/explore/events/${EV.know}/like`);
  await call('POST', `/api/explore/events/${EV.know}/like`);
  ok(await likeCount(EV.know) === 2, 'Cookie なしで2回 → 2件（別の閲覧者として数える）');
  const forged = 'evecre_vid=' + encodeURIComponent('s:' + 'a'.repeat(32) + '.forged');
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: forged });
  ok(await likeCount(EV.know) === 3, '署名が合わない Cookie は無かったものとして扱う（新しい匿名 ID）');

  console.log('\n[ログインの前後]');
  await getDb().collection('public_likes').deleteMany({ eventId: EV.know });
  const v2 = crypto.randomBytes(16).toString('hex');
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: visitorCookie(v2) });
  const login = await call('POST', '/api/auth/login', { cookie: visitorCookie(v2), body: { email: EMAIL('outsider'), password: PASSWORD } });
  const sess = cookieFrom(login.setCookies, 'eve_sess');
  ok(login.status === 200 && !!sess, 'ログインできる');
  const both = `${sess}; ${visitorCookie(v2)}`;
  const afterLogin = await call('GET', `/api/explore/events/${EV.know}`, { cookie: both });
  ok(afterLogin.json?.likeCount === 1 && afterLogin.json?.liked === true, '匿名でいいね → ログイン → 1件のまま・liked');
  const docs = await getDb().collection('public_likes').find({ eventId: EV.know }).toArray();
  ok(docs.length === 1 && docs[0].voterKey === `u:${uid('outsider')}`, 'ログインした直後に u: へ付け替わっている');
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: C.outsider });
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: C.outsider });
  ok(await likeCount(EV.know) === 1, 'ログイン済みが2回いいね → 1件');
  const v3 = crypto.randomBytes(16).toString('hex');
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: visitorCookie(v3) });
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: `${C.member}; ${visitorCookie(v3)}` });
  ok(await likeCount(EV.know) === 2, 'ログイン中にいいね → 同じブラウザの匿名のいいねは1件にまとまる');
  await getDb().collection('public_likes').insertOne({ _id: 'l_dup', eventId: EV.know, voterKey: `a:${v3}`, createdAt: new Date() });
  const relog = await call('POST', '/api/auth/login', { cookie: visitorCookie(v3), body: { email: EMAIL('member'), password: PASSWORD } });
  ok(relog.status === 200 && await likeCount(EV.know) === 2, '付け替え先に既にいいねがあれば匿名の方を消す（二重に数えない）');

  console.log('\n[コメント]');
  const kd = await call('GET', `/api/explore/events/${EV.know}`, { cookie: C.outsider });
  ok(kd.json?.viewer?.loggedIn === true && kd.json?.viewer?.canComment === true, '認証済みは canComment');
  ok((await call('GET', `/api/explore/events/${EV.know}`, { cookie: C.unverified })).json?.viewer?.canComment === false, '未認証は canComment が false');
  ok((await call('GET', `/api/explore/events/${EV.know}`)).json?.viewer?.loggedIn === false, '未ログインは loggedIn が false');
  ok((await call('POST', `/api/explore/events/${EV.know}/comments`, { body: { body: 'こんにちは' } })).status === 401, '未ログインでコメント → 401');
  const unv = await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.unverified, body: { body: 'こんにちは' } });
  ok(unv.status === 403 && unv.json?.error === 'verification_required', '未認証 → 403 verification_required');
  ok((await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: 'あ'.repeat(1001) } })).status === 400, '1001 文字 → 400');
  ok((await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: '   ' } })).status === 400, '空白だけ → 400');
  const c1000 = await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: 'あ'.repeat(1000) } });
  ok(c1000.status === 200, '1000 文字は書ける');
  const many = await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: Array.from({ length: 15 }, (_, i) => `行${i + 1}`).join('\n') } });
  ok(many.status === 200 && many.json?.comment?.body.split('\n').length === 10, '改行は10行まで（それ以上は詰める）');
  const mine = await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: '  参考になりました  ' } });
  ok(mine.status === 200 && mine.json?.comment?.body === '参考になりました', '書ける（前後の空白を削る）');
  ok(mine.json?.comment?.author?.username === '検証outsiderさん', '書き手の名前が付く');
  ok((await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: 'もう一度' } })).status === 200, '同じイベントに何回でも書ける');
  const cl = await call('GET', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider });
  ok(cl.status === 200 && cl.json?.comments?.[0]?.body === 'もう一度', '新しい順');
  ok(cl.json.comments.every(c => c.canDelete === true), '本人には canDelete');
  const clAnon = await call('GET', `/api/explore/events/${EV.know}/comments`);
  ok(clAnon.json.comments.every(c => c.canDelete === false), '未ログインには canDelete が付かない');
  const cid = mine.json.comment.id;
  ok((await call('DELETE', `/api/explore/events/${EV.know}/comments/${cid}`, { cookie: C.member })).status === 403, '他人のコメントを削除 → 403');
  ok((await call('DELETE', `/api/explore/events/${EV.know}/comments/${cid}`, { cookie: C.owner })).status === 200, '管理者なら消せる');
  const own = await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: '自分で消す' } });
  ok((await call('DELETE', `/api/explore/events/${EV.know}/comments/${own.json.comment.id}`, { cookie: C.outsider })).status === 200, '本人なら消せる');
  ok((await call('DELETE', `/api/explore/events/${EV.basic}/comments/${own.json.comment.id}`, { cookie: C.owner })).status === 404, '別のイベントの id では消せない（404）');

  console.log('\n[ページ送り]');
  const bulk = Array.from({ length: 35 }, (_, i) => ({ _id: `pc_bulk${i}`, eventId: EV.know, userId: uid('outsider'), body: `まとめ${i}`, createdAt: new Date(Date.now() - (i + 10) * 60000) }));
  await getDb().collection('public_comments').insertMany(bulk);
  const p1 = await call('GET', `/api/explore/events/${EV.know}/comments`);
  ok(p1.json?.comments?.length === 30 && p1.json?.hasMore === true, '30 件ずつ・hasMore');
  const p2 = await call('GET', `/api/explore/events/${EV.know}/comments?before=${p1.json.comments.at(-1).createdAt}`);
  ok(p2.json?.comments?.length > 0 && p2.json.comments.every(c => c.createdAt < p1.json.comments.at(-1).createdAt), '?before で続きが取れる');

  console.log('\n[オブザーバー]');
  const obsLike = await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: C.observer });
  if (obsLike.status === 200) console.log('  （注）オブザーバーとして解決されていない。サーバーを DEV_OBSERVER_EMAILS=' + EMAIL('observer') + ' で起動したか確かめる');
  ok(obsLike.status === 403, 'いいね → 403');
  ok((await call('DELETE', `/api/explore/events/${EV.know}/like`, { cookie: C.observer })).status === 403, 'いいねの取り消し → 403');
  ok((await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.observer, body: { body: 'x' } })).status === 403, 'コメント → 403');
  const victim = await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: '消されない' } });
  ok((await call('DELETE', `/api/explore/events/${EV.know}/comments/${victim.json.comment.id}`, { cookie: C.observer })).status === 403, '削除 → 403');
  ok((await call('GET', `/api/explore/events/${EV.know}`, { cookie: C.observer })).json?.viewer?.canComment === false, 'canComment は false');

  console.log('\n[応答に出してはいけないもの]');
  const dumps = [
    (await call('GET', '/api/explore/events', { cookie: C.outsider })).text,
    (await call('GET', `/api/explore/events/${EV.know}`, { cookie: C.outsider })).text,
    (await call('GET', `/api/explore/events/${EV.know}/comments`, { cookie: C.owner })).text,
  ].join('\n');
  for (const r of ROLES) ok(!dumps.includes(uid(r)), `userId（${r}）が含まれない`);
  ok(!/voterKey|"u:|"a:[0-9a-f]/.test(dumps), 'voterKey が含まれない');
  ok(!/@example\.com/.test(dumps), 'メールが含まれない');
  ok(!dumps.includes('検証memberさん') && !dumps.includes('検証ownerさん'), 'メンバー名が含まれない（コメントの書き手を除く）');

  console.log('\n[ナレッジの公開を止める・戻す]');
  await setFlag(EV.know, 'publicKnowledge', false);
  ok((await call('GET', `/api/explore/events/${EV.know}/comments`)).status === 404, '非公開にしたらコメントの取得が 404');
  ok((await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.outsider, body: { body: 'x' } })).status === 404, '書き込みも 404');
  ok((await call('POST', `/api/explore/events/${EV.know}/like`)).status === 200, 'いいねは告知として押せる');
  await setFlag(EV.know, 'publicKnowledge', true);
  const back = await call('GET', `/api/explore/events/${EV.know}/comments`);
  ok(back.status === 200 && back.json.comments.length > 0, '再公開でコメントが戻る（消していない）');

  console.log('\n[CSRF]');
  const cross = await fetch(`${BASE}/api/explore/events/${EV.know}/like`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  ok(cross.status === 403, '他のサイトからのいいね → 403');
  const form = await fetch(`${BASE}/api/explore/events/${EV.know}/like`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }, body: 'a=1' });
  ok(form.status === 415, 'フォームの本文でのいいね → 415');

  console.log('\n[退会・イベント削除の後始末]');
  const db = getDb();
  await call('POST', `/api/explore/events/${EV.know}/like`, { cookie: C.outsider });
  ok(await db.collection('public_comments').countDocuments({ userId: uid('outsider') }) > 0, '（前提）退会する人のコメントがある');
  const del = await call('DELETE', '/api/account', { cookie: C.outsider });
  ok(del.status === 200, '退会できる');
  ok(await db.collection('public_comments').countDocuments({ userId: uid('outsider') }) === 0, '退会したらその人のコメントが消える');
  ok(await db.collection('public_likes').countDocuments({ voterKey: `u:${uid('outsider')}` }) === 0, '退会したらその人のいいねが消える');
  await call('POST', `/api/explore/events/${EV.know}/comments`, { cookie: C.member, body: { body: '削除の確認' } });
  ok(await db.collection('public_likes').countDocuments({ eventId: EV.know }) > 0, '（前提）消すイベントにいいねがある');
  const wipe = await call('PUT', '/api/data', { cookie: C.owner, body: { events: [] } });
  ok(wipe.status === 200 && !(await db.collection('events').findOne({ _id: EV.know })), 'オーナーがイベントを削除できる');
  ok(await db.collection('public_likes').countDocuments({ eventId: { $in: Object.values(EV) } }) === 0, 'イベントを消したらいいねが消える');
  ok(await db.collection('public_comments').countDocuments({ eventId: { $in: Object.values(EV) } }) === 0, 'イベントを消したらコメントが消える');
}

// ── 実行 ──────────────────────────────────────────

await connectDb();
try {
  if (arg('cleanup')) { await cleanup(); console.log('後片付けしました'); }
  else if (arg('prepare')) { await cleanup(); await ensureUser('observer'); console.log(`オブザーバー役 ${EMAIL('observer')} を作りました。DEV_OBSERVER_EMAILS に渡してサーバーを起動してください`); }
  else {
    if (!SECRET) throw new Error('COOKIE_SECRET が読めません');
    try {
      await cleanup();
      await prepareData();
      await run();
    } finally {
      await cleanup();
    }
    console.log(`\n結果: ${passed} passed / ${failed} failed`);
    if (failed) process.exitCode = 1;
  }
} finally {
  await closeDb();
}
