// ===== 完了フォームの編集欄（文章の途中に画像を置ける）=====
//
// Google ドキュメントのように、文章の好きな位置に画像を挟める入力欄。
// 実体は contenteditable の <div id="clear-input">（views/missionDetail.js が描く）。
//
// ■ 保存の形（★HTML は保存しない）
//   本文（content）はプレーンテキストで、画像の位置に {{image:N}}（1始まり）を入れる。
//   画像の実体は submissions.images（R2 の URL の配列）の N 番目。
//   読むときは utils.js の submissionSegments / submissionText を通す。
//   ★編集欄の HTML をそのまま保存しないこと。貼り付けや他ブラウザ由来のタグが
//     そのまま他人の画面に描かれる（XSS）。readEditor が文字と画像の印だけを取り出す。
//
// ■ 画像の入り方
//   - ドラッグ＆ドロップ … 指（マウス）を離した位置（PC・タブレット向け）
//   - 画像ボタン・貼り付け … 今カーソルがある位置（無ければ末尾）
//   ★1枚ごとに縮小と 2MB 上限を通す（外すと 512MB のサーバーが OOM する）
//   ★枚数は SUBMISSION_MAX_IMAGES まで
//
// ■ PDF も同じように置ける（最大 SUBMISSION_MAX_FILES・1つ SUBMISSION_FILE_MAX_BYTES まで）。
//   置いた時点で1ページ目を絵にする（pdfThumb.js。pdf.js はそのとき初めて読む）。
//   描いているあいだはくるくるを出す。描けなければ絵なしのカードになる（添付はできる）。
//
// ■ 1画面に複数置ける（アーカイブの編集モードでは、タスクごとに1つ）。
//   選んだ画像・PDF と最後のカーソル位置は**編集欄の要素ごと**に持つ（el._items / el._lastRange）。
//   ★モジュールに1つだけ持たせないこと（別の欄に画像を入れた瞬間に、他の欄の画像が消える）。
//
// ■ 選んだ画像・PDF の中身は各編集欄が持つ（el._items）。
//   ★下書き（localStorage）には入れない（複数枚の dataURL は約5MBをすぐにあふれる）。
//   送信済みの URL も覚えておき、完了に失敗して押し直したときに送り直さない。

import { SUBMISSION_MAX_IMAGES, SUBMISSION_MAX_FILES, SUBMISSION_FILE_MAX_BYTES } from './constants.js';
import { renderPdfThumb } from './pdfThumb.js';
import { formatFileSize, submissionImages, submissionFiles, stripInlineMarks } from './utils.js';

// 本文の中の画像・添付ファイル（PDF）の印。★utils.js の IMAGE_MARK_RE / FILE_MARK_RE と同じ形に保つこと
// ★編集欄の中の塊は、画像も PDF も data-img-key を持つ（並べ替え・×・差し込み先の判定を共通にするため）。
//   PDF は data-kind="file" で見分ける。
const MARK      = (n) => `{{image:${n}}}`;
const MARK_FILE = (n) => `{{file:${n}}}`;

// 提出物画像の上限。server.js の SUBMISSION_MAX_BYTES と揃えること（2MB）。
export const SUBMISSION_MAX_BYTES = 2 * 1024 * 1024;
const RESIZE_MAX_EDGE = 1600;  // 長辺の上限(px)
const RESIZE_QUALITY  = 0.8;   // JPEG 品質

// key → { dataUrl, url }。★編集欄ごと（el._items）
let _seq = 0;
function _store(el) { return (el._items ||= new Map()); }
// ★最後にカーソルがあった位置も編集欄ごと（el._lastRange）。画像ボタンを押すとフォーカスが外れるため覚えておく

// 画面上の編集欄（いくつあってもよい）
const _editorOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.c-editor') || null;

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _toast(msg) { window._app?.showToast(msg, 'error'); }

// ── 画像の下ごしらえ ─────────────────────────────────────

function _readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * dataURL を canvas で縮小する。スマホの写真は 3〜8MB あり、そのままでは
 * サーバの上限（2MB）に引っかかるため送信前に必ず通す。
 * 既に上限内かつ小さい画像は再エンコードせず元のまま返す（無駄な劣化を避ける）。
 */
// サーバーがそのまま受け付ける形式（server.js の IMAGE_DATA_URL_RE と揃える）。
// ★これ以外（HEIC・GIF・BMP・AVIF など）は必ず JPEG に描き直す。そのまま送ると弾かれる
const _PASS_THROUGH_RE = /^data:image\/(png|jpeg|jpg|webp);base64,/;

/**
 * @returns {Promise<string|null>} 縮小後の dataURL。★ブラウザが画像として読めなければ null
 *   （Chrome は HEIC を読めない。以前は読めないまま挿入され、送信で弾かれていた）
 */
