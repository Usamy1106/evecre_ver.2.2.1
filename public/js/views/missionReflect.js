// ===== 完了後の振り返りページ（MISSION_REFLECT）=====
//
// 完了を確定させたあとに開く**ページ**（モーダルではない）。完了ボタンまでの道のりを軽くし、
// 達成感がいちばん高い瞬間に「どうだった？」を聞く。**完全な任意**で、書かずに戻ってよい。
//
// ★完了は先に確定している。このページで何が起きても完了を巻き戻さないこと。
// ★保存は `PATCH .../reflection`（api.updateReflection）だけを使う。
//   completeMission を再送すると山のオブジェクトが引き直され、完了通知と Web Push も再送される。
// ★成否チップを押した時点で outcome だけを保存する（1タップで最低限のデータが残る）。
//   サーバーは送られた項目だけを書くので、本文を空で潰さない。
// ★成否で演出の「量」に差をつけないこと。うまくいった＝上に弾ける（速い・明るい）、
//   つまずいた＝ゆっくり立ちのぼる（遅い・淡い）で、違うのは質だけにする。
//   正直な報告が損をすると、実態と違う側が押され、集めたい失敗事例が集まらない。
// ★絵（🎉 / 🤔）は constants.js の OUTCOME_CHOICES.art にしか書かない（イラスト差し替え前提）。
// ★入力欄を開いたときに textarea へ自動フォーカスしないこと（モバイルでキーボードが飛び出す）。

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { placeholderFor } from '../utils.js';
import {
  OUTCOME_CHOICES, OUTCOME_REPLIES, REFLECT_LABELS,
  REFLECT_STRUGGLE_PLACEHOLDERS, REFLECT_SOLUTION_PLACEHOLDERS,
  REFLECT_EFFECT_PLACEHOLDERS, REFLECT_WHY_PLACEHOLDERS,
} from '../constants.js';

const MAX = 200;
// 粒の数。★0.5CPU 環境が基準なので増やさないこと（16個以内）
const SPARKS = { success: 10, struggle: 6 };

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** 成否ごとの入力欄の見出しとプレースホルダー（保存先は struggle / solution のまま）*/
function _fieldsFor(outcome, m) {
  const labels = REFLECT_LABELS[outcome] || REFLECT_LABELS.struggle;
  const tables = outcome === 'success'
    ? { struggle: REFLECT_EFFECT_PLACEHOLDERS, solution: REFLECT_WHY_PLACEHOLDERS }
    : { struggle: REFLECT_STRUGGLE_PLACEHOLDERS, solution: REFLECT_SOLUTION_PLACEHOLDERS };
  return {
    struggle: { label: labels.struggle, placeholder: placeholderFor(tables.struggle, m) },
    solution: { label: labels.solution, placeholder: placeholderFor(tables.solution, m) },
  };
}

export function renderMissionReflect(appEl) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const m = p?.missions?.find(x => x.id === state.reflectMissionId);
  // タスクが消えた（削除・差し戻し）ときはボードへ戻す
  if (!p || !m) { state.closeMissionReflect(); return; }

  const d = state.reflectDraft || (state.reflectDraft = { outcome: null, struggle: '', solution: '', shareable: false });
  const f = _fieldsFor(d.outcome || 'struggle', m);

  const chip = (c) => `
    <button type="button" data-reflect-outcome="${c.id}"
      class="p-mission-reflect__chip${d.outcome === c.id ? ' is-selected' : ''}${d.outcome && d.outcome !== c.id ? ' is-dimmed' : ''}"
      aria-pressed="${d.outcome === c.id}">
      <span class="p-mission-reflect__chip-art">${c.art}</span>
      <span class="p-mission-reflect__chip-label">${_esc(c.label)}</span>
      <span class="p-mission-reflect__sparks" aria-hidden="true">${
        Array.from({ length: SPARKS[c.id] || 6 }, () => '<span class="p-mission-reflect__spark"></span>').join('')
      }</span>
    </button>`;

  appEl.innerHTML = `
    <div id="mission-reflect-page" class="p-mission-reflect">
      <header class="p-mission-reflect__header">
        <button type="button" onclick="window._app.closeMissionReflect()" data-log="reflect_back"
          class="p-mission-reflect__round-button" aria-label="戻る">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
      </header>

      <div class="p-mission-reflect__body">
        <p class="p-mission-reflect__done">完了！</p>
        <h1 class="p-mission-reflect__title">${_esc(m.title)}</h1>

        <p class="p-mission-reflect__question">このタスク、どうだった？</p>
        <div class="p-mission-reflect__chips">
          ${chip(OUTCOME_CHOICES.success)}
          ${chip(OUTCOME_CHOICES.struggle)}
        </div>
        <p id="reflect-reply" class="p-mission-reflect__reply" role="status">${
          d.outcome ? _esc(OUTCOME_REPLIES[d.outcome] || '') : ''
        }</p>

        <div id="reflect-fields" class="p-mission-reflect__fields${d.outcome ? ' is-open' : ''}">
          <label class="p-mission-reflect__label" for="reflect-struggle" id="reflect-label-struggle">${_esc(f.struggle.label)}</label>
          <textarea id="reflect-struggle" maxlength="${MAX}" rows="3"
            class="c-input c-input--block p-mission-reflect__input"
            placeholder="${_esc(f.struggle.placeholder)}">${_esc(d.struggle)}</textarea>

          <label class="p-mission-reflect__label" for="reflect-solution" id="reflect-label-solution">${_esc(f.solution.label)}</label>
          <textarea id="reflect-solution" maxlength="${MAX}" rows="3"
            class="c-input c-input--block p-mission-reflect__input"
            placeholder="${_esc(f.solution.placeholder)}">${_esc(d.solution)}</textarea>

          <label class="p-mission-reflect__share">
            <input type="checkbox" id="reflect-shareable" ${d.shareable ? 'checked' : ''}>
            <span>他の団体にも役立ちそう</span>
          </label>

          <button type="button" onclick="window._app.saveMissionReflect()" id="reflect-save"
            class="c-button c-button--primary p-mission-reflect__save">保存して戻る</button>
        </div>

        <p class="p-mission-reflect__note">あとからアーカイブで書き足せます</p>
      </div>
    </div>`;

  // チップ：押した瞬間に見た目を返し、outcome だけを先に保存する。
  // ★ページ全体を描き直さないこと（書きかけの本文が消える）。触るのは押した要素まわりだけ。
  appEl.querySelectorAll('[data-reflect-outcome]').forEach(btn => {
    btn.addEventListener('click', () => _pickOutcome(p, m, btn.dataset.reflectOutcome));
  });
  // 入力は下書きへ即時反映（保存はボタンを押したときだけ）
  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { state.reflectDraft[key] = el.value; });
  };
  bind('reflect-struggle', 'struggle');
  bind('reflect-solution', 'solution');
  document.getElementById('reflect-shareable')?.addEventListener('change', (e) => {
    state.reflectDraft.shareable = e.target.checked;
  });
}

