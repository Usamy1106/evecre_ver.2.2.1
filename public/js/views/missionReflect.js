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
// ★絵（illustration-good / -bad）は constants.js の OUTCOME_CHOICES.art にしか書かない。
// ★入力欄を開いたときに textarea へ自動フォーカスしないこと（モバイルでキーボードが飛び出す）。
// ★「あとで」を置く（2026-09-21。文言は 2026-10-13 に「今はしない」から変更）。以前は「選択肢として見せると押される」として
//   専用のスキップを置かず、戻る矢印と注記だけで抜けてもらっていた。だが戻る矢印は
//   「スキップしてよい」とは読めず、答えなければいけない画面に見える。
//   出口が分かる状態のほうが、次に完了するときの心理的な負担が軽い。
//   ★押されても完了は確定済みで、何も失われない（あとからアーカイブで書ける）。
// ★書き方の案内（2026-11-07。指示書B §7）：入力欄のすぐ上にキャラクターの吹き出し（REFLECT_BUBBLES）と
//   3語のラベル（REFLECT_STEPS）。どちらも入力中も残す（プレースホルダーは書き始めると消えるため）。
//   キャラはタスクのラベルで決める（PROPOSAL_CHARACTERS の domains）。イベント作りに慣れた人（濃度 many）には絵を出さない。
//   例文はプレースホルダーのまま残し、欄の下の「例を見る」でも見返せる。
// ★欄は1行から始め、書いた分だけ伸ばす。残りの字数は 160 字を超えてから出す（0/200 を常に出さない）

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { placeholderFor, reflectShowsStruggle, isKnowledgePublished, taskSubmissions } from '../utils.js';
import { setArchiveLanding } from './mainBoard.js';
import { characterFigureHtml } from '../character.js';
import { densityForEvent, DENSITY } from '../onboarding.js';
import { Components } from '../components.js';
import { confirmFirstShare, applyShareConfirmed } from '../modals/shareConfirmModal.js';
import { reflectEditorHtml, bindReflectEditor, readReflectEditor, editorEl, loadEditorContent } from '../clearEditor.js';
import { afterMissionCleared } from '../modals/helpers.js';
import {
  OUTCOME_CHOICES, OUTCOME_REPLIES, REFLECT_LABELS, REFLECT_BUBBLES, REFLECT_STEPS, PROPOSAL_CHARACTERS,
  REFLECT_STRUGGLE_PLACEHOLDERS, REFLECT_SOLUTION_PLACEHOLDERS,
  REFLECT_EFFECT_PLACEHOLDERS, REFLECT_WHY_PLACEHOLDERS,
} from '../constants.js';

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

/** 吹き出しを話すキャラ。タスクのラベルで決める（PROPOSAL_CHARACTERS の domains。4つのラベルは3体のどれかに入る） */
function _guideCharacter(m) {
  const tags = [...(Array.isArray(m.tags) ? m.tags : []), m.tag].filter(Boolean);
  return PROPOSAL_CHARACTERS.find(ch => tags.some(t => ch.domains.includes(t))) || PROPOSAL_CHARACTERS[0];
}

/** 3語のラベル（矢印でつなぐ）。無ければ '' */
function _stepsHtml(outcome, key) {
  const steps = REFLECT_STEPS[outcome]?.[key];
  return steps ? steps.map(x => `<span class="p-mission-reflect__step">${_esc(x)}</span>`).join('<span class="p-mission-reflect__step-arrow" aria-hidden="true">→</span>') : '';
}

