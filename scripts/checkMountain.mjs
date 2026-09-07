#!/usr/bin/env node
// 山ビジュアルの自己点検
//
//   node scripts/checkMountain.mjs
//
// ★このファイルはリポジトリに置くこと。
//   一時ディレクトリに置いていた検証は /tmp の掃除で2度消えた。
//   数値を触るたびに要るものなので、コードと一緒に残す。
//
// ★定数はソースから読む。ここに直値を書くと、値を調整したときに
//   実装ではなくテストが落ちる（過去に2回やらかした）。
//
// 見ているもの：
//   [A] 背景セグメントとマスの位置が厳密に一致するか
//   [B] スクロールで最新のマスが手前まで下りてくるか
//   [C] 遠近（大きさ・不透明度・振れ幅）が画面位置に連動するか
//   [D] 背景テーマが決定的に決まるか（保存しない・全員同じ・不変）
//   [H] 生成マニフェストが実ファイルと合っているか（手書き側にファイル名が無いか）
//   [I] 素材そのものが健全か（重さ・幅・ファイル名）

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = path.join(ROOT, 'public/js/mountainPath.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log(`  ❌ ${n}${d ? '\n     ' + d : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

/** ソースから定数を読む（テスト側に値を複製しないため） */
/** コメントを除いたコードだけを返す。
 *  ★「ソースに X が現れないこと」の判定は必ずこれを通す。素材の置き場所や
 *    「Math.random を使わないこと」という注意書き自体はコメントに書いてあるべきで、
 *    生のソースで判定すると**警告文そのものがテストを落とす**（2回踏んだ）。 */
const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')     // ブロックコメント
  .replace(/(^|[^:])\/\/.*$/gm, '$1');    // 行コメント（'://' は URL なので除く）
const srcCode = codeOnly(src);

const K = (name) => {
  const m = new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`).exec(src);
  if (!m) throw new Error(`定数が見つからない: ${name}`);
  return +m[1];
};
const NODE_GAP = K('NODE_GAP'), TOP_PAD = K('TOP_PAD'), BOTTOM_PAD = K('BOTTOM_PAD');
const NEAR_MARGIN = K('NEAR_MARGIN');
const SCALE_MAX = K('SCALE_MAX'), SCALE_MIN = K('SCALE_MIN');
const OPACITY_MIN = K('OPACITY_MIN'), OPACITY_RANGE = K('OPACITY_RANGE');
const ART_W = K('ART_W'), LF_OVERLAP = K('LF_OVERLAP');
const THEME_RUN = K('THEME_RUN'), MAX_PARTS = K('MAX_PARTS');
const PLANT_MIN_STRIP = K('PLANT_MIN_STRIP'), MAX_PLANTS = K('MAX_PLANTS');
const PLANT_GAP = K('PLANT_GAP');
const MAX_DRIFT = K('MAX_DRIFT');

// 素材の一覧と調整値。★テスト側に複製せず、実装と同じものを読む
const { BG_ASSETS, BG_SHARED } = await import(pathToFileURL(path.join(ROOT, 'public/js/mountainAssets.generated.js')).href);
const { BG_THEMES } = await import(pathToFileURL(path.join(ROOT, 'public/js/mountainThemes.js')).href);
const themeCfg = (id) => BG_THEMES.find(t => t.id === id);
const colorOf = (pt) => { const a = BG_ASSETS[pt.theme].landform.find(x => x.f === pt.file); return a.c || a.n; };

// ── 最小 DOM スタブ ───────────────────────────────────────
const VIEW_H = 800, HEADER = 110, PANEL_TOP = 496;
let rafQueue = [];
const winListeners = [];

function mkEl() {
  const el = {
    dataset: {}, children: [], _props: {}, _top: 0, listeners: {},
    style: {
      setProperty(k, v) { el._props[k] = v; },
      getPropertyValue(k) { return el._props[k]; },
    },
    addEventListener(t, fn) { (el.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { el.listeners[t] = (el.listeners[t] || []).filter(f => f !== fn); },
    getBoundingClientRect: () => ({ top: el._top, width: 448 }),
    querySelectorAll: (s) => (s === '[data-node-y]' ? el.children : []),
    querySelector: (s) => (s === '[data-mtn-spacer]' ? el._spacer : null),
    scrollTop: 0, clientHeight: PANEL_TOP - HEADER, clientWidth: 448, offsetHeight: 0,
  };
  return el;
}

global.window = {
  innerHeight: VIEW_H,
  addEventListener(t, fn) { winListeners.push({ t, fn }); },
  removeEventListener(t, fn) {
    const i = winListeners.findIndex(x => x.t === t && x.fn === fn);
    if (i >= 0) winListeners.splice(i, 1);
  },
};
global.requestAnimationFrame = (fn) => rafQueue.push(fn);
const flush = () => { const q = rafQueue; rafQueue = []; q.forEach(fn => fn()); };

// ★先読みが実際に取りに行った URL を記録するスタブ。
//   `new Image().src = url` はブラウザのキャッシュに入れるためだけの呼び出し。
const prefetched = [];
global.Image = class { set src(v) { prefetched.push(v); } };

const M = await import(SRC_PATH);

/** 完了 done 件のイベントを描画し、結果を解析して返す */
function build(done, eventId = 'ev1', dates = [], opts = {}) {
  const missions = Array.from({ length: done + 3 }, (_, i) =>
    ({ id: 'm' + i, createdAt: i, status: i < done ? 'cleared' : 'yet' }));
  const html = M.renderMountainBg({ id: eventId, name: 't', missions, dates, clearedData: {} }, opts);
  return {
    html,
    canvasH: +/class="p-mountain__canvas" style="height:(\d+)px/.exec(html)[1],
    nodes: [...html.matchAll(/data-node-y="([\d.]+)"/g)].map(m => +m[1]),
    // 地形パーツ。★JS が渡すのは素材px の数値だけ（位置と大きさの計算は CSS）
    // 地形の入れ物 <div> ごとに切り出し、その中の地形の絵と植物を読む
    parts: html.split('<div class="p-mountain__lf"').slice(1).map(chunk => {
      const box = /--lf-y:(\d+);--lf-h:(\d+);--lf-img:url\('\/images\/bg\/([^/]+)\/landform\/([^']+)'\);z-index:(\d+)/.exec(chunk);
      const plants = [...chunk.matchAll(/class="p-mountain__plant" src="\/images\/bg\/([^/]+)\/WorldSpawnedObjects\/([^"]+)"[\s\S]*?loading="(\w+)"[\s\S]*?style="--pl-x:(\d+);--pl-y:(\d+);--pl-w:(\d+);--pl-h:(\d+)"/g)]
        .map(m => ({ theme: m[1], file: m[2], loading: m[3], x: +m[4], y: +m[5], w: +m[6], h: +m[7] }));
      return { y: +box[1], h: +box[2], theme: box[3], file: box[4], z: +box[5], plants };
    }),
    clouds: [...html.matchAll(/class="p-mountain__cloud" src="\/images\/bg\/cloud\/([^"]+)"[\s\S]*?style="--cl-y:(-?\d+);--cl-w:(\d+);--cl-h:(\d+);--cl-x0:(-?\d+);--cl-x1:(-?\d+);--cl-dur:(\d+)s;--cl-delay:(-?\d+)s;z-index:(\d+)"/g)]
      .map(m => ({ file: m[1], y: +m[2], w: +m[3], h: +m[4], x0: +m[5], x1: +m[6], dur: +m[7], delay: +m[8], z: +m[9] })),
    // 山頂の看板。★専用の1枚絵は廃止し、最後の地形の上に看板を立てる方式
    summit: (/class="p-mountain__summit" style="--lf-y:(\d+);--summit-img:(var\(--summit-board-\d+\));z-index:(\d+)"/.exec(html) || null),
    summitTitle: (/class="p-mountain__summit-title">([^<]*)</.exec(html) || [])[1],
    summitAlt:   (/class="p-mountain__summit-alt">([^<]*)</.exec(html) || [])[1],
    sig: (/data-bg-sig="([^"]*)"/.exec(html) || [])[1],
  };
}

/** 実際に配線し、scrollTop の位置での画面上の値を取り出す */
function wire(done, scrollTop = 0) {
  const b = build(done);
  const bg = mkEl(); bg._top = HEADER;
  const canvas = mkEl(); canvas.style.height = `${b.canvasH}px`;
  const win = mkEl(); const spacer = mkEl(); win._spacer = spacer;
  const panel = mkEl(); panel._top = PANEL_TOP;
  canvas.children = b.nodes.map(y => { const e = mkEl(); e.dataset.nodeY = String(y); e.dataset.nodeDx = '26'; return e; });
  Object.defineProperty(win, 'scrollHeight', { get: () => parseFloat(spacer.style.height) || b.canvasH });
  global.document = {
    getElementById: (id) => ({
      'mountain-bg': bg, 'mountain-canvas': canvas,
      'mountain-path-scroll': win, 'mainboard-bottom-panel': panel,
    })[id] || null,
    querySelector: () => null,
  };
  win.scrollTop = scrollTop;
  M.initMountainPathSync(scrollTop);
  flush();
  const headroom = parseFloat(canvas.style.marginTop) || 0;
  const at = (i) => {
    const el = canvas.children[i];
    return {
      screenY: HEADER + headroom + b.nodes[i] - scrollTop,
      scale: +el.style.getPropertyValue('--node-scale'),
      opacity: +el.style.getPropertyValue('--node-opacity'),
      dx: parseFloat(el.style.getPropertyValue('--node-dx')),
    };
  };
  const n = canvas.children.length;
  return {
    ...b, headroom, canvas, win, spacer, at,
    newest: n - 1,                        // いちばん上＝次にやる灰色の1マス（未完了）
    lastCleared: n >= 2 ? n - 2 : n - 1,  // ★スクロールで手前まで来てほしいのはこちら
  };
}

// ── [A] 背景の積み方 ────────────────────────────────────────
// ★背景は地形パーツを下から積んで作る。各パーツの下 LF_OVERLAP px は塗り潰しの
//   余白なので、送りがその範囲に収まっていれば高さがバラバラでも隙間が出ない。
//   位置と大きさは CSS（--art-unit）が決めるので、ここで検証できるのは素材px の数値。
section(`[A] ★地形の積み方（重ねしろ ${LF_OVERLAP} 素材px）`);
for (const done of [0, 7, 8, 16, 48]) {
  const { parts } = build(done);
  ok(`完了${String(done).padStart(2)} → 地形${String(parts.length).padStart(2)}枚（1枚以上・上限内）`,
    parts.length >= 1 && parts.length <= MAX_PARTS);
}
{
  const { parts } = build(48);
  ok('いちばん下の地形がキャンバス下端にある（--lf-y = 0）', parts[0].y === 0, String(parts[0].y));

  const asc = parts.every((pt, k) => k === 0 || pt.y > parts[k - 1].y);
  ok('地形の位置が下から上へ単調に増える', asc);

  // ★送りが重ねしろを超えると、地形と地形の間に塗り潰しの無い帯ができる
  const advBad = [];
  for (let k = 1; k < parts.length; k++) {
    const adv = parts[k].y - parts[k - 1].y;
    const cfg = themeCfg(parts[k - 1].theme).landform;
    if (adv < cfg.advanceMin || adv > cfg.advanceMax || adv > LF_OVERLAP) {
      advBad.push(`[${k}] ${adv} (${cfg.advanceMin}-${cfg.advanceMax})`);
    }
  }
  ok(`★送りがテーマの範囲内かつ重ねしろ(${LF_OVERLAP})以下`, advBad.length === 0, advBad.slice(0, 3).join(' '));

  // ★下（手前）ほど z が大きい。逆だと重ねしろが表に出て継ぎ目が見える
  const zDesc = parts.every((pt, k) => k === 0 || parts[k - 1].z > pt.z);
  ok('★手前（下）の地形ほど z-index が大きい', zDesc, parts.map(pt => pt.z).slice(0, 5).join(','));

  // ★z を2刻みにしてあるのは、雲・気象をパーツの「間」に差し込む余地を残すため
  ok('z-index が2刻み（雲・気象を間に挟める）', parts.every(pt => pt.z % 2 === 0));


  // 覆いきれているか：塗り潰しの余白の上端が、必要な高さに届いていること
  const last = parts.at(-1);
  ok('いちばん上の地形が必要な高さまで届いている（上端に隙間ができない）',
    parts.length >= MAX_PARTS || last.y + LF_OVERLAP >= (parts.at(-2) ? last.y : 0));
}
{
  // 山頂は「開催の最終日以降」だけ。日程なしのイベントでは出さない
  ok('日程が無いイベントでは山頂を出さない', build(8).summit === null);
  ok('開催前のイベントでは山頂を出さない', build(8, 'ev1', ['2099-01-01']).summit === null);

  const past = build(8, 'ev1', ['2020-01-01', '2020-01-02']);
  ok('★開催の最終日以降は山頂の看板を立てる', past.summit !== null);
  if (past.summit) {
    const sy = +past.summit[1];
    const top = past.parts.at(-1);
    // ★最上段の地形の上端から少し下げて立てる。下げないと空中に浮いて見える
    const SUMMIT_SINK = K('SUMMIT_SINK');
    ok('看板が最上段の地形の稜線あたりに立つ',
      sy === Math.max(0, top.y + top.h - SUMMIT_SINK), `${sy} vs ${top.y + top.h - SUMMIT_SINK}`);
    // ★看板は地形より手前。地形の裏に回ると読めない
    ok('★看板は地形より手前にある', +past.summit[3] > Math.max(...past.parts.map(pt => pt.z)));
    // ★絵は CSS 変数で参照する（ファイル名を手書きの JS に書かないため）
    ok('看板の絵を CSS 変数で参照している', /^var\(--summit-board-[12]\)$/.test(past.summit[2]),
      past.summit[2]);
    // ★「〇〇山頂」。ラベルは付けず、標高は数字と m だけ
    ok('看板にイベント名＋「山頂」を出す', past.summitTitle === 't山頂', past.summitTitle);
    ok('標高は数字と m だけ（ラベルを付けない）', /^\d+m$/.test(past.summitAlt || ''), past.summitAlt);
    // 完了8件 × 100m
    ok('標高＝完了数 × 100m', past.summitAlt === '800m', past.summitAlt);
    // ★イベントIDから決定的に選ぶ（全メンバーが同じ看板を見る）
    ok('★看板の絵は決定的（同じイベントなら必ず同じ）',
      build(8, 'ev1', ['2020-01-01']).summit[2] === past.summit[2]);
  }
  {
    // 2種類とも使われること（片方に固定されていない）
    const used = new Set();
    for (const ev of ['a','b','c','d','e','f','g','h']) {
      const r = build(3, ev, ['2020-01-01']);
      if (r.summit) used.add(r.summit[2]);
    }
    ok('看板は2種類とも出る（片方に固定されていない）', used.size === 2, [...used].join(', '));
  }
}
{
  const { canvasH, nodes } = build(8);
  ok(`マス i=0 の y = canvasH - BOTTOM_PAD(${BOTTOM_PAD})`, nodes[0] === canvasH - BOTTOM_PAD);
  ok(`マスの間隔が ${NODE_GAP}px で一定`,
    nodes.slice(1).every((y, i) => Math.round(nodes[i] - y) === NODE_GAP));
}

// ── [B] スクロールで最新のマスが手前まで来るか ────────────
section('[B] ★スクロールの届く範囲（基準は「最後の完了マス」）');
for (const done of [0, 5, 10, 20, 48]) {
  const w = wire(done, 0);
  const c = w.at(w.lastCleared);
  const gap = PANEL_TOP - c.screenY;
  // ★最後の**完了**マスがパネルのすぐ上（NEAR_MARGIN 付近）に来ていること。
  //   いちばん上のマスは未完了（次にやる灰色の1マス）なので、そこを基準にすると
  //   最後の完了マスがパネルの裏に隠れる＝報告された不具合になる。
  ok(`完了${String(done).padStart(2)} → 最後の完了マスがパネルの ${gap}px 上・倍率 ${c.scale.toFixed(2)}`,
    gap <= NEAR_MARGIN + 8 && c.scale > SCALE_MAX * 0.9, `gap=${gap} scale=${c.scale}`);
}
{
  // 灰色の1マスはその1つ上に見えていること（隠れも飛びもしない）
  const w = wire(20, 0);
  const g = w.at(w.newest), c = w.at(w.lastCleared);
  ok('次にやる灰色マスは、最後の完了マスの1つ上に見えている',
    g.screenY > HEADER && g.screenY < c.screenY && Math.round(c.screenY - g.screenY) === NODE_GAP,
    `灰色=${g.screenY} 完了=${c.screenY}`);
}
{
  const w = wire(20, 0);
  ok('★スペーサーが headroom ぶん伸びている（スクロール量が足りるように）',
    parseFloat(w.spacer.style.height) === w.canvasH + w.headroom,
    `${w.spacer.style.height} vs ${w.canvasH + w.headroom}`);
  ok('canvas に headroom が入っている', w.headroom > 0, String(w.headroom));
}

// ── [C] 遠近がスクロール連動か ────────────────────────────
section('[C] 遠近（大きさ・不透明度・振れ幅）が画面位置に連動する');
{
  // ★scrollTop=0（道の先端）では、最新マスより手前に置くものが無いので
  //   帯に1個しか出ない。それが正しい。連動の確認は中ほどまで送って行う。
  const w = wire(20, NODE_GAP * 3);
  const vals = w.canvas.children
    .map((el, i) => ({ ...w.at(i) }))
    .filter(v => v.screenY > HEADER && v.screenY < PANEL_TOP)
    .sort((a, b) => a.screenY - b.screenY);
  ok('画面内に複数のマスが出ている', vals.length >= 3, `${vals.length}個`);
  const inc = (key) => vals.every((v, i) => i === 0 || v[key] >= vals[i - 1][key] - 1e-6);
  ok('下ほど大きい', inc('scale'), vals.map(v => v.scale.toFixed(2)).join(' '));
  ok('下ほど濃い',   inc('opacity'), vals.map(v => v.opacity.toFixed(2)).join(' '));
  ok('下ほど大きく振れる（dx が 0 に近づく）',
    vals.every((v, i) => i === 0 || v.dx >= vals[i - 1].dx - 1e-6),
    vals.map(v => v.dx.toFixed(0)).join(' '));
  ok(`倍率が SCALE_MIN(${SCALE_MIN})〜SCALE_MAX(${SCALE_MAX}) に収まる`,
    vals.every(v => v.scale >= SCALE_MIN - 1e-6 && v.scale <= SCALE_MAX + 1e-6));
  ok(`不透明度が OPACITY_MIN(${OPACITY_MIN}) を下回らない（上端のフェードを除く）`,
    vals.every(v => v.opacity >= 0));
}
ok('★OPACITY_RANGE が 1 - OPACITY_MIN になっている',
  Math.abs(OPACITY_RANGE - (1 - OPACITY_MIN)) < 1e-9, `${OPACITY_RANGE} vs ${1 - OPACITY_MIN}`);

// ── [D] 背景の決定的導出 ──────────────────────────────────
section('[D] ★背景は保存せず決定的に導出する');
{
  const sig = (done, ev) => build(done, ev).parts.map(pt => `${pt.theme}/${pt.file}@${pt.y}`).join(',');

  const a1 = sig(40, 'evA');
  ok('同じイベント・同じ完了数なら必ず同じ', a1 === sig(40, 'evA'));
  // ★これが崩れると、1つ完了しただけで山全体が作り直される（シードに完了数を混ぜた形）
  ok('★完了が増えても既存の地形は動かない（上に足されるだけ）',
    sig(48, 'evA').startsWith(a1), 'seed に完了数やキャンバス高が混ざっている');
  ok('別イベントでは並びが変わる', a1 !== sig(40, 'evB'));

  const events = ['e1', 'e2', 'e3', 'x9', 'zz', '1782432300147'];
  const dupTheme = [], dupFile = [], dupColor = [];
  for (const ev of events) {
    const v = build(48, ev).parts;
    for (let i = 1; i < v.length; i++) {
      if (v[i].file === v[i - 1].file && v[i].theme === v[i - 1].theme) dupFile.push(`${ev}[${i}]`);
      if (colorOf(v[i]) === colorOf(v[i - 1]) && v[i].theme === v[i - 1].theme) dupColor.push(`${ev}[${i}]:${colorOf(v[i])}`);
    }
    // テーマは THEME_RUN 枚ごとの帯で替わる。隣り合う帯に同じテーマが入らないこと
    const bands = [];
    for (let i = 0; i < v.length; i += THEME_RUN) bands.push(v[i].theme);
    for (let i = 1; i < bands.length; i++) if (bands[i] === bands[i - 1]) dupTheme.push(`${ev}[帯${i}]:${bands[i]}`);
  }
  ok('★同じ地形が2回続けて出ない', dupFile.length === 0, dupFile.join(' '));
  // ★色が続くと「登ったのに景色が変わらない」ように見える。色の無いテーマは通し番号で代用
  ok('★同じ色が2回続けて出ない', dupColor.length === 0, dupColor.slice(0, 5).join(' '));
  ok('★隣り合う帯に同じテーマが入らない', dupTheme.length === 0, dupTheme.join(' '));

  // 帯が実際に切り替わっている（THEME_RUN が効いていて1テーマに固まっていない）
  const themesUsed = new Set(build(48, 'e1').parts.map(pt => pt.theme));
  ok('長い山では複数テーマが登場する', BG_THEMES.length < 2 || themesUsed.size >= 2,
    [...themesUsed].join(','));

  // ★決定性の根拠。1つでも混ざると全員が違う景色を見る
  ok('★実装に Math.random / Date.now が現れない',
    !/Math\.random|Date\.now/.test(srcCode));

  ok('背景レイヤーがキャンバスの最初の子（最背面）',
    /class="p-mountain__canvas"[^>]*>\s*<div class="p-mountain__bg-layer"/.test(build(8).html));
}

// ── 退行チェック ──────────────────────────────────────────
section('[E] 退行していないこと');
{
  ok('完了0でもエラーにならない', build(0).nodes.length === 1);
  ok('★マスは「完了数 + 先の1マス」', build(7).nodes.length === 8 && build(20).nodes.length === 21);
  ok('★未完了を足してもマス数が変わらない', build(7).nodes.length === 8);
  const before = winListeners.length;
  wire(10, 0); wire(10, 0); wire(10, 0);
  ok('再描画で window リスナーが積み上がらない', winListeners.length === before, `${before} → ${winListeners.length}`);
  const w = wire(20, 300);
  ok('restoreTop がそのまま反映される', w.win.scrollTop === 300, String(w.win.scrollTop));
  ok('★scroll ハンドラから直接 DOM を触っていない（rAF 経由）',
    /addEventListener\('scroll', request/.test(src) && /requestAnimationFrame\(paint\)/.test(src));
  // ★素材px → 画面px の換算を書いていいのは2箇所だけ：
  //     measure()             … メインタブ。初回と resize のときだけ
  //     syncMountainBackdrop() … アーカイブ・通知タブ（スクロール窓が無い）
  //   ★paint() に足すと毎フレーム全パーツのレイアウトが起きて 0.5CPU 環境が落ちる。
  const measureBody = src.slice(src.indexOf('const measure = () =>'), src.indexOf('const paint = () =>'));
  const paintBody = src.slice(src.indexOf('const paint = () =>'), src.indexOf('const request = () =>'));
  const backdropBody = src.slice(src.indexOf('export function syncMountainBackdrop'),
    src.indexOf('export function initMountainPathSync'));
  const artWrites = [...srcCode.matchAll(/--art-unit/g)].length;
  // ★0 を書くと全ての地形が height:0 / bottom:0 になり、マスだけ残して背景が
  //   丸ごと消える。CSS 側に初期値があるので、測れないときは書かないのが正解。
  ok('★幅が測れないときは --art-unit を書かない（背景が丸ごと消えるのを防ぐ）',
    /if \(canvasW > 0\) canvas\.style\.setProperty\('--art-unit'/.test(srcCode));
  ok('★syncMountainBackdrop 側にも同じガードがある',
    /if \(w > 0\) canvas\.style\.setProperty\('--art-unit'/.test(srcCode));

  ok('★--art-unit を paint() で書いていない（毎フレームのレイアウトを起こさない）',
    !/--art-unit/.test(paintBody));
  ok('★--art-unit の書き込みは measure() と syncMountainBackdrop() の2箇所だけ',
    /--art-unit/.test(measureBody) && /--art-unit/.test(backdropBody) && artWrites === 2,
    `書き込み ${artWrites} 箇所`);
  ok('★スクロール中に width/height/top を書き換えていない',
    !/style\.(width|height|top|left)\s*=/.test(src.slice(src.indexOf('const paint = () =>'), src.indexOf('const request = () =>'))));
}

// ── [F] 植物 ──────────────────────────────────────────────
// ★横をスロットに等分して1個ずつ置く設計なので、重ならないことは「構成上」保証される。
//   ここではその保証が実際に守られているかを、素材px の矩形で突き合わせる。
section('[F] 植物が重ならず、設定の範囲に収まる');
{
  const events = ['e1', 'e2', 'e3', 'x9', 'zz'];
  const overlap = [], outRange = [], outBox = [], hiddenPlanted = [];
  let total = 0, planted = 0;

  for (const ev of events) {
    const parts = build(48, ev).parts;
    for (let k = 0; k < parts.length; k++) {
      const pt = parts[k];
      const cfg = themeCfg(pt.theme).WorldSpawnedObjects;   // ★使わないテーマは null
      total += pt.plants.length;
      if (pt.plants.length) planted++;

      // ★手前の地形の上端より上にはみ出したぶんが、この地形の見える帯。
      //   ほとんど見えていない地形に植えても隠れるだけなので、植えない。
      const prev = parts[k - 1];
      const strip = prev ? (pt.y + pt.h) - (prev.y + prev.h) : pt.h;
      if (pt.plants.length && strip < PLANT_MIN_STRIP) hiddenPlanted.push(`${ev}[${k}] 帯${strip}`);

      if (cfg && pt.plants.length > cfg.countMax) outRange.push(`${ev} ${pt.theme} ${pt.plants.length}個`);
      for (const pl of pt.plants) {
        if (cfg && (pl.w > cfg.sizeMax || pl.w < Math.min(cfg.sizeMin, pl.w))) outRange.push(`${ev} w=${pl.w}`);
        // 素材の外へはみ出していないか（左右）
        if (pl.x < 0 || pl.x + pl.w > ART_W) outBox.push(`${ev} x=${pl.x} w=${pl.w}`);
        // 根元が地形の中にあるか
        if (pl.y < 0 || pl.y > pt.h) outBox.push(`${ev} y=${pl.y} h=${pt.h}`);
      }
      // 同じ地形の植物どうしが重ならない（横の区間で判定）
      const xs = pt.plants.map(pl => [pl.x, pl.x + pl.w]).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < xs.length; i++) if (xs[i][0] < xs[i - 1][1]) overlap.push(`${ev} ${xs[i - 1]}∩${xs[i]}`);
    }
  }

  ok('★同じ地形の植物どうしが重ならない', overlap.length === 0, overlap.slice(0, 3).join(' '));
  ok(`★ほとんど隠れている地形（見える帯 ${PLANT_MIN_STRIP} 未満）には植えない`,
    hiddenPlanted.length === 0, hiddenPlanted.slice(0, 3).join(' '));
  ok('個数・大きさがテーマ設定の範囲に収まる', outRange.length === 0, outRange.slice(0, 3).join(' '));
  ok('素材の枠からはみ出さない（左右・根元）', outBox.length === 0, outBox.slice(0, 3).join(' '));
  ok('植物が実際に生えている', total > 0, `${total}本`);
  console.log(`     （${events.length}イベント × 完了48 で 地形に植えた ${planted} 枚 / 植物 ${total} 本）`);

  // 素材の無いテーマでは1本も出さない
  const noPlant = BG_THEMES.filter(t => (BG_ASSETS[t.id]?.WorldSpawnedObjects || []).length === 0).map(t => t.id);
  const stray = build(48, 'e1').parts.filter(pt => noPlant.includes(pt.theme) && pt.plants.length);
  ok('素材の無いテーマには植えない', stray.length === 0,
    noPlant.length ? `対象: ${noPlant.join(',')}` : '（対象テーマなし）');

  // 総数の上限。要素数が増えるとスクロールの合成コストが効く
  for (const ev of events) {
    const c = build(48, ev).parts.reduce((s2, pt) => s2 + pt.plants.length, 0);
    if (c > MAX_PLANTS) outBox.push(`${ev} ${c}本`);
  }
  ok(`植物の総数が上限 ${MAX_PLANTS} を超えない`,
    events.every(ev => build(48, ev).parts.reduce((s2, pt) => s2 + pt.plants.length, 0) <= MAX_PLANTS));

  // 決定的であること
  const sigP = (ev) => build(40, ev).parts.map(pt => pt.plants.map(pl => `${pl.file}@${pl.x},${pl.y},${pl.w}`).join('|')).join(';');
  ok('★植物も決定的（同じイベントなら必ず同じ）', sigP('evA') === sigP('evA'));
  ok('別イベントでは植わり方が変わる', sigP('evA') !== sigP('evB'));
  ok('植物は先読みしない（全部 lazy）',
    build(20).parts.every(pt => pt.plants.every(pl => pl.loading === 'lazy')));

  // ★every で間引けていること。地形1枚ごとに植えると1イベント100本超の密林になる
  //   （実際にそうなって作り直した）。全部の地形に植わっていたら効いていない。
  const p48 = build(48, 'e1').parts;
  const withPlants = p48.filter(pt => pt.plants.length).length;
  ok('★every で間引けている（全部の地形には植えない）',
    withPlants < p48.length * 0.6, `${withPlants}/${p48.length} 枚に植わっている`);

  // ★間引きは「候補の並び」で行う。生の通し番号でやると、選ばれた地形が
  //   たまたま隠れていたときに長い区間まるごと植物が消える。
  //   ★草木を使わないテーマ（WorldSpawnedObjects が空）の帯は、まるごと植物ゼロに
  //     なるのが正しい（雪山に草は生えない）。帯の長さは THEME_RUN なので、
  //     そのぶんは許容する。ここを短くすると、テーマを足すたびにテストが落ちる。
  const gaps = [];
  let run = 0;
  for (const pt of p48) { run = pt.plants.length ? 0 : run + 1; gaps.push(run); }
  const gapLimit = THEME_RUN + 4;
  ok(`植物の無い区間が長く続かない（草木なしテーマの帯 ${THEME_RUN} 枚ぶんは許容）`,
    Math.max(...gaps) <= gapLimit, `最長 ${Math.max(...gaps)} 枚 / 上限 ${gapLimit}`);

  // 設定で完全に止められること
  {
    const saved = BG_THEMES.map(t => t.WorldSpawnedObjects);
    try {
      BG_THEMES.forEach(t => { t.WorldSpawnedObjects = null; });
      ok('★WorldSpawnedObjects: null のテーマには1本も植えない',
        build(48, 'e1').parts.every(pt => pt.plants.length === 0));
      BG_THEMES.forEach((t, i) => { t.WorldSpawnedObjects = saved[i] && { ...saved[i], every: 0 }; });
      ok('every: 0 でも止まる（0 除算・全枚数に植える事故を防ぐ）',
        build(48, 'e1').parts.every(pt => pt.plants.length === 0));
    } finally {
      BG_THEMES.forEach((t, i) => { t.WorldSpawnedObjects = saved[i]; });   // ★必ず戻す
    }
    ok('（後始末）設定を元に戻せている', build(48, 'e1').parts.some(pt => pt.plants.length));
  }

  // ★横位置が「等分スロットに1本ずつ」に戻っていないこと。
  //   スロット方式は重なりこそ起きないが、左・中・右にきれいに並んで
  //   **横一列に見える**（実際にそうなって作り直した）。
  //   スロット方式なら「1本目は必ず左寄り」になるので、そこを突く。
  const firstXs = [];
  for (const ev of [...events, 'q1', 'q2', 'q3', 'q4']) {
    for (const pt of build(48, ev).parts) {
      if (pt.plants.length >= 2) firstXs.push(pt.plants[0].x);
    }
  }
  ok('★横位置が等分スロットに戻っていない（1本目が左寄りに固定されない）',
    firstXs.length > 0 && firstXs.some(x => x > ART_W / 2),
    `1本目の x: ${firstXs.slice(0, 8).join(', ')}`);

  // 隙間。0 だと葉が触れて1本の茂みに見える
  const tight = [];
  for (const ev of events) {
    for (const pt of build(48, ev).parts) {
      const xs = pt.plants.map(pl => [pl.x, pl.x + pl.w]).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < xs.length; i++) {
        if (xs[i][0] - xs[i - 1][1] < PLANT_GAP) tight.push(`${ev} すき間${xs[i][0] - xs[i - 1][1]}`);
      }
    }
  }
  ok(`★植物どうしに ${PLANT_GAP} 素材px 以上のすき間がある`, tight.length === 0, tight.slice(0, 3).join(' '));

  // ★縦位置も1本ごとに散っていること。同じ高さに並ぶとそれだけで横一列に見える
  const flat = [];
  for (const ev of events) {
    for (const pt of build(48, ev).parts) {
      if (pt.plants.length >= 2) {
        const ys = pt.plants.map(pl => pl.y);
        if (Math.max(...ys) - Math.min(...ys) < 20) flat.push(`${ev} ${ys.join('/')}`);
      }
    }
  }
  ok('★同じ地形の植物が同じ高さに並ばない', flat.length === 0, flat.slice(0, 3).join(' '));

  // 密度。「地形2〜4枚に1本」を目安にしている
  const density = total / events.length / (build(48, 'e1').parts.length || 1);
  ok('★密度が「地形2〜4枚に1本」の範囲に収まる', density >= 0.2 && density <= 0.55,
    `地形1枚あたり ${density.toFixed(2)} 本`);

  console.log(`     （完了48 で 地形 ${p48.length} 枚 / 植えた ${withPlants} 枚 / 植物 ${total / events.length | 0} 本 = 地形 ${(1 / density).toFixed(1)} 枚に1本）`);
}

// ── [G] 横に流れる要素（雲）──────────────────────────────
// ★動く要素は合成レイヤーになるので、数がそのままメモリと合成コストになる。
//   0.5CPU / 512MB 環境が基準なので、総数の上限は必ず守られていること。
section('[G] 雲が上限を守り、地形の裏を正しい向きに流れる');
{
  const events = ['e1', 'e2', 'e3', 'x9', 'zz'];
  const over = [], badZ = [], badDir = [], badPhase = [];

  for (const ev of events) {
    const { parts, clouds } = build(48, ev);
    if (clouds.length > MAX_DRIFT) over.push(`${ev} ${clouds.length}個`);

    const zs = parts.map(pt => pt.z);
    for (const c of clouds) {
      // ★地形の「間」に挟まること（z が奇数＝地形の偶数 z の間）
      if (c.z % 2 !== 1) badZ.push(`${ev} z=${c.z}`);
      if (c.z > Math.max(...zs) || c.z < Math.min(...zs) - 1) badZ.push(`${ev} 範囲外 z=${c.z}`);

      // 端から端まで抜けきる（入れ物の幅 = ART_W）
      const passes = (c.x0 === ART_W && c.x1 === -c.w) || (c.x0 === -c.w && c.x1 === ART_W);
      if (!passes) badDir.push(`${ev} ${c.x0}→${c.x1} w=${c.w}`);

      // ★負の delay で開始位相がずれていること（0 に揃うと全部同時に横切る）
      if (!(c.delay <= 0 && -c.delay < c.dur)) badPhase.push(`${ev} delay=${c.delay} dur=${c.dur}`);
    }
  }
  ok(`★総数が上限 ${MAX_DRIFT} を超えない`, over.length === 0, over.join(' '));
  ok('★地形の「間」の z に入る（道とマスに被らない）', badZ.length === 0, badZ.slice(0, 3).join(' '));
  ok('端から端まで抜けきる（途中で消えない）', badDir.length === 0, badDir.slice(0, 3).join(' '));
  ok('★開始位相が雲ごとにずれている（負の delay）', badPhase.length === 0, badPhase.slice(0, 3).join(' '));

  // 設定した向きに従う
  const dirBad = [];
  for (const ev of events) {
    const { parts, clouds } = build(48, ev);
    for (const c of clouds) {
      // 高さから所属する地形を引き当て、そのテーマの dir と突き合わせる
      const owner = parts.filter(pt => pt.y + pt.h <= c.y).at(-1) || parts[0];
      const dir = themeCfg(owner.theme).cloud.dir;
      const rtl = c.x0 === ART_W;
      if (dir === 'rtl' && !rtl) dirBad.push(`${ev} rtl設定なのに左→右`);
      if (dir === 'ltr' && rtl) dirBad.push(`${ev} ltr設定なのに右→左`);
    }
  }
  ok('テーマの dir 設定に従って流れる', dirBad.length === 0, dirBad.slice(0, 3).join(' '));

  // 'both' のテーマでは両方向が出る（片方に偏っていない）
  const bothThemes = BG_THEMES.filter(t => t.cloud?.dir === 'both').map(t => t.id);
  if (bothThemes.length) {
    const dirs = new Set();
    for (const ev of ['e1', 'e2', 'e3', 'x9', 'zz', 'q1', 'q2', 'q3']) {
      for (const c of build(48, ev).clouds) dirs.add(c.x0 === ART_W ? 'rtl' : 'ltr');
    }
    ok("dir:'both' のテーマでは両方向が出る", dirs.size === 2, [...dirs].join(','));
  }

  // 決定的であること
  const sigC = (ev) => build(40, ev).clouds.map(c => `${c.file}@${c.y},${c.dur},${c.delay}`).join(',');
  ok('★雲も決定的（同じイベントなら必ず同じ）', sigC('evA') === sigC('evA'));
  ok('別イベントでは流れ方が変わる', sigC('evA') !== sigC('evB'));

  // ★雲を出さない書き方が本当に効くか。ここが効かないと、テーマ設定で
  //   雲を切ったつもりでも出続ける（調整ファイルのコメントで約束していること）。
  //   BG_THEMES は実装と同じモジュール実体なので、一時的に差し替えて確かめられる。
  {
    const saved = BG_THEMES.map(t => t.cloud);
    try {
      BG_THEMES.forEach(t => { t.cloud = null; });
      ok("★cloud: null のテーマでは雲を1つも出さない", build(48, 'e1').clouds.length === 0);

      BG_THEMES.forEach((t, i) => { t.cloud = { ...saved[i], dir: null }; });
      ok("dir: null でも止まる（後方互換）", build(48, 'e1').clouds.length === 0);

      BG_THEMES.forEach((t, i) => { t.cloud = { ...saved[i], every: 0 }; });
      ok('every: 0 でも止まる（0 除算・全枚数に出す事故を防ぐ）', build(48, 'e1').clouds.length === 0);
    } finally {
      BG_THEMES.forEach((t, i) => { t.cloud = saved[i]; });   // ★必ず戻す（後続の検証が狂う）
    }
    ok('（後始末）設定を元に戻せている', build(48, 'e1').clouds.length > 0);
  }

  const n = build(48, 'e1').clouds.length;
  console.log(`     （完了48 で雲 ${n} 個 / 上限 ${MAX_DRIFT}）`);
}

// ── [L] 背景としてだけ見せるモード ────────────────────────
// ★アーカイブ・通知タブでも山を出したままにする（タブを移っても同じ場所に
//   居る感じを保つため）。ただしスクロール窓が無いタブなので、遠近を毎フレーム
//   書く paint() が動かない。マスを出すと等倍・不透明のまま並んでしまう。
section('[L] backdrop モードは景色だけを出す');
{
  const main = build(20, 'evA');
  const back = build(20, 'evA', [], { backdrop: true });

  ok('★backdrop ではマス（道）を出さない', back.nodes.length === 0, `${back.nodes.length}個`);
  ok('（対比）メインタブではマスを出す', main.nodes.length > 0);
  ok('景色（地形・植物・雲）はメインタブと同じだけ出る',
    back.parts.length === main.parts.length && back.clouds.length === main.clouds.length);

  // ★署名が同じであること。タブを移っても背景の DOM を使い回せる
  //   （マスは bg-layer の外なので、backdrop でも中身は変わらない）
  ok('★署名が同じ（タブをまたいで背景 DOM を使い回せる）', back.sig === main.sig,
    `${main.sig} vs ${back.sig}`);

  ok('白いベールを重ねる目印が付く', /class="p-mountain p-mountain--backdrop"/.test(back.html));
  ok('（対比）メインタブには付かない', !/p-mountain--backdrop/.test(main.html));

  ok('ミッション0件の案内文も出さない（背景に文字を載せない）',
    !/p-mountain__empty/.test(build(0, 'evA', [], { backdrop: true }).html));

  // スクロール窓が無いタブ用の軽い配線が公開されていること
  ok('syncMountainBackdrop が公開されている', typeof M.syncMountainBackdrop === 'function');
}

// ── [K] SSE 再描画での使い回し ────────────────────────────
// ★mainBoard.js は SSE のたび innerHTML を丸ごと差し替える。背景の <img> は
//   200 個近くあるので、素直に作り直すと毎回すべて再デコードされて一瞬白くなる。
//   署名が同じときだけ元の DOM に差し戻す仕組みなので、**署名が正しく変わること**が要。
//   ここが鈍いと、中身が変わったのに古い背景が残り続ける。
section('[K] 背景の使い回しの署名が、中身の変化を取りこぼさない');
{
  ok('同じ内容なら署名も同じ', build(20, 'evA').sig === build(20, 'evA').sig);
  ok('別イベントでは署名が変わる', build(20, 'evA').sig !== build(20, 'evB').sig);

  // ★枚数が変わる＝山が伸びた。使い回すと上端に背景の無い帯ができる
  const a = build(8, 'evA'), b = build(48, 'evA');
  ok('★地形の枚数が変われば署名が変わる',
    a.parts.length === b.parts.length || a.sig !== b.sig, `${a.sig} vs ${b.sig}`);

  // ★山頂の有無が変わる＝開催日を過ぎた。使い回すと山頂が出ない
  const before = build(20, 'evA', ['2099-01-01']);
  const after = build(20, 'evA', ['2020-01-01']);
  ok('★山頂の有無が変われば署名が変わる', before.sig !== after.sig, `${before.sig} vs ${after.sig}`);
  ok('（前提）山頂の有無が実際に変わっている',
    (before.summit === null) !== (after.summit === null));

  // 使い回しの入口と出口が両方 export されていること（片方だけだと退避したまま漏れる）
  ok('captureBgLayer / restoreBgLayer が対で公開されている',
    typeof M.captureBgLayer === 'function' && typeof M.restoreBgLayer === 'function');
  ok('★退避した参照を必ず手放している（大きな部分木を抱え込まない）',
    /_bgKeep = null;/.test(srcCode.slice(srcCode.indexOf('export function restoreBgLayer'))));
}

// ── [M] 書き出し解像度からの独立 ──────────────────────────
// ★素材を何px 幅で書き出しても同じ景色になること。これがあるから、通信量と
//   デコード量を減らすために解像度を下げられる（1枚のデコード量は幅の2乗に効く）。
//   配置は ART_W に正規化した高さ（_artHeight）だけで決めること。
//   マニフェストの実ピクセル値をそのまま使うと、解像度を下げた瞬間に山が縮む。
section('[M] 素材の書き出し解像度を変えても景色が変わらない');
{
  const sig = (html) => [...html.matchAll(/--lf-y:(\d+);--lf-h:(\d+)/g)].map(m => [+m[1], +m[2]]);
  const before = sig(build(48).html);

  // 900px 幅で書き出し直した想定でマニフェストを差し替える
  const saved = [];
  for (const t of Object.values(BG_ASSETS)) {
    for (const a of t.landform) { saved.push([a, a.w, a.h]); }
  }
  try {
    for (const [a] of saved) { const k = 900 / a.w; a.h = Math.round(a.h * k); a.w = 900; }
    const after = sig(build(48).html);

    ok('枚数が変わらない', before.length === after.length, `${before.length} vs ${after.length}`);
    // ★位置は完全一致でなければならない（ここがずれると地形の間に隙間が出る）
    const posBad = before.filter((b, i) => b[0] !== after[i]?.[0]).length;
    ok('★地形の位置が完全に一致する', posBad === 0, `${posBad}枚ずれた`);
    // 高さは二重の丸めで ±2 art px 動きうる（画面上 0.2px 未満）。実害は無い
    const hBad = before.filter((b, i) => Math.abs(b[1] - (after[i]?.[1] ?? 0)) > 2);
    ok('高さの差が丸め誤差（±2 素材px）に収まる', hBad.length === 0,
      hBad.slice(0, 3).map((b, i) => `${b[1]}→${after[i]?.[1]}`).join(' '));
  } finally {
    for (const [a, w, h] of saved) { a.w = w; a.h = h; }   // ★必ず戻す
  }
  ok('（後始末）マニフェストを元に戻せている',
    sig(build(48).html).every((v, i) => v[0] === before[i][0] && v[1] === before[i][1]));

  // ★実装が実ピクセルを直に使っていないこと
  ok('★配置に _artHeight（正規化）を通している', /h: a\.h[,}]/.test(srcCode) === false);
}

// ── [J] 読み込み ──────────────────────────────────────────
// ★ここは3回作り直した箇所。設計を変えるときは mountainPath.js の「読み込み」節を読むこと。
//   1. <img loading="lazy">        … transform で動くキャンバスの中では発火しない端末があり、
//                                     マスだけ出て絵が1枚も出ない
//   2. JS で見えているぶんを eager … 解放しないとデコード済みが積み上がり、
//                                     スクロール中にタブごと落ちる（1枚 約12.8MB）
//   3. 枚数に上限を付けて解放      … 解放したところが白く抜ける
//   → background-image に戻した。ブラウザが描画時にだけラスタライズし、
//     画面外のデコード結果は自分で捨てる。JS 側の管理は持たない。
section('[J] 地形は background-image（読み込み管理を JS に持たない）');
{
  const html = build(48).html;

  ok('★地形を <img> で出していない（上の1〜3を踏み直さないため）',
    !/class="p-mountain__lf-img"/.test(html));
  ok('地形の絵を --lf-img（background-image）で渡している',
    /--lf-img:url\('\/images\/bg\/[^']+'\)/.test(html));

  // ★JS 側に読み込み管理を持たないこと。持つと必ず上の2か3に落ちる
  const banned = ['MAX_LOADED', 'EAGER_COUNT', '_lfEls', 'loadVisible', '_loadAround', '_loadRange'];
  const alive = banned.filter(w => new RegExp(`\\b${w}\\b`).test(srcCode));
  ok('★JS に読み込み管理の残骸が無い', alive.length === 0, alive.join(', '));

  ok("★loading 属性で地形を出し分けていない", !/loading="\$\{eager/.test(src));

  // 植物と雲は軽い SVG なので lazy のままでよい
  ok('植物・雲は lazy のまま（軽い SVG なのでブラウザ任せでよい）',
    /class="p-mountain__plant"[\s\S]*?loading="lazy"/.test(html) &&
    /class="p-mountain__cloud"[\s\S]*?loading="lazy"/.test(html));

  // ★通信量の目安。素材の解像度が過剰だとここが膨らむ
  const lfAll = Object.values(BG_ASSETS).flatMap(t => t.landform);
  const avgPx = lfAll.reduce((acc, a) => acc + a.w * a.h, 0) / lfAll.length;
  const parts = build(48).parts.length;
  console.log(`     （完了48：地形 ${parts} 枚。1枚のデコード量 ${(avgPx * 4 / 1024 / 1024).toFixed(1)}MB`
    + ` … 表示幅は最大 448px なので素材 ${Math.round(Math.sqrt(avgPx * 2049 / 1481))}px 幅は過剰）`);
}

// ── 生成マニフェスト ──────────────────────────────────────
// ★背景をパーツから組み立てるには、JS が素材の枚数だけでなく「1枚ごとの高さと色」を
//   知る必要がある。CSS 変数にはそれを載せられないので、生成物に持たせている。
//   その代わり **生成物が実ファイルとずれていないこと**をここで担保する。
section('[H] ★生成マニフェストが実ファイルと一致する');
{
  const BG_DIR = path.join(ROOT, 'public/images/bg');
  const assetsSrc = path.join(ROOT, 'public/js/mountainAssets.generated.js');
  const themesSrc = path.join(ROOT, 'public/js/mountainThemes.js');

  const { BG_ASSETS, BG_SHARED } = await import(pathToFileURL(assetsSrc).href);
  const { BG_THEMES } = await import(pathToFileURL(themesSrc).href);

  const listOnDisk = (dir) => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => !f.startsWith('.') && /\.(webp|svg)$/.test(f)).sort()
    : [];

  // マニフェストの各層が、ディスクの中身とちょうど一致すること
  let mismatch = null;
  const allEntries = [];
  for (const [theme, layers] of Object.entries(BG_ASSETS)) {
    for (const [layer, list] of Object.entries(layers)) {
      const disk = listOnDisk(path.join(BG_DIR, theme, layer));
      const manifest = list.map(a => a.f).sort();
      if (disk.join('|') !== manifest.join('|')) mismatch ||= `${theme}/${layer}: disk ${disk.length} / manifest ${manifest.length}`;
      for (const a of list) allEntries.push({ ...a, dir: path.join(BG_DIR, theme, layer), theme, layer });
    }
  }
  for (const [name, list] of Object.entries(BG_SHARED)) {
    const disk = listOnDisk(path.join(BG_DIR, name));
    const manifest = list.map(a => a.f).sort();
    if (disk.join('|') !== manifest.join('|')) mismatch ||= `${name}: disk ${disk.length} / manifest ${manifest.length}`;
    for (const a of list) allEntries.push({ ...a, dir: path.join(BG_DIR, name), theme: null, layer: name });
  }
  ok('マニフェストとディスクの内容が一致する（生成し直し忘れが無い）', !mismatch, mismatch || '');
  ok('全エントリの実ファイルが存在する',
    allEntries.every(a => fs.existsSync(path.join(a.dir, a.f))));
  ok('全エントリが幅・高さを持つ',
    allEntries.every(a => a.w > 0 && a.h > 0));

  // ★「JS にファイル名・拡張子を書かない」規約。趣旨は**人間が手保守しないこと**なので、
  //   生成物は対象外、手書きの2ファイルだけを見る。
  const handWritten = [SRC_PATH, themesSrc];
  const dirty = handWritten.filter(f => /\.webp|\.svg|images\/bg/.test(codeOnly(fs.readFileSync(f, 'utf8'))));
  ok('★手書きの JS に素材のファイル名・拡張子・パスが出てこない', dirty.length === 0,
    dirty.map(f => path.relative(ROOT, f)).join(', '));

  // 素材の前提：下 LF_OVERLAP px が塗り潰しの余白。これより低い地形があると重ねられない
  const landforms = allEntries.filter(a => a.layer === 'landform');
  const tooShort = landforms.filter(a => a.h <= LF_OVERLAP);
  ok(`★全 landform の高さが重ねしろ(${LF_OVERLAP})を超える`, tooShort.length === 0,
    tooShort.map(a => `${a.f} h=${a.h}`).join(', '));

  // テーマ設定と素材フォルダの対応。どちらかにしか無いと黙って使われない
  const cfgIds = BG_THEMES.map(t => t.id).sort();
  const assetIds = Object.keys(BG_ASSETS).sort();
  ok('★テーマ設定と素材フォルダが1対1で対応する', cfgIds.join('|') === assetIds.join('|'),
    `設定 [${cfgIds}] / 素材 [${assetIds}]`);

  // 送りが重ねしろを超えると地形の間に隙間が空く（調整ファイルのコメントで約束していること）
  const bad = BG_THEMES.filter(t => !(t.landform.advanceMin > 0 && t.landform.advanceMin <= t.landform.advanceMax && t.landform.advanceMax <= LF_OVERLAP));
  ok(`★全テーマの送りが 0 < min ≤ max ≤ ${LF_OVERLAP} に収まる`, bad.length === 0,
    bad.map(t => `${t.id} ${t.landform.advanceMin}-${t.landform.advanceMax}`).join(', '));

  // 調整ファイルは端末px を持ち込まない（持ち込むと端末ごとに景色が変わる）
  ok('★調整ファイルに画面単位（vh/vw/px）が書かれていない',
    !/\d\s*(vh|vw|px)\b/.test(codeOnly(fs.readFileSync(themesSrc, 'utf8'))));

  // ── 素材そのもの ────────────────────────────────────────
  section('[I] 素材が健全である');
  const MAX_KB = 500;
  const heavy = allEntries.filter(a => fs.statSync(path.join(a.dir, a.f)).size > MAX_KB * 1024);
  ok(`1枚あたり ${MAX_KB}KB 以下`, heavy.length === 0,
    heavy.map(a => `${a.f} ${(fs.statSync(path.join(a.dir, a.f)).size / 1024 | 0)}KB`).join(', '));

  const wide = allEntries.filter(a => a.w > ART_W);
  ok(`幅が ${ART_W}（座標系の基準）を超えない`, wide.length === 0,
    wide.map(a => `${a.f} w=${a.w}`).join(', '));

  // ★landform は「同じ色を続けない」ために色サフィックスが要る。1枚でも
  //   命名規則を外すと、その1枚だけが色の連続判定から外れて静かに抜ける。
  //   実際に2回踏んだ：通し番号の無い `<テーマ>-landform-TeaGreen.webp` と、
  //   一括改名から漏れた `<テーマ>-landform-38-MintGreen.webp`。
  //   ★色は**全テーマ共通の1文字**（a / b / c …）で分類する取り決め。
  //     `[A-Za-z]+` まで許すと旧来の色名が素通りするので、1文字だけを通す。
  const lfNamed = landforms.filter(a => !/-\d{2,}-[a-z]\.webp$/.test(a.f));
  ok('★landform の名前が <テーマ>-landform-NN-<a|b|c…>.webp になっている',
    lfNamed.length === 0, lfNamed.map(a => a.f).join(', '));
  ok('★全 landform に色が読めている（色の連続判定から漏れない）',
    landforms.every(a => a.c), landforms.filter(a => !a.c).map(a => a.f).join(', '));

  // 通し番号の重複（同じ番号が2枚あると、どちらかが意図せず二重に出る）
  const byTheme = {};
  for (const a of landforms) (byTheme[a.theme] ||= []).push(a.n);
  const dupN = Object.entries(byTheme)
    .flatMap(([t, ns]) => ns.filter((x, i) => ns.indexOf(x) !== i).map(x => `${t}-${x}`));
  ok('landform の通し番号が重複していない', dupN.length === 0, dupN.join(', '));

  // ★過去に cloud のファイル名へ改行文字が混入し、URL にできない状態だった。その再発防止。
  const badName = allEntries.filter(a => !/^[A-Za-z0-9._-]+$/.test(a.f));
  ok('★ファイル名が [A-Za-z0-9._-] だけでできている（改行・空白の混入なし）',
    badName.length === 0, badName.map(a => JSON.stringify(a.f)).join(', '));

  const totalMB = allEntries.reduce((s, a) => s + fs.statSync(path.join(a.dir, a.f)).size, 0) / 1024 / 1024;
  console.log(`     （素材 ${allEntries.length} 件 / 合計 ${totalMB.toFixed(1)}MB）`);
}

console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
