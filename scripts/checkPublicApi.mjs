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

console.log('[4-2] 目的 purpose（def-1。タスクの記録と一緒に公開。2026-11-09）');
{
  const withPurpose = (over = {}, mo = {}) => event({ missions: [...event().missions,
    { id: 'def-1', title: 'このイベントの目的・目標を決めよう', tags: ['企画'], status: 'cleared', ...mo }], ...over });
  const sp = () => ({ ...subs(), 'def-1': { content: '作品を身近に{{p}}内輪のメモ{{/p}}', format: 'text', submittedBy: 'u_owner' } });
  const r = pub.buildPublicEvent(withPurpose(), sp(), TODAY);
  ok(r.purpose === '作品を身近に', `目的の本文（非公開を消す。実際：${r.purpose}）`);
  ok(!r.knowledge.some(k => k.title.includes('目的')), '目的は knowledge[] には入れない（振り返りの索引を汚さない）');
  ok(pub.buildPublicEvent(withPurpose({ publicKnowledge: false }), sp(), TODAY).purpose === null, 'publicKnowledge が false なら null');
  ok(pub.buildPublicEvent(withPurpose({ dates: ['2026-11-20'] }), sp(), TODAY).purpose === null, '開催前は null');
  ok(pub.buildPublicEvent(withPurpose({}, { status: 'yet' }), sp(), TODAY).purpose === null, '目的が未完了なら null');
  const noKn = Object.fromEntries(Object.entries(sp()).map(([k, v]) => [k, { ...v, shareable: false }]));
  ok(pub.buildPublicEvent(withPurpose(), noKn, TODAY).purpose === null, '公開される記録が0件なら目的も出さない');
  ok(pub.buildPublicEvent(event(), subs(), TODAY).purpose === null, '目的のタスクが無ければ null');
  ok(leaks(r).length === 0, `個人を指すキーが無い（見つかった：${leaks(r)}）`);
  ok(pub.publicReflectionItems(withPurpose(), sp(), TODAY).every(x => x.title !== 'このイベントの目的・目標を決めよう'), 'reflections にも目的は入らない');
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

console.log('[7] 非公開テキスト・見出し・箇条書き（指示書B §6-4）');
{
  const SECRET = '電話090-1234-5678';
  const withMarks = {
    ...subs(),
    m1: { ...subs().m1,
      content: `{{h}}準備{{/h}}\n{{l}}A4を300部{{/l}}\n{{l}}12店舗に置いた{{/l}}\n公開する文{{p}}${SECRET}{{image:2}}{{file:1}}{{/p}}のあと{{image:1}}`,
      images: [`${R2}/img_open.webp`, `${R2}/img_secret.webp`],
      files: [{ url: `${R2}/file_secret.pdf`, name: '内部資料.pdf', size: 10, thumb: `${R2}/img_secret_t.webp` },
              { url: `${R2}/file_open.pdf`, name: '公開資料.pdf', size: 10, thumb: null }] },
  };
  const r = pub.buildPublicEvent(event(), withMarks, TODAY);
  const k = r.knowledge.find(x => x.title === 'ポスターを作る');
  const json = JSON.stringify(r);
  ok(!json.includes(SECRET), '{{p}}…{{/p}} の中身が応答に含まれない（文字列で探す）');
  ok(k.text.includes('公開する文') && k.text.includes('のあと'), `{{p}} の外は残る（実際：${k.text}）`);
  ok(!json.includes('img_secret'), '{{p}} の中の画像の URL が images に含まれない');
  ok(json.includes('img_open'), '{{p}} の外の画像は残る');
  ok(!json.includes('file_secret') && !json.includes('内部資料'), '{{p}} の中の PDF が files に含まれない');
  ok(json.includes('file_open'), '{{p}} の外の PDF は残る');
  ok(k.text.includes('準備') && k.text.includes('A4を300部') && k.text.includes('12店舗に置いた'), '{{h}} / {{l}} の中身は残る');
  ok(!/\{\{/.test(json), `印（{{…}}）が1つも残らない（実際：${json.match(/\{\{[^}]*\}\}/g)}）`);

  // 閉じていない {{p}} は末尾まで非公開
  const open = { ...subs(), m1: { ...subs().m1, content: `ここは出る{{p}}${SECRET}\n最後まで隠れる` } };
  const ko = pub.buildPublicEvent(event(), open, TODAY).knowledge.find(x => x.title === 'ポスターを作る');
  ok(ko.text === 'ここは出る', `閉じの印が無い {{p}} はそこから末尾まで出ない（実際：${ko.text}）`);
  // 入れ子・対応しない閉じ
  ok(pub.publicText(`a{{p}}b{{p}}c{{/p}}d{{/p}}e`) === 'ae', '入れ子の {{p}} は外側の閉じまで消す');
  ok(pub.publicText(`a{{/p}}b`) === 'ab', '対応しない {{/p}} は無視（印だけ外す）');
  ok(pub.publicText(`{{b}}太{{/b}}{{i}}斜{{/i}}`) === '太斜', '太字・斜体は印だけ外す');

  // 概要（def-3 の本文・description）にも効く
  const legacy = event({ description: '' });
  const bs = pub.buildPublicEvent(legacy, { ...subs(), 'def-3': { content: `概要です{{p}}${SECRET}{{/p}}`, format: 'text' } }, TODAY).basic;
  ok(bs.summary === '概要です', `概要（def-3）の非公開も消える（実際：${bs.summary}）`);
  const bd = pub.buildPublicEvent(event({ description: `説明{{p}}${SECRET}{{/p}}` }), subs(), TODAY).basic;
  ok(bd.summary === '説明', `description に残っていた非公開も消える（実際：${bd.summary}）`);
  // 振り返りの欄
  const rs = { ...subs(), m1: { ...subs().m1, solution: `次は{{p}}${SECRET}{{/p}}早めに` } };
  ok(!JSON.stringify(pub.buildPublicEvent(event(), rs, TODAY)).includes(SECRET), '振り返り（solution）の非公開も消える');
}

console.log('[8] 公開の確認ページ（preview。指示書B §5-1）');
{
  const SECRET = '内線1234';
  const hidden = event({ publicBasicInfo: false, publicKnowledge: false });
  const s = { ...subs(), m1: { ...subs().m1, content: `本文{{p}}${SECRET}{{/p}}` } };
  ok(pub.buildPublicEvent(hidden, s, TODAY).basic === null, 'preview でなければ、非公開のイベントは basic が null');
  const r = pub.buildPublicEvent(hidden, s, TODAY, { preview: true });
  ok(r.basic && r.basic.title === 'テスト展示会', 'preview は公開フラグを見ずに basic を組み立てる');
  ok(Array.isArray(r.knowledge) && r.knowledge.length === 2, `preview でも shareable・solution の条件はそのまま（実際：${r.knowledge?.length}件）`);
  ok(!JSON.stringify(r).includes(SECRET), 'preview でも非公開テキストは消える');
  ok(leaks(r).length === 0, `preview に個人を指すキーが無い（見つかった：${leaks(r)}）`);
  ok(!JSON.stringify(r).includes('u_owner') && !JSON.stringify(r).includes('u_a'), 'preview に userId の値も出ない');
  ok(pub.buildPublicEvent({ ...hidden, dates: ['2026-11-20'] }, s, TODAY, { preview: true }).knowledge === null, 'preview でも開催前は knowledge が null');
}

console.log('[9] 種別（eventType）と最終更新（lastUpdated。指示書B §5-4）');
{
  const crdt = require('../lib/crdt.js');
  const fs = await import('node:fs');
  // 本体の EVENT_TYPES と同じ id か（ソースから読む。テストに値を複製しない）
  const src = fs.readFileSync(new URL('../public/js/constants.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const EVENT_TYPES'), src.indexOf('];', src.indexOf('export const EVENT_TYPES')));
  const ids = [...block.matchAll(/id:\s*'([a-z_]+)'/g)].map(m => m[1]);
  ok(JSON.stringify(ids) === JSON.stringify(pub.EVENT_TYPE_IDS), `EVENT_TYPE_IDS が constants.js の EVENT_TYPES と同じ（実際：${ids}）`);

  const b = pub.buildPublicEvent(event({ eventType: 'exhibit' }), subs(), TODAY).basic;
  ok(b.eventType === 'exhibit', 'eventType は id を返す');
  ok(pub.buildPublicEvent(event({ eventType: '<x>' }), subs(), TODAY).basic.eventType === null, '知らない種別は null');
  ok(pub.buildPublicEvent(event({ eventType: undefined }), subs(), TODAY).basic.eventType === null, '未設定は null');
  ok(pub.publicListItem(event({ eventType: 'social' }), subs(), TODAY).eventType === 'social', '一覧にも eventType');

  // 最終更新：CRDT のセルの t から（公開フラグの t は数えない）
  const at = (s) => new Date(`${s}T12:00:00`).getTime();
  const raw = {
    id: 'E9', ownerId: 'u', members: [], rev: 1,
    fields: {
      name: { v: 'n', t: at('2026-10-05') }, description: { v: 'd', t: at('2026-10-03') },
      dates: { v: ['2026-10-01'], t: at('2026-09-01') },
      publicBasicInfo: { v: true, t: at('2026-11-04') }, publicKnowledge: { v: true, t: at('2026-11-04') },
      publishCheckedAt: { v: 1, t: at('2026-11-04') }, eventType: { v: 'other', t: at('2026-11-03') },
    },
    missions: {}, proposals: {},
  };
  const flat = crdt.crdtToFlat(raw);
  ok(pub.lastUpdatedOf(flat, {}) === '2026-10-05', `基礎情報の t の最大（公開フラグ・種別の t は数えない）（実際：${pub.lastUpdatedOf(flat, {})}）`);
  ok(pub.lastUpdatedOf(flat, { a: { timestamp: at('2026-10-20') } }) === '2026-10-20', '提出物の時刻が新しければそちら');
  const flat2 = crdt.crdtToFlat({ ...raw, fields: { ...raw.fields, publicBasicInfo: { v: false, t: at('2026-11-06') } } });
  ok(pub.lastUpdatedOf(flat2, {}) === '2026-10-05', '公開の切り替えで lastUpdated が変わらない');
  ok(pub.lastUpdatedOf({}, {}) === null, '何も無ければ null');
  const bb = pub.buildPublicEvent({ ...flat, publicBasicInfo: true }, {}, TODAY).basic;
  ok(/^\d{4}-\d{2}-\d{2}$/.test(bb.lastUpdated), `basic.lastUpdated は YYYY-MM-DD（実際：${bb.lastUpdated}）`);
}

console.log('[10] 本文の構造 knowledge[].blocks（見出し・本文・箇条書き。2026-11-08）');
{
  const SECRET = '担当は田中さん090-1111-2222';
  const content = [
    '{{h}}決めたこと{{/h}}',
    '3案を並べて{{b}}メンバー{{/b}}で投票した',
    '2行目も同じ段落',
    '',
    '   ',
    `{{l}}入稿は前日まで{{/l}}`,
    `{{l}}サイズは A2{{p}}${SECRET}{{/p}}{{/l}}`,
    '{{l}}{{/l}}',
    '{{h}}{{/h}}',
    `{{p}}${SECRET}`,
    '最後まで非公開',
  ].join('\n');
  const b = pub.publicBlocks(content);
  ok(JSON.stringify(b) === JSON.stringify([
    { type: 'heading', text: '決めたこと' },
    { type: 'text',    text: '3案を並べてメンバーで投票した\n2行目も同じ段落' },
    { type: 'item',    text: '入稿は前日まで' },
    { type: 'item',    text: 'サイズは A2' },
  ]), `見出し・段落・項目に分かれる（空の行・空の見出し・項目は出さない）（実際：${JSON.stringify(b)}）`);
  ok(!JSON.stringify(b).includes(SECRET), 'blocks に非公開テキストの中身が入らない（閉じ忘れの末尾まで）');
  ok(b.every(x => ['heading', 'text', 'item'].includes(x.type)), 'type は heading / text / item の3つだけ');
  ok(!/\{\{/.test(JSON.stringify(b)), 'blocks に印（{{…}}）が残らない');
  ok(JSON.stringify(pub.publicBlocks('A{{image:1}}\n{{file:1}}\nB')) === JSON.stringify([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }]),
    '画像・PDF だけの行は段落の区切り（印は外す）');
  ok(JSON.stringify(pub.publicBlocks('ab{{h}}見{{/h}}cd')) === JSON.stringify([{ type: 'heading', text: 'ab見cd' }]), '行の途中の見出しの印は、その行ごと見出し');
  ok(JSON.stringify(pub.publicBlocks('')) === '[]', '空の本文は []');

  // knowledge に載る形（text は今までどおり）
  const s = { ...subs(), m1: { ...subs().m1, content } };
  const k = pub.buildPublicEvent(event(), s, TODAY).knowledge.find(x => x.title === 'ポスターを作る');
  ok(Array.isArray(k.blocks) && k.blocks.length === 4, 'knowledge[].blocks が入る');
  ok(k.text === pub.publicText(content), 'text は今までどおり（平文）');
  ok(!JSON.stringify(k).includes(SECRET), 'knowledge に非公開の中身が無い（text・blocks とも）');
  const img = pub.buildPublicEvent(event(), { ...subs(), m1: { ...subs().m1, format: 'image', content: `${R2}/x.webp` } }, TODAY)
    .knowledge.find(x => x.title === 'ポスターを作る');
  ok(Array.isArray(img.blocks) && img.blocks.length === 0, '画像だけの旧形式は blocks が []');
  ok(leaks(pub.buildPublicEvent(event(), s, TODAY)).length === 0, 'blocks を足しても個人を指すキーが無い');
}

console.log('[11] 振り返りの一覧 publicReflectionItems（GET /api/public/reflections。2026-11-08）');
{
  const pick = (k) => ({ title: k.title, tags: k.tags, outcome: k.outcome, struggle: k.struggle, solution: k.solution });
  const s = { ...subs(), m1: { ...subs().m1, solution: '次は{{p}}佐藤さんに{{/p}}早めに' } };
  const items = pub.publicReflectionItems(event({ eventType: 'exhibit' }), s, TODAY);
  const detail = pub.buildPublicEvent(event({ eventType: 'exhibit' }), s, TODAY).knowledge;
  ok(JSON.stringify(items.map(({ event, ...k }) => k)) === JSON.stringify(detail.map(pick)), '詳細の knowledge[] と同じ項目・同じ順');
  ok(items.every(i => JSON.stringify(Object.keys(i)) === JSON.stringify(['event', 'title', 'tags', 'outcome', 'struggle', 'solution'])),
    'text / blocks / images / files は入れない（項目はこの6つだけ）');
  ok(JSON.stringify(items[0].event) === JSON.stringify({ id: 'E1', title: 'テスト展示会', dates: ['2026-10-01', '2026-10-02'], eventType: 'exhibit' }),
    `event は basic と同じ値（実際：${JSON.stringify(items[0].event)}）`);
  ok(!JSON.stringify(items).includes('佐藤さん'), '非公開テキストは消えている');
  ok(leaks(items).length === 0 && !JSON.stringify(items).includes('u_owner') && !JSON.stringify(items).includes('u_a'), '名前・userId が無い');
  ok(pub.publicReflectionItems(event({ publicBasicInfo: false }), s, TODAY).length === 0, '基礎情報が非公開なら、knowledge が公開でも出さない');
  ok(pub.publicReflectionItems(event({ dates: ['2026-11-20'] }), s, TODAY).length === 0, '開催前は出さない');
  ok(pub.publicReflectionItems(event({ publicKnowledge: false }), s, TODAY).length === 0, 'publicKnowledge が false なら出さない');
  const titles = items.map(i => i.title);
  ok(!titles.includes('告知する') && !titles.includes('会場を下見する'), 'shareable の無いもの・solution が空のものは出ない');
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

  // ── 振り返りの一覧（GET /api/public/reflections）──
  {
    const pick = (k) => ({ title: k.title, tags: k.tags, outcome: k.outcome, struggle: k.struggle, solution: k.solution });
    const rr = await get('/api/public/reflections', ORIGIN ? { Origin: ORIGIN } : {});
    const rj = await rr.json();
    ok(rr.status === 200 && rj.ok === true && Array.isArray(rj.items) && typeof rj.truncated === 'boolean', 'reflections：ok / items / truncated の形');
    ok(rr.headers.get('cache-control') === 'public, max-age=300', 'reflections：Cache-Control');
    ok(/origin/i.test(rr.headers.get('vary') || ''), 'reflections：Vary: Origin');
    if (ORIGIN) ok(rr.headers.get('access-control-allow-origin') === ORIGIN, 'reflections：許可した Origin には Allow-Origin を返す');
    const rEvil = await get('/api/public/reflections', { Origin: 'https://evil.example' });
    ok(!rEvil.headers.get('access-control-allow-origin'), 'reflections：許可していない Origin には Allow-Origin を返さない');
    ok(leaks(rj).length === 0, `reflections：個人を指すキーが無い（見つかった：${leaks(rj)}）`);
    ok(rj.items.every(i => !('text' in i) && !('blocks' in i) && !('images' in i) && !('files' in i)), 'reflections：text / blocks / images / files が無い');
    const listIds = lj.events.map(e => e.id);
    ok(rj.items.every(i => listIds.includes(i.event.id)), 'reflections：一覧に出ていない（詳細が 404 の）イベントの振り返りが無い');
    if (PRIVATE) ok(!rj.items.some(i => i.event.id === PRIVATE), 'reflections：非公開のイベントの振り返りが無い');
    // 一致：公開イベントごとに、詳細の knowledge[] と順番も含めて同じ
    for (const e of lj.events) {
      const dj = await (await get(`/api/public/events/${encodeURIComponent(e.id)}`)).json();
      const want = (dj.knowledge || []).map(pick);
      const got  = rj.items.filter(i => i.event.id === e.id);
      ok(JSON.stringify(got.map(pick)) === JSON.stringify(want), `reflections：${e.id} が詳細の knowledge と一致（${got.length}件）`);
      ok(got.every(i => i.event.title === dj.basic.title && JSON.stringify(i.event.dates) === JSON.stringify(dj.basic.dates)
        && i.event.eventType === dj.basic.eventType), `reflections：${e.id} の event が basic と同じ`);
    }
    // 並び：イベントの出てくる順が一覧の順と同じ
    const seen = [...new Set(rj.items.map(i => i.event.id))];
    ok(JSON.stringify(seen) === JSON.stringify(listIds.filter(id => seen.includes(id))), 'reflections：イベントの並びが一覧と同じ');
    const rPost = await fetch(`${BASE}/api/public/reflections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    ok(rPost.status === 405, 'reflections：GET 以外は 405');
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
