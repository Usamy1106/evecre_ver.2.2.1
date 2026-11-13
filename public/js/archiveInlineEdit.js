// ===== アーカイブの編集モード：文書をその場で書き換える（管理者だけ）=====
//
// 管理者は最初から編集中（state.archiveEditing は state.js の導出。プレビュー中でなければ true。2026-11-07）。
// 編集中は、文書の全部をその場で直せる。
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
import { readEditor, bindClearEditor, loadEditorContent, itemsForKeys, bindReflectEditor, readReflectEditor } from './clearEditor.js';
import { uploadEditorEmbeds, editorContentAndFormat, embedsPayload } from './modals/helpers.js';
import { getArchiveSummary, setArchiveVenue, reflectShowsStruggle, submissionText, taskShareState } from './utils.js';
import { saveSummaryText, savePurposeText, shouldAskPillarsAfterPurpose } from './initialTasks.js';
import { confirmFirstShare, applyShareConfirmed } from './modals/shareConfirmModal.js';
import { REFLECT_LABELS } from './constants.js';

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
  // 概要・目的は初期タスク（def-3 / def-1）に書く（書いた時点で完了になる。initialTasks.js）
  if (field === 'summary' || field === 'purpose') return _saveInitialTask(node, p, field, value);
  // タスク名（missionTitle）はそのタスクの title。★CRDT の項目なので PATCH /api/data でそのまま保存できる
  const mission = field === 'missionTitle' ? (p.missions || []).find(m => m.id === node.dataset.inlineMission) : null;
  if (field === 'missionTitle' && !mission) { node._dirty = false; return; }
  const before = field === 'title' ? (p.name || '')
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
  else if (field === 'venue') setArchiveVenue(p, value);
  node._dirty = false;
  _status(node, 'saving', '保存中…');
  try {
    await state.saveNow(p.id);
    _status(node, 'saved', '保存しました');
    logEvent('archive_inline_saved', { field });
    // ★「宣伝用に公開するか」はここでは聞かない（書き終えた瞬間に割り込むため）。書いていないときの render() で判定する（isArchiveBusy）
  } catch (_) {
    _status(node, 'error', '保存できませんでした');
  }
}

// 概要（def-3）・目的（def-1）。★PATCH /api/data ではなく、タスクの完了・提出内容の書き換えで保存する
async function _saveInitialTask(node, p, field, value) {
  // ★目的は書いたあともリードで直せる（2026-11-07）。変わっていなければ保存しない
  const before = field === 'summary' ? getArchiveSummary(p) : submissionText(p.clearedData?.['def-1']);
  if (value === String(before).trim()) { node._dirty = false; return; }
  node._dirty = false;
  _status(node, 'saving', '保存中…');
  // ★取り直さない（描き直すと、次に書き始めた欄のフォーカスが外れる。保存しても render() を呼ばない、と同じ理由）
  const r = field === 'summary' ? await saveSummaryText(p, value, { reload: false }) : await savePurposeText(p, value, { reload: false });
  if (!r.ok) {
    _status(node, 'error', r.rich ? '画像・PDF・書式があるので、タスクの画面で編集してください' : (r.error || '保存できませんでした'));
    return;
  }
  _status(node, 'saved', '保存しました');
  logEvent('archive_inline_saved', { field, completed: !!r.completed });
  // ★目的を書いたら、プレビューへ切り替えたときに柱のページへ進める（編集の途中では割り込まない。main.js の toggleArchivePreview）
  if (field === 'purpose' && r.completed && shouldAskPillarsAfterPurpose(_event())) state._askPillarsAfterEdit = true;
}

function _bindBasic(node) {
  if (node._bound) return;
  node._bound = true;
  const singleLine = !['summary', 'purpose'].includes(node.dataset.inline);
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
  // ★振り返りの欄は書式の印つきの文字（2026-11-12。clearEditor.js の振り返りの欄）
  const value     = field === 'shareable' ? node.checked : (node.matches('.c-editor') ? readReflectEditor(node) : node.value.trim());
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
  // ★目印は _reflectBound（編集欄の配線 bindClearEditor が _bound を使うので、同じ名前にすると配線されない）
  if (node._reflectBound) return;
  node._reflectBound = true;
  if (node.type === 'checkbox') {
    node.addEventListener('change', async () => {
      // ★このイベントで初めてのチェックなら確認する。「いいえ」ならチェックを外して保存しない
      if (node.checked && !(await confirmFirstShare(_event()))) { node.checked = false; return; }
      _saveReflection(node);
    });
    return;
  }
  if (node.matches('.c-editor')) {
    bindReflectEditor(node, node.dataset.initial || '', () => { node._dirty = true; });
  } else {
    node.addEventListener('input', () => { node._dirty = true; });
  }
  // ★書式のボタン（同じ枠の中）を押してフォーカスが移ったときは保存しない（枠の外へ出たときだけ）
  node.addEventListener('focusout', (e) => {
    const field = node.closest('.c-editor-field');
    if (field && e.relatedTarget && field.contains(e.relatedTarget)) return;
    if (node._dirty) _saveReflection(node);
  });
}

