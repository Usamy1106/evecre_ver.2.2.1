// ===== タスク作成の確認モーダル =====
//
// 「作成する」を押したとき、担当者・実施期間・優先度・ラベルのどれかが空なら、
// 作る前に一度だけ知らせる。**止めるのではなく気づかせる**ためのものなので、
// 「そのまま作成する」を必ず置く。
//
// ★出すのは**新規作成のときだけ**。編集（保存）では出さない。
//   既存のタスクを直すたびに「担当者がいません」と言われるのは邪魔なだけで、
//   埋まっていないことは本人がいちばん知っている。
// ★1つだけ空なら、その項目そのものの言い方で出して、設定へ直接つなぐ。
//   複数空なら箇条書きにして、まとめてフォームへ戻す。
// ★「今後は表示しない」はユーザー単位（localStorage）。イベントごとにしない
//   ―― 同じ人が同じ判断を何度もさせられることになる。
// ★localStorage は private ブラウズで例外を投げる。読めないときは「出す」側に倒す
//   （出しすぎは鬱陶しいだけだが、出ないと気づけない）。

import { state } from '../state.js';
import { logEvent } from '../logger.js';

const OVERLAY_ID = 'mission-check-overlay';
const HIDE_KEY = (userId) => `evecre:missionCheck:hide:v1:${userId}`;

/**
 * 空の項目。★並びは画面（基本設定タブ）の上から下と揃える
 *   （箇条書きの順番と、フォームで目立たせる順番を一致させるため）。
 *
 * action … 'sheet' はボトムシートを直接開く／'focus' はフォームの欄を目立たせる
 */
const FIELDS = [
  { id: 'labels',   label: 'ラベル',       empty: 'ラベルが設定されていません',
    cta: 'ラベルを設定する',     action: 'focus',  target: 'labels' },
  { id: 'priority', label: '優先度',       empty: '優先度が設定されていません',
    cta: '優先度を設定する',     action: 'focus',  target: 'priority' },
  { id: 'assignee', label: '担当者',       empty: '担当者が割り当てられていません',
    cta: '担当者を割り当てる',   action: 'sheet',  open: 'openAssigneeSheet' },
  { id: 'dates',    label: 'タスクの実施期間', empty: '実施する期間が設定されていません',
    cta: '期間を設定する',       action: 'sheet',  open: 'openMissionCalendar' },
];

/** 空の項目を返す（上から下の順）*/
export function missingMissionFields(d = state.draftMission) {
  const has = {
    labels:   Array.isArray(d?.labels) && d.labels.length > 0,
    priority: (d?.priority || 0) > 0,
    // ★申告制は「手を挙げた人に任せる」ので、担当者が空でも正しい
    assignee: !!d?.selfClaim || !!d?.assignee || (Array.isArray(d?.assignees) && d.assignees.length > 0),
    dates:    Array.isArray(d?.dates) && d.dates.length > 0,
  };
  return FIELDS.filter(f => !has[f.id]);
}

function _hidden() {
  const uid = state.currentUser?.id;
  if (!uid) return false;
  try { return localStorage.getItem(HIDE_KEY(uid)) === '1'; } catch (_) { return false; }
}

function _remember() {
  const uid = state.currentUser?.id;
  if (!uid) return;
  try { localStorage.setItem(HIDE_KEY(uid), '1'); } catch (_) {}
}

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function closeMissionCheckModal() {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * 空の項目があれば確認モーダルを出す。出したら true。
 * @param {Function} onProceed 「そのまま作成する」を押したときに実行する処理
 */
export function checkMissionBeforeCreate(onProceed) {
  if (_hidden()) return false;
  const missing = missingMissionFields();
  if (missing.length === 0) return false;

  logEvent('mission_check_shown', { fields: missing.map(f => f.id) });
  _open(missing, onProceed);
  return true;
}

function _open(missing, onProceed) {
  closeMissionCheckModal();

  const single = missing.length === 1 ? missing[0] : null;
  const body = single
    ? `<p class="p-mission-check__lead">${_esc(single.empty)}</p>`
    : `<p class="p-mission-check__lead">以下の項目が設定されていません</p>
       <ul class="p-mission-check__list">
         ${missing.map(f => `<li class="p-mission-check__item">${_esc(f.label)}</li>`).join('')}
       </ul>`;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--center';
  overlay.innerHTML = `
    <div class="c-modal p-mission-check" role="dialog" aria-modal="true">
      ${body}
      <label class="p-mission-check__hide">
        <input type="checkbox" id="mission-check-hide">
        <span>今後は表示しない</span>
      </label>
      <div class="p-mission-check__actions">
        <button type="button" data-check="set"
          class="c-button c-button--primary p-mission-check__button">
          ${_esc(single ? single.cta : '設定する')}
        </button>
        <button type="button" data-check="skip"
          class="p-mission-check__quiet">このまま作成する</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // ★「今後は表示しない」はどちらのボタンでも効く（チェックした意思は同じ）
  const keep = () => { if (document.getElementById('mission-check-hide')?.checked) _remember(); };

  overlay.querySelector('[data-check="set"]').addEventListener('click', () => {
    keep();
    logEvent('mission_check_set', { fields: missing.map(f => f.id) });
    closeMissionCheckModal();
    // ★1つだけなら、その設定へ直接つなぐ。ボトムシートはモーダルを閉じてから開く
    //   （重なると下のシートが掴めない）。
    if (single && single.action === 'sheet') { window._app?.[single.open]?.(); return; }
    highlightMissionFields(missing.map(f => f.target || f.id));
  });

  overlay.querySelector('[data-check="skip"]').addEventListener('click', () => {
    keep();
    logEvent('mission_check_skipped', { fields: missing.map(f => f.id) });
    closeMissionCheckModal();
    onProceed?.();
  });

  // 背景タップは「閉じるだけ」。作成もしないし、設定にも飛ばさない
  overlay.onclick = (e) => { if (e.target === overlay) closeMissionCheckModal(); };
}

/**
 * フォームの該当の欄を目立たせる。
 * ★一番上のものまでスクロールしてから光らせる（画面外で光っても気づけない）。
 * ★クラスは一定時間で外す。付けっぱなしにすると、入力し終わっても光ったまま。
 */
export function highlightMissionFields(targets) {
  // 詳細設定を見ているときは基本設定へ戻す（4項目とも基本設定にある）
  if (state.missionModalTab !== 'BASIC') window._app?.setMissionTab?.('BASIC');

  requestAnimationFrame(() => {
    const els = targets
      .map(t => document.querySelector(`[data-field="${t}"]`))
      .filter(Boolean);
    if (els.length === 0) return;
    els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    for (const el of els) {
      el.classList.remove('is-attention');
      void el.offsetWidth;                 // ★付け直しのため一度外す
      el.classList.add('is-attention');
      setTimeout(() => el.classList.remove('is-attention'), 2400);
    }
  });
}
