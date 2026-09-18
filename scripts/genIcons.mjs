// scripts/genIcons.mjs — アプリアイコン一式を 1024px の元絵から作り直す
//
//   元絵: public/images/icon/evecre-icon-1024px.png（正方形・不透明）
//   出力: public/images/icon/evecre-icon-{16,32,48,180,192,512}.png
//         public/images/icon/evecre-badge-96.png（Android の通知バッジ。白抜き・透過）
//         public/favicon.ico（16/32/48 を1つに束ねたもの）
//
// ★元絵を差し替えたら、このスクリプトを流すだけで全サイズが揃う。
//   手で1枚ずつ書き出さないこと（サイズの取りこぼしが起きる）。
//
// ★sharp はプロジェクトの依存に入れていない（Render のビルドにネイティブ依存を増やさないため）。
//   使うときだけ入れる：
//     npm i --no-save sharp && node scripts/genIcons.mjs
//   または sharp を入れた別ディレクトリを指定する：
//     SHARP_DIR=/path/to/dir node scripts/genIcons.mjs
//
// ★maskable（Android の丸・角丸に切り抜かれる版）はここでは作らない。
//   元絵は文字が端まで来ているので、そのまま丸く切ると「ペ」の丸や「ク」の角が欠ける。
//   作るなら、文字を中央の直径80%の円の内側に収めた版をデザイン側で書き出すこと。

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = path.join(ROOT, 'public/images/icon/evecre-icon-1024px.png');
const OUT  = path.join(ROOT, 'public/images/icon');

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch (_) {
    const dir = process.env.SHARP_DIR;
    if (!dir) {
      console.error('sharp が見つかりません。次のどちらかで実行してください:\n' +
        '  npm i --no-save sharp && node scripts/genIcons.mjs\n' +
        '  SHARP_DIR=<sharp を入れたディレクトリ> node scripts/genIcons.mjs');
      process.exit(1);
    }
    return createRequire(path.join(dir, 'noop.js'))('sharp');
  }
}

// PNG をそのまま埋め込んだ ICO を組み立てる（Windows Vista 以降・全モダンブラウザが読める形式）
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);           // reserved
  header.writeUInt16LE(1, 2);           // type = icon
  header.writeUInt16LE(pngs.length, 4); // 枚数
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);  // 幅（256 は 0 で表す）
    e.writeUInt8(size >= 256 ? 0 : size, 1);  // 高さ
    e.writeUInt8(0, 2);                        // パレット数
    e.writeUInt8(0, 3);                        // reserved
    e.writeUInt16LE(1, 4);                     // planes
    e.writeUInt16LE(32, 6);                    // bit count
    e.writeUInt32LE(buf.length, 8);            // データ長
    e.writeUInt32LE(offset, 12);               // データ位置
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]);
}

const sharp = await loadSharp();

const meta = await sharp(SRC).metadata();
if (meta.width !== meta.height || meta.width < 512) {
  console.error(`元絵は 512px 以上の正方形にしてください（現在 ${meta.width}x${meta.height}）`);
  process.exit(1);
}

// ── 通常のアイコン（不透明・正方形。角丸は OS 側が付ける）──
//   16/32/48 … ファビコン（ICO と <link rel="icon">）
//   180      … iOS のホーム画面（apple-touch-icon）
//   192/512  … PWA の manifest・通知のアイコン・ようこそ画面のロゴ
const SIZES = [16, 32, 48, 180, 192, 512];
const bufs = {};
for (const size of SIZES) {
  // ★180px 以上はパレット PNG にする。元絵のざらざらした質感はフルカラー PNG だと
  //   圧縮が効かず、512px が元の 1024px より重くなった（406KB）。パレットにすると
  //   見た目は並べても区別がつかず、約4割の大きさになる（512px で 162KB）。
  //   小さいサイズは元々数KBなのでフルカラーのまま。
  const png = size >= 180
    ? { palette: true, quality: 90, effort: 10, compressionLevel: 9 }
    : { compressionLevel: 9 };
  const buf = await sharp(SRC)
    .resize(size, size, { kernel: 'lanczos3' })
    .png(png)
    .toBuffer();
  bufs[size] = buf;
  await fs.writeFile(path.join(OUT, `evecre-icon-${size}.png`), buf);
  console.log(`  evecre-icon-${size}.png  ${buf.length} bytes`);
}

// ── favicon.ico（サイト直下。ブラウザは <link> が無くても /favicon.ico を取りに来る）──
const ico = buildIco([16, 32, 48].map(size => ({ size, buf: bufs[size] })));
await fs.writeFile(path.join(ROOT, 'public/favicon.ico'), ico);
console.log(`  favicon.ico            ${ico.length} bytes`);

// ── Android の通知バッジ（ステータスバーの小さな白抜きアイコン）──
// ★Android はバッジの「不透明度」しか使わない（色は捨てて白で塗る）。不透明な正方形の
//   アイコンを渡すと、ステータスバーに白い四角が出る。そこで元絵の白い文字だけを抜き出す。
// ★白の判定は RGB すべてが高いこと。背景のベージュ（R・G は高いが B が低い）を拾わないため
//   B も含めて全チャンネルで判定する。
const BADGE = 96;
const WHITE_MIN = 235;
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const alpha = Buffer.alloc(info.width * info.height);
for (let i = 0, p = 0; i < alpha.length; i++, p += info.channels) {
  const r = data[p], g = data[p + 1], b = data[p + 2];
  alpha[i] = (r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN) ? 255 : 0;
}
// ★ノイズ除去（median）は掛けないこと。背景のざらざらは上の全チャンネル判定で
//   すでに落ちていて、掛けると「ペ」の半濁点の細い輪だけが消えて汚れのように残る
//   （median 3 / 5 で比べて確認済み）。
const mask = await sharp(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
  .resize(BADGE, BADGE, { kernel: 'lanczos3' })
  // ★1チャンネルに戻すこと。sharp は出力時に sRGB（3チャンネル）へ変換するので、
  //   そのまま1画素1バイトとして読むと行がずれて横縞になる（実際になった）
  .extractChannel(0)
  .raw()
  .toBuffer();
if (mask.length !== BADGE * BADGE) {
  console.error(`バッジのマスクの大きさが想定と違います（${mask.length} bytes）`);
  process.exit(1);
}
const rgba = Buffer.alloc(BADGE * BADGE * 4);
for (let i = 0; i < BADGE * BADGE; i++) {
  rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
  rgba[i * 4 + 3] = mask[i];
}
const badge = await sharp(rgba, { raw: { width: BADGE, height: BADGE, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toBuffer();
await fs.writeFile(path.join(OUT, `evecre-badge-${BADGE}.png`), badge);
console.log(`  evecre-badge-${BADGE}.png   ${badge.length} bytes`);

console.log('完了。public/images/icon/ と public/favicon.ico を確認してください。');
