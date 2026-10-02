// ===== 柱を立てる・直すページ（PILLAR_EDIT）=====
//
// 目的（def-1）を支える「柱」を最大3つ決める**ページ**（モーダルではない）。管理者だけが開ける。
//
// ★空欄から3つ書かせない。イベント種別ごとの候補（constants.js の PILLAR_SUGGESTIONS）から選び、
//   名前は自由に直せる。候補に無ければ「＋ 自分で足す」。
// ★柱の id は追加したときに1回だけ振る（utils.js の newPillarId）。名前を変えても保持する。
//   削除した柱の id は再利用しない（タスクの pillarId が別の柱を指してしまう）。
// ★削除は確認を挟む（その場の確認。モーダルにしない）。紐づいていたタスクの pillarId は
//   書き換えない。存在しない id は pillarIdOf が未分類として読む。
// ★保存するまでイベントには書かない（下書き state.pillarDraft だけを触る）。戻るで捨てる。
// ★入力中に描き直さないこと（フォーカスが飛ぶ）。描き直すのは行を足す・消すときだけ。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { getPillars, pillarIdOf, newPillarId, submissionText } from '../utils.js';
import { PILLARS_MAX, PILLAR_NAME_MAX, PILLAR_SUGGESTIONS } from '../constants.js';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** 下書き（無ければイベントの今の柱から作る） */
function _draft(p) {
  if (!state.pillarDraft || state.pillarDraft.eventId !== p.id) {
    state.pillarDraft = {
      eventId: p.id,
      items: getPillars(p).map(x => ({ id: x.id, name: x.name, saved: true })),
      confirmId: null,
    };
  }
  return state.pillarDraft;
}

/** その柱に紐づいているタスクの数（削除の確認に出す） */
function _linkedCount(p, pillarId) {
  let n = 0;
  for (const m of p.missions || []) if (pillarIdOf(p, m) === pillarId) n++;
  return n;
}

export function renderPillarEdit(appEl) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.canManageCurrentEvent()) { state.closePillarEdit(); return; }
  const d = _draft(p);
  const full = d.items.length >= PILLARS_MAX;
  const purpose = submissionText(p.clearedData?.['def-1']);
  const names = new Set(d.items.map(x => x.name.trim()));
  const suggestions = PILLAR_SUGGESTIONS[p.eventType] || PILLAR_SUGGESTIONS.DEFAULT;

  const row = (it, i) => {
    if (d.confirmId === it.id) {
      const n = _linkedCount(p, it.id);
      return `
        <li class="p-pillar-edit__row p-pillar-edit__row--confirm">
          <p class="p-pillar-edit__confirm-text">「${_esc(it.name || '名前なし')}」を削除しますか？${
            n > 0 ? `<br>紐づいているタスク ${n}件は「未分類」に戻ります。` : ''}</p>
          <div class="p-pillar-edit__confirm-actions">
            <button type="button" data-pillar-cancel class="p-pillar-edit__text-button">やめる</button>
            <button type="button" data-pillar-remove="${_esc(it.id)}" class="p-pillar-edit__danger-button">削除する</button>
          </div>
        </li>`;
    }
    return `
      <li class="p-pillar-edit__row">
        <span class="p-pillar-edit__num">${i + 1}</span>
        <input type="text" data-pillar-name="${_esc(it.id)}" maxlength="${PILLAR_NAME_MAX}"
          value="${_esc(it.name)}" placeholder="例：誰も孤立させない" aria-label="柱 ${i + 1} の名前"
          class="c-input p-pillar-edit__input">
        <button type="button" data-pillar-delete="${_esc(it.id)}" class="p-pillar-edit__delete" aria-label="この柱を削除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
      </li>`;
  };

  appEl.innerHTML = `
    <div class="p-pillar-edit">
      <header class="p-pillar-edit__header">
        <button type="button" data-pillar-back data-log="pillar_edit_back"
          class="p-pillar-edit__round-button" aria-label="戻る">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <h1 class="p-pillar-edit__heading">このイベントの柱</h1>
      </header>

      <div class="p-pillar-edit__body">
        ${purpose ? `
          <div class="p-pillar-edit__purpose">
            <p class="p-pillar-edit__purpose-label">このイベントの目的</p>
            <p class="p-pillar-edit__purpose-text">${_esc(purpose)}</p>
          </div>` : ''}

        <p class="p-pillar-edit__lead">目的のために大事にすることを、${PILLARS_MAX}つまで決めます。
          タスクを柱に紐づけると、柱ごとの進み具合がメインボードに出ます。</p>

        <div class="p-pillar-edit__section-head">
          <h2 class="p-pillar-edit__section-title">柱</h2>
          <span class="p-pillar-edit__count">${d.items.length} / ${PILLARS_MAX}</span>
        </div>
        ${d.items.length ? `<ol class="p-pillar-edit__list">${d.items.map(row).join('')}</ol>`
          : '<p class="p-pillar-edit__empty">下の候補から選ぶか、自分で足してください</p>'}
        <button type="button" data-pillar-add ${full ? 'disabled' : ''} data-log="pillar_add_custom"
          class="p-pillar-edit__add">＋ 自分で足す</button>

        <h2 class="p-pillar-edit__section-title p-pillar-edit__section-title--spaced">候補から選ぶ</h2>
        <div class="p-pillar-edit__chips">
          ${suggestions.map(name => {
            const on = names.has(name);
            return `<button type="button" data-pillar-suggest="${_esc(name)}" aria-pressed="${on}"
              ${on || full ? 'disabled' : ''}
              class="p-pillar-edit__chip${on ? ' is-selected' : ''}">${_esc(name)}</button>`;
          }).join('')}
        </div>

        <button type="button" data-pillar-save class="c-button c-button--primary p-pillar-edit__save">保存する</button>
      </div>
    </div>`;

  _bind(appEl, p, d);
}

