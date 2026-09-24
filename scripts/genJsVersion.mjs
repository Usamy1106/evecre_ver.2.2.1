#!/usr/bin/env node
// public/js の中身から版（ハッシュ）を計算し、index.html の module スクリプトの
// パスに焼き込む。
//
//   npm run js:version
//
// なぜ要るか：
//   起動時に読む ES Modules は 62 本あり、すべて Cache-Control: no-cache だった。
//   つまり2回目以降のリロードでも **62 本の条件付き GET（304）** が毎回飛ぶ。
//   回線が細い環境ではこれ自体が失敗の種になる（1本の HTTP/2 接続に
//   62 本のストリームが乗り、その接続が死ねば全滅する）。
//
//   /js/v<ハッシュ>/main.js という形にして immutable 配信にすれば、
//   2回目以降は往復ごと消える。ES Modules の相対 import は同じ接頭辞の下に
//   解決されるので、**index.html の1行を書き換えるだけで 62 本すべてに効く**。
//   ファイルは1つも動かさない（server.js が接頭辞を剥がして public/js から配る）。
//
// ★手で番号を上げる方式にしないこと。上げ忘れると immutable なので
//   古い JS が永久に配信される。ここで内容から計算し、check:flocss が
//   再計算して不一致なら落とす（忘れられないようにする）。
// ★public/js/vendor/ は対象外（別のバージョン付きパスで既に immutable）。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** public/js 以下の .js を集める（vendor は除く）。並び順を固定して安定したハッシュにする */
export function listJsFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (name === 'vendor') continue;
        walk(full);
      } else if (name.endsWith('.js')) {
        out.push(full);
      }
    }
  };
  walk(path.join(ROOT, 'public/js'));
  return out;
}

/** 中身から版を計算する（先頭8桁） */
export function computeJsVersion() {
  const h = crypto.createHash('sha1');
  for (const f of listJsFiles()) {
    h.update(path.relative(ROOT, f));
    h.update('\0');
    h.update(fs.readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 8);
}

/** index.html の module スクリプトのパス。読み取りにも書き込みにも使う */
export const JS_ENTRY_RE = /(<script type="module" src=")\/js\/(?:v[0-9a-f]{8}\/)?main\.js(">)/;

// ★パスに空白が入るので file://${argv[1]} との文字列比較はできない（URL エンコードでずれる）
if (fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const v = computeJsVersion();
  const p = path.join(ROOT, 'public/index.html');
  const src = fs.readFileSync(p, 'utf8');
  if (!JS_ENTRY_RE.test(src)) {
    console.error('index.html の module スクリプトが見つからない');
    process.exit(1);
  }
  const out = src.replace(JS_ENTRY_RE, `$1/js/v${v}/main.js$2`);
  if (out === src) {
    console.log(`変更なし（v${v}）`);
  } else {
    fs.writeFileSync(p, out);
    console.log(`index.html を更新した → /js/v${v}/main.js`);
  }
}
