// ===== 柱を立てる・直すページ（PILLAR_EDIT）=====
//
// 目的（def-1）を支える「柱」を最大3つ決める**ページ**（モーダルではない）。管理者だけが開ける。
//
// ★空欄から3つ書かせない。候補（constants.js の PILLAR_CANDIDATES。固定の10個）から選び、
//   名前は自由に直せる。候補に無ければ「＋ 自分で足す」。
// ★選んだ柱はキャラクター3体（mizu → mori → iwa の順）の体の中に名前で出る（pillarChars.js）。
//   足した柱のキャラは下からぽこっと出る（.is-new）。開いたときは3体が順に出る（.is-entering）。
//   キャラをタップすると、その下に名前の欄と「この柱を外す」が開く。
// ★柱の id は追加したときに1回だけ振る（utils.js の newPillarId）。名前を変えても保持する。
//   削除した柱の id は再利用しない（タスクの pillarIds が別の柱を指してしまう）。
// ★保存済みで、タスクが紐づいている柱を外すときは確認を挟む（その場で。モーダルにしない）。
//   紐づいていたタスクの pillarIds は書き換えない。存在しない id は pillarIdsOf が数えない。
// ★保存するまでイベントには書かない（下書き state.pillarDraft だけを触る）。「あとで」で捨てる。
// ★名前の入力中に描き直さないこと（フォーカスが飛ぶ）。描き直すのは足す・外す・選ぶときだけ。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { getPillars, pillarIdsOf, newPillarId, submissionText } from '../utils.js';
import { PILLARS_MAX, PILLAR_NAME_MAX, PILLAR_CANDIDATES } from '../constants.js';
import { pillarCharHtml, pillarSlotHtml } from '../pillarChars.js';
import { unassignedCount } from './pillarAssign.js';

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
      activeId: null,     // 名前を直している柱
      confirmId: null,    // 外す確認を出している柱
      newId: null,        // いま足した柱（ぽこっと出す）
      entering: true,     // 開いた直後（3体を順に出す）
    };
  }
  return state.pillarDraft;
}

/** その柱に紐づいているタスクの数（外す確認に出す） */
function _linkedCount(p, pillarId) {
  let n = 0;
  for (const m of p.missions || []) if (pillarIdsOf(p, m).includes(pillarId)) n++;
  return n;
}

