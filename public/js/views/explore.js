// ===== 公開ページ「みんなの記録」（/explore。2026-11-12。指示書05 §2・§5）=====
//
// URL：/explore（一覧）／/explore?event=<id>（一覧の上で告知モーダル）／/explore/<id>（ナレッジページ）
// ★ログインしていなくても見られる。state.init() が /explore を拾うと、ほかの起動の流れ（招待・オンボーディング・
//   タスクのリンク）を通さずにこの画面を描く（アプリのモーダル・案内はここでは出さない）。
//   アプリへ戻るときはページを読み込み直す（location.assign('/')）＝保留していた流れはそこで始まる。
// ★/explore の中だけ URL を持つ（pushState / popstate）。ブラウザの「戻る」は ナレッジページ → 一覧、告知モーダル → 閉じる。
//   browserBack.js（アプリの見張り）は EXPLORE では何もしない。
// ★外に出る姿の描き方は views/publicArchive.js（公開の確認ページと共通）。ここに書き写さないこと
// ★いいねは1つのイベントにつき1つ。告知モーダルとナレッジページで同じいいねを共有する
// ★展示モード（?kiosk=1。外部サイトからの依頼 main-app-explore-kiosk-return.md）：sessionStorage に持ち、
//   3分操作が無ければ外部サイトの Top（<publicSiteUrl>/?kiosk=1）へ戻る。ログイン・新規登録の導線とコメントの入力欄を出さない

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { Components } from '../components.js';
import { EVENT_TYPES } from '../constants.js';
import { formatHandoverDates } from '../handoverLink.js';
import { showConfirmDialog } from '../dialog.js';
import { publicArchiveHtml, publicBasicHtml } from './publicArchive.js';
import { rememberExploreReturn } from '../exploreReturn.js';

const KIOSK_KEY      = 'evecre:explore-kiosk';
const KIOSK_IDLE_MS  = 180000;            // 展示モード：この時間操作が無ければ外部サイトの Top へ
const COMMENT_MAX    = 1000;
const ID_RE          = /^[A-Za-z0-9_-]{1,64}$/;
const MODAL_ID       = 'explore-modal';

// ── 画面の状態（このモジュールだけが持つ）──
const S = {
  route: { kind: 'list', id: null, event: null },
  list: null, listLoading: false, listError: false,
  filterStatus: 'all', filterType: 'all',
  detail: {},        // id → { loading, data, notFound, error }
  comments: {},      // id → { items, hasMore, loading, posting, error }
  draft: {},         // id → 入力中のコメント
  likeBusy: new Set(),
  siteUrl: undefined,  // 外部サイトの Top（未取得は undefined、無ければ null）
};

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { sessionStorage.removeItem(k); } catch (_) {} },
};

export const isKiosk = () => _ss.get(KIOSK_KEY) === '1';

// ── URL ──

