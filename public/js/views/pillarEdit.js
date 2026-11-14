// ===== 柱を立てる・直すページ（PILLAR_EDIT）=====
//
// 目的（def-1）を支える「柱」を最大3つ決める**ページ**（モーダルではない）。管理者だけが開ける。
//
// ★空欄から3つ書かせない。候補（constants.js の PILLAR_CATEGORIES。区分ごとの見出しの下に4つずつ）から選び、
//   名前は自由に直せる。候補に無ければ「＋ 自分で足す」。
// ★選んだ柱はキャラクターの体の中に名前で出る（pillarChars.js）。キャラは柱の区分で決まる（2026-11-14）：
//   運営・進行＝mizu／制作＝mori／企画＝iwa。同じ区分を複数選んでもよい（同じキャラが並ぶ）。
// ★自由記述の柱は、名前を書いたあとに区分を必ず選ぶ（選ぶまで灰色のキャラ。区分の無いまま保存させない）。
//   ★それ以前に保存された区分の無い柱（saved）は止めない（名前が候補と同じなら区分を推定、それ以外は順番のキャラ）。
//   足した柱のキャラは下からぽこっと出る（.is-new）。開いたときは3体が順に出る（.is-entering）。
//   キャラをタップすると、その下に名前の欄と「この柱を外す」が開く。
// ★柱の id は追加したときに1回だけ振る（utils.js の newPillarId）。名前を変えても保持する。
//   削除した柱の id は再利用しない（タスクの pillarIds が別の柱を指してしまう）。
// ★保存済みで、タスクが紐づいている柱を外すときは確認を挟む（その場で。モーダルにしない）。
//   紐づいていたタスクの pillarIds は書き換えない。存在しない id は pillarIdsOf が数えない。
// ★保存するまでイベントには書かない（下書き state.pillarDraft だけを触る）。「閉じる」で捨てる。
// ★名前の入力中に描き直さないこと（フォーカスが飛ぶ）。描き直すのは足す・外す・選ぶときだけ。
// ★前の代があるイベントでは、目的の下に前の代の柱を出す（2026-11-14。読むだけ。以前は柱を立てたあとにモーダルで比べていた）。
//   取れないとき（非公開でメンバーでもない・前の代が柱を立てていない）は出さない

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { getPillars, pillarIdsOf, newPillarId, submissionText, pillarCategoryOf } from '../utils.js';
import { PILLARS_MAX, PILLAR_NAME_MAX, PILLAR_CATEGORIES } from '../constants.js';
import { pillarCharHtml, pillarSlotHtml } from '../pillarChars.js';
import { unassignedCount } from './pillarAssign.js';
import { markPillarNextPending } from '../modals/pillarNextModal.js';
import { api } from '../api.js';

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
      // ★cat は保存された区分か、名前が候補と同じならその区分（それ以外の古い柱は null＝順番のキャラ）
      items: getPillars(p).map(x => ({ id: x.id, name: x.name, cat: pillarCategoryOf(x), saved: true })),
      activeId: null,     // 名前を直している柱
      confirmId: null,    // 外す確認を出している柱
      newId: null,        // いま足した柱（ぽこっと出す）
      entering: true,     // 開いた直後（3体を順に出す）
    };
  }
  return state.pillarDraft;
}

// 前の代の柱（sourceId → { loading, pillars, title }。画面を開いている間だけ覚える）
const _prev = new Map();
let _prevLogged = null;

/** 前の代の柱を取る（1回だけ）。取れたら描き直す（名前の入力中は描き直さず、次の描き直しで出す） */
function _prevPillars(sourceId) {
  const c = _prev.get(sourceId);
  if (c) return c;
  const entry = { loading: true, pillars: null, title: '' };
  _prev.set(sourceId, entry);
  const member = state.events.some(e => e.id === sourceId);
  (member ? api.handoverSource(sourceId) : api.exploreEvent(sourceId)).then(r => {
    entry.loading = false;
    entry.pillars = r?.ok && Array.isArray(r.pillars) && r.pillars.length ? r.pillars.filter(Boolean) : null;
    entry.title = String(r?.basic?.title || '');
    if (state.currentView === 'PILLAR_EDIT' && document.activeElement?.id !== 'pillar-name-input') state.render();
  }).catch(() => { entry.loading = false; });
  return entry;
}

