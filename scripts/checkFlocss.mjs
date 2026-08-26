#!/usr/bin/env node
// FLOCSS 移行の自己点検
//
//   node scripts/checkFlocss.mjs
//
// ★このファイルはリポジトリに置くこと。
//   以前は検証スクリプトを一時ディレクトリに置いていたが、/tmp が掃除された
//   ときにまとめて消えた。移行が終わるまでの安全網なので、コードと一緒に残す。
//
// 見ているのは次の3種類：
//   [A] 規約   … 接頭辞・トークン・登録漏れ。新しい CSS を足すと自動で対象になる
//   [B] 再発防止 … 実機で見つかった不具合。直した形が崩れていないか
//   [C] 完了条件 … 指示書の「JS 内に <style> を書かない」など

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ls = (d) => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.css')).sort();
/** コメントを外す。「!important」や色の説明文が本文と誤認されるのを防ぐ */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

const entry = R('public/css/style.css');
const readme = R('public/css/README.md');

// public/js 全体。Tailwind は撤去済みなので例外は無い。
const JS_ALL = [
  ...fs.readdirSync(path.join(ROOT, 'public/js')).filter(f => f.endsWith('.js')).map(f => `public/js/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'public/js/views')).map(f => `public/js/views/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'public/js/modals')).map(f => `public/js/modals/${f}`),
];

// ---------------------------------------------------------------- [A] 規約
section('[A] CSS の規約');

const LAYERS = [
  ['public/css/layout', '.l-'],
  ['public/css/object/component', '.c-'],
  ['public/css/object/project', '.p-'],
  ['public/css/object/utility', '.u-'],
];

// ★Phase 5 で接頭辞なしのクラスは全て改名済み。例外は作らないこと。
const LEGACY_CLASSES = new Set([]);

