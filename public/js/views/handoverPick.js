// ===== 前の代のタスクから追加する（2026-11-12。指示書D §4-2・§4-3 ＋ 返信 §1）=====
//
// ★原則2：タスクは自動で入れない。次の代が選んで追加する（既定のチェックは全部オフ）。何度でも開ける
// ★原則1：前の代の目的と柱は、この画面の上に**読ませるだけ**（取り込まない）
// ★原則3：中身はサーバーの buildPublicEvent を通したもの（handover-source / /api/explore/events/:id）。
//   取り込みはサーバーが元を読み直して組み立てる（POST handover-import に渡すのは taskKey だけ）
// ★1行＝1タスク（taskKey でまとめる。個別完了の記録は「ほか N件」）。取り込み済み（inherited.sourceKey）はチェックできない
//
// 元イベントの決め方：
//   - parentEventId があればそれ（自分がメンバーなら handover-source、そうでなければ公開ページの詳細）
//   - 無ければ「自分がメンバーのイベント」から選ぶか、アーカイブのリンクを貼る（handoverLink.js）

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { OUTCOME_CHOICES, REFLECT_LABELS } from '../constants.js';
import { loadHandoverOrigins, parseHandoverLink, handoverLinkErrorText, formatHandoverDates } from '../handoverLink.js';
import { publicRecordHtml } from './publicArchive.js';

