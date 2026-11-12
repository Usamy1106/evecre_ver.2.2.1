// ===== 系譜（前の代を見る）と、前の代の後付け登録（2026-11-12。指示書D §4-1・§4-6）=====
//
// ★系譜はアプリの中（メンバーだけ）に留める。公開ページ（/explore）には出さない（指示書D §5-4）
// ★閲覧権限のない代は「前の代（閲覧権限なし）」とだけ出す（サーバーも名前と id を返さない）
// ★前の代の登録は作成フロー STEP 7 と同じ検査（handoverLink.js でリンクを読み、公開されているか／自分がメンバーかを確かめる）

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { loadHandoverOrigins, parseHandoverLink, handoverLinkErrorText, formatHandoverDates } from '../handoverLink.js';

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _event = () => state.events.find(p => p.id === state.selectedEventId);

// イベントごとの系譜（アーカイブのリードの「N件のイベントが生まれました」と設定の行でも使う）
const _cache = {};   // eventId → { loading, data }

/** 系譜を取る（1イベントにつき1回。force で取り直す）。取れたら描き直す */
export function lineageOf(eventId, { force = false } = {}) {
  const c = _cache[eventId];
  if (c && !force) return c.data || null;
  _cache[eventId] = { loading: true, data: c?.data || null };
  api.lineage(eventId).then(r => {
    _cache[eventId] = { loading: false, data: r?.ok ? r : null };
    state.render();
  }).catch(() => { _cache[eventId] = { loading: false, data: null }; });
  return c?.data || null;
}

let _return = null;   // { view, tab }

export function openLineage() {
  const p = _event();
  if (!p) return;
  _return = { view: state.currentView, tab: state.mainBoardTab || 'ARCHIVE' };
  logEvent('lineage_opened', { eventId: p.id });
  lineageOf(p.id, { force: true });
  state.currentView = 'LINEAGE';
  state.render();
  window.scrollTo(0, 0);
}

export function closeLineage() {
  const ret = _return || { view: 'MAIN_BOARD', tab: 'ARCHIVE' };
  _return = null;
  state.currentView = ret.view === 'EVENT_SETTINGS' ? 'EVENT_SETTINGS' : 'MAIN_BOARD';
  if (state.currentView === 'MAIN_BOARD') state.mainBoardTab = ret.tab;
  state.render();
  window.scrollTo(0, 0);
}

function _genHtml(g, { self = false } = {}) {
  if (!g.canView) {
    return `<li class="p-lineage__gen is-hidden"><span class="p-lineage__gen-title">前の代（閲覧権限なし）</span></li>`;
  }
  const year = (g.dates || [])[0]?.slice(0, 4);
  // 自分がメンバーの代 → その代のアーカイブ。メンバーでないが公開されている代 → 公開ページ
  const action = self ? '' : g.member
    ? `<button type="button" class="p-lineage__open" data-ln-archive="${_esc(g.id)}">アーカイブを開く</button>`
    : g.isPublic ? `<a class="p-lineage__open" href="/explore/${encodeURIComponent(g.id)}">公開ページを開く</a>` : '';
  return `
    <li class="p-lineage__gen${self ? ' is-self' : ''}">
      <span class="p-lineage__gen-year">${year ? `${_esc(year)}年` : '日程未設定'}${self ? '（このイベント）' : ''}</span>
      <span class="p-lineage__gen-title">${_esc(g.title)}</span>
      <span class="p-lineage__gen-meta">${_esc(formatHandoverDates(g.dates))}${g.isPublic ? '・公開中' : ''}</span>
      ${action}
    </li>`;
}