/** /explore で始まるパスなら route を返す（それ以外は null） */
export function parseExploreLocation(loc = window.location) {
  const m = loc.pathname.match(/^\/explore(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  if (m[1]) {
    const id = decodeURIComponent(m[1]);
    return { kind: 'detail', id: ID_RE.test(id) ? id : null, event: null };
  }
  const ev = new URLSearchParams(loc.search).get('event');
  return { kind: 'list', id: null, event: ev && ID_RE.test(ev) ? ev : null };
}

const _rerender = () => { if (state.currentView === 'EXPLORE') state.render(); };

/**
 * state.init() から1回だけ呼ぶ。展示モードの受け取り・popstate・無操作の見張りを配線する
 * @returns {boolean} /explore だったか
 */
export function startExplore() {
  const route = parseExploreLocation();
  if (!route) return false;
  // 展示モード：kiosk=1 で入る・kiosk=0 で解除。受け取ったら URL から消す（?event= と混ざらないように）
  const params = new URLSearchParams(window.location.search);
  if (params.has('kiosk')) {
    if (params.get('kiosk') === '1') _ss.set(KIOSK_KEY, '1'); else _ss.del(KIOSK_KEY);
    params.delete('kiosk');
    const q = params.toString();
    history.replaceState(history.state, '', window.location.pathname + (q ? `?${q}` : ''));
  }
  S.route = route;
  _appTitle = document.title;
  document.title = 'みんなの記録 | イベクリ';
  window.addEventListener('popstate', () => {
    if (state.currentView !== 'EXPLORE') return;
    const r = parseExploreLocation();
    if (!r) return;
    S.route = r;
    _rerender();
  });
  _armKioskIdle();
  api.getConfig().then(r => { S.siteUrl = typeof r?.publicSiteUrl === 'string' ? r.publicSiteUrl : null; _rerender(); })
    .catch(() => { S.siteUrl = null; });
  logEvent('explore_opened', { kind: route.kind, kiosk: isKiosk() });
  return true;
}

let _appTitle = '';
/** /explore を出てアプリの画面（ログイン・新規登録）へ移る。URL とタブの題名をアプリのものに戻す */
function _leaveToApp(view) {
  history.replaceState(null, '', '/');
  if (_appTitle) document.title = _appTitle;
  state.authErrors = {};
  state.setView(view);
}

function _go(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({ explore: true }, '', path);
  S.route = parseExploreLocation() || { kind: 'list', id: null, event: null };
  _rerender();
  if (!S.route.event) window.scrollTo(0, 0);
}

// ── 展示モード：無操作で外部サイトの Top へ ──
let _idleTimer = null;
function _armKioskIdle() {
  const reset = () => {
    clearTimeout(_idleTimer);
    if (!isKiosk() || state.currentView !== 'EXPLORE') return;
    _idleTimer = setTimeout(() => {
      // ★戻り先は publicSiteUrl だけ（URL のパラメータで受け取らない）。無ければ何もしない
      if (S.siteUrl) location.replace(`${S.siteUrl}/?kiosk=1`);
    }, KIOSK_IDLE_MS);
  };
  for (const t of ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(t, reset, { passive: true, capture: true });
  }
  reset();
}

// ── データ ──

async function _loadList() {
  if (S.listLoading) return;
  S.listLoading = true; S.listError = false;
  const r = await api.exploreList();
  S.listLoading = false;
  if (r?.ok) S.list = r.events || []; else S.listError = true;
  _rerender();
}

async function _loadDetail(id) {
  const cur = S.detail[id];
  if (cur?.loading) return;
  S.detail[id] = { ...(cur || {}), loading: true, error: false };
  const r = await api.exploreEvent(id);
  if (r?.ok) S.detail[id] = { loading: false, data: r };
  else if (r?.httpStatus === 404) S.detail[id] = { loading: false, notFound: true };
  else S.detail[id] = { loading: false, error: true };
  _rerender();
}

async function _loadComments(id, more = false) {
  const c = S.comments[id] || (S.comments[id] = { items: [], hasMore: false });
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
  _rerender();
}

// いいね数と押した状態を、一覧と詳細の両方にそろえる
function _setLike(id, liked, count) {
  const d = S.detail[id]?.data;
  if (d) { d.liked = liked; d.likeCount = count; }
  const it = S.list?.find(e => e.id === id);
  if (it) it.likeCount = count;
}

async function _toggleLike(id) {
  if (S.likeBusy.has(id)) return;            // ★応答が返るまで次を送らない
  const d = S.detail[id]?.data;
  const was = !!d?.liked;
  const count = d?.likeCount ?? (S.list?.find(e => e.id === id)?.likeCount || 0);
  S.likeBusy.add(id);
  _setLike(id, !was, Math.max(0, count + (was ? -1 : 1)));   // すぐに見た目を変える
  _rerender();
  const r = await api.exploreLike(id, !was);
  S.likeBusy.delete(id);
  if (r?.ok) _setLike(id, r.liked, r.likeCount);
  else {
    _setLike(id, was, count);
    window._app?.showToast?.(r?.error === 'rate_limited' ? '少し時間をおいてから押してください' : 'いいねを送れませんでした');
  }
  logEvent(was ? 'explore_unliked' : 'explore_liked', { eventId: id });
  _rerender();
}

async function _postComment(id) {
  const c = S.comments[id] || (S.comments[id] = { items: [], hasMore: false });
  const body = (S.draft[id] || '').trim();
  if (!body || c.posting) return;
  if ([...body].length > COMMENT_MAX) { window._app?.showToast?.(`${COMMENT_MAX}文字以内で書いてください`); return; }
  c.posting = true; _rerender();
  const r = await api.explorePostComment(id, body);
  c.posting = false;
  if (r?.ok && r.comment) {
    c.items = [r.comment, ...c.items];
    S.draft[id] = '';
    logEvent('explore_comment_posted', { eventId: id });
  } else {
    window._app?.showToast?.(
      r?.error === 'verification_required' ? 'メール認証をすると、コメントできます'
        : r?.error === 'rate_limited' ? '少し時間をおいてから送ってください'
          : r?.error === 'invalid_body' ? `1〜${COMMENT_MAX}文字で書いてください`
            : 'コメントを送れませんでした');
  }
  _rerender();
}

async function _deleteComment(id, cid) {
  const ok = await showConfirmDialog({ message: 'このコメントを削除しますか？', confirmLabel: '削除する', cancelLabel: 'キャンセル', destructive: true });
  if (!ok) return;
  const r = await api.exploreDeleteComment(id, cid);
  if (!r?.ok) { window._app?.showToast?.('削除できませんでした'); return; }
  const c = S.comments[id];
  if (c) c.items = c.items.filter(x => x.id !== cid);
  logEvent('explore_comment_deleted', { eventId: id });
  _rerender();
}

// ── 描画の部品 ──

// リンクをコピー（告知モーダルとナレッジページ）。★開催後（status が archive）のイベントだけ。告知（開催前）は出さない（2026-11-14）
//   ★コピーしたリンクは、新しいイベントの「前のイベントの引き継ぎ」
//   （作成フロー STEP 7・イベント設定の「前の代のイベント」）にそのまま貼れる（handoverLink.js が両方の形を読む）
function _copyButtonHtml(id, kind, status) {
  if (status !== 'archive') return '';
  return `<button type="button" class="c-button c-button--secondary p-explore__small" data-ex-copy="${_esc(id)}" data-ex-copy-kind="${kind}">リンクをコピー</button>`;
}

/** ページのリンク：ナレッジページは /explore/<id>、告知モーダルは /explore?event=<id> */
function _shareUrl(id, kind) {
  const e = encodeURIComponent(id);
  return kind === 'page' ? `${location.origin}/explore/${e}` : `${location.origin}/explore?event=${e}`;
}

/** クリップボードへ。navigator.clipboard が無い（http の LAN など）・断られたときは選択してコピーする */
async function _copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) {}
  ta.remove();
  return ok;
}

