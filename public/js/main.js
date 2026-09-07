// ===== エントリーポイント =====
// 全モジュールをインポートし、グローバルバインディングを設定する

import { state, registerRenderer } from './state.js';
import { api } from './api.js';
import { logEvent, initLogger, setProjectIdGetter } from './logger.js';

// ビュー
import { renderHome }               from './views/home.js';
import {
  renderCreateEventInfo, renderCreateEventType, renderCreateEventScale,
  renderCreateEventDates, renderCreateEventCatchphrase, renderCreateEventMotivation,
  renderCreateEventInvite,
} from './views/createEvent.js';
import { renderEventSettings } from './views/eventSettings.js';
import { renderProjectDetail } from './views/projectDetail.js';
import { renderMainBoard, toggleAnnounceList } from './views/mainBoard.js';
import { renderWelcome } from './views/welcome.js';
import { renderLogin, motivationBlockHtml, inviteMembersHtml } from './views/auth.js';
import { renderSignup, resumeOnboardingIfNeeded } from './views/signup.js';
import { renderAccount } from './views/account.js';
import { renderPasswordResetRequest, renderPasswordResetConfirm } from './views/passwordReset.js';
import { renderLegal } from './views/legal.js';
import { startPushSetupFlow, refreshPushSubscribed } from './modals/pushSetupModal.js';
import {
  renderMissionDetail,
  sendChatMessage, deleteChatMessage, toggleChatReaction, openChatEmojiPicker,
  cancelChatReply,
} from './views/missionDetail.js';
import { renderArchiveAnswers } from './views/archiveAnswers.js';
import { renderArchiveStats } from './views/archiveStats.js';

// モーダル
import { openCalendarModal, moveCalendarMonth } from './modals/calendar.js';
import {
  openMissionModal, closeMissionModal, deleteMission,
  renderMissionModalContent,
  addProposalToMission, showProposalHelp,
  toggleMissionMenu, toggleSortMenu,
  showMissionListModal, changeMissionSort,
  openAssigneeSheet,
  openTagCreator, closeTagCreator,
  openSelectClaimModal,
} from './modals/mission.js';
import {
  editArchiveItem, openEditModal,
  submitMissionClear, handleImageSelect, clearImagePreview,
  handleGoodClick,
  updateDraftInfo,
  copyMissionLink,
} from './modals/helpers.js';
import { openVerifyEmailModal } from './modals/verifyEmailModal.js';
import { openJoinByCodeModal } from './modals/joinByCodeModal.js';
import { openEventCalendarSheet } from './modals/eventCalendarSheet.js';
import { checkPurposeReminderModal } from './modals/purposeReminderModal.js';
import { checkLeaderMotivationModal, openLeaderMotivationModal } from './modals/leaderMotivationModal.js';
import { openJoinFormModal } from './modals/joinFormModal.js';
import { SKILL_TAGS } from './constants.js';
import { checkOnboarding } from './onboarding.js';
import { checkIntro, abortIntroVisuals } from './onboardingIntro.js';
import { openUserProfileModal } from './modals/userProfileModal.js';
import { copySchedule } from './scheduleCopy.js';
import { openReflectionEditModal } from './modals/reflectionEditModal.js';
import { checkEventDateReminderModal } from './modals/eventDateReminderModal.js';
import { checkDeveloperAnnouncementModal } from './modals/devAnnouncementModal.js';
// ★暫定：既存メンバーのスキル回収。回収が済んだらこの import ごと削除する
import { checkSkillCollectModal } from './modals/skillCollectModal.js';
import { showConfirmDialog } from './dialog.js';
import { initSheetDragClose } from './sheet.js';
import {
  registerServiceWorker, initPushNavigation,
  enablePush, disablePush, getPushState, hasSubscription,
} from './push.js';

// ===== ビューレンダラーの登録 =====
// アカウント作成は STEP 0〜3 の段階フロー（views/signup.js）。
// 旧1画面版 renderCreateAccountInfo は auth.js に残っているが未使用。
// ★未ログイン時の入口は WELCOME（新規登録 / ログインの2択）。
//   ここを CREATE_ACCOUNT_INFO に戻すと、既存ユーザーが毎回いきなり
//   アカウント作成画面から始まることになる。
registerRenderer('WELCOME',               renderWelcome);
registerRenderer('CREATE_ACCOUNT_INFO',   renderSignup);
registerRenderer('LOGIN',                 renderLogin);
registerRenderer('PASSWORD_RESET_REQUEST', renderPasswordResetRequest);
registerRenderer('PASSWORD_RESET_CONFIRM', renderPasswordResetConfirm);
registerRenderer('LEGAL',                 renderLegal);

// オンボーディング再開のフックを state に渡す（state.js から views を import すると
// 循環依存になるため、registerRenderer と同じ方式で注入する）。
state._resumeOnboarding = resumeOnboardingIfNeeded;
registerRenderer('ACCOUNT',               renderAccount);
registerRenderer('HOME',                  renderHome);
// イベント作成フロー（STEP 1〜7）
registerRenderer('CREATE_EVENT_INFO',        renderCreateEventInfo);
registerRenderer('CREATE_EVENT_TYPE',        renderCreateEventType);
registerRenderer('CREATE_EVENT_SCALE',       renderCreateEventScale);
registerRenderer('CREATE_EVENT_DATES',       renderCreateEventDates);
registerRenderer('CREATE_EVENT_CATCHPHRASE', renderCreateEventCatchphrase);
registerRenderer('CREATE_EVENT_MOTIVATION',  renderCreateEventMotivation);
registerRenderer('CREATE_EVENT_INVITE',      renderCreateEventInvite);
registerRenderer('MAIN_BOARD',            renderMainBoard);
registerRenderer('EVENT_SETTINGS',      renderEventSettings);
registerRenderer('PROJECT_DETAIL',      renderProjectDetail);
registerRenderer('MISSION_DETAIL',      renderMissionDetail);
registerRenderer('ARCHIVE_ANSWERS',     renderArchiveAnswers);
registerRenderer('ARCHIVE_STATS',       renderArchiveStats);

// ===== 参加承認ロール設定モーダル（共通ヘルパー）=====
// uid: 承認対象userId, username: 表示名, roles: イベントのロール配列（破壊的に追加される）
// onSuccess(uid): 承認成功時コールバック
function _openApproveModal(uid, username, roles, onSuccess) {
  const mutableRoles = roles.slice();

  function _roleCheckItem(r, checked = false) {
    const el = document.createElement('label');
    el.className = 'p-member-manage__role-item';
    el.innerHTML = `
      <input type="checkbox" data-role-check value="${_escH(r.id)}"
        ${checked || r.id === 'member' ? 'checked' : ''}
        class="p-member-manage__check">
      <div>
        <span class="p-member-manage__role-name">${_escH(r.name || r.id)}</span>
        ${r.canManage
          ? '<span class="p-member-manage__role-badge p-member-manage__role-badge--manage">管理者権限</span>'
          : '<span class="p-member-manage__role-badge">一般ユーザー</span>'}
      </div>`;
    return el;
  }

  const roleOverlay = document.createElement('div');
  roleOverlay.className = 'c-overlay c-overlay--approve c-overlay--blur';
  roleOverlay.onclick = (e2) => { if (e2.target === roleOverlay) roleOverlay.remove(); };
  roleOverlay.innerHTML = `
    <div class="c-modal c-modal--left u-animate-fade">
      <h3 class="c-modal__title c-modal__title--tight">ロールを設定する</h3>
      <p class="text-rs p-member-manage__lead">@${_escH(username)} さんのロールを選択してください（複数可）</p>
      <div id="role-check-list" class="p-member-manage__role-list"></div>
      <button id="role-add-toggle" class="p-member-manage__role-add">
        ＋ 新しいロールを追加
      </button>
      <div id="role-add-form" class="p-member-manage__role-form u-hidden">
        <input id="role-add-name" placeholder="例: サブリーダー、デザイナーなど" maxlength="20"
          class="c-input p-member-manage__role-input">
        <label class="p-member-manage__role-check-row">
          <input id="role-add-canmanage" type="checkbox" class="p-member-manage__check">
          <span class="p-member-manage__role-check-label">管理者権限</span>
          <span class="p-member-manage__role-check-note">イベント管理・ミッション編集</span>
        </label>
        <div class="p-member-manage__role-form-actions">
          <button id="role-add-cancel" class="c-button c-button--muted">キャンセル</button>
          <button id="role-add-save" class="c-button c-button--primary">追加</button>
        </div>
      </div>
      <div class="c-modal__actions">
        <button data-action="cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
        <button data-action="confirm" class="c-button c-button--primary c-modal__button c-modal__button--shadow">承認する</button>
      </div>
    </div>`;
  document.body.appendChild(roleOverlay);

  const checkList = roleOverlay.querySelector('#role-check-list');
  mutableRoles.forEach(r => checkList.appendChild(_roleCheckItem(r, false)));

  const addToggle = roleOverlay.querySelector('#role-add-toggle');
  const addForm   = roleOverlay.querySelector('#role-add-form');
  addToggle.onclick = () => {
    addForm.classList.remove('u-hidden');
    addToggle.classList.add('u-hidden');
    roleOverlay.querySelector('#role-add-name').focus();
  };
  roleOverlay.querySelector('#role-add-cancel').onclick = () => {
    addForm.classList.add('u-hidden');
    addToggle.classList.remove('u-hidden');
    roleOverlay.querySelector('#role-add-name').value = '';
    roleOverlay.querySelector('#role-add-canmanage').checked = false;
  };
  roleOverlay.querySelector('#role-add-save').onclick = async () => {
    const name = roleOverlay.querySelector('#role-add-name').value.trim();
    if (!name) { roleOverlay.querySelector('#role-add-name').focus(); return; }
    const canManage = roleOverlay.querySelector('#role-add-canmanage').checked;
    const r = await api.createRole(state.selectedEventId, name, canManage);
    if (r.ok && r.role) {
      checkList.appendChild(_roleCheckItem(r.role, true));
      mutableRoles.push(r.role);
      roles.push(r.role);
      const proj = state.events.find(x => x.id === state.selectedEventId);
      if (proj) proj.roles = (proj.roles || []).concat([r.role]);
      addForm.classList.add('u-hidden');
      addToggle.classList.remove('u-hidden');
      roleOverlay.querySelector('#role-add-name').value = '';
      roleOverlay.querySelector('#role-add-canmanage').checked = false;
    } else {
      window._app?.showToast(r.error || 'ロールの追加に失敗しました', 'error');
    }
  };
  roleOverlay.querySelector('[data-action="cancel"]').onclick = () => roleOverlay.remove();
  roleOverlay.querySelector('[data-action="confirm"]').onclick = async (evConf) => {
    const confirmBtn = evConf.currentTarget;
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = '承認中…';

    const addFormEl = roleOverlay.querySelector('#role-add-form');
    if (addFormEl && !addFormEl.classList.contains('u-hidden')) {
      const newName = (roleOverlay.querySelector('#role-add-name')?.value || '').trim();
      if (newName) {
        const canManage = roleOverlay.querySelector('#role-add-canmanage')?.checked || false;
        const rr = await api.createRole(state.selectedEventId, newName, canManage);
        if (rr.ok && rr.role) {
          checkList.appendChild(_roleCheckItem(rr.role, true));
          mutableRoles.push(rr.role);
          roles.push(rr.role);
          const proj = state.events.find(x => x.id === state.selectedEventId);
          if (proj) proj.roles = (proj.roles || []).concat([rr.role]);
        }
      }
    }

    const roleIds = [...roleOverlay.querySelectorAll('[data-role-check]:checked')]
      .map(cb => cb.value).filter(Boolean);
    const finalRoles = roleIds.length > 0 ? roleIds : ['member'];
    const r = await api.approvePendingMember(state.selectedEventId, uid, finalRoles);
    roleOverlay.remove();
    if (r.ok) {
      _showToast(`@${username} を承認しました`);
      onSuccess(uid);
    } else {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '承認する';
      window._app?.showToast(r.error || '承認に失敗しました', 'error');
    }
  };
}