// 未記入の振り返り：「うまくいった／つまずいた」を選んだら、成否を保存して入力欄を出す（2026-10-14）
// ★描き直さない（ほかの欄の書きかけを消さない）。見出しを成否のものに差し替え、欄を出してカーソルを置く
// ★focus はタップのハンドラから同期で当てる（iOS）。保存はそのあと
async function _pickOutcome(btn) {
  const p = _event();
  const block = btn.closest('.p-archive__reflect--editing');
  if (!p || !block) return;
  const outcome   = btn.dataset.reflectOutcome;
  const missionId = btn.dataset.reflectMission;
  const userId    = btn.dataset.reflectUser || null;
  const labels = REFLECT_LABELS[outcome] || REFLECT_LABELS.struggle;
  block.querySelectorAll('[data-reflect-label]').forEach(el => { el.textContent = labels[el.dataset.reflectLabel] || ''; });
  block.querySelector('[data-reflect-outcome-pick]')?.remove();
  block.querySelector('[data-reflect-fields]')?.classList.remove('u-hidden');
  // ★うまくいった側は1つ目の欄（struggle）を隠し、カーソルは見えている最初の欄へ（2026-11-05）
  const struggleWrap = block.querySelector('[data-reflect-struggle-wrap]');
  const sNode = block.querySelector('[data-reflect-field="struggle"]');
  const struggleText = sNode ? (sNode.matches('.c-editor') ? readReflectEditor(sNode) : sNode.value || '') : '';
  struggleWrap?.classList.toggle('u-hidden', !reflectShowsStruggle(outcome, struggleText));
  const first = struggleWrap && !struggleWrap.classList.contains('u-hidden') ? 'struggle' : 'solution';
  block.querySelector(`[data-reflect-field="${first}"]`)?.focus({ preventScroll: false });
  // ★手元のデータにも先に入れる（保存を待つ間に描き直されても、選び直しにならない）
  const key = userId ? `${missionId}_u_${userId}` : missionId;
  if (p.clearedData?.[key]) p.clearedData[key].outcome = outcome;
  logEvent('reflect_outcome_picked', { outcome, source: 'archive' });
  _status(btn.isConnected ? btn : block, 'saving', '保存中…');
  const r = await api.updateReflection(p.id, missionId, { outcome, targetUserId: userId || undefined });
  const host = block.querySelector('[data-reflect-field]') || block;
  if (!r?.ok) { _status(host, 'error', r?.error || '保存できませんでした'); return; }
  _status(host, 'saved', '保存しました');
}

function _bindOutcomePick(btn) {
  if (btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', () => _pickOutcome(btn));
}

// ── 公開する関数 ───────────────────────────────────────────

// ── プレビュー中に本文をタップしたら、編集の場所を知らせる（管理者だけ。2026-11-07）──────────
//
// プレビュー中の欄（data-archive-tap）をタップしたら「右上の『編集』で書けます」と知らせるだけ。
// ★勝手に編集へ戻さない（プレビューは自分で選んだ状態。戻るのは右上のボタンから）。
// ★リンク・ボタン・PDF のカード・個別完了の行の開閉・文字を選んでいるときは知らせない（コピーを邪魔しない）。
const _TAP_IGNORE = 'a, button, summary, input, textarea, label, select, video, [role="button"], .c-file-card';

export function bindArchivePreviewTap(root = document) {
  const doc = root.querySelector('.p-archive--preview');
  if (!doc || doc._tapBound) return;
  doc._tapBound = true;
  doc.addEventListener('click', (e) => {
    const t = e.target.closest('[data-archive-tap]');
    if (!t || !doc.contains(t)) return;
    if (e.target.closest(_TAP_IGNORE)) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && t.contains(sel.anchorNode)) return;
    logEvent('archive_preview_tap', { target: String(t.dataset.archiveTap).split(':')[0] });
    window._app?.showToast?.('いまはプレビューです。右上の「編集」で書けます。');
  });
}

