// ===== オンボーディングの表示コンポーネント =====
// トリガー判定は ../onboarding.js。ここは「渡された内容を出す」だけに徹する。
// 見た目は purposeReminderModal.js に合わせてある（中央のカード・角丸3xl・最大 max-w-sm）。
//
// ★z-index は 180（他の自動表示モーダルと同じ）。onboarding.js が
//   isAnyAutoModalOpen() で重複を防ぐので、重ね順で競う必要はない。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { openInviteIssueModal } from './inviteIssueModal.js';

const OVERLAY_ID = 'onboarding-overlay';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * @param {object} o
 * @param {string} o.stepId   'L1' など。計測に使う
 * @param {'leader'|'member'} o.role
 * @param {string} o.density
 * @param {string} [o.eyebrow] 小見出し
 * @param {string} o.title     見出し（<br> 可・自前の文言なので raw で入れる）
 * @param {Array<[string,string]>} [o.steps] 5ステップ等の箇条
 * @param {string} [o.body]    本文
 * @param {string} o.primary   主ボタンの文言
 * @param {string} [o.action]  主ボタンの動作（'openMissionModal' など。省略で閉じるだけ）
 * @param {*} [o.actionArg]    動作に渡す引数（'openMission' のミッションIDなど）
 * @param {string} [o.emoji]   見出しの上に出す絵文字（お祝いの演出用）
 * @param {boolean} [o.bullet] steps を手順(①②③)ではなく一覧(・)として出す
 */
export function openOnboardingModal(o) {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  // 背景タップでも閉じられる（＝dismissed 扱い）
  overlay.onclick = (e) => { if (e.target === overlay) _dismiss(); };

  // numbered: true なら手順（①②③）、false なら箇条（・）として出す。
  // L1 は5ステップの手順、L5 は未割当ミッションの一覧なので見た目を変える。
  const numbered = o.numbered !== false && !o.bullet;
  const stepsHtml = (o.steps || []).map(([label, desc], i) => `
    <div class="c-modal__step">
      <span class="w-6 h-6 rounded-full ${numbered ? 'bg-[#0CA1E3] text-white' : 'bg-[#EBE8E5] text-[#A7AAAC]'}
        text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">${numbered ? i + 1 : '・'}</span>
      <div class="c-modal__step-body">
        <p class="c-modal__step-title">${_esc(label)}</p>
        <p class="c-modal__step-text">${_esc(desc)}</p>
      </div>
    </div>`).join('');

  overlay.innerHTML = `
    <div class="c-modal c-modal--scroll animate-fadeIn">
      ${o.emoji ? `<p class="c-modal__emoji">${o.emoji}</p>` : ''}
      ${o.eyebrow ? `<p class="c-modal__eyebrow">${_esc(o.eyebrow)}</p>` : ''}
      <!-- ★title は _esc しないこと。改行のための <br> を意図的に含んでいる
           （「あなたのやることは<br>3つです」など）。中に入るユーザー名・
           ミッション名は onboarding.js の _escapeName() が発生源で
           エスケープ済み。ここで二重に esc すると <br> が文字として出る
           （実際にその不具合を出した）。body は <br> を含まないので esc する。 -->
      <h3 class="c-modal__title c-modal__title--wide">${o.title}</h3>
      <div class="c-modal__body">
        ${stepsHtml ? `<div class="c-modal__steps">${stepsHtml}</div>` : ''}
        ${o.body ? `<p class="c-modal__lead">${_esc(o.body)}</p>` : ''}
      </div>
      <button type="button" data-ob="primary" class="c-button c-button--primary c-modal__button c-modal__button--roomy">${_esc(o.primary)}</button>
      <button type="button" data-ob="close" class="c-modal__button--quiet">あとで</button>
    </div>`;
  document.body.appendChild(overlay);

  logEvent('onboarding_shown', { stepId: o.stepId, role: o.role, experience: o.density });

  function _dismiss() {
    logEvent('onboarding_dismissed', { stepId: o.stepId });
    overlay.remove();
  }

  overlay.querySelector('[data-ob="close"]').onclick = _dismiss;
  overlay.querySelector('[data-ob="primary"]').onclick = () => {
    logEvent('onboarding_action', { stepId: o.stepId });
    overlay.remove();
    _runAction(o.action, o.actionArg);
  };
}

/** 主ボタンの動作。増えたらここに1行足す（モーダル側に処理を書かない） */
function _runAction(action, arg) {
  if (!action) return;
  if (action === 'openMissionModal') {
    // ★ミッションは自動追加しない。作成モーダルを開いてユーザーに作らせる
    window._app?.openMissionModal?.();
    return;
  }
  if (action === 'openPendingMembers') {
    window._app?.openPendingMembersSheet?.();
    return;
  }
  if (action === 'openMissionList') {
    // メインタブに戻すだけ。担当はミッションを開いて決めてもらう
    state.mainBoardTab = 'MAIN';
    state.render();
    return;
  }
  if (action === 'openArchive') {
    state.mainBoardTab = 'ARCHIVE';
    state.render();
    return;
  }
  if (action === 'openInvite') {
    openInviteIssueModal(state.selectedEventId);
    return;
  }
  if (action === 'openMission') {
    // 削除済みなら詳細を開かず、メインタブに戻すだけにする
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (arg && p?.missions?.some(m => m.id === arg)) state.openMissionDetail(arg);
    else { state.mainBoardTab = 'MAIN'; state.render(); }
    return;
  }
  if (typeof action === 'function') action(state);
}
