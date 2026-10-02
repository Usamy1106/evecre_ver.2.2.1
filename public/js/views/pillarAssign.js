// ===== タスクを柱に振り分けるページ（PILLAR_ASSIGN）=====
//
// 途中から柱を立てると、既存のタスクは全部「未分類」になる。そのままだと柱ごとの進み具合が
// 「どれも0件」になり、何も読めない。柱を保存した直後にここへ来て、まとめて振り分ける。
//
// ★スキップできる（必須にしない）。「あとで」で何も書かずに戻る。タスクの編集でも後から変えられる。
// ★1件ずつモーダルを開かせない。1画面に全部並べて、チップで選ぶ。
// ★複数選べる（pillarIds。2026-10-02）。何も選ばなければ未分類。
// ★選ぶたびに描き直さない（スクロール位置が飛ぶ）。押したチップの見た目だけ替える。
// ★保存は「保存する」を押したときだけ。選び直したタスクの pillarIds だけを書く。
// ★目的・企画の整理の初期タスク（REFLECT_SKIP_MISSION_IDS）は並べない（柱を立てる土台そのもの）。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { getPillars, pillarIdsOf } from '../utils.js';
import { REFLECT_SKIP_MISSION_IDS } from '../constants.js';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** 振り分けの対象（初期タスクを除く）。未分類を先に、その中は元の並び */
export function assignableMissions(p) {
  const list = (p?.missions || []).filter(m => !REFLECT_SKIP_MISSION_IDS.includes(m.id));
  const un = [], done = [];
  for (const m of list) (pillarIdsOf(p, m).length ? done : un).push(m);
  return [...un, ...done];
}

/** 未分類のタスクの数（柱を保存したあと、このページへ来るかの判定） */
export function unassignedCount(p) {
  let n = 0;
  for (const m of p?.missions || []) {
    if (!REFLECT_SKIP_MISSION_IDS.includes(m.id) && pillarIdsOf(p, m).length === 0) n++;
  }
  return n;
}

export function renderPillarAssign(appEl) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const pillars = getPillars(p);
  if (!p || !pillars.length || !state.canManageCurrentEvent()) { state.closePillarAssign(); return; }
  if (!state.pillarAssignDraft || state.pillarAssignDraft.eventId !== p.id) {
    state.pillarAssignDraft = { eventId: p.id, picks: new Map() };
  }
  const picks = state.pillarAssignDraft.picks;
  const missions = assignableMissions(p);
  // picks: タスク id → 選んだ柱の id の Set（触ったタスクだけ持つ）
  const current = (m) => picks.has(m.id) ? picks.get(m.id) : new Set(pillarIdsOf(p, m));

  const chip = (m, id, label) => {
    const on = current(m).has(id);
    return `<button type="button" data-assign-mission="${_esc(m.id)}" data-assign-pillar="${_esc(id)}"
      aria-pressed="${on}" class="p-pillar-assign__chip${on ? ' is-selected' : ''}">${_esc(label)}</button>`;
  };

  appEl.innerHTML = `
    <div class="p-pillar-assign">
      <header class="p-pillar-assign__header">
        <h1 class="p-pillar-assign__heading">タスクを柱に振り分ける</h1>
        <button type="button" data-assign-later data-log="pillar_assign_later" class="p-pillar-assign__later">あとで</button>
      </header>

      <div class="p-pillar-assign__body">
        <p class="p-pillar-assign__lead">どの柱のためのタスクかを選びます（複数選べます）。どれにも当てはまらなければ、選ばないままで構いません。
          あとからタスクの編集でも変えられます。</p>
        ${missions.length ? `
          <ul class="p-pillar-assign__list">
            ${missions.map(m => `
              <li class="p-pillar-assign__item">
                <p class="p-pillar-assign__title">${_esc(m.title)}${m.status === 'cleared' ? '<span class="p-pillar-assign__done">完了</span>' : ''}</p>
                <div class="p-pillar-assign__chips">
                  ${pillars.map(x => chip(m, x.id, x.name)).join('')}
                </div>
              </li>`).join('')}
          </ul>` : '<p class="p-pillar-assign__empty">振り分けるタスクはありません</p>'}
      </div>

      <div class="p-pillar-assign__footer">
        <button type="button" data-assign-save class="c-button c-button--primary p-pillar-assign__save">保存する</button>
      </div>
    </div>`;

  appEl.querySelectorAll('[data-assign-mission]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = missions.find(x => x.id === btn.dataset.assignMission);
      if (!m) return;
      const set = new Set(current(m));
      const pid = btn.dataset.assignPillar;
      if (set.has(pid)) set.delete(pid); else set.add(pid);
      picks.set(m.id, set);
      // ★押したチップだけ替える（描き直さない）
      const on = set.has(pid);
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  });
  appEl.querySelector('[data-assign-later]')?.addEventListener('click', () => {
    logEvent('pillars_assign_skipped', { unassigned: unassignedCount(p) });
    state.closePillarAssign();
  });
  appEl.querySelector('[data-assign-save]')?.addEventListener('click', () => _save(p, picks));
}

function _save(p, picks) {
  let changed = 0;
  const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  for (const m of p.missions || []) {
    if (!picks.has(m.id)) continue;
    const next = [...picks.get(m.id)];
    if (same(next, pillarIdsOf(p, m))) continue;   // 選び直していない
    m.pillarIds = next;
    changed++;
  }
  // ★すぐに保存する（デバウンスの save() だと、待つ間の取り直しで手元の変更が消えることがある）
  if (changed) state.saveNow(p.id);
  logEvent('pillars_assigned', { changed, unassigned: unassignedCount(p) });
  window._app?.showToast(changed ? `${changed}件のタスクを振り分けました` : '変更はありません');
  state.closePillarAssign();
}
