// ===== アーカイブの編集モード：文書をその場で書き換える（管理者だけ）=====
//
// 編集モード（state.archiveEditing）では、文書の全部をその場で直せる。
//   タイトル・概要・場所 … その場で入力（contenteditable の1行／複数行）
//   期間・ヘッダー画像   … タップで選ぶ画面（calendar / 画像ダイアログ。helpers.js の editArchiveItem）
//   各タスクの提出内容   … 完了フォームと同じ編集欄（clearEditor.js）。1タスク（個別完了は1人）に1つ
//   振り返り             … その場の入力欄
//
// ■ 保存は「その都度、自動で」（2026-09-26 に決定）。
//   - 欄から離れたとき（focusout）にその欄だけを保存する
//   - 画像・PDF の追加／削除／並べ替えは、フォーカスが外れないことがあるので、少し待って保存する
//   - 欄ごとに「保存中… / 保存しました / 保存できませんでした」を出す（[data-save-status]）
//   ★保存しても state.render() を呼ばないこと。描き直すと、ほかの欄で書いている途中の文字と
//     カーソルが消える。手元のデータ（p.name / p.clearedData など）だけを更新する。
//
// ■ 描き直し（SSE など）をまたいで、書いている途中の欄を守る
//   captureInlineEdits() → innerHTML の差し替え → restoreInlineEdits() で、
//   フォーカスのある欄・保存待ち・保存中の欄は**ノードごと**差し戻す（完了フォームと同じ考え方）。
//
// ★サーバー側の権限：基礎情報（PATCH /api/data）も提出内容（PATCH …/submission）も canManage 必須。

import { state } from './state.js';
import { api } from './api.js';
import { logEvent } from './logger.js';
import { readEditor, bindClearEditor, loadEditorContent, itemsForKeys } from './clearEditor.js';
import { uploadEditorEmbeds, editorContentAndFormat, embedsPayload } from './modals/helpers.js';
import { setArchiveSummary, setArchiveVenue } from './utils.js';
import { confirmFirstShare, applyShareConfirmed } from './modals/shareConfirmModal.js';

const EMBED_SAVE_DELAY_MS = 1200;   // 画像・PDF を動かしたあと、保存するまで待つ時間

function _event() {
  return state.events.find(x => x.id === state.selectedEventId);
}

// ── 保存の状態表示 ─────────────────────────────────────────

function _status(node, kind, text) {
  const host = node.closest('[data-inline-block]') || node.parentElement;
  const el = host?.querySelector('[data-save-status]');
  if (!el) return;
  el.dataset.state = kind;
  el.textContent = text;
  if (kind === 'saved') {
    clearTimeout(el._t);
    el._t = setTimeout(() => { if (el.dataset.state === 'saved') el.textContent = ''; }, 2500);
  }
}

// ── 基礎情報（タイトル・概要・場所）───────────────────────────