function _resizeImageDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const longEdge = Math.max(img.width, img.height);
        if (longEdge <= RESIZE_MAX_EDGE && dataUrl.length <= SUBMISSION_MAX_BYTES
            && _PASS_THROUGH_RE.test(dataUrl)) return resolve(dataUrl);
        const scale = Math.min(1, RESIZE_MAX_EDGE / longEdge);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        // JPEG は透過を持てないので白で下地を塗る（PNG の透過部分が黒くなるのを防ぐ）
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let out = canvas.toDataURL('image/jpeg', RESIZE_QUALITY);
        for (let q = 0.6; out.length > SUBMISSION_MAX_BYTES && q >= 0.4; q -= 0.2) {
          out = canvas.toDataURL('image/jpeg', q);
        }
        resolve(out);
      } catch (_) {
        resolve(_PASS_THROUGH_RE.test(dataUrl) ? dataUrl : null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ★type が空のファイルもある（ブラウザ・OS によっては拡張子しか手がかりが無い）
const _IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif|tiff?)$/i;
/**
 * 画像ファイル1枚を、送れる dataURL にする（縮小・JPEG 化・2MB 上限）。
 * ★アーカイブのヘッダー画像でも使う（同じ上限・同じ縮小を通すため）。
 * @returns {Promise<{ dataUrl?: string, error?: 'unreadable'|'too_large' }>}
 */
export async function prepareImageFile(file) {
  let dataUrl = null;
  try { dataUrl = await _resizeImageDataUrl(await _readAsDataUrl(file)); } catch (_) { /* 下で扱う */ }
  if (!dataUrl) return { error: 'unreadable' };
  if (dataUrl.length > SUBMISSION_MAX_BYTES) return { error: 'too_large' };
  return { dataUrl };
}

const _isImageFile = (f) => !!f && (/^image\//.test(f.type) || (!f.type && _IMAGE_EXT_RE.test(f.name || '')));
const _isPdfFile   = (f) => !!f && (f.type === 'application/pdf' || (!f.type && /\.pdf$/i.test(f.name || '')));

/**
 * DataTransfer（ドロップ・貼り付け）からファイルを集める。
 * ★files だけを見ないこと。ブラウザによっては items（kind:'file'）にしか入ってこない。
 */
function _filesFrom(dt) {
  if (!dt) return [];
  const out = [...(dt.files || [])];
  for (const it of [...(dt.items || [])]) {
    if (it.kind !== 'file') continue;
    const f = it.getAsFile?.();
    if (f && !out.some(x => x.name === f.name && x.size === f.size && x.type === f.type)) out.push(f);
  }
  return out;
}

// ── 編集欄の読み書き ─────────────────────────────────────

export function editorEl() {
  return document.getElementById('clear-input');
}

/** いま編集欄に置かれている画像の数（PDF は数えない） */
export function imageCount(el = editorEl()) {
  return el ? el.querySelectorAll('[data-img-key]:not([data-kind="file"])').length : 0;
}

/** いま編集欄に置かれている PDF の数 */
export function fileCount(el = editorEl()) {
  return el ? el.querySelectorAll('[data-img-key][data-kind="file"]').length : 0;
}

// 書式の印と、編集欄の中での持ち方（★表示の utils.js richTextHtml と同じクラスを使い、見た目を揃える）
//   太字 b → <b> ／ 斜体 i → <i> ／ 見出し h → span.c-rich-text__h ／ 箇条書き l → span.c-rich-text__l ／ 非公開 p → span.u-private-text
const _SPAN_CLASS = { h: 'c-rich-text__h', l: 'c-rich-text__l', p: 'u-private-text' };
const _LINE_KEYS = ['h', 'l'];                 // 1行だけの書式（改行で閉じる）
const _NEST_ORDER = ['p', 'h', 'l', 'b', 'i']; // 編集欄の中で入れ子にする順（外 → 内）
// 書式を切り替えるあいだだけ置く、選択範囲の目印（私用領域の文字。保存には残さない）
const SEL_START = '';
const SEL_END   = '';
const ZWSP = '​';

/**
 * 編集欄を「本文（印つき）」と「画像の key の並び」に変換する。
 * ★HTML は捨てる。取り出すのは文字・改行・画像の印・書式の印だけ。
 * @returns {{ text: string, plain: string, keys: string[], fileKeys: string[] }}
 *   text     … 画像・PDF の位置に {{image:N}} / {{file:N}} を入れた本文（保存用）
 *   plain    … 印を外した本文（下書き・空判定用）
 *   keys     … 画像の key の並び／fileKeys … PDF の key の並び
 */
export function readEditor(el = editorEl()) {
  const out = [];
  const keys = [];
  const fileKeys = [];
  // ★書式は印にする（utils.js の inlineRuns が読む）：{{b}} {{i}} {{h}} {{l}} {{p}}。
  //   開いている書式を stack で持つ。
  // ★画像・PDF の印の前後では、太字・斜体・見出し・箇条書きは閉じて開き直す（表示は文章のかたまりごとに読む）。
  //   ★非公開（p）だけは閉じない＝非公開の中に置いた画像・PDF も非公開になる（外へ出すとき lib/publicData.js が外す）。
  //   ここで p を閉じると、画像が非公開の外に出て公開されてしまう。
  // ★見出し・箇条書きは1行だけ：改行に当たったら閉じる。前後は改行で区切る（表示はその改行を飲む）。
  const open = [];
  let pendingNewline = false;   // 見出し・箇条書きを閉じた直後。次に何か書くときに改行を入れる
  const tail = () => out.join('').replace(/(\{\{\/?[bihlp]\}\})+$/, '');
  const endsWithNewline = () => { const s = tail(); return s === '' || s.endsWith('\n'); };
  const flushNewline = () => { if (pendingNewline) { if (!endsWithNewline()) out.push('\n'); pendingNewline = false; } };
  const isBold = (n) => /^(B|STRONG)$/.test(n.tagName) || n.style?.fontWeight === 'bold' || +n.style?.fontWeight >= 600;
  const isItal = (n) => /^(I|EM)$/.test(n.tagName) || n.style?.fontStyle === 'italic';
  const has = (n, k) => !!n.classList?.contains(_SPAN_CLASS[k]);
  // 見出し・箇条書きを閉じる（その内側で開いているものは閉じて、見出し・箇条書き以外を開き直す）
  const closeLine = () => {
    const at = open.findIndex(t => _LINE_KEYS.includes(t));
    if (at < 0) return;
    const above = open.splice(at);
    for (let k = above.length - 1; k >= 0; k--) out.push(`{{/${above[k]}}}`);
    for (const t of above) if (!_LINE_KEYS.includes(t)) { out.push(`{{${t}}}`); open.push(t); }
    pendingNewline = true;
  };
  const newline = () => { closeLine(); pendingNewline = false; out.push('\n'); };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.nodeValue.replace(/​/g, '');
        if (t) { flushNewline(); out.push(t); }
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      if (n.dataset?.imgKey) {
        flushNewline();
        closeLine();
        pendingNewline = false;
        for (let k = open.length - 1; k >= 0; k--) if (open[k] !== 'p') out.push(`{{/${open[k]}}}`);
        if (n.dataset.kind === 'file') { fileKeys.push(n.dataset.imgKey); out.push(MARK_FILE(fileKeys.length)); }
        else { keys.push(n.dataset.imgKey); out.push(MARK(keys.length)); }
        for (const t of open) if (t !== 'p') out.push(`{{${t}}}`);
        continue;
      }
      if (n.tagName === 'BR') { newline(); continue; }
      // Enter でブラウザが作る <div>/<p> は「その前で改行」
      if (/^(DIV|P|LI)$/.test(n.tagName) && !endsWithNewline()) newline();
      const tags = [];
      if (has(n, 'p') && !open.includes('p')) tags.push('p');
      for (const k of _LINE_KEYS) {
        if (has(n, k) && !open.some(t => _LINE_KEYS.includes(t))) {
          // ★見出し・箇条書きは行の頭から。前に文字があれば改行で区切る
          pendingNewline = false;
          if (!endsWithNewline()) out.push('\n');
          tags.push(k);
        }
      }
      if (isBold(n) && !open.includes('b')) tags.push('b');
      if (isItal(n) && !open.includes('i')) tags.push('i');
      for (const t of tags) { if (!_LINE_KEYS.includes(t)) flushNewline(); out.push(`{{${t}}}`); open.push(t); }
      walk(n);
      for (const t of tags.reverse()) {
        const at = open.lastIndexOf(t);
        if (at < 0) continue;   // ★見出し・箇条書きは途中の改行で閉じ済み
        // その内側で開いているものを閉じて開き直す（交差させない）
        const above = open.splice(at);
        for (let k = above.length - 1; k >= 0; k--) out.push(`{{/${above[k]}}}`);
        for (const x of above.slice(1)) { out.push(`{{${x}}}`); open.push(x); }
        if (_LINE_KEYS.includes(t)) pendingNewline = true;
      }
    }
  };
  if (el) walk(el);
  for (let k = open.length - 1; k >= 0; k--) out.push(`{{/${open[k]}}}`);
  let text = out.join('');
  // 中身の無い書式（{{b}}{{/b}}）を消し、続けて同じ書式が閉じて開くところ（{{/b}}{{b}}）をつなぐ
  for (let prev = ''; prev !== text;) {
    prev = text;
    text = text.replace(/\{\{([bihlp])\}\}(\s*)\{\{\/\1\}\}/g, '$2').replace(/\{\{\/([bip])\}\}\{\{\1\}\}/g, '');
  }
  text = text.replace(/\s+$/, '');
  const plain = stripInlineMarks(text.replace(/\{\{(image|file):\d+\}\}/g, '')).replace(/[]/g, '').trim();
  return { text, plain, keys, fileKeys };
}