export function renderLineage(appEl) {
  const p = _event();
  if (!p) { closeLineage(); return; }
  const data = _cache[p.id]?.data;
  const loading = _cache[p.id]?.loading && !data;
  const self = { id: p.id, title: p.name, dates: [...(p.dates || [])].sort(), isPublic: p.publicBasicInfo === true, canView: true, member: true };
  const canMgr = state.canManageCurrentEvent();
  appEl.innerHTML = `
    <div class="p-lineage u-page-transition">
      <header class="l-header l-header--sub">
        <button type="button" class="l-header__back" data-ln-close aria-label="戻る">
          <img src="/images/icon/icon-chevron.svg" class="l-header__back-icon" alt="">
        </button>
        <h1 class="l-header__heading">前の代</h1>
      </header>
      <main class="p-lineage__body">
        ${loading ? '<p class="p-lineage__note">読み込み中…</p>' : `
        <ol class="p-lineage__list">
          ${_genHtml(self, { self: true })}
          ${(data?.ancestors || []).map(g => _genHtml(g)).join('')}
        </ol>
        ${!(data?.ancestors || []).length ? `
          <p class="p-lineage__note">前の代のイベントはまだ登録されていません。</p>
          ${canMgr ? '<button type="button" class="c-button c-button--secondary p-lineage__register" data-ln-register>前の代を登録する</button>' : ''}` : ''}
        ${data?.descendantCount > 0 ? `<p class="p-lineage__note">このイベントから ${data.descendantCount}件のイベントが生まれました。</p>` : ''}`}
      </main>
    </div>`;
  appEl.querySelector('[data-ln-close]')?.addEventListener('click', closeLineage);
  appEl.querySelector('[data-ln-register]')?.addEventListener('click', () => openParentRegister());
  appEl.querySelectorAll('[data-ln-archive]').forEach(b => b.addEventListener('click', () => {
    _return = null;
    state.setView('MAIN_BOARD', b.dataset.lnArchive, { tab: 'ARCHIVE' });
  }));
}

// ── 前の代の後付け登録（イベント設定・系譜から。管理者だけ）──

const REG_ID = 'parent-register-overlay';

export function openParentRegister() {
  const p = _event();
  if (!p || !state.canManageCurrentEvent()) return;
  document.getElementById(REG_ID)?.remove();
  const mine = state.events.filter(e => e.id !== p.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const ov = document.createElement('div');
  ov.id = REG_ID;
  ov.className = 'c-overlay c-overlay--center c-overlay--blur u-animate-fade';
  ov.innerHTML = `
    <div class="p-lineage__register-box" role="dialog" aria-modal="true" aria-labelledby="pr-title">
      <h2 id="pr-title" class="p-lineage__register-title">前の代のイベントを登録する</h2>
      <p class="p-lineage__note">引き継ぎたいイベントを選ぶか、公開されているアーカイブのリンクを貼ってください。目的や柱は引き継がれません。</p>
      ${mine.length ? `<ul class="p-lineage__choices">${mine.map(e => `
        <li><button type="button" class="p-lineage__choice" data-pr-pick="${_esc(e.id)}">${_esc(e.name || '（名前なし）')}
          <span class="p-lineage__gen-meta">${_esc(formatHandoverDates(e.dates))}</span></button></li>`).join('')}</ul>` : ''}
      <input id="pr-link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
        class="p-lineage__register-input" placeholder="https://…/explore/…">
      <p class="p-lineage__register-msg" data-pr-msg role="status"></p>
      <div class="p-lineage__register-actions">
        ${p.parentEventId ? '<button type="button" class="c-button c-button--secondary p-lineage__register-btn" data-pr-clear>登録を外す</button>' : ''}
        <button type="button" class="c-button c-button--secondary p-lineage__register-btn" data-pr-close>閉じる</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-pr-close]').addEventListener('click', close);
  const msg = ov.querySelector('[data-pr-msg]');

  const save = async (id, label) => {
    const prev = p.parentEventId;
    p.parentEventId = id;
    const ok = await state.saveNow(p.id);
    if (!ok) { p.parentEventId = prev; return; }
    logEvent('parent_event_registered', { eventId: p.id, cleared: !id });
    delete _cache[p.id];
    close();
    window._app?.showToast?.(id ? `「${label}」を前の代として登録しました` : '前の代の登録を外しました');
    state.render();
  };
  ov.querySelectorAll('[data-pr-pick]').forEach(b => b.addEventListener('click', () => {
    const e = mine.find(x => x.id === b.dataset.prPick);
    save(e.id, e.name || '');
  }));
  ov.querySelector('[data-pr-clear]')?.addEventListener('click', () => save('', ''));   // ★外すときは空文字（落とし穴 0-3）
  const input = ov.querySelector('#pr-link');
  let t = null;
  const check = async () => {
    const r = parseHandoverLink(input.value, await loadHandoverOrigins());
    if (r.error) { msg.textContent = r.error === 'empty' ? '' : handoverLinkErrorText(r.error); return; }
    if (r.id === p.id) { msg.textContent = 'このイベント自身のリンクです'; return; }
    msg.textContent = '確かめています…';
    const ev = await api.getPublicEvent(r.id);
    if (!ev?.ok) { msg.textContent = handoverLinkErrorText(ev?.error === 'not_found' ? 'not_found' : 'network'); return; }
    msg.textContent = '';
    save(r.id, ev.basic?.title || '');
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(check, 500); });
  input.addEventListener('paste', () => setTimeout(check, 0));
}