function _plainText(node) {
  // contenteditable の中身を文字だけで取り出す（<br> / <div> は改行）
  return (node.innerText || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function _saveBasic(node) {
  const p = _event();
  if (!p) return;
  const field = node.dataset.inline;
  const value = _plainText(node);
  // タスク名（missionTitle）はそのタスクの title。★CRDT の項目なので PATCH /api/data でそのまま保存できる
  const mission = field === 'missionTitle' ? (p.missions || []).find(m => m.id === node.dataset.inlineMission) : null;
  if (field === 'missionTitle' && !mission) { node._dirty = false; return; }
  const before = field === 'title' ? (p.name || '') : field === 'summary' ? (p.description || '')
    : field === 'missionTitle' ? (mission.title || '') : (p.venue ?? '');
  if (value === String(before).trim()) { node._dirty = false; return; }
  if ((field === 'title' || field === 'missionTitle') && !value) {
    // ★イベント名・タスク名は空にできない。元に戻す
    node.textContent = before;
    _status(node, 'error', field === 'title' ? 'タイトルは空にできません' : 'タスク名は空にできません');
    node._dirty = false;
    return;
  }
  if (field === 'title') p.name = value;
  else if (field === 'missionTitle') {
    mission.title = value;
    // ★描き直さないので、目次の名前だけ手で差し替える
    document.querySelectorAll('[data-toc-mission]').forEach(b => { if (b.dataset.tocMission === mission.id) b.textContent = value; });
  }
  else if (field === 'summary') setArchiveSummary(p, value);
  else if (field === 'venue') setArchiveVenue(p, value);
  node._dirty = false;
  _status(node, 'saving', '保存中…');
  try {
    await state.saveNow(p.id);
    _status(node, 'saved', '保存しました');
    logEvent('archive_inline_saved', { field });
    // ★5つがそろったら「宣伝用に公開するか」を聞く。編集モードは保存しても描き直さないので、ここで判定を呼ぶ
    window._app?.checkPublicBasicInfoModal?.();
  } catch (_) {
    _status(node, 'error', '保存できませんでした');
  }
}

function _bindBasic(node) {
  if (node._bound) return;
  node._bound = true;
  const singleLine = node.dataset.inline !== 'summary';
  node.addEventListener('input', () => { node._dirty = true; node.classList.toggle('is-empty', !_plainText(node)); });
  node.addEventListener('keydown', (e) => {
    // 1行の欄は Enter で確定（改行させない）
    if (singleLine && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); node.blur(); }
  });
  // ★貼り付けは文字だけ（書式・タグを持ち込まない）
  node.addEventListener('paste', (e) => {
    e.preventDefault();
    let text = e.clipboardData?.getData('text/plain') || '';
    if (singleLine) text = text.replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  });
  node.addEventListener('focusout', () => { if (node._dirty) _saveBasic(node); });
}

// ── 提出内容（文章・画像・PDF）───────────────────────────────

// 保存済みの内容と比べるための署名（本文＋画像・PDF の並び）
function _signature(el) {
  const read = readEditor(el);
  const items = itemsForKeys([...read.keys, ...read.fileKeys], el);
  return read.text + '|' + items.map(it => it.url || 'new').join(',');
}

// ★提出内容の保存は1本の列に並べる。画像・PDF の送信を並列にしないため
//   （サーバーは 512MB / 0.5CPU。2つの欄を続けて離れたときに同時に送らない）
let _chain = Promise.resolve();
function _saveSubmission(el) {
  clearTimeout(el._saveTimer);
  const job = _chain.then(() => _saveSubmissionNow(el));
  _chain = job.catch(() => {});
  return job;
}

async function _saveSubmissionNow(el) {
  if (el._saving) { el._again = true; return; }
  const p = _event();
  if (!p) return;
  if (_signature(el) === el._sig) { el._dirty = false; return; }

  const missionId = el.dataset.subMission;
  const userId    = el.dataset.subUser || null;
  const read   = readEditor(el);
  const images = itemsForKeys(read.keys, el);
  const files  = itemsForKeys(read.fileKeys, el);
  if (!read.plain && images.length === 0 && files.length === 0) {
    _status(el, 'error', '提出内容を空にはできません');
    return;
  }

  el._saving = true;
  el._dirty = false;
  try {
    const ok = await uploadEditorEmbeds(p.id, missionId, images, files, (text) => _status(el, 'saving', text), '保存');
    if (!ok) { el._dirty = true; _status(el, 'error', '保存できませんでした（もう一度編集すると再送します）'); return; }
    _status(el, 'saving', '保存中…');
    const { content, format } = editorContentAndFormat(read, images, files);
    const r = await api.updateSubmission(p.id, missionId, { targetUserId: userId || undefined, content, format, ...embedsPayload(images, files) });
    if (!r?.ok) { el._dirty = true; _status(el, 'error', r?.error || '保存できませんでした'); return; }
    // ★手元のデータだけ更新する（描き直さない）
    const key = userId ? `${missionId}_u_${userId}` : missionId;
    p.clearedData = p.clearedData || {};
    p.clearedData[key] = { ...(p.clearedData[key] || {}), ...(r.submission || {}) };
    el._sig = _signature(el);
    _status(el, 'saved', '保存しました');
    logEvent('submission_edited', { missionId, individual: !!userId, inline: true });
  } finally {
    el._saving = false;
    if (el._again) { el._again = false; _saveSubmissionNow(el); }
  }
}

function _bindSubmission(el) {
  if (el._bound) return;
  const p = _event();
  const missionId = el.dataset.subMission;
  const userId    = el.dataset.subUser || null;
  const cd = p?.clearedData?.[userId ? `${missionId}_u_${userId}` : missionId];
  loadEditorContent(el, cd || {});
  el._sig = _signature(el);
  bindClearEditor(el, {
    // 入力・画像の追加／削除のたびに呼ばれる。★文字の入力は focusout で保存するので、ここでは印を付けるだけ。
    //   画像・PDF の変化はフォーカスが外れないことがあるので、少し待って保存する
    onChange: () => {
      el._dirty = true;
      clearTimeout(el._saveTimer);
      el._saveTimer = setTimeout(() => {
        if (document.activeElement !== el) _saveSubmission(el);
      }, EMBED_SAVE_DELAY_MS);
    },
  });
  el.addEventListener('focusout', (e) => {
    // 同じ枠の画像ボタンへ移っただけなら保存しない（画像を選んでから保存する）
    if (e.relatedTarget && el.closest('.c-editor-field')?.contains(e.relatedTarget)) return;
    if (el._dirty) _saveSubmission(el);
  });
}

// ── 振り返り ───────────────────────────────────────────────

async function _saveReflection(node) {
  const p = _event();
  if (!p) return;
  const missionId = node.dataset.reflectMission;
  const userId    = node.dataset.reflectUser || null;
  const field     = node.dataset.reflectField;   // struggle | solution | shareable
  const value     = field === 'shareable' ? node.checked : node.value.trim();
  node._dirty = false;
  _status(node, 'saving', '保存中…');
  const r = await api.updateReflection(p.id, missionId, { [field]: value, targetUserId: userId || undefined });
  if (!r?.ok) { node._dirty = true; _status(node, 'error', r?.error || '保存できませんでした'); return; }
  const key = userId ? `${missionId}_u_${userId}` : missionId;
  if (p.clearedData?.[key]) Object.assign(p.clearedData[key], r.reflection || { [field]: value });
  applyShareConfirmed(p, r);
  // ★サーバーが正規化した値（200字で切る／本文が無いと shareable は false）に合わせる
  if (field === 'shareable' && r.reflection && 'shareable' in r.reflection) {
    const accepted = !!r.reflection.shareable;
    // ★本文の無い振り返りは公開の候補にできない（サーバーの _sanitizeReflection）。黙って外すと
    //   押しても効かないように見えるので、理由を出す
    if (value && !accepted) {
      node.checked = false;
      _status(node, 'error', '先に「困ったこと」か「次にやるなら」を書くと選べます');
      return;
    }
    node.checked = accepted;
  }
  _status(node, 'saved', '保存しました');
}

function _bindReflection(node) {
  if (node._bound) return;
  node._bound = true;
  if (node.type === 'checkbox') {
    node.addEventListener('change', async () => {
      // ★このイベントで初めてのチェックなら確認する。「いいえ」ならチェックを外して保存しない
      if (node.checked && !(await confirmFirstShare(_event()))) { node.checked = false; return; }
      _saveReflection(node);
    });
    return;
  }
  node.addEventListener('input', () => { node._dirty = true; });
  node.addEventListener('focusout', () => { if (node._dirty) _saveReflection(node); });
}

// ── 公開する関数 ───────────────────────────────────────────

// ── 閲覧中のタップで編集に入る（管理者だけ）──────────────────────
//
// 閲覧中の欄（data-archive-tap）をタップすると、編集モードに入ってその欄にカーソルを置く。
//   title / summary / venue … その場の入力欄
//   sub:<タスク>:<人> … 提出内容の編集欄／ ref:<タスク>:<人> … 振り返りの1つ目の欄
//   period / image … 選ぶ画面を直接開く（編集モードには入らない）
// ★タスク名はここに入れない（閲覧ではタップでタスク詳細へ行く）。
// ★リンク・ボタン・PDF のカード・個別完了の行の開閉・文字を選んでいるときは入らない（コピーを邪魔しない）。
// ★focus() はタップのハンドラから同期で当てる（iOS は操作の外の focus を無視してキーボードが出ない）。
//   state.render() は同期なので、描き直した直後にそのまま当てられる。

const _TAP_IGNORE = 'a, button, summary, input, textarea, label, select, video, [role="button"], .c-file-card';

export function bindArchiveTapToEdit(root = document) {
  const doc = root.querySelector('.p-archive--tap-edit');
  if (!doc || doc._tapBound) return;
  doc._tapBound = true;
  doc.addEventListener('click', (e) => {
    const t = e.target.closest('[data-archive-tap]');
    if (!t || !doc.contains(t)) return;
    if (e.target.closest(_TAP_IGNORE)) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && t.contains(sel.anchorNode)) return;
    startArchiveEditAt(t.dataset.archiveTap);
  });
}

