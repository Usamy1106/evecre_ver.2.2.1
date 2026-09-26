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
// ■ 選んだ画像・PDF の中身はこのモジュールが持つ（_items）。
//   ★下書き（localStorage）には入れない（複数枚の dataURL は約5MBをすぐにあふれる）。
//   送信済みの URL も覚えておき、完了に失敗して押し直したときに送り直さない。

import { SUBMISSION_MAX_IMAGES, SUBMISSION_MAX_FILES, SUBMISSION_FILE_MAX_BYTES } from './constants.js';
import { renderPdfThumb } from './pdfThumb.js';
import { formatFileSize, submissionSegments } from './utils.js';

// 本文の中の画像・添付ファイル（PDF）の印。★utils.js の IMAGE_MARK_RE / FILE_MARK_RE と同じ形に保つこと
// ★編集欄の中の塊は、画像も PDF も data-img-key を持つ（並べ替え・×・差し込み先の判定を共通にするため）。
//   PDF は data-kind="file" で見分ける。
const MARK      = (n) => `{{image:${n}}}`;
const MARK_FILE = (n) => `{{file:${n}}}`;

// 提出物画像の上限。server.js の SUBMISSION_MAX_BYTES と揃えること（2MB）。
export const SUBMISSION_MAX_BYTES = 2 * 1024 * 1024;
const RESIZE_MAX_EDGE = 1600;  // 長辺の上限(px)
const RESIZE_QUALITY  = 0.8;   // JPEG 品質

// key → { dataUrl, url }。どのタスクのものかは _missionId で区別し、変わったら捨てる
let _missionId = null;
let _items = new Map();
let _seq = 0;
// 編集欄の中で最後にカーソルがあった位置（画像ボタンを押すと編集欄からフォーカスが外れるため）
let _lastRange = null;

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

/**
 * 編集欄を「本文（印つき）」と「画像の key の並び」に変換する。
 * ★HTML は捨てる。取り出すのは文字・改行・画像の印だけ。
 * @returns {{ text: string, plain: string, keys: string[], fileKeys: string[] }}
 *   text     … 画像・PDF の位置に {{image:N}} / {{file:N}} を入れた本文（保存用）
 *   plain    … 印を外した本文（下書き・空判定用）
 *   keys     … 画像の key の並び／fileKeys … PDF の key の並び
 */
export function readEditor(el = editorEl()) {
  const out = [];
  const keys = [];
  const fileKeys = [];
  const endsWithNewline = () => { const s = out.join(''); return s === '' || s.endsWith('\n'); };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { out.push(n.nodeValue.replace(/​/g, '')); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      if (n.dataset?.imgKey) {
        if (n.dataset.kind === 'file') { fileKeys.push(n.dataset.imgKey); out.push(MARK_FILE(fileKeys.length)); }
        else { keys.push(n.dataset.imgKey); out.push(MARK(keys.length)); }
        continue;
      }
      if (n.tagName === 'BR') { out.push('\n'); continue; }
      // Enter でブラウザが作る <div>/<p> は「その前で改行」
      if (/^(DIV|P|LI)$/.test(n.tagName) && !endsWithNewline()) out.push('\n');
      walk(n);
    }
  };
  if (el) walk(el);
  const text = out.join('').replace(/\s+$/, '');
  const plain = text.replace(/\{\{(image|file):\d+\}\}/g, '').trim();
  return { text, plain, keys, fileKeys };
}

/** 本文（文字だけ）を編集欄に入れる。下書きの復元用。★HTML として解釈しない */
export function setEditorText(el, text) {
  if (!el) return;
  el.textContent = '';
  const lines = String(text || '').split('\n');
  lines.forEach((line, i) => {
    if (i > 0) el.appendChild(document.createElement('br'));
    if (line) el.appendChild(document.createTextNode(line));
  });
  _syncEmpty(el);
}

/**
 * 保存済みの提出物（文章・画像・PDF）を編集欄に並べる（アーカイブの編集モードで直すとき）。
 * ★画像・PDF は送信済みなので url を持たせ、送り直さない（uploadEditorEmbeds が url 付きを飛ばす）。
 * ★PDF の1ページ目の絵も保存済みのものを使う（描き直さない）。
 * ★この編集欄のタスクIDは dataset.missionId（完了フォームと別の値にして _items を混ぜないこと）。
 */
export function loadEditorContent(el, cd) {
  if (!el) return;
  _missionId = el.dataset.missionId;
  _items = new Map();
  el.textContent = '';
  const appendText = (text) => {
    String(text).split('\n').forEach((line, i) => {
      if (i > 0) el.appendChild(document.createElement('br'));
      if (line) el.appendChild(document.createTextNode(line));
    });
  };
  let prevWasText = false;
  for (const seg of submissionSegments(cd)) {
    if (seg.type === 'text') {
      if (prevWasText) el.appendChild(document.createElement('br'));
      appendText(seg.text);
      prevWasText = true;
      continue;
    }
    const key = `k${++_seq}`;
    if (seg.type === 'image') {
      _items.set(key, { dataUrl: null, url: seg.url });
      el.appendChild(_imageNode(key, seg.url));
    } else {
      const f = seg.file;
      _items.set(key, { kind: 'file', blob: null, name: f.name, size: f.size, url: f.url,
        thumbUrl: f.thumb || null, thumbDataUrl: null, thumbReady: Promise.resolve() });
      const node = _fileNode(key, f.name, f.size);
      el.appendChild(node);
      _fillFileThumb(node, f.thumb ? { dataUrl: f.thumb } : null);
    }
    prevWasText = false;
  }
  // ★末尾が画像・PDF だと Safari がその後ろにカーソルを置けない。受け皿の改行を足す
  if (el.lastChild?.dataset?.imgKey) el.appendChild(document.createElement('br'));
  _syncEmpty(el);
}

