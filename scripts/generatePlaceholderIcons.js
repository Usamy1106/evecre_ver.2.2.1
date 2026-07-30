// scripts/generatePlaceholderIcons.js — PWA アイコンの暫定プレースホルダー生成
//
// ★これは仮素材。デザインが用意できたら同じファイル名で上書きすること（このスクリプトは不要になる）。
// 外部依存を増やさないため、zlib だけで最小限の PNG エンコーダを自前実装している。
//
// 生成物（public/images/icon/）:
//   app-icon-192.png          192x192  manifest / apple-touch-icon
//   app-icon-512.png          512x512  manifest
//   app-icon-512-maskable.png 512x512  Android アダプティブ（安全領域を確保して図形を小さめに）
//   app-badge-72.png           72x72   通知バッジ（Android。単色シルエット）
//
// 使い方: node scripts/generatePlaceholderIcons.js

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'icon');

// ブランドカラー（index.html の CSS 変数と揃える）
const BLUE  = [0x0C, 0xA1, 0xE3, 255];  // --create-blue（背景）
const BODY  = [0xC4, 0xD6, 0xE8, 255];  // 山肌（雪冠とコントラストを付けるため少し暗く）
const SNOW  = [0xFF, 0xFF, 0xFF, 255];  // 雪冠
const TRANS = [0, 0, 0, 0];

// ── PNG エンコーダ ────────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/**
 * RGBA 画素配列を PNG バッファに変換する
 * @param {number} w
 * @param {number} h
 * @param {(x:number,y:number)=>number[]} pixelFn (x,y) → [r,g,b,a]
 */
function encodePng(w, h, pixelFn) {
  // 各行の先頭にフィルタタイプ 0 を置いた raw データ
  const raw = Buffer.alloc(h * (w * 4 + 1));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 図形（山＋雪冠）────────────────────────────────────────────
// アプリのテーマ（山登り）に合わせた三角形の山。座標は 0..1 の正規化空間で判定する。
function mountainPixel(u, v, opts) {
  const { scale, bg, body, snow } = opts;
  // 山の輪郭：底辺 y=0.78、頂点 (0.5, 0.24) を scale で中心から縮小
  const c = 0.5;
  const su = (u - c) / scale + c;
  const sv = (v - c) / scale + c;

  const apexY = 0.24, baseY = 0.78, apexX = 0.5, halfW = 0.34;
  if (sv >= apexY && sv <= baseY) {
    const t = (sv - apexY) / (baseY - apexY);      // 0=頂上 1=底辺
    const w = halfW * t;
    if (su >= apexX - w && su <= apexX + w) {
      // 上部 22% は雪冠
      return (t < 0.22) ? snow : body;
    }
  }
  return bg;
}

function writeIcon(name, size, opts) {
  const png = encodePng(size, size, (x, y) => {
    const u = (x + 0.5) / size;
    const v = (y + 0.5) / size;
    return mountainPixel(u, v, opts);
  });
  const outPath = path.join(OUT_DIR, name);
  fs.writeFileSync(outPath, png);
  console.log(`  ${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

// ── 生成 ──────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('PWA アイコン（暫定プレースホルダー）を生成します:');

// 通常アイコン：青背景に白い山
writeIcon('app-icon-192.png', 192, { scale: 1.0, bg: BLUE, body: BODY, snow: SNOW });
writeIcon('app-icon-512.png', 512, { scale: 1.0, bg: BLUE, body: BODY, snow: SNOW });

// maskable：Android が角を丸く切り取るため、図形を内側 60% に収める（安全領域の確保）
writeIcon('app-icon-512-maskable.png', 512, { scale: 0.62, bg: BLUE, body: BODY, snow: SNOW });

// バッジ：通知の小アイコン。単色シルエット（背景は透明）
writeIcon('app-badge-72.png', 72, { scale: 1.0, bg: TRANS, body: SNOW, snow: SNOW });

console.log('完了。デザインが用意できたら同じファイル名で上書きしてください。');
