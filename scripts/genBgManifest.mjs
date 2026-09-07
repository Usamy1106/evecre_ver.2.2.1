// scripts/genBgManifest.mjs
// 山の背景素材を走査して public/js/mountainAssets.generated.js を書き出す。
//
// 使い方:
//   npm run bg:manifest
//
// なぜ生成するのか:
//   背景をパーツから組み立てるには、JS が「何枚あるか」だけでなく
//   **1枚ごとの高さ（landform は 1481/1781/2241 の3種）と色**を知る必要がある。
//   CSS 変数（--mtn-bg-*）にはこれらを載せられず、ファイル名からも高さは分からない。
//
// ★生成物は手で編集しないこと。素材を足したらこのスクリプトを流し直す。
// ★冪等であること。2回流して git diff が空になるよう、並びは常にファイル名順で固定する。
// ★依存を足さないこと。webp の寸法は RIFF ヘッダから直接読む
//   （sips は macOS 専用なので CI で動かない）。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT   = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG_DIR = path.join(ROOT, 'public/images/bg');
const OUT    = path.join(ROOT, 'public/js/mountainAssets.generated.js');

// テーマ配下に置く層＝**フォルダ名そのまま**。★増やすときはここに足す。
//   フォルダが無い／空のテーマは空配列になり、「その層を使わない」の意味になる。
// ★WorldSpawnedObjects … 地形の上に生やすもの（草・木など）。旧 `plant`。
//   `mountainObjects.js`（ミッション完了時に出るオブジェクト）とは**別物**なので
//   混同しないこと。あちらは submissions に保存される記念碑で、こちらは景色の一部。
const LAYERS = ['landform', 'WorldSpawnedObjects', 'phenomenon'];
// テーマに属さない共通素材
const SHARED = ['cloud'];

