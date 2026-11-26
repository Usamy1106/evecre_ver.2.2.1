// ===== アーカイブのいいね・コメント（2026-11-18）=====
//
// 公開ページ（/explore/<id>）の右のサブエリアと同じものを、アプリのアーカイブにも出す。
// ★出す条件はサーバー（/api/explore）が決める。ここで条件を書き直さないこと：
//   - いいね … 宣伝用に公開している（publicBasicInfo）。公開していなければ /api/explore/events/:id が 404 → 何も出さない
//   - コメント … タスクも含めて公開している（ナレッジが出ている）。出ていなければ knowledge が null → コメントの欄を出さない
// ★メンバー自身は、いいねは数を見るだけ（自分たちのイベントに押させない。2026-11-18 ユーザー決定）。
//   コメントは読める・書ける（メール認証済み）・消せる（本人か管理者。サーバーが canDelete を返す）
// ★描き直し（SSE・保存）では手元の控え（_cache）から同じ HTML を作る。通信は開いたときと、少し時間がたったときだけ
// ★コメントの1件の形は公開ページと共通（views/explore.js の exploreCommentItemHtml）。CSS も公開ページのもの（_explore.css）
// ★2026-11-26：狭いとき（右の箱が横に並ばないとき）は、右の箱の代わりに概要の上へ1行（いいね＋最新のコメント1件）を出し、
//   コメントのタップでボトムシート（全部・入力欄）を開く（archiveSocialCompactHtml / _openSheet）

import { state } from './state.js';
import { api } from './api.js';
import { logEvent } from './logger.js';
import { showConfirmDialog } from './dialog.js';
import { exploreCommentItemHtml } from './views/explore.js';
import { Components } from './components.js';

const COMMENT_MAX = 1000;
const STALE_MS    = 60 * 1000;   // これより古ければ、アーカイブを描いたときに取り直す
const INPUT_ID    = 'archive-comment-input';

// eventId → { loading, fetchedAt, gone, data: { likeCount, knowledge, viewer }, comments: { items, hasMore, loaded, loading, posting, error }, draft }
const _cache = new Map();

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 宣伝用に公開しているイベントだけ（いいねが付くのはそこから）。★本当に出すかはサーバーの応答で決まる */
export function archiveSocialEnabled(p) {
  return !!p && p.publicBasicInfo === true;
}

function _entry(id) {
  if (!_cache.has(id)) _cache.set(id, { data: null, comments: { items: [], hasMore: false }, draft: '' });
  return _cache.get(id);
}

function _likeHtml(c) {
  const count = Number(c.data?.likeCount) || 0;
  return `
    <div class="p-explore__page-like">
      <span class="c-like-button c-like-button--static" aria-label="いいね ${count}">
        <img src="/images/icon/icon-heart-pressed.svg" class="c-like-button__icon" width="20" height="20" alt="">
        <span class="c-like-button__count">${count}</span>
      </span>
      <span class="p-archive__side-note">公開ページでもらったいいね</span>
    </div>`;
}

// コメントの欄（見出し・入力欄・一覧）。右の箱とボトムシートで共用する。
// ★入力欄の id は置き場所ごとに変える（右の箱は狭いとき display:none で DOM に残るので、同じ id だと getElementById が隠れた方を掴む）
function _commentsHtml(id, inputId, titleId) {
  const c = _entry(id);
  const d = c.data;
  const cm = c.comments;
  let input;
  if (d.viewer?.canComment) {
    const left = COMMENT_MAX - [...c.draft].length;
    input = `
      <div class="p-explore__comment-form">
        <textarea id="${inputId}" class="p-explore__comment-input" rows="3" maxlength="${COMMENT_MAX}"
          placeholder="コメントへの返事・お礼など" data-as-draft="${_esc(id)}">${_esc(c.draft)}</textarea>
        <div class="p-explore__comment-actions">
          <span class="p-explore__comment-left${left < 0 ? ' is-over' : ''}" data-as-left>あと${left}文字</span>
          <button type="button" class="c-button c-button--primary p-explore__small" data-as-post="${_esc(id)}" data-cmd-enter
            ${!c.draft.trim() || cm.posting ? 'disabled' : ''}>${cm.posting ? '送信中…' : '送信'}</button>
        </div>
      </div>`;
  } else {
    input = '<p class="p-explore__comment-note">メール認証をすると、コメントできます</p>';
  }
  const items = cm.items || [];
  return `
    <section class="p-explore__comments" aria-labelledby="${titleId}">
      <h2 id="${titleId}" class="p-explore__section-title">公開ページへのコメント</h2>
      ${input}
      ${cm.error ? '<p class="p-explore__comment-empty">コメントを読み込めませんでした。</p>' : ''}
      <div class="p-explore__comment-scroll" data-as-comment-scroll>
        ${items.length ? `<ul class="p-explore__comment-list">${items.map(x => exploreCommentItemHtml(x, id)).join('')}</ul>`
          : (cm.loaded ? '<p class="p-explore__comment-empty">まだコメントはありません。</p>' : '')}
        ${cm.hasMore ? `<button type="button" class="c-button c-button--secondary p-explore__small p-explore__more" data-as-more="${_esc(id)}" ${cm.loading ? 'disabled' : ''}>もっと見る</button>` : ''}
      </div>
    </section>`;
}