/**
 * 本文（書式の印つき）から編集欄の中身を作り直す。改行は <br>。
 * ★HTML として解釈しない（文字は必ずテキストノード）。
 * ★画像・PDF は embedFor(kind, n) が返すノードを置く（無ければ飛ばす）。非公開の中にあれば非公開の span の中に置く。
 * ★見出し・箇条書きの前後の改行は飲む（ブロックで行になるので、<br> を足すと空行が出る）。readEditor が改行を戻す
 */
function _renderMarked(el, text, embedFor = () => null) {
  el.textContent = '';
  const src = String(text ?? '')
    .replace(/\n(\{\{[hl]\}\})/g, '$1')
    .replace(/(\{\{\/[hl]\}\})\n/g, '$1');
  const count = { b: 0, i: 0, h: 0, l: 0, p: 0 };
  let chain = [];   // いま開いている要素（外 → 内）
  const make = (k) => {
    if (k === 'b' || k === 'i') return document.createElement(k);
    const span = document.createElement('span');
    span.className = _SPAN_CLASS[k];
    return span;
  };
  const hostFor = (want) => {
    let i = 0;
    while (i < chain.length && i < want.length && chain[i].k === want[i]) i++;
    chain = chain.slice(0, i);
    let host = i ? chain[i - 1].node : el;
    for (const k of want.slice(i)) { const n = make(k); host.appendChild(n); chain.push({ k, node: n }); host = n; }
    return host;
  };
  const putText = (t) => {
    if (!t) return;
    const host = hostFor(_NEST_ORDER.filter(k => count[k] > 0));
    t.split('\n').forEach((line, k) => {
      if (k > 0) host.appendChild(document.createElement('br'));
      if (line) host.appendChild(document.createTextNode(line));
    });
  };
  const used = new Set();
  let last = 0;
  for (const m of src.matchAll(/\{\{(\/?)([bihlp])\}\}|\{\{(image|file):(\d+)\}\}/g)) {
    putText(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2]) {
      const k = m[2];
      if (!m[1]) { count[k]++; continue; }
      if (count[k] === 0) continue;
      if (--count[k] === 0) {
        // ★閉じたら、次に同じ書式が来ても別の要素にする（箇条書きの項目が1つにつながらないように）
        const at = chain.findIndex(x => x.k === k);
        if (at >= 0) chain = chain.slice(0, at);
      }
      continue;
    }
    const id = `${m[3]}:${m[4]}`;
    if (used.has(id)) continue;
    used.add(id);
    const node = embedFor(m[3], parseInt(m[4], 10));
    if (!node) continue;
    hostFor(count.p > 0 ? ['p'] : []).appendChild(node);
  }
  putText(src.slice(last));
  // ★末尾が画像・PDF だと Safari がその後ろにカーソルを置けない。受け皿の改行を足す
  if (el.lastChild?.dataset?.imgKey || el.lastChild?.lastChild?.dataset?.imgKey) el.appendChild(document.createElement('br'));
}

/** 本文（文字だけ）を編集欄に入れる。下書きの復元用。★HTML として解釈しない */
export function setEditorText(el, text) {
  if (!el) return;
  _renderMarked(el, text);
  _syncEmpty(el);
}

/**
 * 保存済みの提出物（文章・画像・PDF）を編集欄に並べる（アーカイブの編集モードで直すとき）。
 * ★画像・PDF は送信済みなので url を持たせ、送り直さない（uploadEditorEmbeds が url 付きを飛ばす）。
 * ★PDF の1ページ目の絵も保存済みのものを使う（描き直さない）。
 * ★選んだ画像・PDF はこの編集欄だけが持つ（el._items）。他の編集欄とは混ざらない。
 * ★本文は印つきのまま _renderMarked で並べる（非公開の中の画像を非公開の span の中に戻すため。
 *   文章のかたまりごとに並べると、保存し直したときに画像が非公開の外に出て公開されてしまう）
 */
export function loadEditorContent(el, cd) {
  if (!el) return;
  el._items = new Map();
  const _items = el._items;
  const imgs  = submissionImages(cd);
  const files = submissionFiles(cd);
  let text = cd?.format === 'image' ? '' : String(cd?.content || '');
  // 本文に印の無い画像・PDF は、本文の後ろに並べる（submissionSegments と同じ）
  for (let n = 1; n <= imgs.length; n++) if (!text.includes(MARK(n))) text += `\n${MARK(n)}`;
  for (let n = 1; n <= files.length; n++) if (!text.includes(MARK_FILE(n))) text += `\n${MARK_FILE(n)}`;
  _renderMarked(el, text, (kind, n) => {
    const key = `k${++_seq}`;
    if (kind === 'image') {
      const url = imgs[n - 1];
      if (!url) return null;
      _items.set(key, { dataUrl: null, url });
      return _imageNode(key, url);
    }
    const f = files[n - 1];
    if (!f) return null;
    _items.set(key, { kind: 'file', blob: null, name: f.name, size: f.size, url: f.url,
      thumbUrl: f.thumb || null, thumbDataUrl: null, thumbReady: Promise.resolve() });
    const node = _fileNode(key, f.name, f.size);
    _fillFileThumb(node, f.thumb ? { dataUrl: f.thumb } : null);
    return node;
  });
  _syncEmpty(el);
}

// ── 書式の切り替え（見出し・箇条書き・非公開。2026-11-07）──────────────
// ★DOM を直接いじらず、選択範囲に目印を置いて「保存する形（印つきの本文）」を書き換え、編集欄を作り直す。
//   保存の形がただ1つの正なので、入れ子や画像をまたぐ非公開もずれない。画像・PDF のノードは使い回す。

/** 選択範囲（無ければ最後のカーソル）に目印を置き、本文を fn で書き換えて作り直す。fn が null を返したら何もしない */
function _transformEditor(el, fn) {
  const sel = window.getSelection?.();
  let r = sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0) : el._lastRange;
  if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
  r = r.cloneRange();
  if (r.collapsed) r.insertNode(document.createTextNode(SEL_START + SEL_END));
  else {
    const endR = r.cloneRange(); endR.collapse(false); endR.insertNode(document.createTextNode(SEL_END));
    r.collapse(true); r.insertNode(document.createTextNode(SEL_START));
  }
  const nodes = new Map();
  el.querySelectorAll('[data-img-key]').forEach(n => nodes.set(n.dataset.imgKey, n));
  const { text, keys, fileKeys } = readEditor(el);
  const next = fn(text);
  const embedFor = (kind, n) => nodes.get(kind === 'image' ? keys[n - 1] : fileKeys[n - 1]) || null;
  _renderMarked(el, next ?? text, embedFor);
  _restoreSelection(el);
  return next != null;
}

/** 目印の文字を消して、そこに選択範囲を戻す */
function _restoreSelection(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  let start = null, end = null;
  for (const n of texts) {
    let i;
    while ((i = n.nodeValue.indexOf(SEL_START)) >= 0) { n.nodeValue = n.nodeValue.slice(0, i) + n.nodeValue.slice(i + 1); start = { n, o: i }; }
    while ((i = n.nodeValue.indexOf(SEL_END)) >= 0) { n.nodeValue = n.nodeValue.slice(0, i) + n.nodeValue.slice(i + 1); end = { n, o: i }; }
  }
  if (!start) return;
  end ||= start;
  // ★カーソルだけ（範囲なし）で文字が空になったら、ゼロ幅の文字を置いて入れ物を残す（readEditor は消す）
  if (start.n === end.n && start.o === end.o && start.n.nodeValue === '') { start.n.nodeValue = ZWSP; start.o = end.o = 1; }
  for (const n of texts) if (n.nodeValue === '' && n !== start.n && n !== end.n) n.remove();
  const sel = window.getSelection?.();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(start.n, start.o);
  range.setEnd(end.n, end.o);
  sel.removeAllRanges();
  sel.addRange(range);
  el._lastRange = range.cloneRange();
}