function _likeButtonHtml(id, liked, count) {
  const busy = S.likeBusy.has(id);
  return `
    <button type="button" class="c-like-button${liked ? ' is-liked' : ''}" data-ex-like="${_esc(id)}"
      aria-pressed="${liked ? 'true' : 'false'}" aria-label="いいね（${Number(count) || 0}）"${busy ? ' aria-busy="true"' : ''}>
      <span class="c-like-button__icon" aria-hidden="true">${liked ? '♥' : '♡'}</span>
      <span class="c-like-button__count">${Number(count) || 0}</span>
    </button>`;
}

function _headerHtml() {
  const kiosk = isKiosk();
  const site = S.siteUrl ? (kiosk ? `${S.siteUrl}/?kiosk=1` : `${S.siteUrl}/`) : null;
  const auth = kiosk ? ''
    : state.currentUser
      ? `<button type="button" class="c-button c-button--secondary p-explore__small p-explore__head-action" data-ex-app>アプリに戻る</button>`
      : `<button type="button" class="c-button c-button--primary p-explore__small p-explore__head-action" data-ex-start>イベクリをはじめる</button>`;
  return `
    <header class="p-explore__head">
      <a href="/explore" class="p-explore__brand" data-ex-home>
        <img src="/images/icon/evecre-icon-48.png" alt="" class="p-explore__logo" width="28" height="28">
        <span class="p-explore__brand-name">イベクリ</span>
      </a>
      <nav class="p-explore__nav" aria-label="サイト内">
        ${site ? `<a href="${_esc(site)}" class="p-explore__nav-link">イベクリについて</a>` : ''}
        ${auth}
      </nav>
    </header>`;
}

