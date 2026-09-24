#!/usr/bin/env node
// public/css/style.css の @import を順番に連結して1本にまとめる。
//
//   npm run css:build     （npm start の前段でも走る）
//
// なぜ要るか：
//   style.css は @import を73本並べており、ブラウザは「style.css を取って読む →
//   73本を取る」という2段の往復になる。しかも全部 Cache-Control: no-cache なので、
//   2回目以降のリロードでも毎回73本の条件付き GET（304）が飛ぶ。
//   回線が細い環境ではこれ自体が失敗の種になる。
//
// 方針：
//   ★style.css は**ソースの正**として残す（並び順＝詳細度の弱い順という意味を持つ）。
//     開発では今までどおり public/css/ を分割して書く。FLOCSS の構造は変えない。
//   ★連結した style.bundle.css を生成して index.html が読む。URL に ?v=<ハッシュ> を
//     付けて immutable 配信にするので、2回目以降は往復ごと消える。
//   ★ファイル名は固定（style.bundle.css）。ハッシュはクエリに置く。
//     名前にハッシュを入れると、CSS を直すたびに git 上でファイルが増減して履歴が荒れる。
//
// ★生成物はコミットすること（genBgManifest と同じ考え方）。
//   流し忘れは check:flocss が中身を作り直して比べ、一致しなければ落とす。
// ★url() は全部絶対パス（/images/...）なので、連結してもパスは壊れない。
//   ★相対パスの url() を書かないこと。書くと連結でベースがずれて画像が出なくなる。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = path.join(ROOT, 'public/css');
export const BUNDLE_REL = 'public/css/style.bundle.css';

/** style.css の @import を書かれている順に取り出す */
export function importedFiles() {
  const entry = fs.readFileSync(path.join(CSS_DIR, 'style.css'), 'utf8');
  const out = [];
  for (const m of entry.matchAll(/^@import\s+url\(["']?(.+?)["']?\);/gm)) {
    out.push(m[1].replace(/^\.\//, ''));
  }
  return out;
}

/** 連結した中身を作る（ファイルには書かない） */
export function buildBundle() {
  const parts = [
    '/* 自動生成 — 手で編集しないこと（scripts/buildCss.mjs）。',
    ' * 元は public/css/style.css の @import。直すのは分割された元ファイルのほう。',
    ' * 作り直し: npm run css:build */',
  ];
  for (const rel of importedFiles()) {
    const full = path.join(CSS_DIR, rel);
    if (!fs.existsSync(full)) throw new Error(`@import の参照先が無い: ${rel}`);
    parts.push(`\n/* ===== ${rel} ===== */`);
    parts.push(fs.readFileSync(full, 'utf8').trimEnd());
  }
  return parts.join('\n') + '\n';
}

export const cssHash = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);

/** index.html のスタイルシート行。読み取りにも書き込みにも使う */
export const CSS_LINK_RE =
  /<link rel="stylesheet" href="\/css\/style(?:\.bundle)?\.css(?:\?v=[0-9a-f]{8})?">/;

/** 連結した中身をファイルへ書き出す（変わっていなければ書かない）。ハッシュを返す。
 *  ★server.js が開発中だけ呼ぶ（CSS を直すたびに css:build を流さずに済むように）。 */
export function writeBundleFile() {
  const text = buildBundle();
  const bundlePath = path.join(ROOT, BUNDLE_REL);
  const prev = fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, 'utf8') : null;
  if (prev !== text) fs.writeFileSync(bundlePath, text);
  return { text, hash: cssHash(text) };
}

if (fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const { text, hash } = writeBundleFile();

  const htmlPath = path.join(ROOT, 'public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!CSS_LINK_RE.test(html)) {
    console.error('index.html のスタイルシート行が見つからない');
    process.exit(1);
  }
  const out = html.replace(CSS_LINK_RE,
    `<link rel="stylesheet" href="/css/style.bundle.css?v=${hash}">`);
  if (out !== html) fs.writeFileSync(htmlPath, out);

  const n = importedFiles().length;
  console.log(`style.bundle.css を生成（${n} ファイル → 1本、${(Buffer.byteLength(text) / 1024).toFixed(0)}KB、v=${hash}）`);
}