// 右の箱（広いとき）の中身
function _innerHtml(id) {
  const c = _entry(id);
  if (c.gone) return '';
  if (!c.data) return '<p class="p-explore__comment-empty">読み込み中…</p>';
  // ★コメントはナレッジが出ているときだけ（サーバーは出ていなければ knowledge を null で返す）
  if (c.data.knowledge === null) return _likeHtml(c);
  return _likeHtml(c) + _commentsHtml(id, INPUT_ID, 'archive-comments-title');
}

// 狭いとき（右の箱が横に並ばないとき）に、概要の上（もとの「公開中」の帯の場所）へ出す1行。
// ★いいねの数と、いちばん新しいコメント1件だけ。コメントのタップでボトムシート（全部・入力欄）を開く
function _compactInnerHtml(id) {
  const c = _entry(id);
  if (c.gone) return '';
  if (!c.data) return '<p class="p-archive__social-loading">読み込み中…</p>';
  const count = Number(c.data.likeCount) || 0;
  const like = `
    <span class="p-archive__social-like" aria-label="公開ページでもらったいいね ${count}">
      <img src="/images/icon/icon-heart-pressed.svg" class="p-archive__social-heart" width="20" height="20" alt="">
      <span class="p-archive__social-count">${count}</span>
    </span>`;
  if (c.data.knowledge === null) {
    return `<div class="p-archive__social-row">${like}<span class="p-archive__side-note">公開ページでもらったいいね</span></div>`;
  }
  const cm = c.comments;
  const latest = (cm.items || [])[0];
  let comment;
  if (latest) {
    const name = latest.author ? latest.author.username || '名前なし' : '退会したユーザー';
    comment = `
      ${Components.UserAvatar(latest.author ? { username: name, avatarUrl: latest.author.avatarUrl } : { username: '?' }, { size: 24 })}
      <span class="p-archive__social-comment-main">
        <span class="p-archive__social-comment-name">${_esc(name)}</span>
        <span class="p-archive__social-comment-body">${_esc(latest.body)}</span>
      </span>`;
  } else {
    comment = `<span class="p-archive__social-comment-empty">${cm.loaded ? 'まだコメントはありません' : 'コメントを読み込み中…'}</span>`;
  }
  return `
    <div class="p-archive__social-row">
      ${like}
      <button type="button" class="p-archive__social-comment" data-as-open-sheet="${_esc(id)}" data-log="archive_comments_sheet_open"
        aria-label="公開ページへのコメントをすべて見る">
        ${comment}
        <span class="c-icon c-icon--right p-archive__social-chevron" style="--icon:url('/images/icon/icon-chevron.svg')" aria-hidden="true"></span>
      </button>
    </div>`;
}

/**
 * アーカイブの右（狭い画面は下）に置く箱。宣伝用に公開していないイベントでは空文字。
 * ★中身は手元の控えから作る（通信は refreshArchiveSocial）
 */
export function archiveSocialHtml(p) {
  if (!archiveSocialEnabled(p)) return '';
  const inner = _innerHtml(p.id);
  if (_entry(p.id).gone) return '';
  return `
    <aside class="p-explore__side p-archive__side" data-archive-social="${_esc(p.id)}" data-as-kind="side" aria-label="いいね・コメント">
      ${inner}
    </aside>`;
}