function _cardHtml(e) {
  const img = typeof e.headerImage === 'string' && /^https:\/\//.test(e.headerImage) ? e.headerImage : '';
  const type = EVENT_TYPES.find(t => t.id === e.eventType)?.label || '';
  return `
    <li class="p-explore__item">
      <button type="button" class="p-explore__card" data-ex-card="${_esc(e.id)}" data-ex-knowledge="${e.hasKnowledge ? '1' : ''}">
        ${img ? `<img src="${_esc(img)}" alt="" class="p-explore__thumb" loading="lazy" data-fallback="archive-visual">`
              : `<span class="p-explore__thumb p-explore__thumb--empty" aria-hidden="true"><img src="/images/icon/evecre-icon-192.png" alt=""></span>`}
        <span class="p-explore__card-body">
          <span class="p-explore__card-labels">
            <span class="p-explore__label p-explore__label--${e.status === 'archive' ? 'archive' : 'upcoming'}">${e.status === 'archive' ? 'アーカイブ' : '告知'}</span>
            ${type ? `<span class="p-explore__type">${_esc(type)}</span>` : ''}
          </span>
          <span class="p-explore__card-title">${_esc(e.title)}</span>
          ${(e.dates || []).length ? `<span class="p-explore__card-meta">${_esc(formatHandoverDates(e.dates))}</span>` : ''}
          ${e.venue ? `<span class="p-explore__card-meta">${_esc(e.venue)}</span>` : ''}
          <span class="p-explore__card-like" aria-label="いいね ${Number(e.likeCount) || 0}">♥ ${Number(e.likeCount) || 0}</span>
        </span>
      </button>
    </li>`;
}

function _filterButtons(name, items, current) {
  return items.map(([v, label]) => `
        <button type="button" class="p-explore__filter${current === v ? ' is-active' : ''}" data-ex-filter="${name}" data-value="${_esc(v)}"
          aria-pressed="${current === v ? 'true' : 'false'}">${_esc(label)}</button>`).join('');
}

function _listHtml() {
  if (!S.list) {
    return `<p class="p-explore__message">${S.listError ? '読み込めませんでした。時間をおいて開き直してください。' : '読み込み中…'}</p>`;
  }
  const types = EVENT_TYPES.filter(t => S.list.some(e => e.eventType === t.id));
  const shown = S.list.filter(e =>
    (S.filterStatus === 'all' || e.status === S.filterStatus) && (S.filterType === 'all' || e.eventType === S.filterType));
  const filtered = S.filterStatus !== 'all' || S.filterType !== 'all';
  const count = !shown.length ? '' : filtered ? `${S.list.length}件中 ${shown.length}件` : `${S.list.length}件`;
  return `
    <div class="p-explore__filters" role="group" aria-label="告知・アーカイブで絞り込み">
      ${_filterButtons('status', [['all', 'すべて'], ['upcoming', '告知'], ['archive', 'アーカイブ']], S.filterStatus)}
    </div>
    ${types.length ? `
    <div class="p-explore__filters" role="group" aria-label="種別で絞り込み">
      ${_filterButtons('type', [['all', 'すべての種別'], ...types.map(t => [t.id, t.label])], S.filterType)}
    </div>` : ''}
    ${count ? `<p class="p-explore__count" aria-live="polite">${_esc(count)}</p>` : ''}
    ${shown.length
      ? `<ul class="p-explore__grid">${shown.map(_cardHtml).join('')}</ul>`
      : `<p class="p-explore__message">${S.list.length ? '該当するイベントはありません。' : 'まだ公開されているイベントはありません。'}</p>`}`;
}