export function renderPillarEdit(appEl) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.canManageCurrentEvent()) { state.closePillarEdit(); return; }
  const d = _draft(p);
  const full = d.items.length >= PILLARS_MAX;
  const purpose = submissionText(p.clearedData?.['def-1']);
  const names = new Set(d.items.map(x => x.name.trim()));
  const active = d.items.find(x => x.id === d.activeId) || null;
  const confirm = d.items.find(x => x.id === d.confirmId) || null;

  const slots = Array.from({ length: PILLARS_MAX }, (_, i) => {
    const it = d.items[i];
    if (!it) return pillarSlotHtml(i);
    return pillarCharHtml(i, it.name, {
      tag: 'button',
      attrs: `data-pillar-pick="${_esc(it.id)}" aria-label="${_esc(it.name || '名前なし')}の柱を直す"`,
      isNew: it.id === d.newId,
      active: it.id === d.activeId,
    });
  }).join('');

  const linked = confirm ? _linkedCount(p, confirm.id) : 0;
  const panel = confirm ? `
    <div class="p-pillar-edit__panel p-pillar-edit__panel--confirm">
      <p class="p-pillar-edit__confirm-text">「${_esc(confirm.name || '名前なし')}」を外しますか？${
        linked > 0 ? `<br>紐づいているタスク ${linked}件は、この柱から外れます。` : ''}</p>
      <div class="p-pillar-edit__confirm-actions">
        <button type="button" data-pillar-cancel class="p-pillar-edit__text-button">やめる</button>
        <button type="button" data-pillar-remove="${_esc(confirm.id)}" class="p-pillar-edit__danger-button">外す</button>
      </div>
    </div>`
    : active ? `
    <div class="p-pillar-edit__panel">
      <label class="p-pillar-edit__panel-label" for="pillar-name-input">柱の名前</label>
      <input type="text" id="pillar-name-input" data-pillar-name="${_esc(active.id)}" maxlength="${PILLAR_NAME_MAX}"
        value="${_esc(active.name)}" placeholder="例：誰も孤立させない" class="c-input c-input--block">
      <div class="p-pillar-edit__panel-actions">
        <button type="button" data-pillar-delete="${_esc(active.id)}" class="p-pillar-edit__text-button p-pillar-edit__text-button--danger">この柱を外す</button>
        <button type="button" data-pillar-done class="p-pillar-edit__text-button">閉じる</button>
      </div>
    </div>` : '';

  appEl.innerHTML = `
    <div class="p-pillar-edit">
      <header class="p-pillar-edit__header">
        <h1 class="p-pillar-edit__heading">このイベントの柱</h1>
        <!-- ★戻るではなく「あとで」（2026-10-02）。柱は決めずに抜けてよい（必須にしない）。下書きは捨てる -->
        <button type="button" data-pillar-back data-log="pillar_edit_later" class="p-pillar-edit__later">あとで</button>
      </header>

      <div class="p-pillar-edit__body">
        ${purpose ? `
          <div class="p-pillar-edit__purpose">
            <p class="p-pillar-edit__purpose-label">このイベントの目的</p>
            <p class="p-pillar-edit__purpose-text">${_esc(purpose)}</p>
          </div>` : ''}

        ${state.pillarAfterPurpose ? `<p class="p-pillar-edit__next">目的が決まりました。次に、柱を決めましょう。</p>` : ''}
        <p class="p-pillar-edit__catch">目的・目標を達成するために大事にすることを${PILLARS_MAX}つ決めよう！</p>
        <p class="p-pillar-edit__lead">タスクを柱に紐づけると、柱ごとの進み具合がメインボードに出ます。</p>

        <div class="p-pillar-chars p-pillar-edit__chars${d.entering ? ' is-entering' : ''}">${slots}</div>
        ${panel}

        <h2 class="p-pillar-edit__section-title p-pillar-edit__section-title--spaced">候補から選ぶ
          <span class="p-pillar-edit__count">${d.items.length} / ${PILLARS_MAX}</span></h2>
        <div class="p-pillar-edit__chips">
          ${PILLAR_CANDIDATES.map(name => {
            const on = names.has(name);
            return `<button type="button" data-pillar-suggest="${_esc(name)}" aria-pressed="${on}"
              ${!on && full ? 'disabled' : ''}
              class="p-pillar-edit__chip${on ? ' is-selected' : ''}">${_esc(name)}</button>`;
          }).join('')}
        </div>
        <button type="button" data-pillar-add ${full ? 'disabled' : ''} data-log="pillar_add_custom"
          class="p-pillar-edit__add">＋ 自分で足す</button>

        <button type="button" data-pillar-save class="c-button c-button--primary p-pillar-edit__save">保存する</button>
        ${getPillars(p).length ? `
          <button type="button" data-pillar-assign data-log="pillar_assign_open" class="p-pillar-edit__assign">
            タスクを柱に振り分ける${unassignedCount(p) ? `（未分類 ${unassignedCount(p)}件）` : ''}</button>` : ''}
      </div>
    </div>`;

  // ★出す演出は1回だけ。次の描き直しで同じキャラがまた跳ねないよう、描いたら消す
  d.entering = false;
  d.newId = null;
  _bind(appEl, p, d);
}

/** 柱を外す。保存済みでタスクが紐づいているときは確認を挟む */
function _remove(d, p, id) {
  const it = d.items.find(x => x.id === id);
  if (!it) return;
  if (it.saved && _linkedCount(p, id) > 0 && d.confirmId !== id) {
    d.confirmId = id; d.activeId = null;
    state.render();
    return;
  }
  d.items = d.items.filter(x => x.id !== id);
  d.confirmId = null;
  if (d.activeId === id) d.activeId = null;
  state.render();
}