function _bind(appEl, p, d) {
  appEl.querySelector('[data-pillar-back]')?.addEventListener('click', () => state.closePillarEdit());

  appEl.querySelectorAll('[data-pillar-name]').forEach(el => {
    el.addEventListener('input', () => {
      const it = d.items.find(x => x.id === el.dataset.pillarName);
      if (it) it.name = el.value;
    });
  });

  appEl.querySelectorAll('[data-pillar-suggest]').forEach(el => {
    el.addEventListener('click', () => {
      if (d.items.length >= PILLARS_MAX) return;
      d.items.push({ id: newPillarId(), name: el.dataset.pillarSuggest, saved: false, suggested: true });
      state.render();
    });
  });

  appEl.querySelector('[data-pillar-add]')?.addEventListener('click', () => {
    if (d.items.length >= PILLARS_MAX) return;
    const id = newPillarId();
    d.items.push({ id, name: '', saved: false });
    state.render();
    // ★タップのハンドラから同期で当てる（iOS は操作の外の focus() を無視する）
    document.querySelector(`[data-pillar-name="${id}"]`)?.focus();
  });

  appEl.querySelectorAll('[data-pillar-delete]').forEach(el => {
    el.addEventListener('click', () => {
      const it = d.items.find(x => x.id === el.dataset.pillarDelete);
      if (!it) return;
      // まだ保存していない柱はそのまま消す（紐づいているタスクが無い）
      if (!it.saved) { d.items = d.items.filter(x => x !== it); state.render(); return; }
      d.confirmId = it.id;
      state.render();
    });
  });
  appEl.querySelector('[data-pillar-cancel]')?.addEventListener('click', () => { d.confirmId = null; state.render(); });
  appEl.querySelector('[data-pillar-remove]')?.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.pillarRemove;
    d.items = d.items.filter(x => x.id !== id);
    d.confirmId = null;
    state.render();
  });

  appEl.querySelector('[data-pillar-save]')?.addEventListener('click', () => _save(p, d));
}

function _save(p, d) {
  const items = d.items
    .map(x => ({ id: x.id, name: String(x.name || '').trim().slice(0, PILLAR_NAME_MAX), suggested: !!x.suggested }))
    .filter(x => x.name)
    .slice(0, PILLARS_MAX);
  const before = getPillars(p).length;
  p.pillars = items.map(({ id, name }) => ({ id, name }));
  state.save(p.id);
  logEvent('pillars_saved', {
    count: items.length, before,
    suggested: items.filter(x => x.suggested).length,
  });
  window._app?.showToast(items.length ? '柱を保存しました' : '柱をすべて外しました');
  state.closePillarEdit();
}