function _commentsHtml(id, viewer) {
  const c = S.comments[id] || {};
  const items = c.items || [];
  const kiosk = isKiosk();
  let input = '';
  if (kiosk) input = '';
  else if (viewer?.canComment) {
    const draft = S.draft[id] || '';
    const left = COMMENT_MAX - [...draft].length;
    input = `
      <div class="p-explore__comment-form">
        <textarea id="ex-comment-input" class="p-explore__comment-input" rows="3" maxlength="${COMMENT_MAX}"
          placeholder="このイベントの記録を読んだ感想・質問など" data-ex-draft="${_esc(id)}">${_esc(draft)}</textarea>
        <div class="p-explore__comment-actions">
          <span class="p-explore__comment-left${left < 0 ? ' is-over' : ''}" data-ex-left>あと${left}文字</span>
          <button type="button" class="c-button c-button--primary p-explore__small" data-ex-post="${_esc(id)}" data-cmd-enter
            ${!draft.trim() || c.posting ? 'disabled' : ''}>${c.posting ? '送信中…' : '送信'}</button>
        </div>
      </div>`;
  } else if (viewer?.loggedIn) {
    input = `<p class="p-explore__comment-note">メール認証をすると、コメントできます</p>`;
  } else {
    input = `<button type="button" class="c-button c-button--secondary p-explore__comment-login" data-ex-login>ログインしてコメントする</button>`;
  }
  const list = items.map(cm => {
    const name = cm.author ? cm.author.username || '名前なし' : '退会したユーザー';
    const d = new Date(cm.createdAt);
    const when = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `
      <li class="p-explore__comment">
        ${Components.UserAvatar(cm.author ? { username: name, avatarUrl: cm.author.avatarUrl } : { username: '?' }, { size: 32 })}
        <div class="p-explore__comment-main">
          <p class="p-explore__comment-head"><span class="p-explore__comment-name">${_esc(name)}</span><time class="p-explore__comment-time">${when}</time></p>
          <p class="p-explore__comment-body">${_esc(cm.body)}</p>
          ${cm.canDelete ? `<button type="button" class="p-explore__comment-delete" data-ex-del="${_esc(cm.id)}" data-ex-del-event="${_esc(id)}">削除</button>` : ''}
        </div>
      </li>`;
  }).join('');
  return `
    <section class="p-explore__comments" aria-labelledby="ex-comments-title">
      <h2 id="ex-comments-title" class="p-explore__section-title">コメント</h2>
      ${input}
      ${c.error ? '<p class="p-explore__message">コメントを読み込めませんでした。</p>' : ''}
      ${items.length ? `<ul class="p-explore__comment-list">${list}</ul>` : (c.loaded && !kiosk ? '<p class="p-explore__comment-empty">まだコメントはありません。</p>' : '')}
      ${c.hasMore ? `<button type="button" class="c-button c-button--secondary p-explore__small p-explore__more" data-ex-more="${_esc(id)}" ${c.loading ? 'disabled' : ''}>もっと見る</button>` : ''}
    </section>`;
}

function _detailHtml(id) {
  const st = S.detail[id];
  const back = `<a href="/explore" class="p-explore__back" data-ex-to-list>‹ みんなの記録へ戻る</a>`;
  if (!st || st.loading && !st.data) return `${back}<p class="p-explore__message">読み込み中…</p>`;
  if (st.notFound) return `${back}<p class="p-explore__message">見つかりませんでした。公開が止められたか、リンクが正しくない可能性があります。</p>`;
  if (st.error) return `${back}<p class="p-explore__message">読み込めませんでした。時間をおいて開き直してください。</p>`;
  const d = st.data;
  return `
    ${back}
    <article class="p-explore__page">
      ${publicArchiveHtml(d)}
      <div class="p-explore__page-like">
        ${_likeButtonHtml(id, d.liked, d.likeCount)}
        ${_copyButtonHtml(id, 'page', d.status)}
      </div>
      ${_commentsHtml(id, d.viewer)}
    </article>`;
}