const PICK_MAX = 30;
const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _cut = (s, n = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

// 画面の状態（開くたびに作り直す）
let S = null;

const _event = () => state.events.find(p => p.id === state.selectedEventId);
const _rerender = () => { if (state.currentView === 'HANDOVER_PICK') state.render(); };

/** 取り込み済みの元タスク（inherited.sourceKey） */
function _importedKeys(p) {
  return new Set((p?.missions || []).map(m => m?.inherited?.sourceKey).filter(Boolean));
}

/** knowledge[]（提出物単位）→ タスク単位。サーバーの _groupHandoverTasks と同じまとめ方 */
function _groupTasks(knowledge) {
  const map = new Map();
  for (const k of knowledge || []) {
    let g = map.get(k.taskKey);
    if (!g) { g = { taskKey: k.taskKey, title: k.title, tags: k.tags || [], records: [] }; map.set(k.taskKey, g); }
    g.records.push(k);
  }
  // ★振り返りのあるタスクを上に（原則として全件あるが、念のため）。その中は元の順
  return [...map.values()].sort((a, b) => (b.records.some(r => r.solution) ? 1 : 0) - (a.records.some(r => r.solution) ? 1 : 0));
}

async function _loadSource(id) {
  S.sourceId = id; S.data = null; S.error = null; S.loading = true; S.picked = new Set();
  _rerender();
  const member = state.events.some(e => e.id === id);
  const r = member ? await api.handoverSource(id) : await api.exploreEvent(id);
  S.loading = false;
  if (r?.ok) {
    S.data = r;
    if (!Array.isArray(r.knowledge)) S.error = 'no_knowledge';
  } else S.error = r?.httpStatus === 404 ? 'not_found' : 'network';
  _rerender();
}

/**
 * 開く（タスクの追加画面・メインボードのカード・アーカイブから）。管理者だけ
 * @param {string} from 計測用
 */
export function openHandoverPick(from = '') {
  const p = _event();
  if (!p || !state.canManageCurrentEvent()) return;
  S = { sourceId: null, data: null, loading: false, error: null, picked: new Set(), choosing: !p.parentEventId,
        link: '', linkError: null, linkChecking: false, saving: false, returnTab: state.mainBoardTab || 'MAIN' };
  logEvent('handover_pick_opened', { eventId: p.id, from, hasParent: !!p.parentEventId });
  state.currentView = 'HANDOVER_PICK';
  state.render();
  window.scrollTo(0, 0);
  if (p.parentEventId) _loadSource(p.parentEventId);
}

export function closeHandoverPick() {
  const tab = S?.returnTab || 'MAIN';
  S = null;
  state.currentView = 'MAIN_BOARD';
  state.mainBoardTab = tab;
  state.render();
  window.scrollTo(0, 0);
}

async function _checkLink() {
  const text = S.link.trim();
  if (!text) { S.linkError = null; _rerender(); return; }
  const r = parseHandoverLink(text, await loadHandoverOrigins());
  if (r.error) { S.linkError = handoverLinkErrorText(r.error); _rerender(); return; }
  if (r.id === state.selectedEventId) { S.linkError = 'このイベント自身のリンクです。前のイベントのリンクを貼ってください'; _rerender(); return; }
  S.linkError = null; S.choosing = false;
  _loadSource(r.id);
}

async function _import() {
  const p = _event();
  if (!p || !S.picked.size || S.saving) return;
  if (S.picked.size > PICK_MAX) { window._app?.showToast?.(`1回に追加できるのは${PICK_MAX}件までです`); return; }
  S.saving = true; _rerender();
  const r = await api.handoverImport(p.id, S.sourceId, [...S.picked]);
  S.saving = false;
  if (!r?.ok) {
    window._app?.showToast?.(r?.error === 'too_many' ? `1回に追加できるのは${PICK_MAX}件までです` : '追加できませんでした');
    _rerender();
    return;
  }
  logEvent('handover_imported_client', { eventId: p.id, count: r.added?.length || 0 });
  await state.silentReloadEvents?.();
  window._app?.showToast?.(r.added?.length ? `前の代のタスクを${r.added.length}件追加しました` : '追加できるタスクはありませんでした');
  closeHandoverPick();
}

// ── 描画 ──

function _sourceHeadHtml() {
  const b = S.data?.basic;
  if (!b) return '';
  const dates = formatHandoverDates(b.dates);
  const pillars = Array.isArray(S.data.pillars) ? S.data.pillars : [];
  return `
    <section class="p-handover__source">
      <p class="p-handover__source-label">前の代のイベント</p>
      <p class="p-handover__source-title">${_esc(b.title)}${dates ? `<span class="p-handover__source-dates">${_esc(dates)}</span>` : ''}</p>
      ${S.data.purpose || pillars.length ? `
      <div class="p-handover__reading">
        <p class="p-handover__reading-note">前の代は、何のためにやったのか（読むだけです。取り込みません）</p>
        ${S.data.purpose ? `<p class="p-handover__reading-label">目的</p><p class="p-handover__reading-text">${_esc(S.data.purpose)}</p>` : ''}
        ${pillars.length ? `<p class="p-handover__reading-label">柱</p><p class="p-handover__reading-text">${pillars.map(_esc).join('・')}</p>` : ''}
      </div>` : ''}
      <button type="button" class="p-handover__change" data-ho-change>別のイベントから選ぶ</button>
    </section>`;
}

function _rowHtml(g, imported) {
  const first = g.records[0] || {};
  const labels = REFLECT_LABELS[first.outcome] || REFLECT_LABELS.struggle;
  const outcome = OUTCOME_CHOICES[first.outcome]?.label || '';
  const done = imported.has(g.taskKey);
  const on = S.picked.has(g.taskKey);
  return `
    <li class="p-handover__row${done ? ' is-imported' : ''}${on ? ' is-picked' : ''}">
      <label class="p-handover__pick">
        <input type="checkbox" data-ho-pick="${_esc(g.taskKey)}" ${on ? 'checked' : ''} ${done ? 'disabled' : ''}>
        <span class="p-handover__row-main">
          <span class="p-handover__row-title">${_esc(g.title)}</span>
          <span class="p-handover__row-meta">${[done ? '取り込み済み' : '', outcome, ...g.tags].filter(Boolean).map(_esc).join('・')}</span>
          ${first.struggle ? `<span class="p-handover__row-line"><b>${_esc(labels.struggle)}</b>${_esc(_cut(first.struggle))}</span>` : ''}
          ${first.solution ? `<span class="p-handover__row-line"><b>${_esc(labels.solution)}</b>${_esc(_cut(first.solution))}</span>` : ''}
          ${g.records.length > 1 ? `<span class="p-handover__row-more">ほか${g.records.length - 1}件の記録</span>` : ''}
        </span>
      </label>
    </li>`;
}

function _chooserHtml(p) {
  const mine = state.events.filter(e => e.id !== p.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return `
    <section class="p-handover__choose">
      <h2 class="p-handover__section-title">どのイベントから引き継ぎますか？</h2>
      <p class="p-handover__note">自分が参加していたイベントなら、公開していなくても選べます。</p>
      ${mine.length ? `<ul class="p-handover__events">${mine.map(e => `
        <li><button type="button" class="p-handover__event" data-ho-source="${_esc(e.id)}">
          <span class="p-handover__event-title">${_esc(e.name || '（名前なし）')}</span>
          ${(e.dates || []).length ? `<span class="p-handover__event-dates">${_esc(formatHandoverDates(e.dates))}</span>` : ''}
        </button></li>`).join('')}</ul>` : '<p class="p-handover__note">ほかに参加しているイベントはありません。</p>'}
      <label for="ho-link" class="p-handover__section-title p-handover__link-label">公開されているアーカイブのリンクを貼る</label>
      <input id="ho-link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
        class="p-handover__link-input" placeholder="https://…/explore/…" value="${_esc(S.link)}">
      ${S.linkError ? `<p class="p-handover__link-error">${_esc(S.linkError)}</p>` : ''}
      ${S.sourceId ? `<button type="button" class="p-handover__change" data-ho-cancel-change>選び直すのをやめる</button>` : ''}
    </section>`;
}

function _listHtml(p) {
  if (S.loading) return '<p class="p-handover__note">読み込み中…</p>';
  if (S.error === 'not_found') return '<p class="p-handover__note">前の代のイベントを読めませんでした。公開が止められたか、見る権限がありません。</p>';
  if (S.error === 'network') return '<p class="p-handover__note">通信できませんでした。少し待ってから開き直してください。</p>';
  if (S.error === 'no_knowledge') return '<p class="p-handover__note">このイベントには、引き継げる記録がまだ公開されていません。</p>';
  if (!S.data) return '';
  const groups = _groupTasks(S.data.knowledge);
  if (!groups.length) {
    return '<p class="p-handover__note">引き継げる記録がありません。前の代が「この活動記録を共有する」にして「次にやるなら」を書いた記録だけを引き継げます。</p>';
  }
  const imported = _importedKeys(p);
  return `
    <h2 class="p-handover__section-title">追加するタスクを選ぶ<span class="p-handover__count">${groups.length}件</span></h2>
    <p class="p-handover__note">選んだタスクが「やること」に入ります。期日・担当・柱は空のまま入るので、あとで決めてください。</p>
    <ul class="p-handover__list">${groups.map(g => _rowHtml(g, imported)).join('')}</ul>`;
}

export function renderHandoverPick(appEl) {
  const p = _event();
  if (!p || !S) { closeHandoverPick(); return; }
  const n = S.picked.size;
  appEl.innerHTML = `
    <div class="p-handover u-page-transition">
      <header class="l-header l-header--sub">
        <button type="button" class="l-header__back" data-ho-close aria-label="閉じる">
          <img src="/images/icon/icon-chevron.svg" class="l-header__back-icon" alt="">
        </button>
        <h1 class="l-header__heading">前の代から追加</h1>
      </header>
      <main class="p-handover__body">
        ${S.choosing ? _chooserHtml(p) : `${_sourceHeadHtml()}${_listHtml(p)}`}
      </main>
      ${!S.choosing && S.data && Array.isArray(S.data.knowledge) && S.data.knowledge.length ? `
      <footer class="p-handover__foot">
        <span class="p-handover__picked${n > PICK_MAX ? ' is-over' : ''}">${n}件を選択中${n > PICK_MAX ? `（${PICK_MAX}件まで）` : ''}</span>
        <button type="button" class="c-button c-button--primary p-handover__submit" data-ho-submit ${!n || n > PICK_MAX || S.saving ? 'disabled' : ''}>
          ${S.saving ? '追加しています…' : '追加する'}</button>
      </footer>` : ''}
    </div>`;

  appEl.querySelector('[data-ho-close]')?.addEventListener('click', closeHandoverPick);
  appEl.querySelector('[data-ho-change]')?.addEventListener('click', () => { S.choosing = true; _rerender(); });
  appEl.querySelector('[data-ho-cancel-change]')?.addEventListener('click', () => { S.choosing = false; _rerender(); });
  appEl.querySelectorAll('[data-ho-source]').forEach(b => b.addEventListener('click', () => { S.choosing = false; _loadSource(b.dataset.hoSource); }));
  appEl.querySelectorAll('[data-ho-pick]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) S.picked.add(cb.dataset.hoPick); else S.picked.delete(cb.dataset.hoPick);
    _rerender();
  }));
  appEl.querySelector('[data-ho-submit]')?.addEventListener('click', _import);
  const link = appEl.querySelector('#ho-link');
  if (link) {
    let t = null;
    link.addEventListener('input', () => { S.link = link.value; clearTimeout(t); t = setTimeout(_checkLink, 400); });
    link.addEventListener('paste', () => setTimeout(() => { S.link = link.value; _checkLink(); }, 0));
  }
}