export function startArchiveEditAt(target) {
  if (!state.canManageCurrentEvent()) return;
  const [kind, missionId = '', userId = ''] = String(target).split(':');
  logEvent('archive_tap_edit', { target: kind });
  if (kind === 'period' || kind === 'image') { window._app?.editArchiveItem?.(kind); return; }
  // 個別完了の行は開いたまま編集モードへ（編集モードでも同じ行が開いて出る）
  if (userId) window._app?.rememberArchiveRow?.(`${missionId}:${userId}`, true);
  state.archiveEditing = true;
  state.render();
  let el = null;
  if (kind === 'sub') {
    el = [...document.querySelectorAll('.c-editor[data-sub-mission]')]
      .find(x => x.dataset.subMission === missionId && (x.dataset.subUser || '') === userId);
  } else if (kind === 'ref') {
    el = [...document.querySelectorAll('[data-reflect-field="struggle"]')]
      .find(x => x.dataset.reflectMission === missionId && (x.dataset.reflectUser || '') === userId);
  } else {
    el = document.querySelector(`[data-inline="${kind}"]`);
  }
  if (!el) return;
  el.closest('details')?.setAttribute('open', '');
  el.focus({ preventScroll: true });
  // カーソルは末尾へ（全選択にしない。うっかり上書きさせない）
  if (el.tagName === 'TEXTAREA') {
    el.setSelectionRange(el.value.length, el.value.length);
  } else {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  el.scrollIntoView({ block: 'center' });
}

// ── 編集モードは、白い文書の外（周り）をタップしても抜けられる ──────────────
//
// 白い文書（.p-archive__doc）の外をタップしたら、「完了」と同じく
// 保存待ちを保存してから閲覧に戻る（main.js の toggleArchiveEditing）。
// ★白い文書の中では抜けない（2026-09-26 の要望。欄の押し損ねで抜けないように）。
//   外側でも、ボタン・ヘッダー画像・上部・下の帯などの「触る場所」では抜けない。
// ★文字を選んでいる途中（ドラッグが欄の外で終わった）では抜けない。
// ★モーダル（期間・画像を選ぶ画面）は body 直下なので、ここには来ない。
const _EXIT_IGNORE = [
  '[contenteditable="true"]', 'textarea', 'input', 'select', 'button', 'a', 'label', 'summary',
  '.c-editor-field', '.c-share-check', '.c-file-card',
  '.p-archive__head', '.p-archive__editbar', '.p-archive__visual', '.p-archive__doc',
].join(', ');

function _bindTapToExit(root) {
  const page = root.querySelector('.p-main-board__page');
  if (!page || page._exitBound) return;
  page._exitBound = true;
  page.addEventListener('click', (e) => {
    // ★白い文書の外なら、.p-archive の外（ページ下の余白）でも抜ける
    if (!state.archiveEditing || state.mainBoardTab !== 'ARCHIVE') return;
    if (e.target.closest(_EXIT_IGNORE)) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) return;
    logEvent('archive_edit_exit_tap');
    window._app?.toggleArchiveEditing?.();
  });
}