// ── 告知モーダル（一覧の上で開く）──

function _syncModal() {
  const id = S.route.kind === 'list' ? S.route.event : null;
  let ov = document.getElementById(MODAL_ID);
  if (!id) { ov?.remove(); return; }
  const st = S.detail[id];
  if (!st) { _loadDetail(id); }
  if (!ov) {
    ov = document.createElement('div');
    ov.id = MODAL_ID;
    ov.className = 'c-overlay c-overlay--center c-overlay--blur u-animate-fade';
    ov.addEventListener('click', (e) => { if (e.target === ov) _closeModal(); });
    document.body.appendChild(ov);
  }
  let inner;
  if (!st || st.loading && !st.data) inner = '<p class="p-explore__message">読み込み中…</p>';
  else if (st.notFound) inner = '<p class="p-explore__message">見つかりませんでした。</p>';
  else if (st.error) inner = '<p class="p-explore__message">読み込めませんでした。</p>';
  else {
    const d = st.data;
    inner = `
      ${publicBasicHtml(d.basic, { status: d.status })}
      <div class="p-explore__modal-actions">
        ${_likeButtonHtml(id, d.liked, d.likeCount)}
        ${_copyButtonHtml(id, 'modal', d.status)}
      </div>`;
  }
  ov.innerHTML = `
    <div class="p-explore__modal" role="dialog" aria-modal="true" aria-label="イベントの告知">
      <button type="button" class="p-explore__modal-close" data-ex-close aria-label="閉じる">×</button>
      ${inner}
    </div>`;
}

function _closeModal() {
  // ★開くときに積んだ履歴があれば戻る（ブラウザの戻ると同じ動き）。直接開いたときは URL を一覧に置き換える
  if (history.state?.exploreModal) history.back();
  else _go('/explore', true);
}

function _openCard(id, hasKnowledge) {
  if (hasKnowledge) { _go(`/explore/${encodeURIComponent(id)}`); return; }
  history.pushState({ explore: true, exploreModal: true }, '', `/explore?event=${encodeURIComponent(id)}`);
  S.route = { kind: 'list', id: null, event: id };
  _rerender();
}

// ── 操作（#app と body に1回だけ委譲する）──