// ===== window._app : インラインイベントハンドラーから呼び出されるAPI =====
// HTMLテンプレート内の onclick="window._app.xxx()" から参照される
window._app = {
  // --- state 委譲 ---
  setView: (view, id) => state.setView(view, id),
  // 通知セットアップ（ホーム画面追加 → 通知許可）。HOME のバナー・お知らせのボタンから呼ぶ
  startPushSetup: (source, silent) => startPushSetupFlow({ source, silent }),
  setTab: (tab) => {
    state.mainBoardTab = tab;
    logEvent('board_tab_switched', { tab });
    if (tab === 'ARCHIVE')       logEvent('archive_viewed');
    if (tab === 'NOTIFICATIONS') state.loadNotifications().then(() => { state.render(); window.scrollTo(0, 0); });
    state.render();
    window.scrollTo(0, 0);
  },

  // --- 招待コード入力・メンバー管理 ---
  openJoinByCodeModal: () => openJoinByCodeModal(),

  // --- メインボードのカレンダーボトムシート（開催まで残り○日 タップで開く）---
  openEventCalendarSheet: () => openEventCalendarSheet(),

  // --- ミッションモーダル：担当者選択 ---
  openAssigneeSheet:  () => openAssigneeSheet(),
  // --- イベント設定ページへの遷移（歯車アイコン）---
  toggleProjectMenu: (e) => {
    e.stopPropagation();
    // 旧ドロップオーバーは廃止。設定ページに直接遷移
    state.setView('EVENT_SETTINGS', state.selectedEventId);
  },

  // --- イベント作成: ステップ間遷移（クリック時に検証）---
  // STEP 1 → 2 → 3 → 4 → 5 → 6 → 7(招待)。STEP 4〜6 はスキップ可。
  // 戻るボタンは state.draftEvent をリセットしないので、回答は保持されたまま戻れる。
  tryProceedFromInfo: () => {
    const d = state.draftEvent || {};
    if (!d.name?.trim()) {
      window._app?.showToast('イベント名を入力してください', 'error');
      return;
    }
    // project_info_completed は旧フローからの継続イベント（既存の集計との互換のため残す）
    logEvent('project_info_completed', { hasDates: (d.dates?.length > 0) });
    logEvent('event_create_step_completed', { step: 'name' });
    state.setView('CREATE_EVENT_TYPE');
  },

  // STEP 2・3 は選んだ瞬間に次へ進む（戻れることが前提）。
  // 選択を見せてから遷移したいので、描画を1フレーム挟んでから移動する。
  selectEventType: (id) => {
    state.draftEvent.eventType = id;
    logEvent('event_create_step_completed', { step: 'type', value: id });
    state.render();
    setTimeout(() => state.setView('CREATE_EVENT_SCALE'), 180);
  },
  selectExpectedScale: (id) => {
    state.draftEvent.expectedScale = id;
    logEvent('event_create_step_completed', { step: 'scale', value: id });
    state.render();
    setTimeout(() => state.setView('CREATE_EVENT_DATES'), 180);
  },

  tryProceedFromDates: () => {
    // 開催日は任意。何も選択していなくても進める。
    logEvent('event_create_step_completed', { step: 'dates', count: state.draftEvent.dates?.length || 0 });
    state.setView('CREATE_EVENT_CATCHPHRASE');
  },

  // STEP 5: キャッチコピー。入力のたびに再描画すると入力欄のフォーカスが飛ぶので、
  // state を更新するだけで再描画はしない（プレビューは廃止済み）。
  updateDraftCatchphrase: (v) => {
    state.draftEvent.catchphrase = v;
  },
  useCatchphraseExample: (text) => {
    state.draftEvent.catchphrase = text;
    logEvent('catchphrase_suggestion_used');
    state.render();
  },
  proceedFromCatchphrase: () => {
    state.draftEvent.catchphrase = (state.draftEvent.catchphrase || '').trim();
    // 「次へ」でも空のまま進めるので、入力の有無を props に持たせる
    logEvent('event_create_step_completed', { step: 'catchphrase', filled: !!state.draftEvent.catchphrase });
    state.setView('CREATE_EVENT_MOTIVATION');
  },

  // STEP 6: 意気込み。カード0件・一言なしでも進める。
  toggleMotivationTag: (id) => {
    const d = state.draftEvent;
    const cur = Array.isArray(d.motivationTags) ? d.motivationTags : [];
    d.motivationTags = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    state.render();
  },
  updateDraftMotivationText: (v) => {
    state.draftEvent.motivationText = v;
  },
  proceedFromMotivation: () => {
    state.draftEvent.motivationText = (state.draftEvent.motivationText || '').trim();
    logEvent('event_create_step_completed', {
      step: 'motivation',
      tagCount: state.draftEvent.motivationTags?.length || 0,
      hasText:  !!state.draftEvent.motivationText,
    });
    state.setView('CREATE_EVENT_INVITE');
  },

  // スキップ：その項目の入力を捨てて次へ進む（あとで設定画面から編集できる）
  skipStep: (step) => {
    const d = state.draftEvent;
    logEvent('event_create_step_skipped', { step });
    if (step === 'dates')      { d.dates = [];          state.setView('CREATE_EVENT_CATCHPHRASE'); }
    if (step === 'catchphrase'){ d.catchphrase = '';    state.setView('CREATE_EVENT_MOTIVATION'); }
    if (step === 'motivation') { d.motivationTags = []; d.motivationText = ''; state.setView('CREATE_EVENT_INVITE'); }
  },

  // --- カレンダー ---
  openCalendarModal: (target) => openCalendarModal(target),
  moveCalendarMonth: (offset, target) => moveCalendarMonth(offset, target),

  // --- ミッションモーダル ---
  openMissionModal: (id = null) => openMissionModal(id),
  closeMissionModal: () => closeMissionModal(),
  deleteMission: (e) => deleteMission(e),

  revertMissionToIncomplete: async (missionId) => {
    const ok = await showConfirmDialog({
      message: 'このミッションを未完了に戻しますか？\n完了記録は削除されます。',
      confirmLabel: '未完了に戻す',
      cancelLabel: 'キャンセル',
    });
    if (!ok) return;
    const event = state.events.find(p => p.id === state.selectedEventId);
    if (!event) return;
    const m = event.missions.find(x => x.id === missionId);
    if (!m) return;
    m.status = 'yet';
    m.individualClearedBy = [];
    delete event.clearedData[missionId];
    Object.keys(event.clearedData).forEach(k => {
      if (k.startsWith(missionId + '_u_')) delete event.clearedData[k];
    });
    state.save();
    state.render();
    window._app.showToast('未完了に戻しました');
  },

  deleteMissionFromArchive: async (missionId) => {
    const ok = await showConfirmDialog({
      message: 'このミッションを完全に削除しますか？\nこの操作は元に戻せません。',
      confirmLabel: '削除する',
      cancelLabel: 'キャンセル',
      destructive: true,
    });
    if (!ok) return;
    const event = state.events.find(p => p.id === state.selectedEventId);
    if (!event) return;
    event.missions = event.missions.filter(m => m.id !== missionId);
    delete event.clearedData[missionId];
    Object.keys(event.clearedData).forEach(k => {
      if (k.startsWith(missionId + '_u_')) delete event.clearedData[k];
    });
    state.save();
    state.render();
    window._app.showToast('ミッションを削除しました');
  },

  openArchiveMissionMenu: (e, missionId) => {
    e.stopPropagation();
    const existing = document.getElementById('archive-mission-menu');
    if (existing) {
      const same = existing.dataset.mid === missionId;
      existing.remove();
      if (same) return;
    }
    const triggerEl = e.currentTarget ?? e.target;
    const rect = triggerEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'archive-mission-menu';
    menu.dataset.mid = missionId;
    menu.className = 'c-context-menu c-context-menu--archive u-animate-fade';
    menu.style.top   = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.innerHTML = `
      <button id="amm-copy-link" class="c-context-menu__item">リンクをコピー</button>
      <button id="amm-revert" class="c-context-menu__item">未完了に戻す</button>
      <button id="amm-delete" class="c-context-menu__item c-context-menu__item--danger">削除する</button>`;
    document.body.appendChild(menu);
    document.getElementById('amm-copy-link').onclick = (ev) => {
      ev.stopPropagation(); menu.remove();
      window._app.copyMissionLink(missionId);
    };
    document.getElementById('amm-revert').onclick = (ev) => {
      ev.stopPropagation(); menu.remove();
      window._app.revertMissionToIncomplete(missionId);
    };
    document.getElementById('amm-delete').onclick = (ev) => {
      ev.stopPropagation(); menu.remove();
      window._app.deleteMissionFromArchive(missionId);
    };
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 10);
  },

  forceCloseMission: async (missionId) => {
    const ok = await showConfirmDialog({
      message: 'このミッションを公開終了しますか？\n全員が完了していなくてもアーカイブされます。',
      confirmLabel: '公開終了する',
      cancelLabel: 'キャンセル',
    });
    if (!ok) return;
    const event = state.events.find(p => p.id === state.selectedEventId);
    if (!event) return;
    const m = event.missions.find(x => x.id === missionId);
    if (!m) return;
    m.status = 'cleared';
    if (!event.clearedData[missionId]) {
      event.clearedData[missionId] = { content: '', format: 'text', title: m.title, timestamp: Date.now(), submittedBy: null };
    }
    state.save();
    state.render();
    window._app.showToast('公開終了しました');
  },
  renderMissionModalContent: () => renderMissionModalContent(),
  setMissionTab: (tab) => { state.missionModalTab = tab; renderMissionModalContent(); },
  toggleMissionLabel: (l) => {
    const arr = state.draftMission.labels || [];
    const idx = arr.indexOf(l);
    if (idx >= 0) {
      // 最後の1つは外せない（必ず1つはラベルを持つ）
      if (arr.length > 1) arr.splice(idx, 1);
    } else {
      arr.push(l);
    }
    state.draftMission.labels = arr;
    renderMissionModalContent();
  },

  // --- カスタムタグ追加ボトムシート ---
  openTagCreator:  () => openTagCreator(),
  closeTagCreator: () => closeTagCreator(),
  setMissionPriority: (v) => { state.draftMission.priority = v; renderMissionModalContent(); },

  // --- チェック項目 ---
  addChecklistItem: () => {
    if (!Array.isArray(state.draftMission.checklist)) state.draftMission.checklist = [];
    state.draftMission.checklist.push('');
    renderMissionModalContent();
    // 追加した行の input にフォーカス
    setTimeout(() => {
      const inputs = document.querySelectorAll('[data-cl-input]');
      inputs[inputs.length - 1]?.focus();
    }, 30);
  },
  updateChecklistItem: (i, value) => {
    if (!Array.isArray(state.draftMission.checklist)) return;
    state.draftMission.checklist[i] = value;
    // 再描画しない（input フォーカスを保持するため）
  },
  removeChecklistItem: (i) => {
    if (!Array.isArray(state.draftMission.checklist)) return;
    state.draftMission.checklist.splice(i, 1);
    renderMissionModalContent();
  },

  // --- 担当の申告制 ---
  toggleMissionSelfClaim: () => {
    state.draftMission.selfClaim = !state.draftMission.selfClaim;
    if (state.draftMission.selfClaim) {
      state.draftMission.assignee = null;
      // 常に「選定あり」モードに固定
      state.draftMission.claimMode = 'selection';
    }
    renderMissionModalContent();
  },
  setMissionClaimDeadline: (value) => {
    // datetime-local の文字列 → タイムスタンプ
    if (!value) {
      state.draftMission.claimDeadline = null;
    } else {
      const t = new Date(value).getTime();
      state.draftMission.claimDeadline = isNaN(t) ? null : t;
    }
    renderMissionModalContent();
  },
  toggleMissionLeaderCheck: () => {
    state.draftMission.leaderCheck = !state.draftMission.leaderCheck;
    renderMissionModalContent();
  },
  toggleMissionAnnounce: () => {
    state.draftMission.announce = !state.draftMission.announce;
    renderMissionModalContent();
  },
  toggleMissionNoInput: () => {
    state.draftMission.noInput = !state.draftMission.noInput;
    renderMissionModalContent();
  },
  toggleMissionIndividualClear: () => {
    state.draftMission.individualClear = !state.draftMission.individualClear;
    renderMissionModalContent();
  },
  // --- ミッション自己申告（メインボードの「やる」ボタンから）---
  claimMissionAsSelf: async (missionId) => {
    const eventId = state.selectedEventId;
    if (!eventId) return;
    const r = await api.claimMission(eventId, missionId);
    if (r.ok) {
      // ローカル更新
      const p = state.events.find(x => x.id === eventId);
      const m = p?.missions.find(x => x.id === missionId);
      if (m) m.assignee = { type: 'user', userId: state.currentUser.id };
      state.render();
    } else {
      window._app?.showToast(r.error || '申告に失敗しました', 'error');
    }
  },
  unclaimMissionAsSelf: async (missionId) => {
    const eventId = state.selectedEventId;
    if (!eventId) return;
    const ok = await showConfirmDialog({
      message: '応募を取り消しますか？',
      confirmLabel: '取り消す',
      cancelLabel: 'キャンセル',
    });
    if (!ok) return;
    const r = await api.unclaimMission(eventId, missionId);
    if (r.ok) {
      await state.silentReloadEvents();
      state.render();
    } else {
      window._app.showToast(r.error || '取り消しに失敗しました');
    }
  },

  // --- 申告制（選定あり）：選定モーダルを開く ---
  openSelectClaimModal: (missionId) => {
    openSelectClaimModal(missionId);
  },
  submitSelectClaims: async (missionId) => {
    const eventId = state.selectedEventId;
    if (!eventId) return;
    const selected = Array.from(document.querySelectorAll('[data-select-claim]:checked')).map(el => el.value);
    if (selected.length === 0) {
      window._app?.showToast('1名以上選んでください', 'error');
      return;
    }
    const r = await api.selectMissionClaims(eventId, missionId, selected);
    if (r.ok) {
      document.getElementById('select-claim-overlay')?.remove();
      await state.silentReloadEvents();
      state.render();
    } else {
      window._app?.showToast(r.error || '選定に失敗しました', 'error');
    }
  },

  // --- リーダーチェック：承認 / 差し戻し ---
  approveMission: async (missionId) => {
    const eventId = state.selectedEventId;
    if (!eventId) return;
    const r = await api.approveMission(eventId, missionId);
    if (r.ok) {
      const p = state.events.find(x => x.id === eventId);
      const m = p?.missions.find(x => x.id === missionId);
      if (m) m.status = 'cleared';
      _showToast('ミッション確認完了');
      _removeLeaderCheckCard(missionId);
    } else {
      window._app?.showToast(r.error || '承認に失敗しました', 'error');
    }
  },
  rejectMission: async (missionId) => {
    const eventId = state.selectedEventId;
    if (!eventId) return;
    // confirm() → ダイアログ
    const confirmOverlay = document.createElement('div');
    confirmOverlay.className = 'c-overlay c-overlay--reject c-overlay--blur';
    confirmOverlay.onclick = (e) => { if (e.target === confirmOverlay) confirmOverlay.remove(); };
    confirmOverlay.innerHTML = `
      <div class="c-modal u-animate-fade">
        <h3 class="c-modal__title">差し戻しますか？</h3>
        <p class="c-modal__text">提出内容は破棄されます。</p>
        <div class="c-modal__actions">
          <button data-action="cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
          <button data-action="confirm" class="c-button c-button--danger c-modal__button">差し戻す</button>
        </div>
      </div>`;
    document.body.appendChild(confirmOverlay);
    confirmOverlay.querySelector('[data-action="cancel"]').onclick = () => confirmOverlay.remove();
    confirmOverlay.querySelector('[data-action="confirm"]').onclick = async () => {
      confirmOverlay.remove();
      const r = await api.rejectMission(eventId, missionId);
      if (r.ok) {
        const p = state.events.find(x => x.id === eventId);
        const m = p?.missions.find(x => x.id === missionId);
        if (m) m.status = 'yet';
        if (p?.clearedData?.[missionId]) delete p.clearedData[missionId];
        _showToast('差し戻しました');
        _removeLeaderCheckCard(missionId);
      } else {
        window._app?.showToast(r.error || '差し戻しに失敗しました', 'error');
      }
    };
  },

  // --- 通知 ---
  openNotification: async (notifId, missionId) => {
    // 既読化
    api.markNotificationRead(notifId);
    const n = state.notifications.find(x => x.id === notifId);
    if (n) n.read = true;
    // チャット通知はミッション詳細ページへ（戻るで通知タブに復帰）
    if (n?.type === 'chat_message' && missionId) {
      const p = state.events.find(x => x.id === state.selectedEventId);
      if (p?.missions?.some(m => m.id === missionId)) {
        state.openMissionDetail(missionId);
        return;
      }
    }
    // ミッションがあるならメインタブへ
    if (missionId) state.mainBoardTab = 'MAIN';
    state.render();
  },
  markAllNotificationsRead: async () => {
    // 表示中のイベントの通知だけ既読にする（一覧の表示と整合）
    const evId = state.selectedEventId;
    await api.markAllNotificationsRead(evId);
    state.notifications.forEach(n => { if (n.eventId === evId) n.read = true; });
    state.render();
  },
  deleteNotification: async (notifId) => {
    await api.deleteNotification(notifId);
    state.notifications = (state.notifications || []).filter(n => n.id !== notifId);
    state.render();
  },
  createOrUpdateMission: () => {
    const titleInput = document.getElementById('mission-title-input');
    const errorText  = document.getElementById('error-title');

    if (!state.draftMission.title) {
      if (titleInput) titleInput.style.borderColor = '#e8383d';
      if (errorText)  errorText.classList.remove('u-hidden');
      return;
    }

    const event = state.events.find(p => p.id === state.selectedEventId);
    if (state.editingMissionId) {
      const idx = event.missions.findIndex(m => m.id === state.editingMissionId);
      if (idx > -1) {
        event.missions[idx] = {
          ...event.missions[idx],
          title: state.draftMission.title,
          tag: state.draftMission.labels[0],
          tags: [...(state.draftMission.labels || [])],
          dates: [...state.draftMission.dates],
          priority: state.draftMission.priority,
          // 申告制 ON の場合、作成画面で指定した担当は無視（メンバーの申告で再設定）
          assignee:  state.draftMission.selfClaim ? null : (state.draftMission.assignee || null),
          assignees: state.draftMission.selfClaim ? [] : (state.draftMission.assignees || []),
          checklist: _cleanChecklist(state.draftMission.checklist),
          description: String(state.draftMission.description || ''),
          selfClaim: !!state.draftMission.selfClaim,
          leaderCheck: !!state.draftMission.leaderCheck,
          claimMode: 'selection',
          claimDeadline: (state.draftMission.selfClaim && state.draftMission.claimDeadline) ? state.draftMission.claimDeadline : null,
          announce: !!state.draftMission.announce,
          announceText: state.draftMission.announce ? (state.draftMission.announceText || '') : '',
          noInput: !!state.draftMission.noInput,
          individualClear: !!state.draftMission.individualClear,
        };
      }
    } else {
      // 提案から開いた場合は採用元の id / 完了フォーマットを引き継ぐ（説明は draft.description 経由で反映済み）
      const fromPid = state.draftMission._fromProposalId || null;
      const newMission = {
        id: Date.now().toString(),
        title: state.draftMission.title,
        tag: state.draftMission.labels[0],
        tags: [...(state.draftMission.labels || [])],
        daysLeft: 7,
        dates: [...state.draftMission.dates],
        status: 'yet',
        isDeletable: true,
        createdAt: Date.now(),
        createdBy: state.currentUser?.id ?? null,
        priority: state.draftMission.priority,
        assignee:  state.draftMission.selfClaim ? null : (state.draftMission.assignee || null),
        assignees: state.draftMission.selfClaim ? [] : (state.draftMission.assignees || []),
        checklist: _cleanChecklist(state.draftMission.checklist),
        description: String(state.draftMission.description || ''),
        selfClaim: !!state.draftMission.selfClaim,
        leaderCheck: !!state.draftMission.leaderCheck,
        claimMode: 'selection',
        claimDeadline: (state.draftMission.selfClaim && state.draftMission.claimDeadline) ? state.draftMission.claimDeadline : null,
        claimApplicants: [],
        claimClosed: false,
        announce: !!state.draftMission.announce,
        announceText: state.draftMission.announce ? (state.draftMission.announceText || '') : '',
        noInput: !!state.draftMission.noInput,
        individualClear: !!state.draftMission.individualClear,
        individualClearedBy: [],
      };
      if (fromPid) {
        newMission.originProposalId = fromPid;
        newMission.clearFormat = state.draftMission._fromProposalFmt || 'text';
      }
      event.missions.push(newMission);
      // 採用元の提案を消す（作成が確定したときのみ。キャンセル時は残る）
      if (fromPid) {
        event.proposals = (event.proposals || []).filter(x => x.id !== fromPid);
        if (event.proposals.length === 0) event.lastProposalClearedTime = Date.now();
        logEvent('proposal_accepted', { proposalId: fromPid, tag: state.draftMission.labels?.[0] });
      }
    }
    if (state.editingMissionId) {
      logEvent('mission_edited', { tag: state.draftMission.labels?.[0] });
    } else {
      logEvent('mission_created', {
        tag:         state.draftMission.labels?.[0],
        priority:    state.draftMission.priority,
        hasDeadline: (state.draftMission.dates?.length > 0),
      });
    }
    const isNew = !state.editingMissionId;
    state.save();
    closeMissionModal();
    state.render();
    _showToast(isNew ? 'ミッション作成' : 'ミッション更新');
  },

  // --- 提案 ---
  addProposalToMission: (pid) => addProposalToMission(pid),
  showProposalHelp: (e, pid) => showProposalHelp(e, pid),

  // --- ミッションリスト操作 ---
  toggleMissionMenu: (e, mid) => toggleMissionMenu(e, mid),
  toggleSortMenu: (e) => toggleSortMenu(e),
  showMissionListModal: () => showMissionListModal(),
  // アナウンスが2件以上のときの「他N件を見る」。開閉状態は mainBoard.js の
  // モジュール変数が持つので、SSE の再描画では畳まれない
  toggleAnnounceList: () => toggleAnnounceList(),
  changeMissionSort: (mode) => changeMissionSort(mode),

  // --- ミッション詳細ページ ---
  openMissionDetail:  (mid) => state.openMissionDetail(mid),
  closeMissionDetail: ()    => state.closeMissionDetail(),
  copyMissionLink:    (mid) => copyMissionLink(mid),
  sendChatMessage:    ()    => sendChatMessage(),
  deleteChatMessage:  (msgId) => deleteChatMessage(msgId),
  toggleChatReaction: (msgId, emoji) => toggleChatReaction(msgId, emoji),
  openChatEmojiPicker: (msgId) => openChatEmojiPicker(msgId),
  cancelChatReply: () => cancelChatReply(),

  // --- ミッション完了 ---
  submitMissionClear: (mid) => submitMissionClear(mid),
  handleImageSelect:  (input) => handleImageSelect(input),
  clearImagePreview:  ()      => clearImagePreview(),

  // --- アーカイブ編集 ---
  editArchiveItem: (type) => editArchiveItem(type),

  // --- 承認待ちメンバー：ロール割り当て承認シート（管理者）---
  openPendingMembersSheet: () => {
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (!p) return;
    const pending = p.pendingMembers || [];
    // オーナー除外・デフォルトは admin + member を含む
    const roles = (p.roles || [
      { id: 'admin',  name: '管理者',   canManage: true  },
      { id: 'member', name: 'メンバー', canManage: false },
    ]).filter(r => r.id !== 'owner');

    // ── シートが既に開いている場合はリアルタイム追加のみ ──
    const existingOverlay = document.getElementById('pending-members-sheet');
    if (existingOverlay) {
      const shownUIDs = new Set(
        [...existingOverlay.querySelectorAll('[data-pending-uid]')].map(el => el.dataset.pendingUid)
      );
      const list     = existingOverlay.querySelector('#pending-members-list');
      const countEl  = existingOverlay.querySelector('#pending-members-count');
      const newItems = pending.filter(m => !shownUIDs.has(m.userId));
      if (newItems.length === 0) return;
      // 空メッセージを消す
      list?.querySelector('p')?.remove();
      newItems.forEach(m => {
        const card = document.createElement('div');
        card.dataset.pendingUid = m.userId;
        card.className = 'c-list-sheet__card u-animate-fade';
        card.innerHTML = `
          <div class="p-member-manage__card-head">
            <div class="p-member-manage__card-user">
              <div class="p-member-manage__avatar">
                ${_escH((m.username || '?').charAt(0).toUpperCase())}
              </div>
              <p class="p-member-manage__username">@${_escH(m.username)}</p>
            </div>
            <div class="p-member-manage__card-actions">
              <button data-reject-pending="${_escH(m.userId)}"
                class="c-button c-button--muted">拒否</button>
              <button data-approve-pending="${_escH(m.userId)}" data-username="${_escH(m.username)}"
                class="c-button c-button--primary">承認</button>
            </div>
          </div>
          ${_pendingAnswersHtml(m)}`;
        list?.prepend(card);
        // 拒否ハンドラ（既存の _removeCard を呼ぶため、ここでは直接処理）
        card.querySelector('[data-reject-pending]').addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const r = await api.rejectPendingMember(state.selectedEventId, m.userId);
          if (r.ok) {
            card.remove();
            const proj = state.events.find(x => x.id === state.selectedEventId);
            if (proj) proj.pendingMembers = (proj.pendingMembers || []).filter(x => x.userId !== m.userId);
            const remaining = existingOverlay.querySelectorAll('[data-pending-uid]').length;
            if (remaining === 0) { existingOverlay.remove(); state.render(); }
            else if (countEl) countEl.textContent = `参加申請（${remaining}件）`;
          } else { window._app?.showToast(r.error || '失敗しました', 'error'); }
        });
        // 承認ハンドラは後段の共通関数で後付け（既存ロジックと同じなので再呼出し）
        card.querySelector('[data-approve-pending]').addEventListener('click', (ev) => {
          ev.stopPropagation();
          _openApproveModal(m.userId, m.username, roles, (uid) => {
            card.remove();
            const proj = state.events.find(x => x.id === state.selectedEventId);
            if (proj) proj.pendingMembers = (proj.pendingMembers || []).filter(x => x.userId !== uid);
            const remaining = existingOverlay.querySelectorAll('[data-pending-uid]').length;
            if (remaining === 0) { existingOverlay.remove(); state.render(); }
            else if (countEl) countEl.textContent = `参加申請（${remaining}件）`;
          });
        });
      });
      const total = existingOverlay.querySelectorAll('[data-pending-uid]').length;
      if (countEl) countEl.textContent = `参加申請（${total}件）`;
      return;
    }

    // ── 新規シート作成 ──
    const overlay = document.createElement('div');
    overlay.id = 'pending-members-sheet';
    overlay.className = 'c-overlay c-overlay--pending c-overlay--blur';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const rows = pending.map(m => `
      <div data-pending-uid="${_escH(m.userId)}" class="c-list-sheet__card">
          <div class="p-member-manage__card-head">
            <div class="p-member-manage__card-user">
              <div class="p-member-manage__avatar">
                ${_escH((m.username || '?').charAt(0).toUpperCase())}
              </div>
              <p class="p-member-manage__username">@${_escH(m.username)}</p>
            </div>
            <div class="p-member-manage__card-actions">
              <button data-reject-pending="${_escH(m.userId)}"
                class="c-button c-button--muted">拒否</button>
              <button data-approve-pending="${_escH(m.userId)}" data-username="${_escH(m.username)}"
                class="c-button c-button--primary">承認</button>
            </div>
          </div>
        ${_pendingAnswersHtml(m)}
      </div>`).join('');

    overlay.innerHTML = `
      <div data-sheet class="c-list-sheet c-list-sheet--capped u-animate-fade">
        <div id="pending-sheet-header" data-sheet-handle class="c-list-sheet__head">
          <div class="c-list-sheet__grip"></div>
          <h3 id="pending-members-count" class="c-list-sheet__title">参加申請（${pending.length}件）</h3>
        </div>
        <div id="pending-members-list" class="c-list-sheet__body">
          ${rows || '<p class="c-list-sheet__empty text-rs">申請はありません</p>'}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 下スワイプで閉じる → sheet.js（data-sheet / data-sheet-handle）が処理

    // カードを1枚削除してカウントを更新。残りゼロならシートを閉じる
    function _removeCard(uid) {
      const card = overlay.querySelector(`[data-pending-uid="${uid}"]`);
      if (card) card.remove();
      const proj = state.events.find(x => x.id === state.selectedEventId);
      if (proj) proj.pendingMembers = (proj.pendingMembers || []).filter(x => x.userId !== uid);
      const remaining = overlay.querySelectorAll('[data-pending-uid]').length;
      const countEl   = overlay.querySelector('#pending-members-count');
      if (remaining === 0) {
        overlay.remove();
        state.render();
      } else {
        if (countEl) countEl.textContent = `参加申請（${remaining}件）`;
      }
    }

    // 拒否
    overlay.querySelectorAll('[data-reject-pending]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const uid = btn.dataset.rejectPending;
        const r = await api.rejectPendingMember(state.selectedEventId, uid);
        if (r.ok) { _removeCard(uid); }
        else { window._app?.showToast(r.error || '失敗しました', 'error'); }
      });
    });

    // 承認 → ロール設定モーダル（共通ヘルパーに委譲）
    overlay.querySelectorAll('[data-approve-pending]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _openApproveModal(
          btn.dataset.approvePending,
          btn.dataset.username || '?',
          roles,
          (uid) => _removeCard(uid)
        );
      });
    });
  },

  // --- メンバー提案：送信シート（一般ユーザー）---
  openMemberProposalSheet: () => {
    const overlay = document.createElement('div');
    overlay.id = 'member-proposal-sheet';
    overlay.className = 'c-overlay c-overlay--pending c-overlay--blur';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div data-sheet class="c-list-sheet c-list-sheet--form u-animate-fade">
        <div data-sheet-handle class="c-list-sheet__handle"><div class="c-sheet__grip"></div></div>
        <h3 class="c-list-sheet__title">ミッションを提案する</h3>
        <textarea id="member-proposal-input" rows="4"
          placeholder="ミッション名を入力してください"
          class="p-archive__edit-input"></textarea>
        <button id="member-proposal-submit"
          class="c-button c-button--success p-member-proposal__submit">提案する</button>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('member-proposal-submit').onclick = async () => {
      const text = document.getElementById('member-proposal-input')?.value?.trim();
      if (!text) { window._app?.showToast('ミッション名を入力してください', 'error'); return; }
      const eventId = state.selectedEventId;
      const btn = document.getElementById('member-proposal-submit');
      if (btn) { btn.disabled = true; btn.textContent = '送信中…'; }
      const r = await api.submitMemberProposal(eventId, text);
      if (r.ok) {
        overlay.remove();
      } else {
        // 失敗時はモーダルを残してボタンをリセット → ユーザーが再試行できる
        if (btn) { btn.disabled = false; btn.textContent = '提案する'; }
        window._app?.showToast(r.error || '提案の送信に失敗しました', 'error');
      }
    };
  },

  // --- メンバー提案：レビューシート（管理者）---
  openMemberProposalsSheet: () => {
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (!p) return;
    const proposals = p.memberProposals || [];

    const overlay = document.createElement('div');
    overlay.id = 'member-proposals-review-sheet';
    overlay.className = 'c-overlay c-overlay--pending c-overlay--blur';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const rows = proposals.map(pr => `
      <div class="c-list-sheet__card">
        <p class="c-list-sheet__card-meta">@${_escH(pr.proposedByName)}</p>
        <p class="c-list-sheet__card-title c-list-sheet__card-title--roomy">${_escH(pr.text)}</p>
        <div class="c-list-sheet__card-actions">
          <button data-reject="${_escH(pr.id)}" class="c-button c-button--muted">拒否</button>
          <button data-accept="${_escH(pr.id)}" class="c-button c-button--success">受理</button>
        </div>
      </div>`).join('');

    overlay.innerHTML = `
      <div data-sheet class="c-list-sheet c-list-sheet--scroll u-animate-fade">
        <div data-sheet-handle class="c-list-sheet__handle"><div class="c-sheet__grip"></div></div>
        <h3 class="c-list-sheet__title">ミッションの提案（${proposals.length}件）</h3>
        ${rows || '<p class="c-list-sheet__empty c-list-sheet__empty--tight text-rs">提案はありません</p>'}
      </div>`;
    document.body.appendChild(overlay);

    // 拒否ボタン
    overlay.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const pid = btn.dataset.reject;
        const r = await api.deleteMemberProposal(state.selectedEventId, pid);
        if (r.ok) {
          const proj = state.events.find(x => x.id === state.selectedEventId);
          if (proj) proj.memberProposals = (proj.memberProposals || []).filter(x => x.id !== pid);
          overlay.remove();
          state.render();
        } else {
          window._app?.showToast(r.error || '失敗しました', 'error');
        }
      });
    });

    // 受理ボタン
    overlay.querySelectorAll('[data-accept]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const pid  = btn.dataset.accept;
        const text = proposals.find(x => x.id === pid)?.text || '';
        const r    = await api.deleteMemberProposal(state.selectedEventId, pid);
        if (r.ok) {
          const proj = state.events.find(x => x.id === state.selectedEventId);
          if (proj) proj.memberProposals = (proj.memberProposals || []).filter(x => x.id !== pid);
          overlay.remove();
          state.render();
          // ミッション作成モーダルを開き、提案テキストをタイトルに pre-fill
          openMissionModal(null);
          state.draftMission.title = text;
          renderMissionModalContent();
        } else {
          window._app?.showToast(r.error || '失敗しました', 'error');
        }
      });
    });
  },

  // --- インフォメーションモーダル（管理者向け・イベント入室時に1回表示）---
  checkAndShowInfoModal: () => {
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (!p || !state.canManageCurrentEvent()) return;
    // 既にこのイベントで表示済みなら何もしない
    if (state._infoModalShownForEvent === p.id) return;
    // モーダルが既に開いていたら何もしない
    if (document.getElementById('info-modal-overlay')) return;
    // ★ミッションを作成・編集している最中には割り込まない。
    //   入力途中に全画面モーダルの上から別のモーダルが出ると、書きかけが
    //   見えなくなるうえ「表示済み」の印が付いて二度と出なくなる。
    //   フラグを立てずに帰るので、モーダルを閉じた次の render() で再判定される。
    if (document.getElementById('mission-overlay')) return;

    // 優先度順に確認
    const pendingMembers = p.pendingMembers || [];
    const claimMissions  = (p.missions || []).filter(m =>
      m.selfClaim && m.status !== 'cleared' && m.status !== 'pending_leader_check' &&
      Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
      !(Array.isArray(m.assignees) && m.assignees.length > 0)
    );
    const leaderMissions = (p.missions || []).filter(m => m.status === 'pending_leader_check');
    const proposals      = p.memberProposals || [];

    let config = null;
    if (pendingMembers.length > 0) {
      config = {
        icon: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>`,
        color: '#F5B600', bgColor: '#FFF8E1',
        title: '参加申請が届いています',
        desc:  `${pendingMembers.length}件の参加申請があります。承認または拒否してください。`,
        action: '承認リストを開く',
        onAction: () => window._app.openPendingMembersSheet(),
      };
    } else if (claimMissions.length > 0) {
      config = {
        icon: `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`,
        color: '#209DDB', bgColor: '#E8F7FD',
        title: '担当申請があります',
        desc:  `${claimMissions.length}件のミッションに担当申請が届いています。`,
        action: '通知タブで確認する',
        onAction: () => { state.mainBoardTab = 'NOTIFICATIONS'; state.render(); },
      };
    } else if (leaderMissions.length > 0) {
      config = {
        icon: `<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`,
        color: '#EE3E12', bgColor: '#FFF0ED',
        title: 'リーダーチェック待ちがあります',
        desc:  `${leaderMissions.length}件のミッションが承認待ちです。`,
        action: '確認リストを開く',
        onAction: () => window._app.openLeaderCheckSheet(),
      };
    } else if (proposals.length > 0) {
      config = {
        icon: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
        color: '#28AB3D', bgColor: '#ECF9F2',
        title: 'ミッション提案が届いています',
        desc:  `${proposals.length}件の提案があります。確認してください。`,
        action: '提案を確認する',
        onAction: () => window._app.openMemberProposalsSheet(),
      };
    }

    if (!config) return;

    // 表示済みとしてマーク
    state._infoModalShownForEvent = p.id;

    const overlay = document.createElement('div');
    overlay.id = 'info-modal-overlay';
    overlay.className = 'c-overlay c-overlay--auto c-overlay--center c-overlay--blur';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="c-modal u-animate-fade">
        <div class="c-modal__icon" style="--icon-bg:${_escH(config.bgColor)}">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${_escH(config.color)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            ${config.icon}
          </svg>
        </div>
        <h3 class="c-modal__title">${_escH(config.title)}</h3>
        <p class="c-modal__text">${_escH(config.desc)}</p>
        <div class="c-modal__actions">
          <button data-action="skip" class="c-button c-button--secondary c-modal__button">スキップ</button>
          <button data-action="go" class="c-modal__button c-modal__button--accent c-modal__button--shadow"
            style="--accent:${_escH(config.color)}">${_escH(config.action)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('[data-action="skip"]').onclick = () => overlay.remove();
    overlay.querySelector('[data-action="go"]').onclick = () => {
      overlay.remove();
      config.onAction();
    };
  },

  // --- 目的リマインドモーダル（全メンバー向け）---
  checkPurposeReminderModal: () => checkPurposeReminderModal(),
  // 参加直後にリーダーの意気込みを見せて🔥を送れるようにする（表示可否はモーダル側が判定）
  checkLeaderMotivationModal: () => checkLeaderMotivationModal(),
  // オンボーディング（表示可否・優先度は onboarding.js が判定する）
  checkOnboarding: () => checkOnboarding(),
  // 初期オンボーディング（イベント作成直後のチュートリアル）
  checkIntro: () => checkIntro(),
  openUserProfileModal: (userId) => openUserProfileModal(userId),
  copySchedule: (source) => copySchedule(source),
  openReflectionEdit: (missionId) => openReflectionEditModal(missionId),
  // アーカイブのサブページ（参加時の回答／みんなの活躍）
  // ★戻り先は必ずアーカイブタブ。setView('MAIN_BOARD') だけだと直前に見ていた
  //   タブ（メイン等）に戻ってしまい、どこから来たのか分からなくなる。
  openArchiveAnswers: () => { state.setView('ARCHIVE_ANSWERS', state.selectedEventId); },
  openArchiveStats:   () => { state.setView('ARCHIVE_STATS',   state.selectedEventId); },
  backToArchive: () => {
    state.mainBoardTab = 'ARCHIVE';
    state.setView('MAIN_BOARD', state.selectedEventId);
  },
  // ★イベントページを離れるとき state.setView から呼ばれる。表示だけ畳み、
  //   進行状態は残すので、戻ってきたら同じ段階から再開する。
  abortIntroVisuals: () => abortIntroVisuals(),
  openLeaderMotivationModal:  () => openLeaderMotivationModal(),

  // --- 開催日リマインドモーダル（全メンバー向け・初日/最終日翌日）---
  checkEventDateReminderModal: () => checkEventDateReminderModal(),

  // --- 開発者からのお知らせモーダル（全ユーザー向け）---
  checkDeveloperAnnouncementModal: () => checkDeveloperAnnouncementModal(),
  // ★暫定：既存メンバーのスキル回収。回収が済んだらこの行ごと削除する
  checkSkillCollectModal: () => checkSkillCollectModal(),

  // --- リーダーチェック：確認ボトムシート（管理者）---
  openLeaderCheckSheet: () => {
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (!p) return;
    const missions = (p.missions || []).filter(m => m.status === 'pending_leader_check');

    const overlay = document.createElement('div');
    overlay.id = 'leader-check-sheet';
    overlay.className = 'c-overlay c-overlay--pending c-overlay--blur';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const rows = missions.map(m => {
      const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
      const cd = p.clearedData?.[m.id];
      let previewHtml = '';
      if (cd?.content) {
        if (cd.format === 'image') {
          previewHtml = `<img src="${_escH(cd.content)}" class="c-list-sheet__preview-image" loading="lazy">`;
        } else {
          previewHtml = `<p class="c-list-sheet__preview-text">${_escH(cd.content)}</p>`;
        }
      }
      return `
        <div data-leader-check-id="${_escH(m.id)}" class="c-list-sheet__card">
          <div class="c-list-sheet__chips">${tagNames.map(t => `<span class="c-list-sheet__chip">${_escH(t)}</span>`).join('')}</div>
          <p class="c-list-sheet__card-title">${_escH(m.title)}</p>
          ${previewHtml}
          <div class="c-list-sheet__card-actions">
            <button data-lc-reject="${_escH(m.id)}" class="c-button c-button--muted">差し戻す</button>
            <button data-lc-approve="${_escH(m.id)}" class="c-button c-button--danger">確認完了</button>
          </div>
        </div>`;
    }).join('');

    overlay.innerHTML = `
      <div data-sheet class="c-list-sheet c-list-sheet--tall u-animate-fade">
        <div data-sheet-handle class="c-list-sheet__head">
          <div class="c-list-sheet__grip"></div>
          <h3 id="leader-check-count" class="c-list-sheet__title">リーダーチェック（${missions.length}件）</h3>
        </div>
        <div id="leader-check-list" class="c-list-sheet__body">
          ${rows || '<p class="c-list-sheet__empty text-rs">確認待ちはありません</p>'}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 確認完了
    overlay.querySelectorAll('[data-lc-approve]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await window._app.approveMission(btn.dataset.lcApprove);
      });
    });

    // 差し戻し
    overlay.querySelectorAll('[data-lc-reject]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await window._app.rejectMission(btn.dataset.lcReject);
      });
    });
  },

  // --- トースト公開（helpers.js など他モジュールから呼べるよう）---
  showToast: (msg) => _showToast(msg),

  // --- ミッション表示モード切替（全て / 私のみ）---
  setMissionViewMode: (mode) => {
    state.missionViewMode = mode;
    state.missionFilterTag = null; // タグフィルタはリセット
    state.render();
  },

  // --- ミッション絞り込みタグ変更 ---
  setMissionFilterTag: (tag) => {
    state.missionFilterTag = tag || null;
    state.render();
  },

  // --- アーカイブ表示モード変更 ---
  setArchiveDisplayMode: (mode) => {
    state.archiveDisplayMode = mode || 'label';
    state.render();
  },

  // --- アーカイブ セクション折りたたみ（DOM直接操作でre-renderを避ける）---
  toggleArchiveSection: (tag) => {
    if (!state.archiveCollapsed) state.archiveCollapsed = {};
    state.archiveCollapsed[tag] = !state.archiveCollapsed[tag];
    const section = document.querySelector(`[data-archive-section="${tag}"]`);
    if (!section) return;
    // ★開閉はセクションの is-collapsed 1つで決まる（本体の display と矢印の回転は
    //   object/project/_archive.css が受け持つ）。以前は body と arrow に
    //   インライン style を書いており、初期描画のクラスと二重管理になっていた。
    section.classList.toggle('is-collapsed', !!state.archiveCollapsed[tag]);
  },

  // --- いいね ---
  handleGoodClick: (e) => handleGoodClick(e),

  // --- イベント作成フォーム ---
  updateDraftInfo: (field, value) => updateDraftInfo(field, value),

  // --- イベント操作（長押しメニューから呼ばれる）---
  leaveEvent:  (id) => state.leaveEvent(id),

  // --- ホームタブ切替 ---
  setHomeTab: (tab) => {
    state.homeTab = tab;
    state.render();
  },

  // --- Web Push（アカウント画面の通知設定から呼ぶ）---
  // enablePush は必ずユーザーのタップ起点で呼ぶこと（iOS で無反応になる）
  enablePush:     () => enablePush(),
  disablePush:    () => disablePush(),
  getPushState:   () => getPushState(),
  hasSubscription: () => hasSubscription(),

  // --- プロジェクト（フォルダ）操作 ---
  openNewProjectModal: (pendingEventId = null) => _openNewProjectModal(pendingEventId),
  openNewProjectModalForEvent: (eventId) => _openNewProjectModal(eventId),
  openProjectMenu: (folderId) => _openProjectMenu(folderId),
  openEventLogSheet: () => _openEventLogSheet(),

  // プロジェクト詳細から「+ 新規イベント作成」
  createEventInFolder: (folderId) => {
    state.selectedFolderId = folderId;
    state.resetDraftEvent();
    state.setView('CREATE_EVENT_INFO');
  },

  // --- 招待参加確認モーダル ---
  openJoinEventModal: (eventName, inviteToken) => {
    document.getElementById('join-event-confirm-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'join-event-confirm-modal';
    overlay.className = 'c-overlay c-overlay--join c-overlay--blur';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="c-modal u-animate-fade">
        <p class="p-app-shell__join-emoji">🎉</p>
        <h3 class="c-modal__title">イベントに参加する</h3>
        <p id="jec-catch" class="p-app-shell__join-catch u-hidden"></p>
        <p class="p-app-shell__join-name">「${_escH(eventName || 'イベント')}」</p>
        <p class="p-app-shell__join-note">への参加を申請しますか？<br>管理者の承認後に参加できます。</p>
        <!-- 参加中メンバー＋リーダーの意気込み（招待プレビューを取得できたときだけ差し込む） -->
        <div id="jec-motivation" class="p-app-shell__join-motivation"></div>
        <div class="c-modal__actions">
          <button id="jec-cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
          <button id="jec-confirm" class="c-button c-button--primary c-modal__button c-modal__button--shadow">次へ</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // メンバー・意気込み・キャッチコピーは招待プレビューから後追いで差し込む。
    // 取得に失敗しても参加フロー自体は従来どおり動く（表示が増えないだけ）。
    // ここで得た invite は参加申請フォームにも渡す（再取得しない）。
    let previewCtx = null;
    _hydrateJoinModalMotivation(inviteToken).then(ctx => { previewCtx = ctx; });

    document.getElementById('jec-cancel').onclick = () => overlay.remove();
    // ★ここでは accept を呼ばない。参加申請フォーム（入口A・B共通）へ渡し、
    //   フォームの送信ボタンが accept を呼ぶ。
    document.getElementById('jec-confirm').onclick = () => {
      overlay.remove();
      openJoinFormModal({
        invite: previewCtx || { eventName },
        token:  inviteToken,
        entry:  'invite_link',
        // 招待プレビューを渡して、承認待ちカード（M0）で見せる
        onDone: (r) => _afterJoinAccepted(r, eventName, previewCtx),
      });
    };
  },

  // --- 認証 ---
  requireVerification: () => {
    // 「+作成」ボタンを押した時など → 認証モーダルを直接開く
    openVerifyEmailModal();
  },
  openVerifyModal: () => openVerifyEmailModal(),

  // --- ユーザーメニュー（ヘッダーのユーザー名タップ）---
  toggleUserMenu: (e) => {
    e.stopPropagation();
    let menu = document.getElementById('user-menu-popover');
    if (menu) { menu.remove(); return; }
    const btn  = document.getElementById('user-menu-btn');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    menu = document.createElement('div');
    menu.id = 'user-menu-popover';
    menu.className = 'p-app-shell__user-menu u-animate-fade';
    menu.style.top  = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    menu.style.minWidth = '160px';
    menu.innerHTML = `
      <div class="p-app-shell__user-head">
        <p class="p-app-shell__user-caption">ログイン中</p>
        <p class="p-app-shell__user-name">${_escH((state.currentUser?.username) || '')}</p>
      </div>
      <button id="user-menu-join" class="p-app-shell__user-item">
        イベントに参加する
      </button>
      <button id="user-menu-account" class="p-app-shell__user-item p-app-shell__user-item--divided">
        アカウント設定
      </button>
      <button id="user-menu-logout" class="p-app-shell__user-item p-app-shell__user-item--divided p-app-shell__user-item--danger">
        ログアウト
      </button>`;
    document.body.appendChild(menu);
    document.getElementById('user-menu-join').onclick = () => {
      menu.remove();
      openJoinByCodeModal();
    };
    document.getElementById('user-menu-account').onclick = () => {
      menu.remove();
      state.setView('ACCOUNT');
    };
    document.getElementById('user-menu-logout').onclick = () => {
      menu.remove();
      state.logout();
    };
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target)) {
          menu.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  },
};

// 後方互換性のため state も公開
window.state = state;

// ===== リーダーチェックシートのカード削除ヘルパー =====
function _removeLeaderCheckCard(missionId) {
  const sheet = document.getElementById('leader-check-sheet');
  if (sheet) {
    const card = sheet.querySelector(`[data-leader-check-id="${missionId}"]`);
    if (card) card.remove();
    const remaining = sheet.querySelectorAll('[data-leader-check-id]').length;
    const countEl = sheet.querySelector('#leader-check-count');
    if (remaining === 0) {
      sheet.remove();
    } else if (countEl) {
      countEl.textContent = `リーダーチェック（${remaining}件）`;
    }
  }
  state.render();
}

// ===== トーストヘルパー =====
function _showToast(msg, durationMs = 2500) {
  const t = document.createElement('div');
  // スタイル: public/css/object/component/_toast.css
  t.className = 'c-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

// ===== ロガー初期化 =====
setProjectIdGetter(() => state.selectedEventId);
initLogger();

// ===== ボタンタップの宣言的ログ（委譲） =====
// data-log="<name>" を持つ要素のタップを一括で記録する。
// 個別に logEvent を散らさず、HTML 側に data-log を付けるだけで網羅できる。
// 既存の専用ログ（board_tab_switched 等）と二重にならないよう、それらの要素には付けない。
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-log]');
  if (!el) return;
  logEvent('button_tapped', { name: el.dataset.log });
}, true);

// ===== 保留中の保存を離脱時に確定させる =====
// state.save() はデバウンスされるため、タブを閉じる・バックグラウンドに回すと
// 待機中の変更が失われる。logger.js の _onVisibilityChange / _onBeforeUnload と同じ方式。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') state.flushPendingSave();
});
window.addEventListener('beforeunload', () => state.flushPendingSave());

// ===== Web Push =====
// SW を登録し、通知タップ（アプリが開いている場合）の遷移を配線する。
// 購読そのものはユーザーのタップから enablePush() を呼ぶ（iOS の必須条件）。
registerServiceWorker();
// バナーの表示判定を同期で行えるよう、購読状態を先に state に載せておく
refreshPushSubscribed().then(() => state.render());
initPushNavigation((url) => state.handlePushNavigation(url));

// ===== アプリ起動 =====
initSheetDragClose(); // ボトムシートの下スワイプで閉じる（data-sheet / data-sheet-handle）
state.init().catch(e => {
  console.error('init() で例外:', e);
  // 何が起きてもローディング画面は強制的に消す
  const loading = document.getElementById('loading-screen');
  if (loading) loading.remove();
});

// 念のため5秒後にもローディングを強制非表示（サーバー応答遅延への保険）
setTimeout(() => {
  const loading = document.getElementById('loading-screen');
  if (loading && !loading.classList.contains('is-hidden')) {
    console.warn('ローディング画面を強制非表示（タイムアウト）');
    loading.remove();
  }
}, 5000);

// ===== ヘルパ =====
/** チェック項目の空白除去・空文字除外 */
function _cleanChecklist(list) {
  if (!Array.isArray(list)) return [];
  return list.map(s => String(s ?? '').trim()).filter(s => s.length > 0);
}

/**
 * 承認待ちメンバーの申請内容（得意／やってみたい／意気込み）。
 * 「知らない人が申請してきた」ではなく「デザインができる人が来た」と判断できるようにする。
 * ★申請者カードは openPendingMembersSheet 内の2箇所（SSEでの追加時／シート新規作成時）で
 *   組み立てられるので、必ず両方でこの関数を使うこと。片方だけだと
 *   「シートを開いたまま新しい申請が来たとき」だけタグが出ない不整合になる。
 * 回答なしで申請した人（旧経路含む）は何も出さない。
 */
function _pendingAnswersHtml(m) {
  const label = (id) => SKILL_TAGS.find(t => t.id === id)?.label;
  const good = (m.skillsGood || []).map(label).filter(Boolean);
  const want = (m.skillsWant || []).map(label).filter(Boolean);
  const msg  = (m.joinMessage || '').trim();
  if (!good.length && !want.length && !msg) return '';

  const chips = (labels, kind) => labels.map(l =>
    `<span class="p-member-manage__chip p-member-manage__chip--${kind}">${_escH(l)}</span>`).join('');

  return `
    <div class="p-member-manage__answers">
      ${good.length ? `
        <div class="p-member-manage__answer-row">
          <span class="p-member-manage__answer-label">得意</span>
          ${chips(good, 'good')}
        </div>` : ''}
      ${want.length ? `
        <div class="p-member-manage__answer-row">
          <span class="p-member-manage__answer-label">やってみたい</span>
          ${chips(want, 'want')}
        </div>` : ''}
      ${msg ? `<p class="p-member-manage__message">「${_escH(msg)}」</p>` : ''}
    </div>`;
}

/** HTML 属性・テキストのエスケープ */
function _escH(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * 参加確認モーダルに、招待側の意気込み・キャッチコピー・🔥ボタンを差し込む。
 *
 * ★🔥を出すのはここ（ログイン済みの参加確認モーダル）だけ。認証前の招待バナー
 *   （auth.js の _inviteContextBanner）では押せないためボタンを置かない。
 *   サーバーはメンバーでなくても有効な招待トークンがあれば受け付ける。
 */
async function _hydrateJoinModalMotivation(inviteToken) {
  if (!inviteToken) return null;
  let ctx = null;
  try {
    const r = await api.previewInvite(inviteToken);
    if (r?.ok) ctx = r.invite;
  } catch (_) { return null; }      // 取得できなければ何も足さない（従来の見た目）
  if (!ctx) return null;

  const catchEl = document.getElementById('jec-catch');
  if (catchEl && ctx.catchphrase) {
    catchEl.textContent = ctx.catchphrase;
    catchEl.classList.remove('u-hidden');
  }

  const box = document.getElementById('jec-motivation');
  // ★🔥はここには置かない。参加が承認されてイベントページに入った直後に
  //   modals/leaderMotivationModal.js が出す（申請時点ではまだ仲間ではないため）。
  if (box) box.innerHTML = inviteMembersHtml(ctx) + motivationBlockHtml(ctx);
  return ctx;
}

/**
 * 参加申請 accept 成功後の遷移。入口A・B で同じ扱いにするためここに集約する。
 * @param {object} r        accept のレスポンス
 * @param {string} eventName 表示用のイベント名（レスポンスに無い場合のフォールバック）
 */
async function _afterJoinAccepted(r, eventName, invite = null) {
  const name = r.eventName || eventName || 'イベント';
  if (r.alreadyMember) {
    // 既に参加済み → そのままイベント画面へ（承認待ちの文言は出さない）
    await state.silentReloadEvents?.();
    state.setView('MAIN_BOARD', r.eventId);
    return;
  }
  state.pendingApprovalMessage =
    `「${name}」への参加申請を送りました。管理者の承認後に参加できます。`;
  // ★承認待ちの時間を空白にしない（M0）。取れていなければ従来どおり一文だけ出る
  state.pendingApprovalInvite = invite || null;
  state.setView('HOME');
  state.render();
}

// ===== プロジェクト（フォルダ）ヘルパ =====

/** 新規プロジェクト作成モーダル。pendingEventId が指定された場合、作成後そのイベントを追加する */
function _openNewProjectModal(pendingEventId = null) {
  document.getElementById('new-project-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'new-project-modal';
  overlay.className = 'c-overlay c-overlay--action-dialog c-overlay--blur u-page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="c-modal c-modal--left u-animate-fade">
      <h3 class="c-modal__title c-modal__title--loose">新しいプロジェクト</h3>
      <input id="np-name" type="text" maxlength="40" placeholder="プロジェクト名"
        class="c-input c-input--block p-app-shell__field">
      <input id="np-desc" type="text" maxlength="100" placeholder="説明（任意）"
        class="c-input c-input--block c-modal__field">
      <div class="c-modal__actions">
        <button id="np-cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
        <button id="np-save"   class="c-button c-button--primary c-modal__button">作成</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const nameInput = document.getElementById('np-name');
  nameInput.focus();

  document.getElementById('np-cancel').onclick = () => overlay.remove();
  document.getElementById('np-save').onclick   = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.style.outline = '2px solid #EE3E12'; return; }
    overlay.remove();
    await state.addFolder(name, document.getElementById('np-desc')?.value.trim() || '');
    // イベントを追加するケース
    if (pendingEventId && state.selectedFolderId) {
      await state.setEventFolder(pendingEventId, state.selectedFolderId);
    }
    // フォルダ数を更新してHOMEのタブを再描画
    await state.loadFolders();
    state.render();
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('np-save').click();
    if (e.key === 'Escape') overlay.remove();
  });
}

/** プロジェクト詳細の「︙」メニュー */
function _openProjectMenu(folderId) {
  const folder = (state.folders || []).find(f => f.id === folderId);
  if (!folder) return;

  document.getElementById('project-menu-sheet')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'project-menu-sheet';
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--action u-page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div data-sheet class="c-action-sheet u-animate-fade">
      <div data-sheet-handle class="c-sheet__handle"><div class="c-sheet__grip"></div></div>
      <p class="c-action-sheet__caption">${_escH(folder.name)}</p>
      <button id="pm-rename"
        class="c-action-sheet__item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        名前を変更
      </button>
      <button id="pm-delete"
        class="c-action-sheet__item c-action-sheet__item--danger">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        削除
      </button>
      <button id="pm-cancel" class="c-action-sheet__cancel">キャンセル</button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('pm-rename').onclick = () => { overlay.remove(); _openProjectRenameDialog(folderId); };
  document.getElementById('pm-delete').onclick = async () => {
    overlay.remove();
    const ok = await showConfirmDialog({
      message: `「${folder.name}」を削除しますか？\n所属イベントはそのまま残ります。`,
      confirmLabel: '削除する',
      cancelLabel: 'キャンセル',
      destructive: true,
    });
    if (ok) state.deleteFolder(folderId);
  };
  document.getElementById('pm-cancel').onclick = () => overlay.remove();
}

/** プロジェクト名変更ダイアログ */
function _openProjectRenameDialog(folderId) {
  const folder = (state.folders || []).find(f => f.id === folderId);
  if (!folder) return;

  document.getElementById('project-rename-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'project-rename-dialog';
  overlay.className = 'c-overlay c-overlay--action-dialog c-overlay--blur u-page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="c-modal c-modal--left u-animate-fade">
      <h3 class="c-modal__title c-modal__title--loose">プロジェクト名を変更</h3>
      <input id="pr-name" type="text" maxlength="40"
        class="c-input c-input--block c-modal__field"
        value="${_escH(folder.name)}">
      <div class="c-modal__actions">
        <button id="pr-cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
        <button id="pr-save"   class="c-button c-button--primary c-modal__button">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('pr-name');
  input.focus(); input.select();

  document.getElementById('pr-cancel').onclick = () => overlay.remove();
  document.getElementById('pr-save').onclick   = async () => {
    const name = input.value.trim();
    if (!name) { input.style.outline = '2px solid #EE3E12'; return; }
    overlay.remove();
    const r = await api.updateProject(folderId, { name });
    if (r.ok) {
      const f = state.folders.find(x => x.id === folderId);
      if (f) f.name = name;
      state.render();
    } else {
      window._app?.showToast(r.error || '更新に失敗しました', 'error');
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('pr-save').click();
    if (e.key === 'Escape') overlay.remove();
  });
}

// ===== 操作履歴シート（管理者のみ）=====
// イベントの event_logs を「誰が・いつ・何を」の時系列で表示する。
const _LOG_LABELS = {
  schedule_copied:  '予定をコピー',
  session_started:        'アプリを開いた',
  session_ended:          'アプリを閉じた',
  login_completed:        'ログインした',
  signup_completed:       '新規登録した',
  // ★signup_completed は register 直後のまま据え置き（既存の集計との互換のため）。
  //   オンボーディングの完走はこちらで測る。両方あると「登録したが完走しなかった人」も分かる。
  onboarding_completed:   'アカウント作成を完了した',

  // アカウント作成フロー（views/signup.js）。どのステップで落ちるかを追うため、
  // 画面表示・完了・スキップを別イベントにしている。
  // props の step は 'step1'〜'step9' / 'complete'（サーバーの ONBOARDING_STEPS と同じ値域）。
  welcome_signup_tapped:  '入口で「新規登録」をタップ',
  welcome_login_tapped:   '入口で「ログイン」をタップ',
  signup_started:         'アカウント作成を開始',
  signup_step_viewed:     'アカウント作成の画面を表示',
  signup_step_completed:  'アカウント作成の項目を入力',
  signup_step_skipped:    'アカウント作成の項目をスキップ',
  signup_email_changed:   'アカウント作成中にメールを変更',
  otp_sent:               '確認コードを送信',
  otp_verified:           '確認コードを認証',
  otp_failed:             '確認コードの入力に失敗',
  otp_deferred:           'メール認証をあとまわしにした',
  logout:                 'ログアウトした',
  // イベント作成フロー（views/createEvent.js、STEP 1〜7）。
  // signup_step_* と同じ考え方で、どのステップで落ちるか・何をスキップするかを追う。
  // props の step は 'name' / 'type' / 'scale' / 'dates' / 'catchphrase' / 'motivation'。
  event_create_started:        'イベント作成を開始',
  project_info_completed:      'イベント情報を入力',
  event_create_step_completed: 'イベント作成の項目を入力',
  event_create_step_skipped:   'イベント作成の項目をスキップ',
  event_create_completed:      'イベント作成を完了した',
  catchphrase_suggestion_used: 'キャッチコピーの例文を使った',
  motivation_reaction_added:   '意気込みに応援を送った',

  // 参加申請フォーム（modals/joinFormModal.js）。入口A/Bの両方から同じイベントが出る。
  // ★join_form_skipped_all が多ければフォーム自体が機能していないということなので必ず見る。
  // オンボーディング（onboarding.js）。「出したが誰も押さないステップ」を特定するため
  // shown / action / dismissed の3つを必ず揃えて記録する。
  // 初期オンボーディング（onboardingIntro.js）。イベント作成直後の4段階。
  // ★最重要の指標は「①は見たが③（目的）をタップしていない」人の数。
  //   ここで落ちているなら、目的を書いてもらう導線が機能していない。
  intro_usage_shown:         '進め方モーダルを表示',
  intro_usage_ack:           '進め方モーダルで「わかった」',
  intro_feature_tour_shown:  '主要機能の案内を表示',
  intro_feature_tour_step:   '主要機能の案内を進めた',
  intro_feature_tour_done:   '主要機能の案内を完了',
  intro_purpose_shown:       '目的の促しを表示',
  intro_purpose_tapped:      '目的の促しから目的ミッションを開いた',
  intro_purpose_dismissed:   '目的の促しを閉じた（書かずに離脱）',
  intro_completed:           '初期オンボーディングを完了',
  // ミッション作成フォームのツアー（初期オンボーディングとは独立・ユーザー単位で1回）
  intro_form_tour_shown:     '作成フォームの案内を表示',
  intro_form_tour_step:      '作成フォームの案内を進めた',
  intro_form_tour_skipped:   '作成フォームの案内をスキップ',
  // ★暫定：既存メンバーのスキル回収（回収後に削除）
  member_approved_modal_shown:  '参加承認モーダルを表示',
  member_approved_modal_opened: '参加承認モーダルからイベントを開いた',
  member_approved_modal_closed: '参加承認モーダルを閉じた',
  skill_collect_shown:     'スキル回収モーダルを表示',
  skill_collect_submitted: 'スキルを回答した',
  skill_collect_skipped:   'スキル回収を「あとで」',
  skills_collected:        'スキルを保存した（サーバー記録）',

  onboarding_shown:       'オンボーディングを表示',
  onboarding_action:      'オンボーディングのボタンを押した',
  onboarding_dismissed:   'オンボーディングを閉じた',

  join_form_shown:        '参加申請フォームを表示',
  join_form_submitted:    '参加を申請した',
  join_form_skipped_all:  '参加申請フォームを未回答で送信',
  event_created:          'イベントを作成した',
  mission_created:        'ミッションを作成した',
  mission_edited:         'ミッションを編集した',
  mission_completed:      'ミッションを完了した',
  mission_deleted:        'ミッションを削除した',
  proposal_accepted:      'AI提案を採用した',
  proposal_help_viewed:   'AI提案の詳細を見た',
  like_given:             'いいねした',
  invite_issued:          '招待リンクを発行した',
  invite_code_copied:     '招待コードをコピー',
  invite_shared:          '招待を共有した',
  board_tab_switched:     'タブを切替',
  archive_viewed:         'アーカイブを表示',
  view_changed:           '画面を移動',
  chat_message_sent:      'チャットを送信した',
  mission_link_copied:    'ミッションリンクをコピー',
  reflection_edited:       '振り返りを編集した',
  archive_answers_open:    'アーカイブから参加時の回答を開いた',
  archive_stats_open:      'アーカイブからみんなの活躍を開いた',
  // Web Push（iOS はホーム画面追加が必須なので、どこで脱落するかを追う）
  push_prompt_shown:      '通知の案内を表示',
  push_ios_guide_shown:   'iOSのホーム画面追加案内を表示',
  // ホーム画面への追加（PWA インストール）。iOS は追加しないと通知が届かないため、
  // ここの通過率が通知到達率をそのまま決める。
  pwa_prompt_shown:       'ホーム画面追加の案内を表示',
  pwa_prompt_dismissed:   'ホーム画面追加の案内を閉じた',
  pwa_install_accepted:   'ホーム画面に追加した',
  pwa_install_dismissed:  'ホーム画面への追加を断った',
  pwa_installed:          'ホーム画面に追加された',
  push_setup_started:     '通知の設定を開いた',
  push_banner_tapped:     '通知バナーをタップ',
  push_banner_dismissed:  '通知バナーを閉じた',
  push_enable_tap:        '通知をオンにするを押した',
  push_disable_tap:       '通知をオフにするを押した',
  push_enabled:           '通知をオンにした',
  push_denied:            '通知を拒否した',
  push_disabled:          '通知をオフにした',
  // サーバー側監査ログ（後述の拡充分）
  role_changed:           'ロールを変更した',
  member_joined:          'メンバーが参加した',
  member_approved:        'メンバーを承認した',
  member_removed:         'メンバーを除名した',
  member_left:            'イベントを脱退した',
  owner_transferred:      'オーナー権限を引き継いだ',
  claim_applied:          '担当に応募した',
  claim_unapplied:        '応募を取り消した',
  claim_selected:         '担当を選定した',
  leader_approved:        'リーダー承認した',
  leader_rejected:        'リーダー差し戻し',
};

function _logLabel(ev) { return _LOG_LABELS[ev] || ev; }

function _fmtLogTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const yearPrefix = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}/`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yearPrefix}${d.getMonth() + 1}/${d.getDate()} ${hh}:${mi}`;
}

async function _openEventLogSheet() {
  const eventId = state.selectedEventId;
  if (!eventId) return;

  document.getElementById('event-log-sheet')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'event-log-sheet';
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--action u-page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div data-sheet class="p-app-shell__log-sheet u-animate-fade">
      <div data-sheet-handle class="c-sheet__handle c-sheet__handle--mid"><div class="c-sheet__grip"></div></div>
      <p class="p-app-shell__log-title">操作履歴</p>
      <div id="event-log-body" class="p-app-shell__log-body">
        <p class="p-app-shell__log-status">読み込み中...</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('#event-log-body');
  try {
    const r = await api.getEventLogs(eventId, 300);
    if (!r.ok) {
      body.innerHTML = `<p class="p-app-shell__log-status p-app-shell__log-status--error">${_escH(r.error || '取得に失敗しました')}</p>`;
      return;
    }
    const logs = Array.isArray(r.logs) ? r.logs : [];
    if (logs.length === 0) {
      body.innerHTML = `<p class="p-app-shell__log-status">まだ履歴がありません</p>`;
      return;
    }
    body.innerHTML = logs.map(l => `
      <div class="p-app-shell__log-row">
        <div class="p-app-shell__log-main">
          <p class="p-app-shell__log-action">${_escH(_logLabel(l.event))}</p>
          <p class="p-app-shell__log-user">${_escH(l.username || 'ゲスト')}</p>
        </div>
        <span class="p-app-shell__log-time">${_fmtLogTime(l.ts)}</span>
      </div>`).join('');
  } catch (_) {
    body.innerHTML = `<p class="p-app-shell__log-status p-app-shell__log-status--error">通信エラー</p>`;
  }
}
