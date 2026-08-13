// ===== オンボーディングの表示コンポーネント =====
// トリガー判定は ../onboarding.js。ここは「渡された内容を出す」だけに徹する。
// 見た目は purposeReminderModal.js に合わせてある（中央のカード・角丸3xl・最大 max-w-sm）。
//
// ★z-index は 180（他の自動表示モーダルと同じ）。onboarding.js が
//   isAnyAutoModalOpen() で重複を防ぐので、重ね順で競う必要はない。

import { state } from '../state.js';
import { logEvent } from '../logger.js';

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
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[180] flex items-center justify-center p-6';
  // 背景タップでも閉じられる（＝dismissed 扱い）
  overlay.onclick = (e) => { if (e.target === overlay) _dismiss(); };

  // numbered: true なら手順（①②③）、false なら箇条（・）として出す。
  // L1 は5ステップの手順、L5 は未割当ミッションの一覧なので見た目を変える。
  const numbered = o.numbered !== false && !o.bullet;
  const stepsHtml = (o.steps || []).map(([label, desc], i) => `
    <div class="flex items-start gap-3 text-left">
      <span class="w-6 h-6 rounded-full ${numbered ? 'bg-[#0CA1E3] text-white' : 'bg-[#EBE8E5] text-[#A7AAAC]'}
        text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">${numbered ? i + 1 : '・'}</span>
      <div class="min-w-0">
        <p class="text-[13px] font-bold text-[#484545] break-words">${_esc(label)}</p>
        <p class="text-[11px] text-[#0CA1E3] font-bold leading-relaxed break-words">${_esc(desc)}</p>
      </div>
    </div>`).join('');

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center max-h-[85vh] flex flex-col">
      ${o.emoji ? `<p class="text-[44px] leading-none mb-3">${o.emoji}</p>` : ''}
      ${o.eyebrow ? `<p class="text-[11px] text-[#0CA1E3] font-bold mb-2">${_esc(o.eyebrow)}</p>` : ''}
      <h3 class="heading-m text-[#484545] mb-5 font-bold leading-snug">${o.title}</h3>
      <div class="flex-1 overflow-y-auto">
        ${stepsHtml ? `<div class="space-y-3 mb-5">${stepsHtml}</div>` : ''}
        ${o.body ? `<p class="text-[12px] text-[#484545] font-bold leading-relaxed mb-6 whitespace-pre-line">${_esc(o.body)}</p>` : ''}
      </div>
      <button data-ob="primary" class="btn-primary w-full py-4 heading-rs font-bold shadow-lg">${_esc(o.primary)}</button>
      <button data-ob="close" class="w-full py-3 mt-1 text-[13px] font-bold text-[#A7AAAC]">あとで</button>
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
  if (action === 'openMission') {
    // 削除済みなら詳細を開かず、メインタブに戻すだけにする
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (arg && p?.missions?.some(m => m.id === arg)) state.openMissionDetail(arg);
    else { state.mainBoardTab = 'MAIN'; state.render(); }
    return;
  }
  if (typeof action === 'function') action(state);
}