// ── 基礎情報の行のペン：その場の欄にカーソルを置く ─────────────────────
// ★タップのハンドラから同期で呼ぶこと（iOS は操作の外の focus を無視する）。カーソルは末尾（全選択にしない）
export function focusArchiveInline(kind) {
  const el = document.querySelector(`[data-inline="${CSS.escape(String(kind))}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  el.scrollIntoView({ block: 'center' });
}

/**
 * アーカイブで書いている途中か（欄にフォーカスがある／保存待ち／保存中）。
 * ★自動で出すモーダル・コーチマークは、これが true のあいだ出さない（書いている最中に割り込まない）。
 *   以前は「編集モード中は出さない」だったが、管理者は常に編集中になったので、実際に書いているかで見る
 */
export function isArchiveBusy() {
  const a = document.activeElement;
  if (a && a.closest?.('.p-archive') && (a.isContentEditable || /^(TEXTAREA|INPUT)$/.test(a.tagName))) return true;
  return [...document.querySelectorAll('.p-archive [data-inline], .p-archive [data-reflect-field], .p-archive .c-editor[data-sub-mission]')]
    .some(n => n._dirty || n._saving);
}

// ── タスク単位の公開（タスクの左のチェック・メニューの「公開する／しない」。2026-11-07。指示書B §4-5）──
// ★そのタスクの提出物すべての shareable を同じ値にする（個別完了は人数ぶん）。本文の無い振り返りは公開候補にできない。
// ★公開する側へ切り替えるときは confirmFirstShare を必ず通す（このイベントで初めてのときだけ確認が出る）。
// ★保存しても state.render() を呼ばない（書いている途中の欄とカーソルが消える）。見た目は DOM を直接書き換える
let _sharing = false;

/** タスクの公開の見た目（チェック・半透明・「非公開」のタグ）を、手元のデータに合わせる */
export function syncTaskShareDom(missionId) {
  const p = _event();
  if (!p) return;
  const { eligible, shared } = taskShareState(p, missionId);
  document.querySelectorAll('.p-archive__entry').forEach(entry => {
    if (entry.dataset.missionId !== missionId) return;
    entry.classList.toggle('is-unshared', !shared);
    entry.querySelector('.p-archive__unshared-tag')?.classList.toggle('u-hidden', shared);
    const box = entry.querySelector('[data-task-share]');
    if (box) { box.checked = shared; box.disabled = eligible.length === 0; }
  });
}

export async function setTaskShared(missionId, on) {
  const p = _event();
  if (!p || _sharing || !state.canManageCurrentEvent()) return;
  const { eligible } = taskShareState(p, missionId);
  if (eligible.length === 0) {
    window._app?.showToast?.('振り返りを書くと、公開の候補にできます');
    syncTaskShareDom(missionId);
    return;
  }
  // ★呼び出し箇所の4つ目（指示書B §4-5）。shareConfirmModal.js の冒頭の一覧も参照
  if (on && !(await confirmFirstShare(p))) { syncTaskShareDom(missionId); return; }
  _sharing = true;
  let failed = false;
  try {
    // ★1つずつ順番に（個別完了は人数ぶん）。送るのは shareable だけ（サーバーは送られた欄だけを書く）
    for (const key of eligible) {
      const userId = key === missionId ? undefined : key.slice(missionId.length + 3);
      const r = await api.updateReflection(p.id, missionId, { shareable: on, targetUserId: userId });
      if (!r?.ok) { failed = true; continue; }
      if (p.clearedData?.[key] && r.reflection && 'shareable' in r.reflection) p.clearedData[key].shareable = !!r.reflection.shareable;
      applyShareConfirmed(p, r);
    }
  } finally {
    _sharing = false;
  }
  syncTaskShareDom(missionId);
  logEvent('archive_task_share_toggled', { missionId, on, count: eligible.length, failed });
  window._app?.showToast?.(failed ? '保存できなかった記録があります'
    : on ? '公開の候補にしました' : '非公開にしました');
}

function _bindTaskShare(box) {
  if (box._bound) return;
  box._bound = true;
  box.addEventListener('change', () => setTaskShared(box.dataset.taskShare, box.checked));
}

/** 編集モードの欄を配線する（renderMainBoard の最後に呼ぶ。二重には配線しない） */
export function bindArchiveInlineEditing(root = document) {
  root.querySelectorAll('[data-task-share]').forEach(_bindTaskShare);
  root.querySelectorAll('[data-inline]').forEach(_bindBasic);
  root.querySelectorAll('.c-editor[data-sub-mission]').forEach(_bindSubmission);
  root.querySelectorAll('[data-reflect-field]').forEach(_bindReflection);
  root.querySelectorAll('[data-reflect-outcome]').forEach(_bindOutcomePick);
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