/** 見出し・箇条書きを、選んだ行（カーソルのある行）ごとに付ける／外す。★画像・PDF だけの行は飛ばす */
export function toggleLineMark(text, key) {
  const lines = text.split('\n');
  const sLine = lines.findIndex(x => x.includes(SEL_START));
  if (sLine < 0) return null;
  let eLine = lines.findIndex(x => x.includes(SEL_END));
  if (eLine < sLine) eLine = sLine;
  const target = [];
  for (let i = sLine; i <= eLine; i++) if (!/\{\{(image|file):\d+\}\}/.test(lines[i])) target.push(i);
  if (target.length === 0) return null;
  const hasKey = (ln) => ln.includes(`{{${key}}}`);
  const remove = target.every(i => hasKey(lines[i]));
  for (const i of target) {
    const bare = lines[i].replace(/\{\{\/?[hl]\}\}/g, '');
    lines[i] = remove ? bare : `{{${key}}}${bare}{{/${key}}}`;
  }
  return lines.join('\n');
}

/**
 * 選んだ範囲を非公開にする／戻す。★範囲の中に公開の文字が1つでもあれば非公開に、全部非公開なら公開に戻す。
 * 画像・PDF も文字と同じに扱う（範囲に入っていれば一緒に非公開）。範囲が無ければ null
 */
export function togglePrivateMark(text) {
  const toks = [];
  let depth = 0;
  for (const m of text.matchAll(/\{\{(\/?)p\}\}|\{\{\/?[bihl]\}\}|\{\{(?:image|file):\d+\}\}|[\s\S]/gu)) {
    if (m[0] === '{{p}}') { depth++; continue; }
    if (m[0] === '{{/p}}') { depth = Math.max(0, depth - 1); continue; }
    const zero = /^\{\{\/?[bihl]\}\}$/.test(m[0]) || m[0] === SEL_START || m[0] === SEL_END;
    toks.push({ raw: m[0], zero, priv: depth > 0 });
  }
  const si = toks.findIndex(t => t.raw === SEL_START);
  const ei = toks.findIndex(t => t.raw === SEL_END);
  if (si < 0 || ei < 0) return null;
  const inside = toks.slice(si + 1, ei).filter(t => !t.zero);
  if (inside.length === 0) return null;
  const makePrivate = inside.some(t => !t.priv);
  for (let j = si + 1; j < ei; j++) toks[j].priv = makePrivate;
  let out = '', cur = false;
  for (const t of toks) {
    if (t.zero) { out += t.raw; continue; }
    if (t.priv !== cur) { out += t.priv ? '{{p}}' : '{{/p}}'; cur = t.priv; }
    out += t.raw;
  }
  if (cur) out += '{{/p}}';
  return out;
}

/** 見出し・箇条書きの中で Enter：その書式を抜けて次の行へ（カーソルより後ろは普通の文字として次の行に） */
function _exitLineOnEnter(text) {
  const at = text.indexOf(SEL_START);
  if (at < 0) return null;
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const head = text.slice(lineStart, at);
  const k = /\{\{h\}\}/.test(head) && !/\{\{\/h\}\}/.test(head) ? 'h'
    : /\{\{l\}\}/.test(head) && !/\{\{\/l\}\}/.test(head) ? 'l' : null;
  if (!k) return null;
  const rest = text.slice(at).replace(`{{/${k}}}`, '');
  return `${text.slice(0, at)}{{/${k}}}\n${rest}`;
}

/** key の並びから、送るもの（画像 { dataUrl, url } ／ PDF { kind:'file', blob, name, size, ... }）を返す */
export function itemsForKeys(keys, el = editorEl()) {
  const items = el ? _store(el) : new Map();
  return keys.map(k => items.get(k)).filter(Boolean);
}

/** 完了したあとに捨てる */
export function resetEditorImages(el = editorEl()) {
  if (el) el._items = new Map();
}

function _syncEmpty(el) {
  const { plain } = readEditor(el);
  el.classList.toggle('is-empty', !plain && !el.querySelector('[data-img-key]'));
}

// ── 挿入 ────────────────────────────────────────────────

function _inside(el, node) {
  return !!node && (node === el || el.contains(node));
}

// 挿入先の範囲。編集欄の中のカーソル → 最後にあった位置 → 末尾 の順
function _currentRange(el) {
  const sel = window.getSelection?.();
  if (sel && sel.rangeCount > 0 && _inside(el, sel.getRangeAt(0).startContainer)) return sel.getRangeAt(0).cloneRange();
  if (el._lastRange && _inside(el, el._lastRange.startContainer)) return el._lastRange.cloneRange();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  return r;
}

// 画面上の座標から範囲を作る（ドロップした位置）
function _rangeFromPoint(el, x, y) {
  let r = null;
  if (document.caretRangeFromPoint) {
    r = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
  }
  // ★画像（編集できない塊）の中を指していたら、その画像の直後にする
  const img = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest?.('[data-img-key]');
  if (img && _inside(el, img)) { r = document.createRange(); r.setStartAfter(img); r.collapse(true); }
  if (!r || !_inside(el, r.startContainer)) return _currentRange(el);
  return r;
}

// 範囲にノードを入れ、カーソルをその直後へ。次に入れるものの範囲を返す
function _insertAt(el, range, node) {
  range.deleteContents();
  range.insertNode(node);
  // ★画像が末尾に来ると、Safari はその後ろにカーソルを置けない。受け皿の改行を足す
  if (node.nodeType === 1 && node.dataset?.imgKey && !node.nextSibling) el.appendChild(document.createElement('br'));
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  const sel = window.getSelection?.();
  if (sel && document.activeElement === el) { sel.removeAllRanges(); sel.addRange(after); }
  el._lastRange = after.cloneRange();
  return after;
}

function _insertText(el, range, text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'));
    if (line) frag.appendChild(document.createTextNode(line));
  });
  const last = frag.lastChild;
  if (!last) return;
  range.deleteContents();
  range.insertNode(frag);
  const after = document.createRange();
  after.setStartAfter(last);
  after.collapse(true);
  const sel = window.getSelection?.();
  if (sel) { sel.removeAllRanges(); sel.addRange(after); }
  el._lastRange = after.cloneRange();
}