// ── webp の寸法を読む ────────────────────────────────────────
// RIFF コンテナの中に VP8（非可逆）/ VP8L（可逆）/ VP8X（拡張）のいずれかが入る。
// 3種とも幅・高さの持ち方が違うので、それぞれ別に読む。
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourCC = buf.toString('ascii', 12, 16);

  if (fourCC === 'VP8X') {
    // 拡張形式。24 バイト目から 3 バイトずつ「実寸 - 1」がリトルエンディアンで入る
    return {
      w: buf.readUIntLE(24, 3) + 1,
      h: buf.readUIntLE(27, 3) + 1,
    };
  }
  if (fourCC === 'VP8 ') {
    // 非可逆。同期コード 0x9d 0x01 0x2a のあとに 14bit の幅・高さ
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return {
      w: buf.readUInt16LE(26) & 0x3fff,
      h: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (fourCC === 'VP8L') {
    // 可逆。シグネチャ 0x2f のあとに 14bit ずつ「実寸 - 1」が詰まっている
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return {
      w: (b & 0x3fff) + 1,
      h: ((b >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

/** svg は viewBox から。★width/height 属性ではなく viewBox を見る（単位が付くことがある） */
function svgSize(text) {
  const m = /viewBox\s*=\s*"[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/.exec(text);
  if (!m) return null;
  return { w: Math.round(+m[1]), h: Math.round(+m[2]) };
}

function sizeOf(file) {
  if (file.endsWith('.webp')) return webpSize(fs.readFileSync(file));
  if (file.endsWith('.svg'))  return svgSize(fs.readFileSync(file, 'utf8'));
  return null;
}

/** 通し番号と色をファイル名から取る。'<テーマ>-landform-07-b.webp' → { n:'07', c:'b' }
 *  ★色は全テーマ共通の1文字（a / b / c …）で分類する取り決め。
 *    ここは後方互換のため長い色名も読めるが、check:mountain が1文字を強制する。 */
function parseName(name) {
  const base = name.replace(/\.(webp|svg)$/, '');
  const m = /-(\d{2,})(?:-([A-Za-z]+))?$/.exec(base);
  return { n: m ? m[1] : base, c: m && m[2] ? m[2] : null };
}

function listDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.') && /\.(webp|svg)$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en'));   // ★並びを固定して冪等にする
}

/**
 * 中身から短いハッシュを作る。★キャッシュ更新用。
 *
 * /images/bg/ は `immutable` で1年キャッシュしているので、**同じ名前で中身だけ
 * 差し替えると古い絵が出続ける**。以前は「差し替えるときは必ずファイル名を変える」
 * という運用で凌いでいたが、実際に踏んだ（900px 化のとき同名で書き出された）。
 * URL に ?v=<ハッシュ> を付けて、**中身が変わったファイルだけ**自動で更新させる。
 */
function contentHash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}

function collect(dir) {
  const out = [];
  for (const f of listDir(dir)) {
    const full = path.join(dir, f);
    const size = sizeOf(full);
    if (!size) { console.warn(`  ⚠ 寸法が読めない: ${f}`); continue; }
    const { n, c } = parseName(f);
    out.push({ n, ...(c ? { c } : {}), w: size.w, h: size.h, f, v: contentHash(full) });
  }
  return out;
}

// ── 走査 ────────────────────────────────────────────────────
// テーマ＝「landform を持つディレクトリ」。cloud のような共通素材と自然に分かれる。
const entries = fs.readdirSync(BG_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('.'))
  .map(d => d.name)
  .sort((a, b) => a.localeCompare(b, 'en'));

const themes = {};
for (const name of entries) {
  if (SHARED.includes(name)) continue;
  const themeDir = path.join(BG_DIR, name);
  if (!fs.existsSync(path.join(themeDir, 'landform'))) continue;   // テーマではない
  themes[name] = {};
  for (const layer of LAYERS) themes[name][layer] = collect(path.join(themeDir, layer));
}

const shared = {};
for (const name of SHARED) shared[name] = collect(path.join(BG_DIR, name));

// ── 書き出し ────────────────────────────────────────────────
const j = (v) => JSON.stringify(v);
const rows = (list) => list.map(a => `      ${j(a)},`).join('\n');

let body = `// ===== 山の背景素材のマニフェスト（自動生成）=====
//
// ★このファイルは scripts/genBgManifest.mjs が書き出す。**手で編集しないこと。**
//   素材を足す・差し替えるときは public/images/bg/ に置いてから
//   \`npm run bg:manifest\` を流し直す。
//
// 1エントリ = { n: 通し番号, c: 色（a / b / c … の1文字）, w: 幅, h: 高さ,
//              f: ファイル名, v: 中身のハッシュ（キャッシュ更新用） }
//   ★w / h は**素材のピクセル**。画面px ではない。配置の計算はこの単位で行い、
//     実寸への変換は CSS の --art-unit が担う（端末幅で景色を変えないため）。
//   ★層が空配列のテーマは「その層を使わない」という意味。

export const BG_ASSETS = {
`;

for (const [theme, layers] of Object.entries(themes)) {
  body += `  ${theme}: {\n`;
  for (const layer of LAYERS) {
    const list = layers[layer] || [];
    body += list.length === 0
      ? `    ${layer}: [],\n`
      : `    ${layer}: [\n${rows(list)}\n    ],\n`;
  }
  body += `  },\n`;
}

body += `};

// テーマに属さない共通素材（雲）。どのテーマからでも使う。
export const BG_SHARED = {
`;
for (const [name, list] of Object.entries(shared)) {
  body += list.length === 0
    ? `  ${name}: [],\n`
    : `  ${name}: [\n${rows(list)}\n  ],\n`;
}
body += `};

/** 素材の URL。★パスの組み立てはここ1箇所に集約する（呼び出し側で連結しないこと）
 *  ★?v=<中身のハッシュ> を必ず付ける。/images/bg/ は immutable で1年キャッシュ
 *    しているので、これが無いと**同じ名前で中身を差し替えても古い絵が出続ける**。
 *    ハッシュなので、変わったファイルだけが更新される。 */
export function bgUrl(theme, layer, file, v) {
  const base = theme
    ? \`/images/bg/\${theme}/\${layer}/\${file}\`
    : \`/images/bg/\${layer}/\${file}\`;
  return v ? \`\${base}?v=\${v}\` : base;
}
`;

fs.writeFileSync(OUT, body);

const count = (o) => Object.values(o).reduce((s, v) => s + (Array.isArray(v) ? v.length : count(v)), 0);
console.log(`書き出し: ${path.relative(ROOT, OUT)}`);
for (const [t, layers] of Object.entries(themes)) {
  console.log(`  ${t}: ` + LAYERS.map(l => `${l} ${layers[l].length}`).join(' / '));
}
for (const [n, list] of Object.entries(shared)) console.log(`  ${n}（共通）: ${list.length}`);
console.log(`  合計 ${count(themes) + count(shared)} 件`);