/** 編集モードの欄を配線する（renderMainBoard の最後に呼ぶ。二重には配線しない） */
export function bindArchiveInlineEditing(root = document) {
  _bindTapToExit(root);
  root.querySelectorAll('[data-inline]').forEach(_bindBasic);
  root.querySelectorAll('.c-editor[data-sub-mission]').forEach(_bindSubmission);
  root.querySelectorAll('[data-reflect-field]').forEach(_bindReflection);
}

// 描き直しで守る欄（フォーカスがある／保存待ち／保存中）
let _kept = null;

/** innerHTML を差し替える前に呼ぶ */
export function captureInlineEdits() {
  _kept = null;
  const nodes = [...document.querySelectorAll('[data-inline-key]')];
  if (nodes.length === 0) return;
  const active = document.activeElement;
  const keep = new Map();
  let focusKey = null, range = null;
  for (const n of nodes) {
    const target = n.matches('[data-inline], [data-reflect-field]') ? n : n.querySelector('.c-editor, [data-inline], [data-reflect-field]');
    const busy = target && (target._dirty || target._saving);
    const focused = active && n.contains(active);
    if (busy || focused) {
      keep.set(n.dataset.inlineKey, n);
      if (focused) {
        focusKey = n.dataset.inlineKey;
        const sel = window.getSelection?.();
        if (sel && sel.rangeCount > 0 && n.contains(sel.getRangeAt(0).startContainer)) range = sel.getRangeAt(0).cloneRange();
      }
    }
  }
  _kept = keep.size ? { keep, focusKey, range, activeTag: active } : null;
}

/** innerHTML を差し替えた後に呼ぶ */
export function restoreInlineEdits() {
  if (!_kept) return;
  const { keep, focusKey, range, activeTag } = _kept;
  _kept = null;
  for (const [key, old] of keep) {
    const fresh = [...document.querySelectorAll('[data-inline-key]')].find(x => x.dataset.inlineKey === key);
    if (fresh && fresh !== old) fresh.replaceWith(old);
  }
  if (focusKey && activeTag && document.contains(activeTag)) {
    activeTag.focus({ preventScroll: true });
    if (range) {
      const sel = window.getSelection?.();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
  }
}

/** 編集モードを終えるとき：保存待ちを全部流してから終える（★1つずつ順番に） */
export async function flushArchiveInlineEdits() {
  for (const n of document.querySelectorAll('[data-inline]')) if (n._dirty) await _saveBasic(n);
  for (const el of document.querySelectorAll('.c-editor[data-sub-mission]')) {
    clearTimeout(el._saveTimer);
    if (_signature(el) !== el._sig) await _saveSubmission(el).catch(() => {});
  }
  for (const n of document.querySelectorAll('[data-reflect-field]')) if (n._dirty) await _saveReflection(n);
  await _chain;
}