function _bind(appEl, p, d) {
  appEl.querySelector('[data-pillar-back]')?.addEventListener('click', () => state.closePillarEdit());

  // 名前（入力中は描き直さない。キャラの中の名前だけ差し替える）
  const nameInput = appEl.querySelector('[data-pillar-name]');
  nameInput?.addEventListener('input', () => {
    const it = d.items.find(x => x.id === nameInput.dataset.pillarName);
    if (!it) return;
    it.name = nameInput.value;
    const label = appEl.querySelector(`[data-pillar-pick="${CSS.escape(it.id)}"] .p-pillar-char__name`);
    if (label) {
      label.querySelector('.p-pillar-char__name-text').textContent = it.name.trim() || '名前を入力';
      label.classList.toggle('is-placeholder', !it.name.trim());
    }
  });

  // キャラをタップ → その柱の名前を直す（もう一度で閉じる）
  appEl.querySelectorAll('[data-pillar-pick]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.pillarPick;
      d.activeId = d.activeId === id ? null : id;
      d.confirmId = null;
      state.render();
      // ★タップのハンドラから同期で当てる（iOS は操作の外の focus() を無視する）
      if (d.activeId) document.getElementById('pillar-name-input')?.focus();
    });
  });
  appEl.querySelector('[data-pillar-done]')?.addEventListener('click', () => { d.activeId = null; state.render(); });

  // 候補：選んでいなければ足す（次のキャラが下から出る）、選んでいれば外す
  appEl.querySelectorAll('[data-pillar-suggest]').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.pillarSuggest;
      const it = d.items.find(x => x.name.trim() === name);
      if (it) { _remove(d, p, it.id); return; }
      if (d.items.length >= PILLARS_MAX) return;
      const id = newPillarId();
      d.items.push({ id, name, saved: false, suggested: true });
      d.newId = id; d.activeId = null; d.confirmId = null;
      state.render();
    });
  });

  appEl.querySelector('[data-pillar-add]')?.addEventListener('click', () => {
    if (d.items.length >= PILLARS_MAX) return;
    const id = newPillarId();
    d.items.push({ id, name: '', saved: false });
    d.newId = id; d.activeId = id; d.confirmId = null;
    state.render();
    document.getElementById('pillar-name-input')?.focus();
  });

  appEl.querySelector('[data-pillar-delete]')?.addEventListener('click', (e) => _remove(d, p, e.currentTarget.dataset.pillarDelete));
  appEl.querySelector('[data-pillar-cancel]')?.addEventListener('click', () => { d.confirmId = null; state.render(); });
  appEl.querySelector('[data-pillar-remove]')?.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.pillarRemove;
    d.items = d.items.filter(x => x.id !== id);
    d.confirmId = null;
    state.render();
  });

  appEl.querySelector('[data-pillar-save]')?.addEventListener('click', () => _save(p, d));
  // ★保存済みの柱で振り分ける（編集中の下書きは捨てる。保存してから振り分けたいときは「保存する」を先に）
  appEl.querySelector('[data-pillar-assign]')?.addEventListener('click', () => state.openPillarAssign());
}

async function _save(p, d) {
  const items = d.items
    .map(x => ({ id: x.id, name: String(x.name || '').trim().slice(0, PILLAR_NAME_MAX), suggested: !!x.suggested }))
    .filter(x => x.name)
    .slice(0, PILLARS_MAX);
  const before = getPillars(p).length;
  p.pillars = items.map(({ id, name }) => ({ id, name }));
  // ★すぐに保存する（デバウンスの save() にしない）。待っている間に取り直し（silentReloadEvents）や
  //   SSE が手元のイベントを差し替えると、保存する前の柱が消える
  await state.saveNow(p.id);
  logEvent('pillars_saved', {
    count: items.length, before,
    suggested: items.filter(x => x.suggested).length,
  });
  window._app?.showToast(items.length ? '柱を保存しました' : '柱をすべて外しました');
  // ★未分類のタスクがあれば、続けて振り分けのページへ（スキップできる）。
  //   途中から柱を立てると既存のタスクは全部未分類で、進み具合が「どれも0件」になって読めないため
  if (items.length && unassignedCount(p) > 0) { state.openPillarAssign(); return; }
  state.closePillarEdit();
}
