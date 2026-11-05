// scripts/checkPublicApi.mjs — 公開 API（GET /api/public/events・/api/public/events/:id）の確認
//
//   node scripts/checkPublicApi.mjs                               # 公開の組み立て（lib/publicData.js）だけを確かめる
//   node scripts/checkPublicApi.mjs --base=http://localhost:3101  # 動いているサーバーにも問い合わせる
//     ＋ --origin=http://localhost:5173（PUBLIC_SITE_ORIGINS に入れた Origin。CORS の許可を確かめる）
//     ＋ --private=<id>（宣伝用に公開していないイベントの id。一覧に出ず、詳細が 404 になることを確かめる）
//
// ★DB には書かない（読むだけ）。サーバー側の確認に使うイベントは呼ぶ側で用意する。
// ★確かめること（指示書 A §4）
//   - 非公開のイベントは一覧に出ず、詳細は 404
//   - publicKnowledge が true でも、開催前なら knowledge は null
//   - shareable でない振り返り・solution が空の振り返りは出ない
//   - 応答に submittedBy / members / userId / organization 系のキーが無い（JSON を文字列で探す）

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pub = require('../lib/publicData.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`  ✗ ${label}`); } };

// 応答に出てはいけないキー（JSON を文字列として探す）
const FORBIDDEN_KEYS = ['submittedBy', 'members', 'userId', 'ownerId', 'organization', 'orgName', 'username',
  'avatarUrl', 'pendingMembers', 'inviteToken', 'motivationReactions', 'objectId', 'objectTier', 'timestamp'];
const leaks = (obj) => FORBIDDEN_KEYS.filter(k => JSON.stringify(obj).includes(`"${k}"`));

const TODAY = '2026-11-05';
const R2 = 'https://pub-test.r2.dev/submissions/E1';

function event(over = {}) {
  return {
    id: 'E1', ownerId: 'u_owner', name: 'テスト展示会', description: '学生の作品30点を展示する2日間の展示会',
    venue: '3号館ホール', headerImage: `${R2}/img_aaaa.webp`,
    dates: ['2026-10-02', '2026-10-01'], dateTimes: {},
    members: [{ userId: 'u_owner', role: 'owner', roles: ['owner'] }],
    publicBasicInfo: true, publicKnowledge: true,
    missions: [
      { id: 'm1', title: 'ポスターを作る', tags: ['制作'], status: 'cleared' },
      { id: 'm2', title: '会場を下見する', tag: '運営', status: 'cleared' },
      { id: 'm3', title: '告知する', tags: ['広報'], status: 'cleared' },
      { id: 'm4', title: '個別に書く', tags: ['企画'], status: 'cleared', individualClear: true },
      { id: 'm5', title: 'まだ', tags: [], status: 'yet' },
    ],
    ...over,
  };
}
const subs = () => ({
  m1: { content: '初稿{{image:1}}を{{b}}共有{{/b}}', format: 'text', images: [`${R2}/img_b.webp`, 'data:image/png;base64,AAAA'],
        files: [{ url: `${R2}/file_c.pdf`, name: '企画書.pdf', size: 1200, thumb: `${R2}/img_t.webp` }],
        outcome: 'success', struggle: '', solution: '3案を並べて投票した', shareable: true,
        submittedBy: 'u_owner', timestamp: 1, objectId: 'flower', objectTier: 'tag' },
  m2: { content: '下見済み', format: 'text', outcome: 'struggle', struggle: '鍵が無かった', solution: '', shareable: true, submittedBy: 'u_a' },
  m3: { content: '投稿した', format: 'text', outcome: 'success', solution: 'ハッシュタグを揃えた', shareable: false, submittedBy: 'u_b' },
  'm4_u_u_a': { content: 'Aさんの分', format: 'text', outcome: 'success', solution: '早めに出した', shareable: true, submittedBy: 'u_a' },
  'm4_u_u_b': { content: 'Bさんの分', format: 'text', outcome: 'success', solution: '書かない', shareable: false, submittedBy: 'u_b' },
  m5: { content: '未完了', format: 'text', solution: '出ない', shareable: true },
});

console.log('\n[1] 基礎情報');
{
  const r = pub.buildPublicEvent(event(), subs(), TODAY);
  ok(r.basic && r.basic.title === 'テスト展示会', 'タイトル');
  ok(JSON.stringify(r.basic.dates) === '["2026-10-01","2026-10-02"]', '日付は並べ替えて出す');
  ok(r.basic.headerImage === `${R2}/img_aaaa.webp`, 'ヘッダー画像');
  ok(pub.buildPublicEvent(event({ publicBasicInfo: false }), subs(), TODAY).basic === null, '非公開（false）なら basic は null');
  ok(pub.buildPublicEvent(event({ publicBasicInfo: undefined }), subs(), TODAY).basic === null, 'まだ聞いていない（undefined）なら basic は null');
  ok(pub.publicListItem(event({ publicBasicInfo: false }), subs(), TODAY) === null, '非公開は一覧に出ない');
}

console.log('[2] dateTimes の形');
{
  const r = pub.buildPublicEvent(event({ dateTimes: {
    '2026-10-01': { start: '10:00', end: '17:00', note: 'x' },
    '2026-10-02': { start: '', end: '' },
    '2026-12-31': { start: '09:00', end: '' },
    'bad':        { start: '09:00' },
    '2026-10-03': 'x',
  } }), subs(), TODAY).basic;
  ok(JSON.stringify(r.dateTimes) === '{"2026-10-01":{"start":"10:00","end":"17:00"}}', `dates にある日・HH:MM だけ（実際：${JSON.stringify(r.dateTimes)}）`);
  ok(JSON.stringify(pub.buildPublicEvent(event({ dateTimes: { '2026-10-01': { start: '<b>', end: 1 } } }), {}, TODAY).basic.dateTimes) === '{}', '形の違う値は捨てる');
  ok(JSON.stringify(pub.buildPublicEvent(event({ dateTimes: null }), {}, TODAY).basic.dateTimes) === '{}', 'null は {}');
}

console.log('[3] 旧データの読み替え（アプリの getArchiveSummary / Venue / MainVisual と同じ）');
{
  const legacy = event({ description: '', venue: undefined, headerImage: undefined,
    missions: [...event().missions, { id: 'mp1', title: '開催場所を決める', originProposalId: 'p1', status: 'cleared' },
                                    { id: 'mp3', title: 'メインビジュアル', originProposalId: 'p3', status: 'cleared' }] });
  const s = { ...subs(), 'def-3': { content: '概要の{{b}}本文{{/b}}{{image:1}}', format: 'text' },
              mp1: { content: '市民会館', format: 'text' }, mp3: { content: `${R2}/old.webp`, format: 'image' } };
  const b = pub.buildPublicEvent(legacy, s, TODAY).basic;
  ok(b.summary === '概要の本文', `概要は def-3 の本文（印を外す）（実際：${b.summary}）`);
  ok(b.venue === '市民会館', '場所は p1 由来のタスク');
  ok(b.headerImage === `${R2}/old.webp`, '画像は p3 由来のタスクの1枚目');
  const s2 = { ...s, 'archive-venue': { content: '体育館' }, 'archive-image': { content: `${R2}/arch.webp` } };
  const b2 = pub.buildPublicEvent(legacy, s2, TODAY).basic;
  ok(b2.venue === '体育館' && b2.headerImage === `${R2}/arch.webp`, 'archive-venue / archive-image を先に読む');
  const b3 = pub.buildPublicEvent({ ...legacy, venue: '', headerImage: '' }, s2, TODAY).basic;
  ok(b3.venue === '' && b3.headerImage === null, '空文字（消した）なら旧データに戻さない');
  const b4 = pub.buildPublicEvent({ ...legacy, headerImage: 'data:image/png;base64,AAAA' }, s2, TODAY).basic;
  ok(b4.headerImage === null, 'https 以外の画像は出さない');
}

console.log('[4] ナレッジ');
{
  const r = pub.buildPublicEvent(event(), subs(), TODAY);
  const titles = r.knowledge.map(k => k.title);
  ok(JSON.stringify(titles) === '["ポスターを作る","個別に書く"]', `shareable かつ solution ありの完了タスクだけ（実際：${titles}）`);
  ok(!titles.includes('会場を下見する'), 'solution が空は出ない');
  ok(!titles.includes('告知する'), 'shareable でないものは出ない');
  ok(!titles.includes('まだ'), '未完了のタスクは出ない');
  const k1 = r.knowledge[0];
  ok(k1.text === '初稿を共有', `本文の印を外す（実際：${k1.text}）`);
  ok(JSON.stringify(k1.images) === JSON.stringify([`${R2}/img_b.webp`]), 'dataURL の画像は出さない');
  ok(k1.files.length === 1 && k1.files[0].name === '企画書.pdf' && k1.files[0].thumb === `${R2}/img_t.webp`, 'PDF');
  ok(pub.buildPublicEvent(event({ dates: ['2026-11-20'] }), subs(), TODAY).knowledge === null, 'publicKnowledge が true でも開催前は null');
  ok(pub.buildPublicEvent(event({ dates: ['2026-11-05'] }), subs(), TODAY).knowledge === null, '開催当日もまだ null');
  ok(pub.buildPublicEvent(event({ dates: [] }), subs(), TODAY).knowledge === null, '日程未設定は null');
  ok(pub.buildPublicEvent(event({ publicKnowledge: false }), subs(), TODAY).knowledge === null, 'publicKnowledge が false なら null');
  ok(leaks(r).length === 0, `個人を指すキーが無い（見つかった：${leaks(r)}）`);
  ok(!JSON.stringify(r).includes('u_owner') && !JSON.stringify(r).includes('u_a'), 'userId の値も出ない（個別完了のキーを含む）');
}

console.log('[5] 一覧の1件');
{
  const it = pub.publicListItem(event(), subs(), TODAY);
  ok(it.id === 'E1' && it.status === 'archive' && it.hasKnowledge === true, 'archive・hasKnowledge true');
  ok(!('knowledge' in it), '本文（knowledge）は含めない');
  const up = pub.publicListItem(event({ dates: ['2026-11-20'] }), subs(), TODAY);
  ok(up.status === 'upcoming' && up.hasKnowledge === false, '開催前は upcoming・hasKnowledge false');
  ok(pub.publicListItem(event({ dates: [] }), subs(), TODAY).status === 'upcoming', '日程未設定は upcoming');
  const none = pub.publicListItem(event(), { m3: subs().m3 }, TODAY);
  ok(none.hasKnowledge === false, '公開してよい振り返りが0件なら hasKnowledge false');
  ok(leaks(it).length === 0, `個人を指すキーが無い（見つかった：${leaks(it)}）`);
}

// ── 動いているサーバーへ ─────────────────────────────────────
const arg = (n) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const BASE = arg('base');
if (BASE) {
  const ORIGIN = arg('origin');
  const PRIVATE = arg('private');
  console.log(`[6] サーバー ${BASE}`);
  const get = (path, headers = {}) => fetch(`${BASE}${path}`, { headers });

  const list = await get('/api/public/events', ORIGIN ? { Origin: ORIGIN } : {});
  const lj = await list.json();
  ok(list.status === 200 && lj.ok === true && Array.isArray(lj.events), '一覧が 200');
  ok(list.headers.get('cache-control') === 'public, max-age=300', 'Cache-Control');
  ok(/origin/i.test(list.headers.get('vary') || ''), 'Vary: Origin');
  ok(!list.headers.get('access-control-allow-credentials'), 'Allow-Credentials を付けない');
  if (ORIGIN) ok(list.headers.get('access-control-allow-origin') === ORIGIN, '許可した Origin には Allow-Origin を返す');
  const evil = await get('/api/public/events', { Origin: 'https://evil.example' });
  ok(!evil.headers.get('access-control-allow-origin'), '許可していない Origin には Allow-Origin を返さない');
  ok(leaks(lj).length === 0, `一覧に個人を指すキーが無い（見つかった：${leaks(lj)}）`);
  ok(lj.events.every(e => !('knowledge' in e)), '一覧に knowledge を含めない');
  const lasts = lj.events.map(e => e.dates.at(-1) || '');
  const firstEmpty = lasts.indexOf('');
  ok(firstEmpty === -1 || lasts.slice(firstEmpty).every(x => x === ''), '日程未設定は最後');
  ok(lasts.filter(Boolean).every((x, i, a) => i === 0 || a[i - 1] >= x), '最終日が新しい順');

  for (const e of lj.events) {
    const d = await get(`/api/public/events/${encodeURIComponent(e.id)}`);
    const dj = await d.json();
    ok(d.status === 200 && dj.basic && dj.id === e.id, `詳細 ${e.id} が 200`);
    ok(leaks(dj).length === 0, `詳細 ${e.id} に個人を指すキーが無い（見つかった：${leaks(dj)}）`);
    ok(dj.status === e.status, `詳細 ${e.id} の status が一覧と同じ`);
    if (dj.status === 'upcoming') ok(dj.knowledge === null, `開催前の ${e.id} は knowledge が null`);
    ok((Array.isArray(dj.knowledge) && dj.knowledge.length > 0) === e.hasKnowledge, `${e.id} の hasKnowledge が詳細と合う`);
  }

  const notFound = async (path, label) => {
    const r = await get(path);
    const j = await r.json().catch(() => null);
    ok(r.status === 404 && j?.error === 'not_found' && r.headers.get('cache-control') === 'no-store', `${label} は 404 not_found（no-store）`);
  };
  await notFound('/api/public/events/no_such_event_zz', '存在しない id');
  await notFound(`/api/public/events/${encodeURIComponent('a'.repeat(65))}`, '長すぎる id');
  await notFound(`/api/public/events/${encodeURIComponent('{"$ne":null}')}`, '形の不正な id');
  if (PRIVATE) {
    await notFound(`/api/public/events/${encodeURIComponent(PRIVATE)}`, '非公開のイベント');
    ok(!lj.events.some(e => e.id === PRIVATE), '非公開のイベントは一覧に出ない');
  }
  const post = await fetch(`${BASE}/api/public/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(post.status === 405, 'GET 以外は 405');
  const pre = await fetch(`${BASE}/api/public/events`, { method: 'OPTIONS', headers: ORIGIN ? { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } : {} });
  ok(pre.status === 204, 'OPTIONS は 204');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 件 OK / ${fail} 件 NG\n`);
process.exit(fail === 0 ? 0 : 1);