let _bound = false;
function _bindOnce() {
  if (_bound) return;
  _bound = true;
  const onClick = async (e) => {
    if (state.currentView !== 'EXPLORE') return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const q = (sel) => t.closest(sel);
    let el;
    if ((el = q('[data-ex-home]'))) { e.preventDefault(); _go('/explore'); return; }
    if ((el = q('[data-ex-to-list]'))) {
      e.preventDefault();
      if (history.state?.exploreFromList) history.back(); else _go('/explore');
      return;
    }
    if ((el = q('[data-ex-card]'))) {
      const id = el.dataset.exCard;
      logEvent('explore_card_opened', { eventId: id, knowledge: !!el.dataset.exKnowledge });
      if (el.dataset.exKnowledge) {
        history.pushState({ explore: true, exploreFromList: true }, '', `/explore/${encodeURIComponent(id)}`);
        S.route = { kind: 'detail', id, event: null };
        _rerender(); window.scrollTo(0, 0);
      } else _openCard(id, false);
      return;
    }
    if ((el = q('[data-ex-filter]'))) {
      if (el.dataset.exFilter === 'status') S.filterStatus = el.dataset.value; else S.filterType = el.dataset.value;
      _rerender(); return;
    }
    if ((el = q('[data-ex-like]'))) { _toggleLike(el.dataset.exLike); return; }
    if ((el = q('[data-ex-close]'))) { _closeModal(); return; }
    if ((el = q('[data-ex-copy]'))) {
      const kind = el.dataset.exCopyKind === 'page' ? 'page' : 'modal';
      const url = _shareUrl(el.dataset.exCopy, kind);
      const ok = await _copyText(url);
      if (ok) logEvent('explore_link_copied', { eventId: el.dataset.exCopy, kind });
      window._app?.showToast?.(ok
        ? 'リンクをコピーしました。新しいイベントの「前のイベントの引き継ぎ」に貼り付けられます'
        : 'コピーできませんでした: ' + url);
      return;
    }
    if ((el = q('[data-ex-post]'))) { _postComment(el.dataset.exPost); return; }
    if ((el = q('[data-ex-more]'))) { _loadComments(el.dataset.exMore, true); return; }
    if ((el = q('[data-ex-del]'))) { _deleteComment(el.dataset.exDelEvent, el.dataset.exDel); return; }
    if ((el = q('[data-ex-login]'))) {
      // ★ログインのあと、このページに戻る（loadAfterAuth の最後で consumeExploreReturn）
      rememberExploreReturn();
      logEvent('explore_login_tapped', {});
      _leaveToApp('LOGIN');
      return;
    }
    if ((el = q('[data-ex-start]'))) {
      logEvent('explore_signup_tapped', {});
      state.signup = null;
      _leaveToApp('CREATE_ACCOUNT_INFO');
      return;
    }
    if ((el = q('[data-ex-app]'))) { location.assign('/'); return; }
  };
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => {
    if (state.currentView === 'EXPLORE' && e.key === 'Escape' && document.getElementById(MODAL_ID)) _closeModal();
  });
  // コメントの入力：再描画しない（フォーカスを保つ）。残りの字数と送信ボタンだけ差し替える
  document.addEventListener('input', (e) => {
    const ta = e.target;
    if (!(ta instanceof HTMLTextAreaElement) || !ta.dataset.exDraft) return;
    const id = ta.dataset.exDraft;
    S.draft[id] = ta.value;
    const left = COMMENT_MAX - [...ta.value].length;
    const box = ta.closest('.p-explore__comment-form');
    const l = box?.querySelector('[data-ex-left]');
    if (l) { l.textContent = `あと${left}文字`; l.classList.toggle('is-over', left < 0); }
    const btn = box?.querySelector('[data-ex-post]');
    if (btn) btn.disabled = !ta.value.trim() || !!S.comments[id]?.posting;
  });
}

// ── 描画 ──

export function renderExplore(appEl) {
  _bindOnce();
  const r = S.route;
  // ★描き直しで入力中のコメントのフォーカスを保つ
  const focused = document.activeElement?.id === 'ex-comment-input';
  const sel = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

  let main = '';
  if (r.kind === 'detail') {
    if (!r.id) main = `<a href="/explore" class="p-explore__back" data-ex-to-list>‹ みんなの記録へ戻る</a><p class="p-explore__message">見つかりませんでした。</p>`;
    else {
      const st = S.detail[r.id];
      if (!st) _loadDetail(r.id);
      // ★ナレッジが出ていない（告知だけ）なら、一覧の上の告知モーダルに置き換える
      if (st?.data && st.data.knowledge === null) {
        history.replaceState({ explore: true }, '', `/explore?event=${encodeURIComponent(r.id)}`);
        S.route = { kind: 'list', id: null, event: r.id };
        return renderExplore(appEl);
      }
      if (st?.data && !S.comments[r.id]) _loadComments(r.id);
      main = _detailHtml(r.id);
    }
  } else {
    if (!S.list && !S.listLoading && !S.listError) _loadList();
    main = `
      <h1 class="p-explore__title">みんなの記録</h1>
      <p class="p-explore__lead">イベクリで公開されたイベントです。開催前の告知と、開催後の記録（つまずいたこと・次にやるなら）を読めます。</p>
      ${_listHtml()}`;
  }
  appEl.innerHTML = `
    <div class="p-explore${r.kind === 'detail' ? ' p-explore--detail' : ''}">
      ${_headerHtml()}
      <main class="p-explore__main">${main}</main>
    </div>`;
  _syncModal();

  if (focused) {
    const ta = document.getElementById('ex-comment-input');
    if (ta) { ta.focus(); try { ta.setSelectionRange(sel[0], sel[1]); } catch (_) {} }
  }
}