export function renderMissionReflect(appEl) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const m = p?.missions?.find(x => x.id === state.reflectMissionId);
  // タスクが消えた（削除・差し戻し）ときはボードへ戻す
  if (!p || !m) { state.pendingClear = null; state.closeMissionReflect(); return; }
  // ★まだ完了を確定していない（振り返りのページの最後で確定する。modals/helpers.js の submitMissionClear）
  const pending = _pending(m.id);

  const d = state.reflectDraft || (state.reflectDraft = { outcome: null, struggle: '', solution: '', shareable: false });
  const f = _fieldsFor(d.outcome || 'struggle', m);
  const ch = _guideCharacter(m);
  // ★イベント作りに慣れた人（濃度 many）には絵を出さない（吹き出しの文だけ）
  const showFigure = densityForEvent(state.currentUser?.id, state.events, p) !== DENSITY.MANY;
  const field = (key) => `
            <div class="p-mission-reflect__steps" id="reflect-steps-${key}">${_stepsHtml(d.outcome, key)}</div>
            <!-- ★太字・非公開などの書式が使える欄（画像・PDF は入れない。200 字。clearEditor.js の reflectEditorHtml） -->
            ${reflectEditorHtml({ id: `reflect-${key}`, placeholder: f[key].placeholder, label: f[key].label })}
            <details class="p-mission-reflect__example">
              <summary>例を見る</summary>
              <p id="reflect-example-${key}">${_esc(f[key].placeholder)}</p>
            </details>`;

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
          class="p-mission-reflect__round-button" aria-label="${pending ? '完了の入力に戻る' : '戻る'}">
          <img src="/images/icon/icon-chevron.svg" width="18" height="18" alt="">
        </button>
      </header>

      <div class="p-mission-reflect__body">
        <p class="p-mission-reflect__done">${pending ? 'あと少しで完了！' : '完了！'}</p>
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
          <!-- 書き方の案内（入力中も残す）。キャラ＝タスクのラベル、セリフ＝成否 -->
          <div class="p-mission-reflect__guide p-char p-char--${ch.id} p-char--ready${showFigure ? '' : ' is-text-only'}">
            ${showFigure ? `<div class="p-mission-reflect__guide-figure">${characterFigureHtml(ch)}</div>` : ''}
            <p id="reflect-bubble" class="p-mission-reflect__guide-bubble">${_esc(REFLECT_BUBBLES[d.outcome] || '')}</p>
          </div>

          <!-- ★うまくいった側は欄を1つ（solution）だけ出す（reflectShowsStruggle。2026-11-05） -->
          <div id="reflect-struggle-wrap" class="p-mission-reflect__field${reflectShowsStruggle(d.outcome, d.struggle) ? '' : ' u-hidden'}">
            <label class="p-mission-reflect__label" for="reflect-struggle" id="reflect-label-struggle">${_esc(f.struggle.label)}</label>
            ${field('struggle')}
          </div>

          <div class="p-mission-reflect__field">
            <label class="p-mission-reflect__label" for="reflect-solution" id="reflect-label-solution">${_esc(f.solution.label)}</label>
            ${field('solution')}
          </div>

          <div class="p-mission-reflect__share">${Components.ShareCheck({ id: 'reflect-shareable', checked: !!d.shareable, published: isKnowledgePublished(p) })}</div>

          <button type="button" onclick="window._app.saveMissionReflect()" id="reflect-save" data-cmd-enter
            class="c-button c-button--primary p-mission-reflect__save">${pending ? '保存して完了する' : '保存して記録を見る'}</button>
        </div>

        <button type="button" onclick="window._app.skipMissionReflect()" data-log="reflect_skip"
          class="p-mission-reflect__skip">${pending ? '振り返らずに完了する' : 'あとで'}</button>
      </div>
    </div>`;

  // チップ：押した瞬間に見た目を返し、outcome だけを先に保存する。
  // ★ページ全体を描き直さないこと（書きかけの本文が消える）。触るのは押した要素まわりだけ。
  appEl.querySelectorAll('[data-reflect-outcome]').forEach(btn => {
    btn.addEventListener('click', () => _pickOutcome(p, m, btn.dataset.reflectOutcome));
  });
  // 入力は下書きへ即時反映（保存はボタンを押したときだけ）。★値は印つきの文字（太字・非公開など）
  bindReflectEditor(document.getElementById('reflect-struggle'), d.struggle, (t) => { state.reflectDraft.struggle = t; });
  bindReflectEditor(document.getElementById('reflect-solution'), d.solution, (t) => { state.reflectDraft.solution = t; });
  document.getElementById('reflect-shareable')?.addEventListener('change', async (e) => {
    // ★このイベントで初めてのチェックなら確認する。「いいえ」ならチェックを外す
    if (e.target.checked && !(await confirmFirstShare(p))) e.target.checked = false;
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
    if (input) input.dataset.placeholder = f[key].placeholder;
    const steps = document.getElementById(`reflect-steps-${key}`);
    if (steps) steps.innerHTML = _stepsHtml(outcome, key);
    const ex = document.getElementById(`reflect-example-${key}`);
    if (ex) ex.textContent = f[key].placeholder;
  };
  setField('struggle');
  setField('solution');
  // ★うまくいった側は1つ目の欄を隠す（以前に書いた文字があれば残す）。ヒントも成否で差し替える
  document.getElementById('reflect-struggle-wrap')?.classList.toggle('u-hidden', !reflectShowsStruggle(outcome, d.struggle));
  // 書き方の案内（吹き出し）。★押した瞬間の反応（#reflect-reply）とは別。こちらは入力中も残す
  const bubble = document.getElementById('reflect-bubble');
  if (bubble) bubble.textContent = REFLECT_BUBBLES[outcome] || '';
  // ★自動フォーカスしない（モバイルでキーボードが出て画面が飛ぶ）
  document.getElementById('reflect-fields')?.classList.add('is-open');

  logEvent('reflect_outcome_picked', { missionId: m.id, outcome, first });

  // ★まだ完了を確定していないとき（振り返りのページの最後で確定する）は、手元に持つだけ（提出物がまだ無い）
  if (_pending(m.id)) return;
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

/**
 * 「あとで」。何も保存せずに戻る。
 * ★成否だけ先に押してある場合、それは既に保存済みなので取り消さない
 *   （押した事実は本人の入力で、スキップは「これ以上書かない」の意味）。
 */
export async function skipMissionReflect() {
  const outcome = state.reflectDraft?.outcome || null;
  // ★まだ完了を確定していない → 振り返らずに完了する（先に押した成否だけは一緒に送る）
  if (_pending(state.reflectMissionId)) {
    const btn = document.querySelector('.p-mission-reflect__skip');
    const r = await _completePending(outcome ? { outcome } : {}, btn, '完了しています…');
    if (!r) return;
    logEvent('reflect_skipped', { outcome });
    state.closeMissionReflect();
    return;
  }
  logEvent('reflect_skipped', { outcome });
  state.closeMissionReflect();
}

// ── 完了の確定を、振り返りのページの最後まで遅らせる（2026-11-12）──
// state.pendingClear = { eventId, missionId, payload, returnTab, imageCount, fileCount }（modals/helpers.js の submitMissionClear が作る）

function _pending(missionId) {
  const pc = state.pendingClear;
  return pc && pc.missionId === missionId && pc.eventId === state.selectedEventId ? pc : null;
}

/** 保留中の完了を、振り返りと一緒に1回で確定する（POST /complete）。成功で応答、失敗で null */
async function _completePending(fields, btn, busyText) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const m = p?.missions?.find(x => x.id === state.reflectMissionId);
  const pc = m && _pending(m.id);
  if (!p || !m || !pc) return null;
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = busyText; }
  const r = await api.completeMission(p.id, m.id, { ...pc.payload, ...fields });
  if (!r?.ok) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    window._app?.showToast(r?.error || '完了の保存に失敗しました', 'error');
    return null;
  }
  state.pendingClear = null;
  state.reflectStash = null;
  applyShareConfirmed(p, r);
  await afterMissionCleared(p, m, r, { format: pc.payload.format, imageCount: pc.imageCount, fileCount: pc.fileCount });
  return r;
}

/**
 * 振り返りのページの「戻る」。まだ完了を確定していなければ、完了前の入力画面へ戻す（完了しない）。
 * ★入力した文章・画像・PDF（送信済みの url）を編集欄に戻す。書きかけの振り返りも、次に開いたときのために残す
 */
export function backMissionReflect() {
  const pc = _pending(state.reflectMissionId);
  if (!pc) { state.closeMissionReflect(); return; }
  state.reflectStash = { missionId: pc.missionId, draft: state.reflectDraft };
  state.pendingClear = null;
  state.reflectMissionId = null;
  state.reflectReturn = null;
  state.reflectDraft = null;
  logEvent('reflect_back_to_clear', { missionId: pc.missionId });
  state.openMissionDetail(pc.missionId, { tab: pc.returnTab });
  loadEditorContent(editorEl(), pc.payload);
}

/** 「保存して記録を見る」。本文が空でも押せる（そのときは保存せずにもとの画面へ戻る）*/
export async function saveMissionReflect() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const missionId = state.reflectMissionId;
  const d = state.reflectDraft || {};
  if (!p || !missionId) { state.closeMissionReflect(); return; }

  // ★印つきの文字（太字・非公開など）。欄から読み直す（下書きは入力のたびに更新しているが、念のため）
  const struggle = readReflectEditor(document.getElementById('reflect-struggle')) || (d.struggle || '').trim();
  const solution = readReflectEditor(document.getElementById('reflect-solution')) || (d.solution || '').trim();
  const btn = document.getElementById('reflect-save');

  // ★まだ完了を確定していない → 振り返りと一緒に完了を確定する
  if (_pending(missionId)) {
    const wasRecordedP = false;
    const r = await _completePending({
      ...(d.outcome ? { outcome: d.outcome } : {}),
      ...(struggle || solution ? { struggle, solution, shareable: !!d.shareable } : {}),
    }, btn, '完了しています…');
    if (!r) return;
    logEvent('reflect_saved', { missionId, outcome: d.outcome || null, hasStruggle: !!struggle, hasSolution: !!solution, shareable: !!d.shareable });
    if (!struggle && !solution) { state.closeMissionReflect(); return; }
    setArchiveLanding(missionId, wasRecordedP);
    state.archiveFocusMissionId = missionId;
    state.closeMissionReflect({ tab: 'ARCHIVE' });
    window._app?.showToast('振り返りを保存しました');
    return;
  }
  if (!struggle && !solution) { state.closeMissionReflect(); return; }

  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  // 保存の前から「振り返り」（2つ目の欄が書いてある）に数えられていたか（着地で数字を上げるかどうか）
  const wasRecorded = taskSubmissions(p, missionId).some(cd => String(cd.solution || '').trim() !== '');

  const r = await api.updateReflection(p.id, missionId, {
    struggle, solution, shareable: !!d.shareable,
    ...(d.outcome ? { outcome: d.outcome } : {}),
  });
  if (!r?.ok) {
    if (btn) { btn.disabled = false; btn.textContent = '保存して記録を見る'; }
    window._app?.showToast(r?.error || '保存に失敗しました', 'error');
    return;
  }
  _applyLocal(p, missionId, r.reflection);
  applyShareConfirmed(p, r);
  // ★本文は送らない（行動ログに自由記述を混ぜない）。書かれたかどうかだけ数える
  logEvent('reflect_saved', {
    missionId, outcome: d.outcome || null,
    hasStruggle: !!struggle, hasSolution: !!solution, shareable: !!d.shareable,
  });
  // ★保存したらアーカイブのその記録に着地する（2026-11-07。指示書B §7-3）。ボードへはボトムナビ・左端の列で戻れる。
  //   「あとで」（skipMissionReflect）は今までどおりボードへ
  setArchiveLanding(missionId, wasRecorded);
  state.archiveFocusMissionId = missionId;
  state.closeMissionReflect({ tab: 'ARCHIVE' });
  window._app?.showToast('振り返りを保存しました');
}