for (const [dir, prefix] of LAYERS) {
  for (const f of ls(dir)) {
    const rel = `${dir}/${f}`;
    const css = R(rel);
    const body = strip(css);
    const sels = (body.match(/^\.[a-z][a-z0-9_-]*/gm) || []);
    const bad = [...new Set(sels.filter(s =>
      !s.startsWith(prefix) && !LEGACY_CLASSES.has(s)))];
    ok(`${f}: ${prefix} 接頭辞`, bad.length === 0, bad.join(' '));
    ok(`${f}: 使用箇所を書いてある`, css.includes('使用箇所:'));
    ok(`${f}: style.css に登録`, entry.includes(`${dir.replace('public/css/', '')}/${f}`));
    ok(`${f}: 生 HEX を書いていない`, !/#[0-9A-Fa-f]{6}/.test(body),
      (body.match(/#[0-9A-Fa-f]{6}/g) || []).join(' '));
    ok(`${f}: README に載っている`, readme.includes(f));
  }
}

// !important は原則禁止。特別な理由があるものだけここに列挙する。
const IMPORTANT_ALLOW = {
  'public/css/object/utility/_display.css': 'u-hidden（他のどの指定より強く隠す）',
};
for (const [dir] of LAYERS) {
  for (const f of ls(dir)) {
    const rel = `${dir}/${f}`;
    const n = (strip(R(rel)).match(/!important/g) || []).length;
    ok(`${f}: !important に理由がある`, n === 0 || rel in IMPORTANT_ALLOW, `${n}箇所`);
  }
}

section('[A-2] トークン');
const vars = R('public/css/foundation/_variables.css');
ok('原色は :root に集約されている', vars.includes('--create-blue: #209DDB'));
ok('z-index は用途名で持つ', /--z-modal:\s*300/.test(vars) && /--z-toast:\s*400/.test(vars));
ok('★z-index を連番に振り直していない（z-[…] の直書きがまだ残る）',
  vars.includes('重なり順が入れ替わる'));
ok('Tailwind の shadow-2xl を別トークンにしてある',
  /--shadow-2xl:\s*0 25px 50px -12px/.test(vars));

// @keyframes の名前がぶつかっていないか。名前は文書全体で1つの空間なので、
// 同名を2回定義すると後勝ちで別のアニメーションが化ける（実際に起きた）。
section('[A-3] @keyframes の名前が重複していない');
const allCss = [...entry.matchAll(/@import url\("\.\/([^"]+)"\)/g)]
  .map(m => R(`public/css/${m[1]}`)).join('\n');
const kf = [...strip(allCss).matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(m => m[1]);
const dupKf = kf.filter((v, i) => kf.indexOf(v) !== i);
ok('CSS 内で重複なし', dupKf.length === 0, dupKf.join(' '));
ok('slideUp と sheetRise を取り違えていない',
  /@keyframes sheetRise[\s\S]{0,80}translateY\(100%\)/.test(allCss) &&
  /@keyframes slideUp[\s\S]{0,80}translateY\(12px\)/.test(allCss));

// -------------------------------------------------------- [B] 再発防止
section('[B] 実機で見つかった不具合');

const overlay = R('public/css/object/component/_overlay.css');
ok('★ボトムシートの暗幕が横中央に寄せる（左へずれた不具合）',
  /\.c-overlay--bottom\s*\{[^}]*justify-content: center/.test(overlay));

const createEvent = R('public/js/views/createEvent.js');
const drag = createEvent.slice(createEvent.indexOf('function _bindCalendarDrag'));
ok('★開催日カレンダーは Pointer Events 1系統（単発タップで戻る不具合）',
  drag.includes("addEventListener('pointerdown'") &&
  !/addEventListener\('mousedown'/.test(drag) &&
  !/addEventListener\('touchstart'/.test(drag));
ok('★document にリスナーを溜めていない', !/document\.addEventListener/.test(drag));

// ★測るのは「開き終わってから」。開くアニメーションの最中だと入力欄がまだ
//   画面の下にあり、1枚目の吹き出しが出ないまま消えた（実機で見つかった）。
ok('★ツールチップは作成モーダルが開き終わってから測る（1枚目が出ない不具合）',
  R('public/js/modals/mission.js').includes("addEventListener('transitionend'"));
ok('吹き出しを画面内に収める処理がある',
  R('public/js/modals/tooltipTour.js').includes('innerHeight'));

// ★<br> を含む文言は「発生源でエスケープ、描画側ではしない」。
//   描画側で二重に esc すると <br> が文字として出る（実際に出した）。
const brRules = [
  ['オンボーディングの見出し', 'public/js/modals/onboardingModal.js', '">${o.title}</h3>'],
  ['アカウント作成の診断',     'public/js/views/signup.js',           '">${q.title}</h1>'],
];
for (const [label, f, needle] of brRules) {
  ok(`★${label}を描画側で esc していない`, R(f).includes(needle));
}
ok('★発生源（onboarding.js）でユーザー名をエスケープしている',
  R('public/js/onboarding.js').includes('_escapeName'));
ok('<br> を含まないコーチマークは esc したまま',
  R('public/js/modals/coachMark.js').includes('${_esc(o.title)}') &&
  !/title:\s*'[^']*<br>/.test(R('public/js/onboardingIntro.js')));

// ------------------------------------------------------ [C] 完了条件
section('[C] 完了条件');

const styleInJs = JS_ALL.filter(f => /<style>/.test(R(f)));
ok('★JS の中に <style> を書いていない', styleInJs.length === 0, styleInJs.join(' '));

// ★Tailwind は撤去済み。class="..." だけでなく className = '...' も見る。
//   Phase 5 で「0 になった」と判断した後、className で組み立てていた
//   オーバーレイ4つとトースト5つが取り残されていた（実機で発覚）。
//   当たるものが何も無いので、そのモーダルは位置指定を丸ごと失っていた。
const TW_TOKEN = /^(flex|grid|w-|h-|p[xytblr]?-|m[xytblr]?-|text-|bg-|border|rounded|gap-|items-|justify-|absolute|relative|fixed|sticky|z-|shadow|opacity-|truncate|overflow-|min-|max-|space-|leading-|font-|whitespace-|break-|object-|inline|block|cursor-|active:|hover:|peer|ring-|backdrop-|transition|duration-|scale-|translate|rotate-|list-|underline|resize|select-|pointer-events-|animate-)/;
const KEEP_TOKEN = /^(heading-(l|m|r|rs)|text-(m|r|rs))$/;
const twLeft = [];
for (const f of JS_ALL.concat(['public/index.html'])) {
  const src = R(f);
  const chunks = [
    ...[...src.matchAll(/class="([^"]*)"/g)].map(m => m[1]),
    ...[...src.matchAll(/className\s*=\s*'([^']*)'/g)].map(m => m[1]),
    ...[...src.matchAll(/className\s*=\s*`([^`]*)`/g)].map(m => m[1]),
  ];
  for (const ch of chunks) {
    for (const t of ch.split(/\s+/)) {
      if (!t || t.includes('${') || /^(l|c|p|u|js|is)-/.test(t)) continue;
      if (KEEP_TOKEN.test(t)) continue;
      if (TW_TOKEN.test(t)) twLeft.push(`${path.basename(f)}: ${t}`);
    }
  }
}
ok('★Tailwind のユーティリティが残っていない（className も含めて）',
  twLeft.length === 0, [...new Set(twLeft)].slice(0, 12).join(' / '));
ok('★Tailwind CDN を読み込んでいない',
  !R('public/index.html').includes('cdn.tailwindcss.com'));

// JS が掴んでいる id / data 属性。改名すると静かに壊れるので存在を見張る。
const HOOKS = [
  ['public/js/modals/mission.js', ['id="mission-panel"', 'id="assignee-sheet-panel"',
    'id="tag-creator-panel"', 'data-coach="mission-title"', 'data-coach="assignee"',
    'data-coach="schedule"']],
  ['public/js/modals/calendar.js', ['id="calendar-bottomsheet-panel"', 'data-sheet-handle']],
  ['public/js/dialog.js', ['id="cd-ok"', 'id="cd-cancel"', '__sheetClose']],
  ['public/js/modals/eventCalendarSheet.js', ['id="mb-cal-fixed"', 'id="mb-cal-list"',
    'id="gantt-header-inner"', 'id="gantt-body"', 'id="btn-view-calendar"',
    'id="btn-view-gantt"', 'data-mb-day', 'data-mb-section', 'data-mission-id',
    'data-sheet', 'data-sheet-handle']],
  ['public/js/views/missionDetail.js', ['id="clear-input"', 'id="file-input"']],
];
for (const [f, hooks] of HOOKS) {
  const src = R(f);
  const missing = hooks.filter(h => !src.includes(h));
  ok(`${path.basename(f)}: JS が掴む id / 属性が残っている`, missing.length === 0, missing.join(' '));
}

// 同じ id が別ファイルで使われていないか（白画面バグの原因になった）。
// 意図して共有しているものだけ除外する。
const SHARED_OK = new Set(['clear-mission-modal', 'clear-input', 'img-chip', 'preview-img',
  'file-input', 'clear-checklist-error']);
const idOwners = new Map();
for (const f of JS_ALL) {
  for (const m of R(f).matchAll(/id="([a-z][a-z0-9-]*)"/g)) {
    if (!idOwners.has(m[1])) idOwners.set(m[1], new Set());
    idOwners.get(m[1]).add(f);
  }
}
// ★既知：auth.js の renderCreateAccountInfo（旧アカウント作成画面）が
//   signup.js と同じ id を持つ。この関数はどこからも呼ばれていない死にコードで、
//   消すのが正しい直し方だが、削除の判断は保留中。両方が同時に DOM に出ることは
//   無いので実害は出ていない。★消したらこの除外も消すこと。
const KNOWN_DEAD_CODE = new Set(['ca-google-section', 'ca-google-btn']);
const clashes = [...idOwners].filter(([id, fs_]) =>
  fs_.size > 1 && !SHARED_OK.has(id) && !KNOWN_DEAD_CODE.has(id));
ok('★同じ id をファイル跨ぎで使っていない', clashes.length === 0,
  clashes.map(([id, fs_]) => `${id}: ${[...fs_].map(x => path.basename(x)).join(', ')}`).join('\n     '));
console.log('  ⚠️ 既知: auth.js の死にコード renderCreateAccountInfo が signup.js と'
  + ' id を共有している（ca-google-section / ca-google-btn）。削除の判断待ち。');

console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