/** 成否チップを押したとき。見た目 → 演出 → 保存の順で、通信を待たせない */
function _pickOutcome(p, m, outcome) {
  if (!OUTCOME_CHOICES[outcome]) return;
  const d = state.reflectDraft;
  const first = !d.outcome;
  d.outcome = outcome;

  // 見た目（選んだ方に色、もう片方は薄く。押し間違いを直せるよう消さない）
  document.querySelectorAll('[data-reflect-outcome]').forEach(el => {
    const on = el.dataset.reflectOutcome === outcome;
    el.classList.toggle('is-selected', on);
    el.classList.toggle('is-dimmed', !on);
    el.setAttribute('aria-pressed', String(on));
    if (on) {
      // 押し込み＋粒。★アニメーションを付け直すために一度外す
      el.classList.remove('is-pressed');
      void el.offsetWidth;
      el.classList.add('is-pressed');
    }
  });

  // 受け止めの一言（演出より効く）
  const reply = document.getElementById('reflect-reply');
  if (reply) {
    reply.textContent = OUTCOME_REPLIES[outcome] || '';
    reply.classList.remove('is-shown');
    void reply.offsetWidth;
    reply.classList.add('is-shown');
  }

  // 入力欄の見出し・プレースホルダーを差し替えて開く（max-height + opacity。height:auto は効かない）
  const f = _fieldsFor(outcome, m);
  const setField = (key) => {
    const label = document.getElementById(`reflect-label-${key}`);
    const input = document.getElementById(`reflect-${key}`);
    if (label) label.textContent = f[key].label;
    if (input) input.placeholder = f[key].placeholder;
  };
  setField('struggle');
  setField('solution');
  // ★自動フォーカスしない（モバイルでキーボードが出て画面が飛ぶ）
  document.getElementById('reflect-fields')?.classList.add('is-open');

  logEvent('reflect_outcome_picked', { missionId: m.id, outcome, first });

  // ★1タップで残す。失敗しても完了は確定済みなので、画面は進めたまま知らせるだけ。
  api.updateReflection(p.id, m.id, { outcome }).then(r => {
    if (!r?.ok) window._app?.showToast(r?.error || '保存に失敗しました', 'error');
    else _applyLocal(p, m.id, r.reflection);
  }).catch(() => window._app?.showToast('保存に失敗しました', 'error'));
}

/** サーバーが返した正規化済みの値を手元の clearedData に反映する */
function _applyLocal(p, missionId, reflection) {
  if (!reflection) return;
  const cd = p.clearedData?.[missionId];
  if (cd) Object.assign(cd, reflection);
}

/** 「保存して戻る」。本文が空でも押せる（そのまま戻る）*/
export async function saveMissionReflect() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const missionId = state.reflectMissionId;
  const d = state.reflectDraft || {};
  if (!p || !missionId) { state.closeMissionReflect(); return; }

  const struggle = (d.struggle || '').trim();
  const solution = (d.solution || '').trim();
  if (!struggle && !solution) { state.closeMissionReflect(); return; }

  const btn = document.getElementById('reflect-save');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

  const r = await api.updateReflection(p.id, missionId, {
    struggle, solution, shareable: !!d.shareable,
    ...(d.outcome ? { outcome: d.outcome } : {}),
  });
  if (!r?.ok) {
    if (btn) { btn.disabled = false; btn.textContent = '保存して戻る'; }
    window._app?.showToast(r?.error || '保存に失敗しました', 'error');
    return;
  }
  _applyLocal(p, missionId, r.reflection);
  // ★本文は送らない（行動ログに自由記述を混ぜない）。書かれたかどうかだけ数える
  logEvent('reflect_saved', {
    missionId, outcome: d.outcome || null,
    hasStruggle: !!struggle, hasSolution: !!solution, shareable: !!d.shareable,
  });
  state.closeMissionReflect();
  window._app?.showToast('振り返りを保存しました');
}
