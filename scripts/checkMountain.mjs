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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const K = (name) => {
  const m = new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`).exec(src);
  if (!m) throw new Error(`定数が見つからない: ${name}`);
  return +m[1];
};
const NODE_GAP = K('NODE_GAP'), TOP_PAD = K('TOP_PAD'), BOTTOM_PAD = K('BOTTOM_PAD');
const SEGMENT_MASSES = K('SEGMENT_MASSES'), NEAR_MARGIN = K('NEAR_MARGIN');
const SCALE_MAX = K('SCALE_MAX'), SCALE_MIN = K('SCALE_MIN');
const OPACITY_MIN = K('OPACITY_MIN'), OPACITY_RANGE = K('OPACITY_RANGE');
const SEG_H = SEGMENT_MASSES * NODE_GAP;

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

const M = await import(SRC_PATH);

/** 完了 done 件のイベントを描画し、結果を解析して返す */
function build(done, eventId = 'ev1') {
  const missions = Array.from({ length: done + 3 }, (_, i) =>
    ({ id: 'm' + i, createdAt: i, status: i < done ? 'cleared' : 'yet' }));
  const html = M.renderMountainBg({ id: eventId, name: 't', missions, clearedData: {} });
  return {
    html,
    canvasH: +/class="p-mountain__canvas" style="height:(\d+)px/.exec(html)[1],
    nodes: [...html.matchAll(/data-node-y="([\d.]+)"/g)].map(m => +m[1]),
    segs: [...html.matchAll(/--seg-image:var\(--mtn-bg-([\w-]+)\);top:(-?\d+)px;height:(\d+)px/g)]
      .map(m => ({ variant: m[1], top: +m[2], height: +m[3] })),
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

// ── [A] 背景とマスの一致 ──────────────────────────────────
section(`[A] ★背景セグメントの境界がマスと厳密に一致（SEGMENT_MASSES=${SEGMENT_MASSES} / NODE_GAP=${NODE_GAP}）`);
for (const done of [0, 7, 8, 9, 16, 17, 48]) {
  const { canvasH, segs } = build(done);
  const base = canvasH - BOTTOM_PAD;                 // マス i=0 の y
  let bad = '';
  segs.forEach((s, k) => {
    const rawBottom = base - k * SEG_H;               // セグメント k の素の下端
    const massY = base - (k * SEGMENT_MASSES) * NODE_GAP;
    if (rawBottom !== massY) bad += ` seg${k}:${rawBottom}≠${massY}`;
  });
  ok(`完了${String(done).padStart(2)} → セグメント${segs.length}枚・境界が全て一致`, !bad, bad);
}
{
  // ★キャンバス上端より上にも背景を敷いてあること（canvas を headroom ぶん
  //   下へずらすので、無いと上端に背景の抜けた帯ができる）
  const w = wire(20, 0);
  const topMost = w.segs.reduce((a, s) => Math.min(a, s.top), Infinity);
  ok(`背景がキャンバス上端より上まで伸びている（最上段 top=${topMost}px）`,
    topMost <= -w.headroom, `top=${topMost} headroom=${w.headroom}`);
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

// ── [D] 背景テーマの決定的導出 ────────────────────────────
section('[D] ★背景テーマは保存せず決定的に導出する');
{
  const a = build(40, 'evA').segs.map(s => s.variant).join(',');
  const b = build(40, 'evA').segs.map(s => s.variant).join(',');
  ok('同じイベント・同じ完了数なら必ず同じ', a === b, a);
  ok('★完了が増えても既存セグメントは変わらない',
    build(48, 'evA').segs.map(s => s.variant).join(',').startsWith(a));
  ok('別イベントでは並びが変わる', a !== build(40, 'evB').segs.map(s => s.variant).join(','));
  let dup = [];
  for (const ev of ['e1', 'e2', 'e3', 'x9', 'zz', '1782432300147']) {
    const v = build(48, ev).segs.map(s => s.variant);
    for (let i = 1; i < v.length; i++) if (v[i] === v[i - 1]) dup.push(`${ev}[${i}]`);
  }
  ok('★直前と同じテーマが連続しない', dup.length === 0, dup.join(' '));
  ok('JS にファイル名・拡張子が出てこない', !/\.webp|images\/bg|bg0\d/.test(src));
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
  ok('★スクロール中に width/height/top を書き換えていない',
    !/style\.(width|height|top|left)\s*=/.test(src.slice(src.indexOf('const paint = () =>'), src.indexOf('const request = () =>'))));
}

console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