// ── タスク詳細の「前回の記録」（§4-5 ＋ 返信 §1）──
// ★読み取り専用。records が複数なら1件目を開き、残りは折りたたむ。solution がある1件目は開いた状態
// ★画像が前の代で削除されていたら「この画像は、前の代のイベントで削除されました」（data-fallback="inherited"）
// ★inherited は公開しない（publicData には足していない）
export function inheritedRecordsHtml(m) {
  const inh = m?.inherited;
  const records = Array.isArray(inh?.records) ? inh.records : [];
  if (!records.length) return '';
  const year = (inh.sourceEventDates || [])[0]?.slice(0, 4);
  const body = (r) => `<div class="p-handover-record__body">
      ${OUTCOME_CHOICES[r.outcome] ? `<p class="p-handover-record__outcome">${_esc(OUTCOME_CHOICES[r.outcome].label)}</p>` : ''}
      ${publicRecordHtml(r, { fallback: 'inherited' })}</div>`;
  return `
    <details class="p-handover-record"${records[0].solution ? ' open' : ''}>
      <summary class="p-handover-record__summary">
        <span class="p-handover-record__title">前回の記録</span>
        <span class="p-handover-record__source">${_esc(inh.sourceEventTitle || '')}${year ? `（${_esc(year)}年）` : ''}</span>
      </summary>
      ${body(records[0])}
      ${records.slice(1).map((r, i) => `
      <details class="p-handover-record__more">
        <summary>ほかの記録 ${i + 2}</summary>
        ${body(r)}
      </details>`).join('')}
    </details>`;
}