function _prevHtml(p) {
  if (!p.parentEventId) return '';
  const c = _prevPillars(p.parentEventId);
  if (!c.pillars) return '';
  if (_prevLogged !== p.id) {
    _prevLogged = p.id;
    logEvent('pillar_prev_shown', { eventId: p.id, prev: c.pillars.length });
  }
  return `
    <div class="p-pillar-edit__prev">
      <p class="p-pillar-edit__prev-label">前の代${c.title ? `「${_esc(c.title)}」` : ''}の柱</p>
      <ul class="p-pillar-edit__prev-list">${c.pillars.map(n => `<li>${_esc(n)}</li>`).join('')}</ul>
      <p class="p-pillar-edit__prev-note">参考です。今回の柱は、今回の目的から決めます。</p>
    </div>`;
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
      cat: it.cat,
      uncategorized: _needsCat(it),
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
      <p class="p-pillar-edit__panel-label p-pillar-edit__panel-label--spaced" id="pillar-cat-label">区分</p>
      <div class="p-pillar-edit__cats" role="group" aria-labelledby="pillar-cat-label">
        ${PILLAR_CATEGORIES.map(c => `
          <button type="button" data-pillar-cat="${_esc(c.id)}" aria-pressed="${active.cat === c.id}"
            class="p-pillar-edit__cat${active.cat === c.id ? ' is-selected' : ''}">
            <img class="p-pillar-edit__cat-char" src="/images/character/character-${_esc(c.char)}.svg" alt="" aria-hidden="true">${_esc(c.label)}</button>`).join('')}
      </div>
      ${_needsCat(active) ? '<p class="p-pillar-edit__cat-note">区分を選ぶと、その区分のキャラになります。</p>' : ''}
      <div class="p-pillar-edit__panel-actions">
        <button type="button" data-pillar-delete="${_esc(active.id)}" class="p-pillar-edit__text-button p-pillar-edit__text-button--danger">この柱を外す</button>
        <button type="button" data-pillar-done class="p-pillar-edit__text-button">閉じる</button>
      </div>
    </div>` : '';

  appEl.innerHTML = `
    <div class="p-pillar-edit">
      <header class="p-pillar-edit__header">
        <h1 class="p-pillar-edit__heading">このイベントの柱</h1>
        <!-- ★戻るではなく「閉じる」（2026-10-13）。柱は決めずに抜けてよい（必須にしない）。下書きは捨てる -->
        <button type="button" data-pillar-back data-log="pillar_edit_later" class="p-pillar-edit__later">閉じる</button>
      </header>

      <div class="p-pillar-edit__body">
        ${purpose ? `
          <div class="p-pillar-edit__purpose">
            <p class="p-pillar-edit__purpose-label">このイベントの目的</p>
            <p class="p-pillar-edit__purpose-text">${_esc(purpose)}</p>
          </div>` : ''}
        ${_prevHtml(p)}

        ${state.pillarAfterPurpose ? `<p class="p-pillar-edit__next">目的が決まりました。次に、柱を決めましょう。</p>` : ''}
        <p class="p-pillar-edit__catch">目的・目標を達成するために大事にすることを${PILLARS_MAX}つ決めよう！</p>
        <p class="p-pillar-edit__lead">タスクを柱に紐づけると、柱ごとの進み具合がメインボードに出ます。</p>

        <div class="p-pillar-chars p-pillar-edit__chars${d.entering ? ' is-entering' : ''}">${slots}</div>
        ${panel}

        <h2 class="p-pillar-edit__section-title p-pillar-edit__section-title--spaced">候補から選ぶ
          <span class="p-pillar-edit__count">${d.items.length} / ${PILLARS_MAX}</span></h2>
        ${PILLAR_CATEGORIES.map(c => `
          <section class="p-pillar-edit__group" aria-labelledby="pillar-group-${_esc(c.id)}">
            <h3 class="p-pillar-edit__group-title" id="pillar-group-${_esc(c.id)}">
              <img class="p-pillar-edit__group-char" src="/images/character/character-${_esc(c.char)}.svg" alt="" aria-hidden="true">${_esc(c.label)}</h3>
            <div class="p-pillar-edit__chips">
              ${c.items.map(name => {
                const on = names.has(name);
                return `<button type="button" data-pillar-suggest="${_esc(name)}" data-pillar-suggest-cat="${_esc(c.id)}" aria-pressed="${on}"
                  ${!on && full ? 'disabled' : ''}
                  class="p-pillar-edit__chip${on ? ' is-selected' : ''}">${_esc(name)}</button>`;
              }).join('')}
            </div>
          </section>`).join('')}
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

/** 区分をまだ選んでいない自由記述の柱（★保存済みの古い柱は対象外。止めない） */
function _needsCat(it) {
  return !!it && !it.saved && !it.cat;
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

  // 区分を選ぶ（キャラが変わる）
  appEl.querySelectorAll('[data-pillar-cat]').forEach(el => {
    el.addEventListener('click', () => {
      const it = d.items.find(x => x.id === d.activeId);
      if (!it) return;
      it.cat = el.dataset.pillarCat;
      state.render();
    });
  });

  // 候補：選んでいなければ足す（次のキャラが下から出る）、選んでいれば外す
  appEl.querySelectorAll('[data-pillar-suggest]').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.pillarSuggest;
      const it = d.items.find(x => x.name.trim() === name);
      if (it) { _remove(d, p, it.id); return; }
      if (d.items.length >= PILLARS_MAX) return;
      const id = newPillarId();
      // ★候補の区分をそのまま持たせる（キャラが決まる）
      d.items.push({ id, name, cat: el.dataset.pillarSuggestCat || null, saved: false, suggested: true });
      d.newId = id; d.activeId = null; d.confirmId = null;
      state.render();
    });
  });

  appEl.querySelector('[data-pillar-add]')?.addEventListener('click', () => {
    if (d.items.length >= PILLARS_MAX) return;
    const id = newPillarId();
    d.items.push({ id, name: '', cat: null, saved: false });   // ★区分は名前のあとで選ぶ（選ぶまで灰色）
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
  // ★区分を選んでいない自由記述の柱があれば保存しない（その柱の欄を開いて知らせる）
  const missing = d.items.find(x => String(x.name || '').trim() && _needsCat(x));
  if (missing) {
    d.activeId = missing.id; d.confirmId = null;
    state.render();
    window._app?.showToast(`「${String(missing.name).trim()}」の区分を選んでください`);
    return;
  }
  const items = d.items
    .map(x => ({ id: x.id, name: String(x.name || '').trim().slice(0, PILLAR_NAME_MAX), cat: x.cat || null, suggested: !!x.suggested }))
    .filter(x => x.name)
    .slice(0, PILLARS_MAX);
  const before = getPillars(p).length;
  // ★cat は区分があるときだけ書く（区分の無い古い柱は名前・順番からキャラを決める）
  p.pillars = items.map(({ id, name, cat }) => (cat ? { id, name, cat } : { id, name }));
  // ★すぐに保存する（デバウンスの save() にしない）。待っている間に取り直し（silentReloadEvents）や
  //   SSE が手元のイベントを差し替えると、保存する前の柱が消える
  await state.saveNow(p.id);
  logEvent('pillars_saved', {
    count: items.length, before,
    suggested: items.filter(x => x.suggested).length,
    cats: items.map(x => x.cat || '').join(','),
  });
  window._app?.showToast(items.length ? '柱を保存しました' : '柱をすべて外しました');
  // ★柱を初めて立てたら、メインボードに戻ったときに「やることを作ってみよう」を1回出す（modals/pillarNextModal.js）
  if (before === 0 && items.length > 0) markPillarNextPending(p.id);
  // ★未分類のタスクがあれば、続けて振り分けのページへ（スキップできる）。
  //   途中から柱を立てると既存のタスクは全部未分類で、進み具合が「どれも0件」になって読めないため
  if (items.length && unassignedCount(p) > 0) { state.openPillarAssign(); return; }
  state.closePillarEdit();
}