/** key の並びから、送るもの（画像 { dataUrl, url } ／ PDF { kind:'file', blob, name, size, ... }）を返す */
export function itemsForKeys(keys) {
  return keys.map(k => _items.get(k)).filter(Boolean);
}

/** 完了したあとに捨てる */
export function resetEditorImages() {
  _items = new Map();
  _missionId = null;
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
  if (_lastRange && _inside(el, _lastRange.startContainer)) return _lastRange.cloneRange();
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
  _lastRange = after.cloneRange();
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
  _lastRange = after.cloneRange();
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
  _items.set(key, item);
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
  const missionId = el?.dataset?.missionId;
  if (!el || !missionId) return;
  if (_missionId !== missionId) { _missionId = missionId; _items = new Map(); }

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
    if (_missionId !== missionId || !el.isConnected) return;
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
    if (_missionId !== missionId || !el.isConnected) return;
    const key = `k${++_seq}`;
    _items.set(key, { dataUrl, url: null });
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
function _endExternalDrag(el) {
  clearTimeout(_extHideTimer);
  _extDropRange = null;
  el?.classList.remove('is-dragover');
  _hideCaret();
}

let _docBound = false;
function _bindDocumentOnce() {
  if (_docBound) return;
  _docBound = true;
  // 最後のカーソル位置を覚える（画像ボタンを押すとフォーカスが外れるため）
  document.addEventListener('selectionchange', () => {
    const el = editorEl();
    const sel = window.getSelection?.();
    if (el && sel && sel.rangeCount > 0 && _inside(el, sel.getRangeAt(0).startContainer)) {
      _lastRange = sel.getRangeAt(0).cloneRange();
    }
  });
  // ★編集欄を少し外してファイルを落としたとき、ブラウザがその画像を開いて
  //   ページごと離れてしまう（書きかけが消える）。編集欄があるあいだは止める。
  //   完了フォームの枠の中なら、末尾に入れる。
  document.addEventListener('dragover', (e) => {
    const el = editorEl();
    if (!_hasFiles(e) || !el) return;
    e.preventDefault();
    // 編集欄の外に出たら「ここに入る」を消す
    if (!_inside(el, e.target)) _endExternalDrag(el);
  });
  document.addEventListener('drop', (e) => {
    const el = editorEl();
    if (!el || !_hasFiles(e) || _inside(el, e.target)) return;   // 編集欄の中は編集欄の配線に任せる
    e.preventDefault();
    _endExternalDrag(el);
    const form = document.getElementById('clear-mission-modal');
    if (form && form.contains(e.target)) {
      const end = document.createRange(); end.selectNodeContents(el); end.collapse(false);
      insertFiles(el, _filesFrom(e.dataTransfer), end, el._onEditorChange);
    }
  });
  // ウィンドウの外へ出た・Esc で取り消した
  document.addEventListener('dragend', () => _endExternalDrag(editorEl()));
}

/**
 * 編集欄に配線する。★描き直しで同じノードが戻ってくるので、二重に配線しない（_bound）。
 * @param {HTMLElement} el
 * @param {{ onChange?: () => void }} opts  入力・画像の追加／削除のたびに呼ぶ（下書きの保存）
 */
export function bindClearEditor(el, { onChange } = {}) {
  if (!el || el._bound) return;
  el._bound = true;
  el._onEditorChange = onChange;
  _bindDocumentOnce();
  _syncEmpty(el);

  el.addEventListener('input', () => { _syncEmpty(el); onChange?.(); });

  // 太字・斜体などの書式は持たない（保存はプレーンテキスト）
  el.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && /^[biu]$/i.test(e.key)) e.preventDefault();
  });

  // 貼り付け：画像ならカーソル位置へ、文字は書式を落として入れる
  el.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const files = _filesFrom(cd).filter(f => _isImageFile(f) || _isPdfFile(f));
    const range = _currentRange(el);
    if (files.length > 0) { insertFiles(el, files, range, onChange); return; }
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
    if (!_hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('is-dragover');
    _extDropRange = _dropRangeAt(el, e.clientX, e.clientY, null) || _extDropRange;
    _showCaret(_extDropRange);
    // ★ウィンドウの外へ出ると dragleave が来ないことがある。dragover が途切れたら消す
    clearTimeout(_extHideTimer);
    _extHideTimer = setTimeout(() => _endExternalDrag(el), 250);
  });
  el.addEventListener('dragleave', (e) => {
    // 子要素の上へ移っただけのときも dragleave が来る。本当に外へ出たときだけ消す
    if (e.relatedTarget && _inside(el, e.relatedTarget)) return;
    if (!e.relatedTarget) return;   // 相手が分からないときは dragover の途切れ（上のタイマー）に任せる
    _endExternalDrag(el);
  });
  el.addEventListener('drop', (e) => {
    const shown = _extDropRange;
    _endExternalDrag(el);
    e.preventDefault();   // ★HTML のまま落とさせない（書式やタグを持ち込まない）
    // ★線で示した位置に落とす（見せた場所と入る場所をずらさない）
    const range = (shown && _inside(el, shown.startContainer)) ? shown : _rangeFromPoint(el, e.clientX, e.clientY);
    if (_hasFiles(e)) { insertFiles(el, _filesFrom(e.dataTransfer), range, onChange); return; }
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
        _lastRange = null;
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
