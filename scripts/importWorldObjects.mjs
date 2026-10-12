// scripts/importWorldObjects.mjs — 草木の素材（WorldSpawnedObjects）を取り込む
//
// 使い方：
//   1. public/images/bg/<テーマ>/WorldSpawnedObjects/ に支給の png を置く（名前は <テーマ>-<番号>.png）
//   2. npm i --no-save sharp && npm run bg:objects
//      （または SHARP_DIR=<sharp を入れたディレクトリ> npm run bg:objects）
//   → 同じ名前の .webp を書き出し、最後に npm run bg:manifest を流す
//
// やること（png 1枚ごと）：
//   - ★背景の白を透明にする。支給の png は透明の情報を持たず、背景が白で塗られていることがある
//     （2026-10-12 に差し替えた11枚がそうだった。山の上で白い四角が見えた）
//     - 透明にするのは「画像のふちからつながっている白」だけ（草木の中の白いハイライトは残す）
//     - 輪郭のなめらかさは、白との混ざり具合から半透明に戻して保つ（color-to-alpha）
//     - もともと透明の情報を持つ png はそのまま使う（白抜きはしない）
//   - 高さ 720px に縮める（表示はスマホで高さ約 200px。3倍解像度の画面でも足りる）。
//     ★元の 4000px 級のまま入れないこと（1枚 300〜600KB。草木は1画面で何枚も読むので山の表示が遅くなる）
//   - webp（透明の情報つき）で書き出す
//
// ★sharp はプロジェクトの依存に入れていない（genIcons.mjs と同じ。Render のビルドにネイティブ依存を増やさない）
// ★支給の png は .gitignore で除外してある（元素材。配信には webp だけを使う）

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG_DIR = path.join(ROOT, 'public/images/bg');

const HEIGHT    = 720;   // 書き出しの高さ（px）
const BG_MIN    = 240;   // ふちからつながった「白」とみなす下限（RGB すべてがこれ以上）
const FRINGE_PX = 2;     // 白の領域のまわり何 px を半透明の対象にするか（輪郭のなめらかさ）

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch (_) {
    const dir = process.env.SHARP_DIR;
    if (!dir) {
      console.error('sharp が見つかりません。次のどちらかで実行してください:\n' +
        '  npm i --no-save sharp && npm run bg:objects\n' +
        '  SHARP_DIR=<sharp を入れたディレクトリ> npm run bg:objects');
      process.exit(1);
    }
    return createRequire(path.join(dir, 'noop.js'))('sharp');
  }
}

/** 白い背景を透明にする（RGBA の生データをその場で書き換える） */
function knockOutWhite(data, w, h) {
  const n = w * h;
  const isWhite = (p) => data[p * 4] >= BG_MIN && data[p * 4 + 1] >= BG_MIN && data[p * 4 + 2] >= BG_MIN;
  // 1. ふちからつながっている白を塗りつぶしで集める（4近傍）
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const push = (p) => { if (!bg[p] && isWhite(p)) { bg[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  // 2. 白の領域は透明、そのまわり FRINGE_PX は白との混ざり具合から半透明に戻す
  let cleared = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (bg[p]) { data[i + 3] = 0; cleared++; continue; }
    const x = p % w, y = (p / w) | 0;
    let near = false;
    for (let dy = -FRINGE_PX; dy <= FRINGE_PX && !near; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -FRINGE_PX; dx <= FRINGE_PX; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        if (bg[yy * w + xx]) { near = true; break; }
      }
    }
    if (!near) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const a = Math.max(255 - r, 255 - g, 255 - b) / 255;   // 白からどれだけ離れているか
    if (a <= 0) { data[i + 3] = 0; continue; }
    data[i]     = Math.round(255 - (255 - r) / a);
    data[i + 1] = Math.round(255 - (255 - g) / a);
    data[i + 2] = Math.round(255 - (255 - b) / a);
    data[i + 3] = Math.round(a * 255);
  }
  return cleared / n;
}

const sharp = await loadSharp();
const themes = fs.readdirSync(BG_DIR).filter(t => fs.existsSync(path.join(BG_DIR, t, 'WorldSpawnedObjects')));
let count = 0;
for (const t of themes) {
  const dir = path.join(BG_DIR, t, 'WorldSpawnedObjects');
  for (const f of fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).sort()) {
    const src = path.join(dir, f);
    const out = path.join(dir, f.replace(/\.png$/i, '.webp'));
    const meta = await sharp(src).metadata();
    let img;
    let note;
    if (meta.hasAlpha) {
      img = sharp(src);
      note = '元から透明あり';
    } else {
      const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const ratio = knockOutWhite(data, info.width, info.height);
      img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      note = `背景の白を透明に（${(ratio * 100).toFixed(0)}%）`;
    }
    const r = await img.resize({ height: HEIGHT }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(out);
    console.log(`${t}/${path.basename(out)}  ${r.width}x${r.height}  ${(r.size / 1024).toFixed(1)}KB  ${note}`);
    count++;
  }
}
if (count === 0) {
  console.log('png が見つかりませんでした（public/images/bg/<テーマ>/WorldSpawnedObjects/*.png）');
  process.exit(0);
}
// 素材の一覧（寸法・ハッシュ）を作り直す。★流さないと古い絵が出続ける（immutable 配信のため）
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/genBgManifest.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 0);
