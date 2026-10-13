// ===== オンボーディングの表示コンポーネント =====
// トリガー判定は ../onboarding.js。ここは「渡された内容を出す」だけに徹する。
// 見た目は purposeReminderModal.js に合わせてある（中央のカード・角丸3xl・最大 max-w-sm）。
//
// ★z-index は 180（他の自動表示モーダルと同じ）。onboarding.js が
//   isAnyAutoModalOpen() で重複を防ぐので、重ね順で競う必要はない。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { openInviteIssueModal } from './inviteIssueModal.js';
import { Components } from '../components.js';

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
 * @param {Array<[string,string,string?]>} [o.steps] 5ステップ等の箇条。3つ目は画像のパス（任意）。
 *        ★画像のある手順は**1枚ずつめくる形**で出す（初期オンボーディング①と同じ見た目。M1・L1。2026-10-12）
 * @param {string} [o.body]    本文
 * @param {string} o.primary   主ボタンの文言
 * @param {string} [o.action]  主ボタンの動作（'openMissionModal' など。省略で閉じるだけ）
 * @param {*} [o.actionArg]    動作に渡す引数（'openMission' のタスクIDなど）
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
  // L1 は5ステップの手順、L5 は未割当タスクの一覧なので見た目を変える。
  const numbered = o.numbered !== false && !o.bullet;
  const stepsHtml = (o.steps || []).map(([label, desc], i) => `
    <div class="c-modal__step">
      <span class="c-modal__step-num${numbered ? '' : ' c-modal__step-num--bullet'}">${numbered ? i + 1 : '・'}</span>
      <div class="c-modal__step-body">
        <p class="c-modal__step-title">${_esc(label)}</p>
        <p class="c-modal__step-text">${_esc(desc)}</p>
      </div>
    </div>`).join('');

  // ★画像のある手順は1枚ずつめくる（並べると画像が小さくなって見えないため）
  const paged = (o.steps || []).some(st => st[2]);
  let page = 0;
  const pagedHtml = () => {
    const [label, desc, art] = o.steps[page];
    const isLast = page === o.steps.length - 1;
    return `
    <div class="c-modal u-animate-fade">
      ${o.eyebrow ? `<p class="c-modal__eyebrow">${_esc(o.eyebrow)}</p>` : ''}
      <!-- ★title は _esc しないこと（下の通常表示と同じ理由。<br> を含む）-->
      <h3 class="c-modal__title c-modal__title--wide">${o.title}</h3>
      <div class="c-modal__stage">
        ${art ? `<img src="${_esc(art)}" class="c-modal__stage-art" width="765" height="601" alt="">` : ''}
        <span class="c-modal__stage-num">${page + 1}</span>
        <p class="c-modal__stage-title">${_esc(label)}</p>
        <p class="c-modal__stage-text">${_esc(desc)}</p>
      </div>
      ${Components.StepIndicator(page + 1, o.steps.length)}
      ${isLast && o.body ? `<p class="c-modal__lead">${_esc(o.body)}</p>` : ''}
      <button type="button" data-ob="${isLast ? 'primary' : 'next'}" class="c-button c-button--primary c-modal__button c-modal__button--roomy">${_esc(isLast ? o.primary : '次へ')}</button>
      ${o.dismissible === false ? '' : '<button type="button" data-ob="close" class="c-modal__button--quiet">後で</button>'}
    </div>`;
  };

  if (paged) overlay.innerHTML = pagedHtml();
  else overlay.innerHTML = `
    <div class="c-modal c-modal--scroll u-animate-fade">
      ${o.emoji ? `<p class="c-modal__emoji">${o.emoji}</p>` : ''}
      ${o.eyebrow ? `<p class="c-modal__eyebrow">${_esc(o.eyebrow)}</p>` : ''}
      <!-- ★title は _esc しないこと。改行のための <br> を意図的に含んでいる
           （「あなたのやることは<br>3つです」など）。中に入るユーザー名・
           タスク名は onboarding.js の _escapeName() が発生源で
           エスケープ済み。ここで二重に esc すると <br> が文字として出る
           （実際にその不具合を出した）。body は <br> を含まないので esc する。 -->
      <h3 class="c-modal__title c-modal__title--wide">${o.title}</h3>
      <div class="c-modal__body">
        ${stepsHtml ? `<div class="c-modal__steps">${stepsHtml}</div>` : ''}
        ${o.body ? `<p class="c-modal__lead">${_esc(o.body)}</p>` : ''}
      </div>
      <button type="button" data-ob="primary" class="c-button c-button--primary c-modal__button c-modal__button--roomy">${_esc(o.primary)}</button>
      <!-- ★dismissible: false のステップでは「あとで」を出さない。
           主ボタンを押しても閉じるだけ（action 無し）の案内で、選択肢が2つあると
           「どちらを押すべきか」を考えさせるだけになるため（L1 がこれ）。 -->
      ${o.dismissible === false ? '' : '<button type="button" data-ob="close" class="c-modal__button--quiet">後で</button>'}
    </div>`;
  document.body.appendChild(overlay);

  logEvent('onboarding_shown', { stepId: o.stepId, role: o.role, experience: o.density });

  // ★参加した人の進め方（M1／L1）を閉じたら描き直す。次の🔥（リーダーの意気込み）の判定は
  //   render() 駆動なので、呼ばないと「あとで」「わかった」で閉じたあと🔥が出ない
  const _afterClose = () => { if (o.stepId === 'M1' || o.stepId === 'L1') state.render(); };

  function _dismiss() {
    logEvent('onboarding_dismissed', { stepId: o.stepId });
    overlay.remove();
    _afterClose();
  }

  const bind = () => {
    overlay.querySelector('[data-ob="close"]')?.addEventListener('click', _dismiss);
    overlay.querySelector('[data-ob="next"]')?.addEventListener('click', () => {
      page++;
      logEvent('onboarding_page', { stepId: o.stepId, page: page + 1 });
      overlay.innerHTML = pagedHtml();
      bind();
    });
    const primary = overlay.querySelector('[data-ob="primary"]');
    if (primary) primary.onclick = () => {
      logEvent('onboarding_action', { stepId: o.stepId });
      overlay.remove();
      if (o.action) _runAction(o.action, o.actionArg);
      else _afterClose();
    };
  };
  bind();
}

/** 主ボタンの動作。増えたらここに1行足す（モーダル側に処理を書かない） */
function _runAction(action, arg) {
  if (!action) return;
  if (action === 'openMissionModal') {
    // ★タスクは自動追加しない。作成モーダルを開いてユーザーに作らせる
    window._app?.openMissionModal?.();
    return;
  }
  if (action === 'openPendingMembers') {
    window._app?.openPendingMembersSheet?.();
    return;
  }
  if (action === 'openMissionList') {
    // メインタブに戻すだけ。担当はタスクを開いて決めてもらう
    state.mainBoardTab = 'MAIN';
    state.render();
    return;
  }
  if (action === 'openArchive') {
    state.mainBoardTab = 'ARCHIVE';
    state.render();
    return;
  }
  if (action === 'openHandoverCalendar') {
    // 引き継ぎ（振り返り）をいつやるかをカレンダーで選ばせる（複数日可）。
    // ★閉じたときに state.commitHandoverDatesEdit() が保存する（calendar.js）。
    window._app?.openCalendarModal?.('handover');
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