function _imageNode(key, dataUrl) {
  const span = document.createElement('span');
  span.className = 'c-editor__embed';
  span.contentEditable = 'false';
  span.dataset.imgKey = key;
  // ★タグの間に空白や改行を入れないこと。編集欄は white-space: pre-wrap なので、
  //   空白がそのまま空行として描かれ、画像の上下に大きな隙間ができる（実際にそうなった）。
  span.innerHTML =
    `<img src="${_esc(dataUrl)}" class="c-editor__embed-img" alt="" draggable="false">`
    + `<button type="button" data-img-remove class="c-editor__embed-remove" aria-label="画像を外す">`
    + `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">`
    + `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
  return span;
}

// PDF の塊。1ページ目の絵ができるまではくるくるを出す
function _fileNode(key, name, size) {
  const span = document.createElement('span');
  span.className = 'c-editor__embed c-editor__file is-loading';
  span.contentEditable = 'false';
  span.dataset.imgKey = key;
  span.dataset.kind = 'file';
  // ★タグの間に空白を入れない（pre-wrap で空行になる。_imageNode と同じ）
  span.innerHTML =
    `<span class="c-editor__file-thumb"><span class="c-spinner c-spinner--sm"></span></span>`
    + `<span class="c-editor__file-name">📄 ${_esc(name)}<span class="c-editor__file-size">${_esc(formatFileSize(size))}</span></span>`
    + `<button type="button" data-img-remove class="c-editor__embed-remove" aria-label="ファイルを外す">`
    + `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">`
    + `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
  return span;
}

// 1ページ目の絵ができたら差し替える（描けなければ「PDF」の札）
function _fillFileThumb(node, thumb) {
  const box = node.querySelector('.c-editor__file-thumb');
  if (!box) return;
  box.innerHTML = thumb
    ? `<img src="${_esc(thumb.dataUrl)}" class="c-editor__embed-img" alt="" draggable="false">`
    : `<span class="c-editor__file-badge">PDF</span>`;
  node.classList.remove('is-loading');
}

async function _insertPdf(el, file, at, onChange) {
  const key = `k${++_seq}`;
  const item = { kind: 'file', blob: file, name: file.name || 'document.pdf', size: file.size, thumbDataUrl: null, url: null, thumbUrl: null };
  _store(el).set(key, item);
  const node = _fileNode(key, item.name, item.size);
  const after = _insertAt(el, at, node);
  _syncEmpty(el);
  onChange?.();
  // ★絵を描き終えるまで送信を待たせる（submitMissionClear が thumbReady を待つ）
  item.thumbReady = renderPdfThumb(file).then((thumb) => {
    item.thumbDataUrl = thumb?.dataUrl || null;
    _fillFileThumb(node, thumb);
  });
  return after;
}

/**
 * 画像・PDF を範囲の位置へ順に入れる（画像は1枚ずつ縮小、PDF は1ページ目を絵にする）。
 * ★順番に処理する（大きな写真を同時にデコードするとスマホのメモリを食う）。
 */
export async function insertFiles(el, files, range, onChange) {
  if (!el) return;

  const all    = [...files];
  const images = all.filter(_isImageFile);
  const pdfs   = all.filter(_isPdfFile);
  if (images.length === 0 && pdfs.length === 0) { _toast('画像か PDF を選んでください'); return; }

  let imgRoom  = SUBMISSION_MAX_IMAGES - imageCount(el);
  let fileRoom = SUBMISSION_MAX_FILES  - fileCount(el);
  if (images.length > Math.max(0, imgRoom)) {
    _toast(imgRoom <= 0 ? `画像は${SUBMISSION_MAX_IMAGES}枚までです` : `画像は${SUBMISSION_MAX_IMAGES}枚までです。先頭の${imgRoom}枚だけ追加しました`);
  }
  if (pdfs.length > Math.max(0, fileRoom)) {
    _toast(fileRoom <= 0 ? `PDF は${SUBMISSION_MAX_FILES}つまでです` : `PDF は${SUBMISSION_MAX_FILES}つまでです。先頭の${fileRoom}つだけ追加しました`);
  }

  let at = range || _currentRange(el);
  let unreadable = 0, tooLarge = 0, pdfTooLarge = 0;
  // ★選んだ順（ドロップした順）のまま入れる
  for (const file of all) {
    if (!el.isConnected) return;
    if (!_inside(el, at.startContainer)) at = _currentRange(el);
    if (_isPdfFile(file)) {
      if (fileRoom <= 0) continue;
      if (file.size > SUBMISSION_FILE_MAX_BYTES) { pdfTooLarge++; continue; }
      fileRoom--;
      at = await _insertPdf(el, file, at, onChange);
      continue;
    }
    if (!_isImageFile(file) || imgRoom <= 0) continue;
    imgRoom--;
    let dataUrl = null;
    try { dataUrl = await _resizeImageDataUrl(await _readAsDataUrl(file)); } catch (_) { /* 下で数える */ }
    if (!dataUrl) { unreadable++; imgRoom++; continue; }
    if (dataUrl.length > SUBMISSION_MAX_BYTES) { tooLarge++; imgRoom++; continue; }
    // 読み込み中に別のタスクへ移った／描き直しで編集欄が差し替わったら捨てる
    if (!el.isConnected) return;
    const key = `k${++_seq}`;
    _store(el).set(key, { dataUrl, url: null });
    if (!_inside(el, at.startContainer)) at = _currentRange(el);
    at = _insertAt(el, at, _imageNode(key, dataUrl));
    _syncEmpty(el);
    onChange?.();
  }
  if (unreadable > 0) _toast(`${unreadable}枚の画像を読み込めませんでした。この形式（HEIC など）は JPEG か PNG にしてから追加してください`);
  if (tooLarge > 0)   _toast(`${tooLarge}枚の画像が大きすぎて追加できませんでした`);
  if (pdfTooLarge > 0) _toast(`${pdfTooLarge}つの PDF が大きすぎて追加できませんでした（1つ ${formatFileSize(SUBMISSION_FILE_MAX_BYTES)} まで）`);
}

// ── 「ここに入る」の縦線 ──────────────────────────────────
// ★画像の並べ替え（_bindImageDrag）と、外からのドロップ（Finder など）で同じものを使う。
//   どちらも「ここに置かれる」を同じ見た目で示すため。
let _caretEl = null;
function _showCaret(range) {
  const rect = range && _caretRect(range);
  if (!rect) { _hideCaret(); return; }
  if (!_caretEl || !_caretEl.isConnected) {
    _caretEl = document.createElement('div');
    _caretEl.className = 'c-editor__caret';
    document.body.appendChild(_caretEl);
  }
  _caretEl.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  _caretEl.style.height = `${rect.height}px`;
}
function _hideCaret() {
  _caretEl?.remove();
  _caretEl = null;
}

// ── 配線 ────────────────────────────────────────────────

// ファイルを抱えたドラッグか（テキストのドラッグと区別する）
// ★Safari は types に 'public.file-url' などを並べることがある。items の kind も見る
const _hasFiles = (e) => {
  const dt = e.dataTransfer;
  if (!dt) return false;
  const types = [...(dt.types || [])];
  return types.includes('Files') || types.includes('public.file-url')
    || [...(dt.items || [])].some(it => it.kind === 'file');
};

// 外からのドラッグが編集欄の上にあるあいだ、最後に示した差し込み先（線と同じ位置に落とす）
let _extDropRange = null;
let _extHideTimer = 0;
let _extEditor = null;   // いまファイルを重ねている編集欄
function _endExternalDrag() {
  clearTimeout(_extHideTimer);
  _extDropRange = null;
  _extEditor?.classList.remove('is-dragover');
  _extEditor = null;
  _hideCaret();
}

let _docBound = false;
function _bindDocumentOnce() {
  if (_docBound) return;
  _docBound = true;
  // ★書式のボタン（B / I）は document で委譲して受ける。タスク詳細は描き直しのたびに編集欄のノードだけを
  //   差し戻し、ボタンは作り直すので、ボタンに直接付けると描き直しのあと効かなくなる（実際にそうなった）
  // ★mousedown で止める。止めないとボタンにフォーカスが移り、選んでいた文字の範囲が外れる
  // ★タッチでも選択が外れないよう pointerdown でも止める（ポップアップのボタン）
  for (const ev of ['mousedown', 'pointerdown']) {
    document.addEventListener(ev, (e) => {
      if (e.target.closest?.('[data-editor-format]')) e.preventDefault();
    });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-editor-format]');
    if (!btn) return;
    const el = btn.closest('.c-editor-field')?.querySelector('.c-editor')
      || (btn.closest('.c-format-popup') ? _popup?._el : null);
    if (!el || !document.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    _applyFormat(el, btn.dataset.editorFormat, el._onEditorChange);
  });
  // 最後のカーソル位置を覚える（画像ボタンを押すとフォーカスが外れるため）
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) { _hidePopup(); return; }
    const el = _editorOf(sel.getRangeAt(0).startContainer);
    if (el) el._lastRange = sel.getRangeAt(0).cloneRange();
    _syncPopup();
  });
  // スクロール・大きさが変わったら付け直す（位置がずれたまま残さない）
  window.addEventListener('scroll', () => { if (_popup && !_popup.hidden) _syncPopup(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => _hidePopup());
  // ★編集欄を少し外してファイルを落としたとき、ブラウザがその画像を開いて
  //   ページごと離れてしまう（書きかけが消える）。編集欄があるあいだは止める。
  //   完了フォームの枠の中なら、末尾に入れる。
  document.addEventListener('dragover', (e) => {
    if (!_hasFiles(e) || !document.querySelector('.c-editor')) return;
    e.preventDefault();
    // 編集欄の外に出たら「ここに入る」を消す
    if (!_editorOf(e.target)) _endExternalDrag();
  });
  document.addEventListener('drop', (e) => {
    if (!_hasFiles(e) || !document.querySelector('.c-editor') || _editorOf(e.target)) return;   // 編集欄の中は編集欄の配線に任せる
    e.preventDefault();
    _endExternalDrag();
    // 入れ物（完了フォーム・編集欄の枠）の中なら、その編集欄の末尾に入れる
    const host = e.target.closest?.('.c-editor-field, #clear-mission-modal');
    const el = host?.querySelector('.c-editor');
    if (el) {
      const end = document.createRange(); end.selectNodeContents(el); end.collapse(false);
      insertFiles(el, _filesFrom(e.dataTransfer), end, el._onEditorChange);
    }
  });
  // ウィンドウの外へ出た・Esc で取り消した
  document.addEventListener('dragend', () => _endExternalDrag());
}

/**
 * 編集欄に配線する。★描き直しで同じノードが戻ってくるので、二重に配線しない（_bound）。
 * @param {HTMLElement} el
 * @param {{ onChange?: () => void }} opts  入力・画像の追加／削除のたびに呼ぶ（下書きの保存）
 */
// ===== 書式（太字・斜体・見出し・箇条書き・非公開）=====
// ボタンは2か所：編集欄の左下のツールバー（キーボードの受け皿・ポップアップが出ない場面の逃げ道）と、
// 文字を選んだときに出るポップアップ。★どちらも同じ data-editor-format を持ち、document で委譲して受ける。
// ★文字だけの欄（data-text-only。目的）には出さない
const _FORMATS = [
  { id: 'bold',    label: '太字',       text: 'B',     title: '太字（⌘B）' },
  { id: 'italic',  label: '斜体',       text: 'I',     title: '斜体（⌘I）' },
  { id: 'heading', label: '見出し',     text: '見出し', title: '見出し（1行）' },
  { id: 'list',    label: '箇条書き',   text: '・',    title: '箇条書き（1行＝1項目）' },
  { id: 'private', label: '非公開にする', text: '非公開', title: '非公開（外に公開しない。メンバーには見える）' },
];
const _MARK_OF = { heading: 'h', list: 'l', private: 'p' };

function _formatButtonsHtml(cls) {
  return _FORMATS.map(f => `
      <button type="button" class="${cls}-btn ${cls}-btn--${f.id}" data-editor-format="${f.id}"
        aria-label="${f.label}" aria-pressed="false" title="${f.title}">${f.text}</button>`).join('');
}

/** 編集欄の左下に置くツールバー。★置き場所は .c-editor-field の中（bindClearEditor が拾う） */
export function editorFormatButtonsHtml() {
  return `
    <div class="c-editor-field__format" role="toolbar" aria-label="文字の書式">${_formatButtonsHtml('c-editor-field__format')}
    </div>`;
}

function _applyFormat(el, cmd, onChange) {
  if (document.activeElement !== el && !el.contains(document.activeElement)) el.focus();
  const mark = _MARK_OF[cmd];
  if (mark) {
    const fn = mark === 'p' ? togglePrivateMark : (t) => toggleLineMark(t, mark);
    const done = _transformEditor(el, fn);
    if (!done && mark === 'p') _toast('非公開にする文字を選んでください');
  } else {
    // ★<b> / <i> で入れる（style="font-weight" の span にしない）。readEditor はどちらも読めるが揃えておく
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
    document.execCommand(cmd, false, null);
  }
  _syncEmpty(el);
  _syncFormatButtons(el);
  _hidePopup();
  onChange?.();
}

function _formatButtons(el) {
  const own = [...(el.closest('.c-editor-field')?.querySelectorAll('[data-editor-format]') || [])];
  if (_popup && _popup._el === el) own.push(..._popup.querySelectorAll('[data-editor-format]'));
  return own;
}

// いまのカーソルが、その書式の中にあるか
function _inMark(el, mark) {
  const node = document.getSelection()?.anchorNode;
  const host = node?.nodeType === 1 ? node : node?.parentElement;
  const span = host?.closest?.(`.${_SPAN_CLASS[mark]}`);
  return !!span && el.contains(span);
}

function _syncFormatButtons(el) {
  const inside = el.contains(document.getSelection()?.anchorNode);
  for (const btn of _formatButtons(el)) {
    const f = btn.dataset.editorFormat;
    let on = false;
    if (_MARK_OF[f]) on = _inMark(el, _MARK_OF[f]);
    else { try { on = document.queryCommandState(f); } catch (_) {} }
    btn.classList.toggle('is-active', !!on && inside);
    btn.setAttribute('aria-pressed', String(!!on));
  }
}

// ── 文字を選んだときのポップアップ（2026-11-07。指示書B §6-3）────────────
// ★出すのは書ける編集欄（.c-editor）で文字を選んだときだけ。文字だけの欄（data-text-only）には出さない。
// ★位置は選んだ範囲の上。上に入らなければ下。★タッチの端末は最初から下に出す
//   （iOS / Android は選んだ範囲の上に純正のメニュー（コピーなど）を出すので、重ならないように）。
// ★body 直下に1つだけ置き、どの編集欄のものかは _popup._el で持つ。
let _popup = null;

function _hidePopup() {
  if (_popup) _popup.hidden = true;
}

function _showPopup(el, range) {
  if (!_popup) {
    _popup = document.createElement('div');
    _popup.className = 'c-format-popup';
    _popup.setAttribute('role', 'toolbar');
    _popup.setAttribute('aria-label', '文字の書式');
    _popup.innerHTML = _formatButtonsHtml('c-format-popup');
    document.body.appendChild(_popup);
  }
  _popup._el = el;
  _popup.hidden = false;
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) { _hidePopup(); return; }
  const pw = _popup.offsetWidth, ph = _popup.offsetHeight, gap = 8;
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  let top = touch ? rect.bottom + gap : rect.top - ph - gap;
  if (top < gap) top = rect.bottom + gap;
  if (top + ph > window.innerHeight - gap) top = Math.max(gap, rect.top - ph - gap);
  const left = Math.min(Math.max(gap, rect.left + rect.width / 2 - pw / 2), window.innerWidth - pw - gap);
  _popup.style.top  = `${Math.round(top)}px`;
  _popup.style.left = `${Math.round(left)}px`;
  _syncFormatButtons(el);
}

function _syncPopup() {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { _hidePopup(); return; }
  const r = sel.getRangeAt(0);
  const el = _editorOf(r.commonAncestorContainer);
  if (!el || el.hasAttribute('data-text-only') || el.getAttribute('contenteditable') !== 'true') { _hidePopup(); return; }
  _showPopup(el, r);
}


export function bindClearEditor(el, { onChange } = {}) {
  if (!el || el._bound) return;
  el._bound = true;
  el._onEditorChange = onChange;
  // ★文字だけの欄（data-text-only。目的＝初期タスク def-1。2026-10-02）。画像・PDF・太字・斜体を受けない。
  //   ボタンは描画側で出さない。ここでは ⌘B / ⌘I・貼り付け・ドロップのファイルを止める
  const textOnly = el.hasAttribute('data-text-only');
  _bindDocumentOnce();
  _syncEmpty(el);

  el.addEventListener('input', () => { _syncEmpty(el); onChange?.(); });

  // 書式は太字・斜体だけ（⌘B / ⌘I。2026-09-28）。下線などは持たない
  // ★ブラウザ任せにせず自分で execCommand する（ボタンと同じ経路にして、<b> / <i> で入れる）
  el.addEventListener('keydown', (e) => {
    // ★見出し・箇条書きの中で Enter：その書式を抜けて次の行へ（変換中・Shift+Enter はブラウザに任せる）
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.metaKey && !e.ctrlKey && !textOnly
        && (_inMark(el, 'h') || _inMark(el, 'l'))) {
      e.preventDefault();
      _transformEditor(el, _exitLineOnEnter);
      _syncEmpty(el);
      _syncFormatButtons(el);
      onChange?.();
      return;
    }
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'u') { e.preventDefault(); return; }
    if (k === 'b' || k === 'i') { e.preventDefault(); if (!textOnly) _applyFormat(el, k === 'b' ? 'bold' : 'italic', onChange); }
  });
  el.addEventListener('keyup', () => _syncFormatButtons(el));
  el.addEventListener('mouseup', () => _syncFormatButtons(el));

  // 貼り付け：画像ならカーソル位置へ、文字は書式を落として入れる
  el.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const files = _filesFrom(cd).filter(f => _isImageFile(f) || _isPdfFile(f));
    const range = _currentRange(el);
    if (files.length > 0 && textOnly) {
      if (!cd.getData('text/plain')) { _toast('ここは文字だけで書けます'); return; }
    } else if (files.length > 0) { insertFiles(el, files, range, onChange); return; }
    // ★Finder で「コピー」したファイルは、ブラウザによっては画像ではなく
    //   ファイル名の文字だけが届く。そのまま入れると名前が本文に混ざるので、案内だけ出す
    const plain = cd.getData('text/plain');
    const uris  = cd.getData('text/uri-list');
    if (/^file:/i.test(uris) || (_IMAGE_EXT_RE.test(plain.trim()) && !/\s/.test(plain.trim()))) {
      _toast('このブラウザでは、コピーしたファイルを貼り付けられません。ドラッグ＆ドロップか画像ボタンで追加してください');
      return;
    }
    _insertText(el, range, plain);
    _syncEmpty(el);
    onChange?.();
  });

  // ドラッグ＆ドロップ：離した位置へ。重ねているあいだ「ここに入る」の縦線を出す
  // ★dragenter も止める（Safari は dragenter を止めないとドロップ先として扱わないことがある）
  el.addEventListener('dragenter', (e) => { if (_hasFiles(e)) e.preventDefault(); });
  el.addEventListener('dragover', (e) => {
    if (!_hasFiles(e) || textOnly) return;   // ★文字だけの欄では「ここに入る」の線を出さない
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // 別の編集欄から移ってきたら、前の欄の色を戻す
    if (_extEditor && _extEditor !== el) { _extEditor.classList.remove('is-dragover'); _extDropRange = null; }
    _extEditor = el;
    el.classList.add('is-dragover');
    _extDropRange = _dropRangeAt(el, e.clientX, e.clientY, null) || _extDropRange;
    _showCaret(_extDropRange);
    // ★ウィンドウの外へ出ると dragleave が来ないことがある。dragover が途切れたら消す
    clearTimeout(_extHideTimer);
    _extHideTimer = setTimeout(() => _endExternalDrag(), 250);
  });
  el.addEventListener('dragleave', (e) => {
    // 子要素の上へ移っただけのときも dragleave が来る。本当に外へ出たときだけ消す
    if (e.relatedTarget && _inside(el, e.relatedTarget)) return;
    if (!e.relatedTarget) return;   // 相手が分からないときは dragover の途切れ（上のタイマー）に任せる
    _endExternalDrag();
  });
  el.addEventListener('drop', (e) => {
    const shown = _extEditor === el ? _extDropRange : null;
    _endExternalDrag();
    e.preventDefault();   // ★HTML のまま落とさせない（書式やタグを持ち込まない）
    // ★線で示した位置に落とす（見せた場所と入る場所をずらさない）
    const range = (shown && _inside(el, shown.startContainer)) ? shown : _rangeFromPoint(el, e.clientX, e.clientY);
    if (_hasFiles(e)) {
      if (textOnly) { _toast('ここは文字だけで書けます'); return; }
      insertFiles(el, _filesFrom(e.dataTransfer), range, onChange); return;
    }
    const text = e.dataTransfer?.getData('text/plain');
    if (text) { _insertText(el, range, text); _syncEmpty(el); onChange?.(); }
  });

  // 置いた画像を指（マウス）で掴んで動かす
  _bindImageDrag(el, onChange);

  // 画像の×
  el.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-img-remove]');
    if (!btn || !_inside(el, btn)) return;
    e.preventDefault();
    btn.closest('[data-img-key]')?.remove();
    _syncEmpty(el);
    onChange?.();
  });
}

// ── 置いた画像の並べ替え（掴んで動かす）──────────────────────
//
// ★Pointer Events 1系統で受ける（マウスとタッチで2系統張ると1回の操作で2回動く。
//   eventCalendarSheet.js / createEvent.js と同じ方針）。
// ★「指に吸い付く」ように：
//   - 掴んだ位置（画像のどこを持ったか）を保ったまま、分身（ghost）が指にぴったり付いてくる
//   - 持ち上げた瞬間に少し大きく・影が付く（CSS の is-lifted）
//   - 離すと、分身が落ちた先の位置へ吸い込まれてから消える（FLIP）
// ★タッチは長押し（DRAG_HOLD_MS）で掴む。すぐ掴むと、画像の上から始めたスクロールができなくなる。
//   長押しの前に指が動いたら掴まない（＝ふつうのスクロール）。
// ★マウスは少し動かした時点（DRAG_MOUSE_SLOP）で掴む。クリック（×など）と区別するため。
// ★ドラッグ中は再描画しない。分身と差し込み線の transform / 位置だけを動かす。
const DRAG_HOLD_MS    = 280;
const DRAG_TOUCH_SLOP = 8;    // 長押しの間に許す指のぶれ(px)
const DRAG_MOUSE_SLOP = 4;
const DRAG_EDGE       = 48;   // 端から何px以内で自動スクロールするか
const DRAG_SCROLL_MAX = 14;   // 1フレームあたりの自動スクロール量の上限(px)

function _reduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

// 画面上の点に対する「差し込み先」。画像の上なら、上半分＝その前／下半分＝その後ろ
function _dropRangeAt(el, x, y, dragging) {
  const hit = document.elementFromPoint(x, y);
  const img = hit?.closest?.('[data-img-key]');
  if (img && _inside(el, img)) {
    const r = document.createRange();
    const box = img.getBoundingClientRect();
    if (y < box.top + box.height / 2) r.setStartBefore(img); else r.setStartAfter(img);
    r.collapse(true);
    return r;
  }
  if (!hit || !_inside(el, hit)) return null;
  let r = null;
  if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
  else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
  }
  if (!r || !_inside(el, r.startContainer) || (dragging && _inside(dragging, r.startContainer))) return null;
  return r;
}

// 差し込み線の位置（折り返しの先頭・空行では矩形が取れないので、近くのノードで補う）
function _caretRect(range) {
  const rects = range.getClientRects();
  if (rects.length > 0 && rects[0].height > 0) return rects[0];
  const c = range.startContainer;
  const node = c.nodeType === 1 ? (c.childNodes[range.startOffset] || c.childNodes[range.startOffset - 1] || c) : c.parentElement;
  const b = node?.getBoundingClientRect?.();
  if (!b) return null;
  const atEnd = c.nodeType === 1 && !c.childNodes[range.startOffset];
  return { left: atEnd ? b.right : b.left, top: b.top, height: Math.max(b.height, 20) };
}

function _bindImageDrag(el, onChange) {
  // ネイティブのドラッグ（画像や選択範囲を引きずる）と、iOS の長押しメニューを止める
  el.addEventListener('dragstart', (e) => { if (e.target.closest?.('[data-img-key]')) e.preventDefault(); });
  el.addEventListener('contextmenu', (e) => { if (e.target.closest?.('[data-img-key]')) e.preventDefault(); });

  el.addEventListener('pointerdown', (e) => {
    const item = e.target.closest?.('[data-img-key]');
    if (!item || !_inside(el, item) || e.target.closest('[data-img-remove]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'mouse') e.preventDefault();   // 文字の選択を始めさせない

    const startX = e.clientX, startY = e.clientY;
    const pid = e.pointerId;
    let lastX = startX, lastY = startY;
    let drag = null;       // 掴んでいる間の状態
    let holdTimer = null;

    const cleanupListeners = () => {
      clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('touchmove', blockScroll, { passive: false });
    };
    // ★掴んでいる間だけ、タッチのスクロールを止める（passive:false でないと止まらない）
    const blockScroll = (ev) => { if (drag) ev.preventDefault(); };

    const lift = () => {
      const box = item.getBoundingClientRect();
      // ★塊ごと複製する（PDF は絵が描き終わっていないこともあり、img が無い）
      const ghost = item.cloneNode(true);
      ghost.removeAttribute('data-img-key');
      ghost.removeAttribute('contenteditable');
      ghost.querySelector('[data-img-remove]')?.remove();
      ghost.classList.add('c-editor__ghost');
      ghost.style.width  = `${box.width}px`;
      ghost.style.height = `${box.height}px`;
      document.body.appendChild(ghost);
      drag = {
        ghost, box,
        grabX: startX - box.left, grabY: startY - box.top,   // 画像のどこを持ったか
        range: null, raf: 0,
      };
      item.classList.add('is-dragging');
      el.classList.add('is-reordering');
      navigator.vibrate?.(8);
      place();
      // 次のフレームで持ち上げる（transition を効かせるため）
      requestAnimationFrame(() => ghost.classList.add('is-lifted'));
      drag.raf = requestAnimationFrame(tick);
    };

    // 分身を指の位置へ（掴んだ位置を保つ）
    const place = () => {
      drag.ghost.style.transform = `translate3d(${lastX - drag.grabX}px, ${lastY - drag.grabY}px, 0)`;
    };

    // 毎フレーム：差し込み先の計算と、端での自動スクロール
    const tick = () => {
      if (!drag) return;
      // 編集欄の中（max-height で独立スクロール）とページの両方
      const eb = el.getBoundingClientRect();
      const speed = (d) => Math.min(DRAG_SCROLL_MAX, Math.ceil((DRAG_EDGE - d) / 3));
      if (el.scrollHeight > el.clientHeight) {
        if (lastY < eb.top + DRAG_EDGE) el.scrollTop -= speed(lastY - eb.top);
        else if (lastY > eb.bottom - DRAG_EDGE) el.scrollTop += speed(eb.bottom - lastY);
      }
      if (lastY < DRAG_EDGE) window.scrollBy(0, -speed(lastY));
      else if (lastY > window.innerHeight - DRAG_EDGE) window.scrollBy(0, speed(window.innerHeight - lastY));

      const range = _dropRangeAt(el, lastX, lastY, item);
      drag.range = range;
      _showCaret(range);
      drag.raf = requestAnimationFrame(tick);
    };

    const onMove = (ev) => {
      if (ev.pointerId !== pid) return;
      lastX = ev.clientX; lastY = ev.clientY;
      if (drag) { ev.preventDefault(); place(); return; }
      const moved = Math.hypot(lastX - startX, lastY - startY);
      if (e.pointerType === 'mouse') {
        if (moved > DRAG_MOUSE_SLOP) lift();
      } else if (moved > DRAG_TOUCH_SLOP) {
        cleanupListeners();   // 長押しの前に動いた＝スクロール。掴まない
      }
    };

    const finish = (commit) => {
      cleanupListeners();
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      const { ghost } = drag;
      _hideCaret();
      const range = commit ? drag.range : null;
      if (range && !_inside(item, range.startContainer)) {
        range.insertNode(item);   // ★insertNode は移動になる（複製しない）
        if (!item.nextSibling) el.appendChild(document.createElement('br'));
        el._lastRange = null;
      }
      // 落ちた先へ吸い込ませてから消す
      const to = item.getBoundingClientRect();
      const done = () => {
        ghost.remove();
        item.classList.remove('is-dragging');
        el.classList.remove('is-reordering');
      };
      if (_reduceMotion()) { done(); }
      else {
        ghost.classList.remove('is-lifted');
        ghost.classList.add('is-landing');
        ghost.style.transform = `translate3d(${to.left}px, ${to.top}px, 0)`;
        ghost.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 400);   // ★transitionend が来なくても必ず片付ける
      }
      drag = null;
      if (range) { _syncEmpty(el); onChange?.(); }
    };
    const onUp = (ev) => { if (ev.pointerId === pid) finish(true); };
    const onCancel = (ev) => { if (ev.pointerId === pid) finish(false); };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    document.addEventListener('touchmove', blockScroll, { passive: false });
    if (e.pointerType !== 'mouse') holdTimer = setTimeout(lift, DRAG_HOLD_MS);
  });
}