/**
 * 概要の上（もとの「公開中」の帯の場所）に置く1行（2026-11-26）。宣伝用に公開していないイベントでは空文字。
 * ★見せるのは右の箱が横に並ばないときだけ（_archive.css の @container。並ぶときは右の箱が同じものを出す）
 */
export function archiveSocialCompactHtml(p) {
  if (!archiveSocialEnabled(p) || _entry(p.id).gone) return '';
  return `
    <div class="p-archive__social-compact" data-archive-social="${_esc(p.id)}" data-as-kind="compact">
      ${_compactInnerHtml(p.id)}
    </div>`;
}

const SHEET_ID       = 'archive-comments-sheet';
const SHEET_INPUT_ID = 'archive-comment-sheet-input';

function _sheetInnerHtml(id) {
  const c = _entry(id);
  if (c.gone || !c.data || c.data.knowledge === null) return '<p class="p-explore__comment-empty">コメントはありません。</p>';
  return _commentsHtml(id, SHEET_INPUT_ID, 'archive-comments-sheet-title');
}

// コメントを全部見るボトムシート。★body の直下に置く（アーカイブの描き直しでは消えない）
function _openSheet(id) {
  document.getElementById(SHEET_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = SHEET_ID;
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--action u-page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div data-sheet class="p-archive__comments-sheet u-animate-fade">
      <div data-sheet-handle class="c-sheet__handle c-sheet__handle--mid"><div class="c-sheet__grip"></div></div>
      <div class="p-archive__comments-sheet-body" data-archive-social="${_esc(id)}" data-as-kind="sheet">${_sheetInnerHtml(id)}</div>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('archive_comments_sheet_opened', { eventId: id });
}

// 箱の中身だけ差し替える（アーカイブ全体は描き直さない＝書きかけの欄やスクロール位置を動かさない）。
// ★置き場所は3つ（右の箱・概要の上の1行・ボトムシート）。どれも data-archive-social と data-as-kind を持つ
const _RENDER = { side: _innerHtml, compact: _compactInnerHtml, sheet: _sheetInnerHtml };
function _patch(id) {
  const boxes = document.querySelectorAll(`[data-archive-social="${CSS.escape(id)}"]`);
  if (!boxes.length) return;
  const a = document.activeElement;
  const focusedId = a && (a.id === INPUT_ID || a.id === SHEET_INPUT_ID) ? a.id : null;
  const sel = focusedId ? [a.selectionStart, a.selectionEnd] : null;
  const gone = _entry(id).gone;
  boxes.forEach((box) => {
    const kind = box.dataset.asKind || 'side';
    if (gone && kind !== 'sheet') { box.remove(); return; }
    const scroll = box.querySelector('[data-as-comment-scroll]')?.scrollTop || 0;
    box.innerHTML = (_RENDER[kind] || _innerHtml)(id);
    const sc = box.querySelector('[data-as-comment-scroll]');
    if (sc && scroll) sc.scrollTop = scroll;
  });
  if (focusedId) {
    const n = document.getElementById(focusedId);
    if (n) { n.focus(); try { n.setSelectionRange(sel[0], sel[1]); } catch (_) {} }
  }
}

async function _loadComments(id, more = false) {
  const c = _entry(id).comments;
  if (c.loading) return;
  c.loading = true; c.error = false;
  const before = more && c.items.length ? c.items.at(-1).createdAt : null;
  const r = await api.exploreComments(id, before);
  c.loading = false;
  if (r?.ok) {
    c.items = more ? [...c.items, ...(r.comments || [])] : (r.comments || []);
    c.hasMore = !!r.hasMore;
    c.loaded = true;
  } else c.error = true;
  _patch(id);
}

/** アーカイブを描いたあとに呼ぶ。控えが無いか古ければ取り直して、箱の中身だけ差し替える */
export async function refreshArchiveSocial(p) {
  if (!archiveSocialEnabled(p)) return;
  const id = p.id;
  const c = _entry(id);
  if (c.loading || (c.fetchedAt && Date.now() - c.fetchedAt < STALE_MS)) return;
  c.loading = true;
  const r = await api.exploreEvent(id);
  c.loading = false;
  c.fetchedAt = Date.now();
  if (r?.ok) {
    c.gone = false;
    c.data = { likeCount: r.likeCount, knowledge: r.knowledge, viewer: r.viewer };
    _patch(id);
    if (r.knowledge !== null) _loadComments(id);
  } else if (r?.httpStatus === 404) {
    // ★公開を止めた直後など。箱ごと消す（次に公開したら、また出る）
    c.gone = true; c.data = null;
    _patch(id);
  }
}

/** 公開の設定を変えたあとなど、すぐ取り直したいとき */
export function invalidateArchiveSocial(eventId) {
  const c = _cache.get(eventId);
  if (c) { c.fetchedAt = 0; c.gone = false; }
}

async function _post(id) {
  const c = _entry(id);
  const body = c.draft.trim();
  if (!body || c.comments.posting) return;
  if ([...body].length > COMMENT_MAX) { window._app?.showToast?.(`${COMMENT_MAX}文字以内で書いてください`); return; }
  c.comments.posting = true; _patch(id);
  const r = await api.explorePostComment(id, body);
  c.comments.posting = false;
  if (r?.ok && r.comment) {
    c.comments.items = [r.comment, ...c.comments.items];
    c.comments.loaded = true;
    c.draft = '';
    logEvent('archive_comment_posted', { eventId: id });
  } else {
    window._app?.showToast?.(
      r?.error === 'verification_required' ? 'メール認証をすると、コメントできます'
        : r?.error === 'rate_limited' ? '少し時間をおいてから送ってください'
          : r?.error === 'invalid_body' ? `1〜${COMMENT_MAX}文字で書いてください`
            : 'コメントを送れませんでした');
  }
  _patch(id);
}

async function _delete(id, cid) {
  const ok = await showConfirmDialog({ message: 'このコメントを削除しますか？', confirmLabel: '削除する', cancelLabel: 'キャンセル', destructive: true });
  if (!ok) return;
  const r = await api.exploreDeleteComment(id, cid);
  if (!r?.ok) { window._app?.showToast?.('削除できませんでした'); return; }
  const c = _entry(id).comments;
  c.items = c.items.filter(x => x.id !== cid);
  logEvent('archive_comment_deleted', { eventId: id });
  _patch(id);
}

// ── 操作（document に1回だけ委譲する。★公開ページの委譲は EXPLORE のときだけ動くので重ならない）──
let _bound = false;
export function bindArchiveSocialOnce() {
  if (_bound) return;
  _bound = true;
  document.addEventListener('click', (e) => {
    if (state.currentView !== 'MAIN_BOARD') return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !t.closest('[data-archive-social]')) return;
    let el;
    if ((el = t.closest('[data-as-open-sheet]'))) { _openSheet(el.dataset.asOpenSheet); return; }
    if ((el = t.closest('[data-as-post]'))) { _post(el.dataset.asPost); return; }
    if ((el = t.closest('[data-as-more]'))) { _loadComments(el.dataset.asMore, true); return; }
    if ((el = t.closest('[data-ex-del]'))) { _delete(el.dataset.exDelEvent, el.dataset.exDel); }
  });
  // 入力中は描き直さない（フォーカスを保つ）。残りの字数と送信ボタンだけ差し替える
  document.addEventListener('input', (e) => {
    const ta = e.target;
    if (!(ta instanceof HTMLTextAreaElement) || !ta.dataset.asDraft) return;
    const id = ta.dataset.asDraft;
    const c = _entry(id);
    c.draft = ta.value;
    const left = COMMENT_MAX - [...ta.value].length;
    const box = ta.closest('.p-explore__comment-form');
    const l = box?.querySelector('[data-as-left]');
    if (l) { l.textContent = `あと${left}文字`; l.classList.toggle('is-over', left < 0); }
    const btn = box?.querySelector('[data-as-post]');
    if (btn) btn.disabled = !ta.value.trim() || !!c.comments.posting;
  });
}

// ── 描き直しをまたいで、入力中のコメント欄のフォーカスを保つ（mainBoard.js が innerHTML の前後で呼ぶ）──
let _focusKeep = null;
export function captureArchiveSocialFocus() {
  const a = document.activeElement;
  _focusKeep = a?.id === INPUT_ID ? [a.selectionStart, a.selectionEnd] : null;
}
export function restoreArchiveSocialFocus() {
  if (!_focusKeep) return;
  const n = document.getElementById(INPUT_ID);
  if (n) { n.focus(); try { n.setSelectionRange(_focusKeep[0], _focusKeep[1]); } catch (_) {} }
  _focusKeep = null;
}
