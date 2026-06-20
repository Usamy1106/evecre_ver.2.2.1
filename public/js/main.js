// ===== エントリーポイント =====
// 全モジュールをインポートし、グローバルバインディングを設定する

import { state, registerRenderer } from './state.js';
import { api } from './api.js';
import { logEvent, initLogger, setProjectIdGetter } from './logger.js';

// ビュー
import { renderHome }               from './views/home.js';
import { renderCreateEventInfo, renderCreateEventDates, renderCreateEventInvite } from './views/createEvent.js';
import { renderEventSettings } from './views/eventSettings.js';
import { renderProjectDetail } from './views/projectDetail.js';
import { renderMainBoard }          from './views/mainBoard.js';
import { renderCreateAccountInfo, renderLogin } from './views/auth.js';
import { renderAccount } from './views/account.js';
import { renderPasswordResetRequest, renderPasswordResetConfirm } from './views/passwordReset.js';

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
  openClearMissionModal, submitMissionClear, handleImageSelect, clearImagePreview,
  handleGoodClick,
  updateDraftInfo,
  openIndividualClearListModal,
} from './modals/helpers.js';
import { openVerifyEmailModal } from './modals/verifyEmailModal.js';
import { openJoinByCodeModal } from './modals/joinByCodeModal.js';
import { openEventCalendarSheet } from './modals/eventCalendarSheet.js';
import { showConfirmDialog } from './dialog.js';
import { initSheetDragClose } from './sheet.js';

// ===== ビューレンダラーの登録 =====
registerRenderer('CREATE_ACCOUNT_INFO',   renderCreateAccountInfo);
registerRenderer('LOGIN',                 renderLogin);
registerRenderer('PASSWORD_RESET_REQUEST', renderPasswordResetRequest);
registerRenderer('PASSWORD_RESET_CONFIRM', renderPasswordResetConfirm);
registerRenderer('ACCOUNT',               renderAccount);
registerRenderer('HOME',                  renderHome);
registerRenderer('CREATE_EVENT_INFO',   renderCreateEventInfo);
registerRenderer('CREATE_EVENT_DATES',  renderCreateEventDates);
registerRenderer('CREATE_EVENT_INVITE', renderCreateEventInvite);
registerRenderer('MAIN_BOARD',            renderMainBoard);
registerRenderer('EVENT_SETTINGS',      renderEventSettings);
registerRenderer('PROJECT_DETAIL',      renderProjectDetail);

// ===== 参加承認ロール設定モーダル（共通ヘルパー）=====
// uid: 承認対象userId, username: 表示名, roles: イベントのロール配列（破壊的に追加される）
// onSuccess(uid): 承認成功時コールバック
function _openApproveModal(uid, username, roles, onSuccess) {
  const mutableRoles = roles.slice();

  function _roleCheckItem(r, checked = false) {
    const el = document.createElement('label');
    el.className = 'flex items-center gap-3 py-2 cursor-pointer';
    el.innerHTML = `
      <input type="checkbox" data-role-check value="${_escH(r.id)}"
        ${checked || r.id === 'member' ? 'checked' : ''}
        class="w-4 h-4 accent-[#0CA1E3] flex-shrink-0">
      <div class="flex-1 min-w-0">
        <span class="text-[13px] text-[#484545] font-bold">${_escH(r.name || r.id)}</span>
        ${r.canManage
          ? '<span class="ml-2 text-[9px] text-[#0CA1E3] font-bold">管理者権限</span>'
          : '<span class="ml-2 text-[9px] text-[#A7AAAC] font-bold">一般ユーザー</span>'}
      </div>`;
    return el;
  }

  const roleOverlay = document.createElement('div');
  roleOverlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6';
  roleOverlay.onclick = (e2) => { if (e2.target === roleOverlay) roleOverlay.remove(); };
  roleOverlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn">
      <h3 class="heading-m text-[#484545] mb-2 font-bold">ロールを設定する</h3>
      <p class="text-rs text-[#A7AAAC] font-medium mb-4">@${_escH(username)} さんのロールを選択してください（複数可）</p>
      <div id="role-check-list" class="border border-[#E1DFDC] rounded-xl px-4 py-1 bg-[#FDFBF8] mb-3"></div>
      <button id="role-add-toggle"
        class="w-full text-left text-[12px] font-bold text-[#0CA1E3] py-2 mb-3 active:opacity-60">
        ＋ 新しいロールを追加
      </button>
      <div id="role-add-form" class="hidden border border-[#E1DFDC] rounded-xl p-4 bg-[#FDFBF8] mb-3">
        <input id="role-add-name" placeholder="例: サブリーダー、デザイナーなど" maxlength="20"
          class="input-field w-full px-3 py-2 text-[13px] focus:outline-none mb-2">
        <label class="flex items-center gap-2 mb-3 cursor-pointer">
          <input id="role-add-canmanage" type="checkbox" class="w-4 h-4 accent-[#0CA1E3]">
          <span class="text-[12px] text-[#484545] font-bold">管理者権限</span>
          <span class="text-[10px] text-[#A7AAAC] ml-auto">イベント管理・ミッション編集</span>
        </label>
        <div class="flex gap-2">
          <button id="role-add-cancel" class="flex-1 py-2 rounded-lg text-[12px] font-bold text-[#484545] bg-[#EBE8E5]">キャンセル</button>
          <button id="role-add-save" class="flex-1 py-2 rounded-lg text-[12px] font-bold text-white bg-[#0CA1E3]">追加</button>
        </div>
      </div>
      <div class="flex gap-3">
        <button data-action="cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">キャンセル</button>
        <button data-action="confirm" class="flex-1 py-3 heading-rs font-bold text-white rounded-xl shadow-md" style="background-color:#0CA1E3">承認する</button>
      </div>
    </div>`;
  document.body.appendChild(roleOverlay);

  const checkList = roleOverlay.querySelector('#role-check-list');
  mutableRoles.forEach(r => checkList.appendChild(_roleCheckItem(r, false)));

  const addToggle = roleOverlay.querySelector('#role-add-toggle');
  const addForm   = roleOverlay.querySelector('#role-add-form');
  addToggle.onclick = () => {
    addForm.classList.remove('hidden');
    addToggle.classList.add('hidden');
    roleOverlay.querySelector('#role-add-name').focus();
  };
  roleOverlay.querySelector('#role-add-cancel').onclick = () => {
    addForm.classList.add('hidden');
    addToggle.classList.remove('hidden');
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
      addForm.classList.add('hidden');
      addToggle.classList.remove('hidden');
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
    if (addFormEl && !addFormEl.classList.contains('hidden')) {
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
  tryProceedFromInfo: () => {
    const d = state.draftEvent || {};
    if (!d.name?.trim()) {
      window._app?.showToast('イベント名を入力してください', 'error');
      return;
    }
    logEvent('project_info_completed', { hasDates: (d.dates?.length > 0) });
    state.setView('CREATE_EVENT_DATES');
  },
  tryProceedFromDates: () => {
    // 開催日時は任意。何も選択していなくても進める。
    state.setView('CREATE_EVENT_INVITE');
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
    menu.className = 'fixed bg-white border border-[#D3D6D8] rounded-xl shadow-xl z-[60] overflow-hidden min-w-[130px] animate-fadeIn';
    menu.style.top   = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.innerHTML = `
      <button id="amm-revert" class="w-full text-left px-4 py-3 active:bg-[#FDFBF8] text-rs font-bold border-b border-[#EBE8E5]">未完了に戻す</button>
      <button id="amm-delete" class="w-full text-left px-4 py-3 active:bg-[#FDFBF8] text-rs font-bold text-[#EE3E12]">削除する</button>`;
    document.body.appendChild(menu);
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

  completeMissionFromListModal: (missionId) => {
    document.getElementById('indiv-clear-list-modal')?.remove();
    const p = state.events.find(x => x.id === state.selectedEventId);
    const m = p?.missions.find(x => x.id === missionId);
    // 完了のみ（noInput）ミッションは、タイトル＋説明だけの確認モーダル
    //（＝「ミッションについて」に見えるもの）を挟まず、その場で完了を記録する。
    // 説明はリストのボトムシート上部に表示済み。入力ありミッションのみ入力モーダルを開く。
    if (m?.noInput) {
      submitMissionClear(missionId);
    } else {
      window._app.openClearMissionModal(missionId);
    }
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
    document.getElementById('indiv-clear-list-modal')?.remove();
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
    confirmOverlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[220] flex items-center justify-center p-6';
    confirmOverlay.onclick = (e) => { if (e.target === confirmOverlay) confirmOverlay.remove(); };
    confirmOverlay.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
        <h3 class="heading-m text-[#484545] mb-3 font-bold">差し戻しますか？</h3>
        <p class="text-rs text-[#A7AAAC] font-medium mb-8 leading-relaxed">提出内容は破棄されます。</p>
        <div class="flex gap-3">
          <button data-action="cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">キャンセル</button>
          <button data-action="confirm" class="flex-1 py-3 heading-rs font-bold text-white rounded-xl" style="background-color:#EE3E12">差し戻す</button>
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
      if (errorText)  errorText.classList.remove('hidden');
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
      event.missions.push({
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
      });
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
  changeMissionSort: (mode) => changeMissionSort(mode),

  // --- ミッション完了 ---
  openClearMissionModal: (mid, fmt) => openClearMissionModal(mid, fmt),
  openIndividualClearListModal: (mid) => openIndividualClearListModal(mid),
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
        card.className = 'bg-[#FDFBF8] rounded-2xl p-4 mb-3 border border-[#E1DFDC] animate-fadeIn';
        card.innerHTML = `
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-full bg-[#0CA1E3] flex items-center justify-center text-white font-bold text-[13px] flex-shrink-0">
                ${_escH((m.username || '?').charAt(0).toUpperCase())}
              </div>
              <p class="text-[14px] font-bold text-[#484545] truncate">@${_escH(m.username)}</p>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button data-reject-pending="${_escH(m.userId)}"
                class="px-3 py-2 text-[12px] font-bold text-[#A7AAAC] bg-[#EBE8E5] rounded-lg active:scale-95 transition-transform">拒否</button>
              <button data-approve-pending="${_escH(m.userId)}" data-username="${_escH(m.username)}"
                class="px-3 py-2 text-[12px] font-bold text-white bg-[#0CA1E3] rounded-lg active:scale-95 transition-transform">承認</button>
            </div>
          </div>`;
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
    overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[150] flex items-end';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const rows = pending.map(m => `
      <div data-pending-uid="${_escH(m.userId)}" class="bg-[#FDFBF8] rounded-2xl p-4 mb-3 border border-[#E1DFDC]">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-full bg-[#0CA1E3] flex items-center justify-center text-white font-bold text-[13px] flex-shrink-0">
              ${_escH((m.username || '?').charAt(0).toUpperCase())}
            </div>
            <p class="text-[14px] font-bold text-[#484545] truncate">@${_escH(m.username)}</p>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button data-reject-pending="${_escH(m.userId)}"
              class="px-3 py-2 text-[12px] font-bold text-[#A7AAAC] bg-[#EBE8E5] rounded-lg active:scale-95 transition-transform">拒否</button>
            <button data-approve-pending="${_escH(m.userId)}" data-username="${_escH(m.username)}"
              class="px-3 py-2 text-[12px] font-bold text-white bg-[#0CA1E3] rounded-lg active:scale-95 transition-transform">承認</button>
          </div>
        </div>
      </div>`).join('');

    overlay.innerHTML = `
      <div data-sheet class="bg-white rounded-t-3xl w-full shadow-2xl max-h-[70vh] flex flex-col animate-fadeIn">
        <div id="pending-sheet-header" data-sheet-handle class="shrink-0 px-6 pt-5 pb-4 cursor-grab active:cursor-grabbing">
          <div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full mx-auto mb-5"></div>
          <h3 id="pending-members-count" class="heading-m text-[#484545]">参加申請（${pending.length}件）</h3>
        </div>
        <div id="pending-members-list" class="flex-1 overflow-y-auto px-6 pb-6">
          ${rows || '<p class="text-center text-[#A7AAAC] text-rs py-8">申請はありません</p>'}
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
    overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[150] flex items-end';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div data-sheet class="bg-white rounded-t-3xl w-full p-6 shadow-2xl animate-fadeIn">
        <div data-sheet-handle class="flex justify-center pt-1 pb-4"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
        <h3 class="heading-m text-[#484545] mb-4">ミッションを提案する</h3>
        <textarea id="member-proposal-input" rows="4"
          placeholder="ミッション名を入力してください"
          class="w-full p-4 rounded-2xl bg-[#EBE8E5] focus:outline-none text-r resize-none leading-relaxed"></textarea>
        <button id="member-proposal-submit"
          class="w-full py-4 mt-4 heading-r font-bold text-white rounded-xl active:scale-95 transition-transform"
          style="background-color: #9EDF05">提案する</button>
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
    overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[150] flex items-end';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const rows = proposals.map(pr => `
      <div class="bg-[#FDFBF8] rounded-2xl p-4 mb-3 border border-[#E1DFDC]">
        <p class="text-[11px] text-[#A7AAAC] font-bold mb-1">@${_escH(pr.proposedByName)}</p>
        <p class="text-[14px] font-bold text-[#484545] mb-3">${_escH(pr.text)}</p>
        <div class="flex gap-2">
          <button data-reject="${_escH(pr.id)}"
            class="flex-1 py-2 text-[12px] font-bold text-[#A7AAAC] bg-[#EBE8E5] rounded-lg active:scale-95 transition-transform">拒否</button>
          <button data-accept="${_escH(pr.id)}"
            class="flex-1 py-2 text-[12px] font-bold text-white rounded-lg active:scale-95 transition-transform"
            style="background-color: #9EDF05">受理</button>
        </div>
      </div>`).join('');

    overlay.innerHTML = `
      <div data-sheet class="bg-white rounded-t-3xl w-full p-6 shadow-2xl max-h-[80vh] overflow-y-auto animate-fadeIn">
        <div data-sheet-handle class="flex justify-center pt-1 pb-4"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
        <h3 class="heading-m text-[#484545] mb-4">ミッションの提案（${proposals.length}件）</h3>
        ${rows || '<p class="text-center text-[#A7AAAC] text-rs py-4">提案はありません</p>'}
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
        color: '#FFC300', bgColor: '#FFF8E1',
        title: '参加申請が届いています',
        desc:  `${pendingMembers.length}件の参加申請があります。承認または拒否してください。`,
        action: '承認リストを開く',
        onAction: () => window._app.openPendingMembersSheet(),
      };
    } else if (claimMissions.length > 0) {
      config = {
        icon: `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`,
        color: '#0CA1E3', bgColor: '#E8F7FD',
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
        color: '#9EDF05', bgColor: '#F0FDE8',
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
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[180] flex items-center justify-center p-6';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
        <div class="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
          style="background-color:${config.bgColor}">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${config.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            ${config.icon}
          </svg>
        </div>
        <h3 class="heading-m text-[#484545] mb-3 font-bold">${config.title}</h3>
        <p class="text-rs text-[#A7AAAC] font-medium mb-8 leading-relaxed">${config.desc}</p>
        <div class="flex gap-3">
          <button data-action="skip" class="btn-secondary flex-1 py-3 heading-rs font-bold">スキップ</button>
          <button data-action="go" class="flex-1 py-3 heading-rs font-bold text-white rounded-xl shadow-md"
            style="background-color:${config.color}">${config.action}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('[data-action="skip"]').onclick = () => overlay.remove();
    overlay.querySelector('[data-action="go"]').onclick = () => {
      overlay.remove();
      config.onAction();
    };
  },

  // --- リーダーチェック：確認ボトムシート（管理者）---
  openLeaderCheckSheet: () => {
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (!p) return;
    const missions = (p.missions || []).filter(m => m.status === 'pending_leader_check');

    const overlay = document.createElement('div');
    overlay.id = 'leader-check-sheet';
    overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[150] flex items-end';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const rows = missions.map(m => {
      const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
      const cd = p.clearedData?.[m.id];
      let previewHtml = '';
      if (cd?.content) {
        if (cd.format === 'image') {
          previewHtml = `<img src="${cd.content}" class="w-full h-24 object-cover rounded-lg mt-2" loading="lazy">`;
        } else {
          previewHtml = `<p class="text-[11px] text-[#484545] bg-[#FDFBF8] px-3 py-2 rounded-lg mt-2 truncate">${_escH(cd.content)}</p>`;
        }
      }
      return `
        <div data-leader-check-id="${_escH(m.id)}" class="bg-[#FDFBF8] rounded-2xl p-4 mb-3 border border-[#E1DFDC]">
          <div class="flex flex-wrap gap-1 mb-1">${tagNames.map(t => `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBE8E5] text-[#484545]">${_escH(t)}</span>`).join('')}</div>
          <p class="text-[14px] font-bold text-[#484545] mb-2">${_escH(m.title)}</p>
          ${previewHtml}
          <div class="flex gap-2 mt-3">
            <button data-lc-reject="${_escH(m.id)}"
              class="flex-1 py-2 text-[12px] font-bold text-[#A7AAAC] bg-[#EBE8E5] rounded-lg active:scale-95 transition-transform">差し戻す</button>
            <button data-lc-approve="${_escH(m.id)}"
              class="flex-1 py-2 text-[12px] font-bold text-white rounded-lg active:scale-95 transition-transform" style="background-color:#EE3E12">確認完了</button>
          </div>
        </div>`;
    }).join('');

    overlay.innerHTML = `
      <div data-sheet class="bg-white rounded-t-3xl w-full shadow-2xl h-[85vh] flex flex-col animate-fadeIn">
        <div data-sheet-handle class="shrink-0 px-6 pt-5 pb-4">
          <div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full mx-auto mb-5"></div>
          <h3 id="leader-check-count" class="heading-m text-[#484545]">リーダーチェック（${missions.length}件）</h3>
        </div>
        <div id="leader-check-list" class="flex-1 overflow-y-auto px-6 pb-6">
          ${rows || '<p class="text-center text-[#A7AAAC] text-rs py-8">確認待ちはありません</p>'}
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
    const body  = section.querySelector('.archive-section-body');
    const arrow = section.querySelector('.archive-section-arrow');
    if (body)  body.style.display = state.archiveCollapsed[tag] ? 'none' : '';
    if (arrow) arrow.style.transform = state.archiveCollapsed[tag] ? 'rotate(-90deg)' : '';
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

  // --- プロジェクト（フォルダ）操作 ---
  openNewProjectModal: (pendingEventId = null) => _openNewProjectModal(pendingEventId),
  openNewProjectModalForEvent: (eventId) => _openNewProjectModal(eventId),
  openProjectMenu: (folderId) => _openProjectMenu(folderId),
  openEventLogSheet: () => _openEventLogSheet(),

  // プロジェクト詳細から「+ 新規イベント作成」
  createEventInFolder: (folderId) => {
    state.selectedFolderId = folderId;
    state.draftEvent = { name: '', description: '', dates: [], seedType: 'jack' };
    state.setView('CREATE_EVENT_INFO');
  },

  // --- 招待参加確認モーダル ---
  openJoinEventModal: (eventName, inviteToken) => {
    document.getElementById('join-event-confirm-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'join-event-confirm-modal';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-6';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
        <p class="text-[36px] mb-2">🎉</p>
        <h3 class="heading-m text-[#484545] font-bold mb-3">イベントに参加する</h3>
        <p class="text-[13px] text-[#484545] font-bold mb-1">「${_escH(eventName || 'イベント')}」</p>
        <p class="text-[12px] text-[#A7AAAC] font-bold mb-8">への参加を申請しますか？<br>管理者の承認後に参加できます。</p>
        <div class="flex gap-3">
          <button id="jec-cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">キャンセル</button>
          <button id="jec-confirm" class="flex-1 py-3 heading-rs font-bold text-white rounded-xl shadow-md bg-[#0CA1E3]">参加申請する</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('jec-cancel').onclick = () => overlay.remove();
    document.getElementById('jec-confirm').onclick = async () => {
      const btn = document.getElementById('jec-confirm');
      btn.disabled = true;
      btn.textContent = '送信中…';
      try {
        const r = await api.acceptInvite(inviteToken);
        overlay.remove();
        if (r.ok) {
          if (r.pending) {
            state.pendingApprovalMessage = `「${eventName || 'イベント'}」への参加申請を送りました。管理者の承認後に参加できます。`;
            state.setView('HOME');
            state.render();
          } else if (r.alreadyMember) {
            // 既に参加済み → イベント画面へ
            await state.silentReloadEvents?.();
            state.setView('MAIN_BOARD', r.eventId);
          } else {
            state.pendingApprovalMessage = `「${eventName || 'イベント'}」への参加申請を送りました。管理者の承認後に参加できます。`;
            state.setView('HOME');
            state.render();
          }
        } else {
          window._app?.showToast(r.error || '参加申請に失敗しました', 'error');
        }
      } catch (e) {
        window._app?.showToast('通信エラーが発生しました', 'error');
      }
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
    menu.className = 'fixed bg-white rounded-xl shadow-xl border border-[#D3D6D8] py-1 z-[150] animate-fadeIn';
    menu.style.top  = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    menu.style.minWidth = '160px';
    menu.innerHTML = `
      <div class="px-4 py-2 border-b border-[#E1DFDC]">
        <p class="text-[10px] text-[#A7AAAC] font-bold">ログイン中</p>
        <p class="text-[12px] text-[#484545] font-bold truncate">${(state.currentUser?.username) || ''}</p>
      </div>
      <button id="user-menu-join" class="w-full text-left px-4 py-2.5 text-[13px] font-bold text-[#484545] hover:bg-[#FDFBF8]">
        イベントに参加する
      </button>
      <button id="user-menu-account" class="w-full text-left px-4 py-2.5 text-[13px] font-bold text-[#484545] hover:bg-[#FDFBF8] border-t border-[#E1DFDC]">
        アカウント設定
      </button>
      <button id="user-menu-logout" class="w-full text-left px-4 py-2.5 text-[13px] font-bold text-[#EE3E12] hover:bg-[#FFEEEA] border-t border-[#E1DFDC]">
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
  t.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#484545] text-white px-5 py-3 rounded-full shadow-2xl text-[13px] font-bold z-[400] whitespace-nowrap';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

// ===== ロガー初期化 =====
setProjectIdGetter(() => state.selectedEventId);
initLogger();

// ===== 提案の8時間サイクル監視 =====
// render() はユーザー操作時にしか走らないため、画面を開いたまま放置しても
// 8時間経過で新しい提案が出現するよう定期チェックする（生成判定は state 側）
setInterval(() => {
  if (document.visibilityState === 'visible') state._checkProposalCycle?.();
}, 5 * 60 * 1000);

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
  if (loading && !loading.classList.contains('hide')) {
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

/** HTML 属性・テキストのエスケープ */
function _escH(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== プロジェクト（フォルダ）ヘルパ =====

/** 新規プロジェクト作成モーダル。pendingEventId が指定された場合、作成後そのイベントを追加する */
function _openNewProjectModal(pendingEventId = null) {
  document.getElementById('new-project-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'new-project-modal';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn">
      <h3 class="heading-m text-[#484545] mb-6 font-bold text-center">新しいプロジェクト</h3>
      <input id="np-name" type="text" maxlength="40" placeholder="プロジェクト名"
        class="input-field w-full px-4 py-3 focus:outline-none mb-3">
      <input id="np-desc" type="text" maxlength="100" placeholder="説明（任意）"
        class="input-field w-full px-4 py-3 focus:outline-none mb-6">
      <div class="flex gap-3">
        <button id="np-cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">キャンセル</button>
        <button id="np-save"   class="btn-primary   flex-1 py-3 heading-rs font-bold">作成</button>
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
  overlay.className = 'fixed inset-0 bg-black/40 z-[200] flex items-end justify-center page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div data-sheet class="bg-white w-full max-w-md rounded-t-[32px] p-4 pb-8 shadow-2xl animate-fadeIn">
      <div data-sheet-handle class="flex justify-center pt-1 pb-3"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
      <p class="text-center text-[12px] text-[#A7AAAC] font-bold mb-3 truncate px-6">${_escH(folder.name)}</p>
      <button id="pm-rename"
        class="w-full text-left px-6 py-4 rounded-xl hover:bg-[#FDFBF8] text-[15px] font-bold text-[#484545] flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        名前を変更
      </button>
      <button id="pm-delete"
        class="w-full text-left px-6 py-4 rounded-xl hover:bg-[#FFEEEA] text-[15px] font-bold text-[#EE3E12] flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        削除
      </button>
      <button id="pm-cancel" class="w-full py-3 mt-2 text-[14px] font-bold text-[#A7AAAC]">キャンセル</button>
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
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn">
      <h3 class="heading-m text-[#484545] mb-6 font-bold text-center">プロジェクト名を変更</h3>
      <input id="pr-name" type="text" maxlength="40"
        class="input-field w-full px-4 py-3 focus:outline-none mb-6"
        value="${_escH(folder.name)}">
      <div class="flex gap-3">
        <button id="pr-cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">キャンセル</button>
        <button id="pr-save"   class="btn-primary   flex-1 py-3 heading-rs font-bold">保存</button>
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
  session_started:        'アプリを開いた',
  session_ended:          'アプリを閉じた',
  login_completed:        'ログインした',
  signup_completed:       '新規登録した',
  logout:                 'ログアウトした',
  event_create_started:   'イベント作成を開始',
  project_info_completed: 'イベント情報を入力',
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
  // サーバー側監査ログ（後述の拡充分）
  role_changed:           'ロールを変更した',
  member_joined:          'メンバーが参加した',
  member_approved:        'メンバーを承認した',
  member_removed:         'メンバーを除名した',
  member_left:            'イベントを脱退した',
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
  overlay.className = 'fixed inset-0 bg-black/40 z-[200] flex items-end justify-center page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div data-sheet class="bg-white w-full max-w-md rounded-t-[32px] shadow-2xl animate-fadeIn flex flex-col" style="max-height:80vh">
      <div data-sheet-handle class="flex justify-center pt-3 pb-2 flex-shrink-0"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
      <p class="text-center text-[15px] font-bold text-[#484545] pb-3 flex-shrink-0">操作履歴</p>
      <div id="event-log-body" class="flex-1 overflow-y-auto px-5 pb-8">
        <p class="text-center text-[13px] text-[#A7AAAC] py-10">読み込み中...</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('#event-log-body');
  try {
    const r = await api.getEventLogs(eventId, 300);
    if (!r.ok) {
      body.innerHTML = `<p class="text-center text-[13px] text-[#EE3E12] py-10">${_escH(r.error || '取得に失敗しました')}</p>`;
      return;
    }
    const logs = Array.isArray(r.logs) ? r.logs : [];
    if (logs.length === 0) {
      body.innerHTML = `<p class="text-center text-[13px] text-[#A7AAAC] py-10">まだ履歴がありません</p>`;
      return;
    }
    body.innerHTML = logs.map(l => `
      <div class="flex items-start gap-3 py-2.5 border-b border-[#F0EEEC]">
        <div class="flex-1 min-w-0">
          <p class="text-[13px] font-bold text-[#484545]">${_escH(_logLabel(l.event))}</p>
          <p class="text-[11px] text-[#A7AAAC] mt-0.5 truncate">${_escH(l.username || 'ゲスト')}</p>
        </div>
        <span class="text-[11px] text-[#A7AAAC] flex-shrink-0 whitespace-nowrap">${_fmtLogTime(l.ts)}</span>
      </div>`).join('');
  } catch (_) {
    body.innerHTML = `<p class="text-center text-[13px] text-[#EE3E12] py-10">通信エラー</p>`;
  }
}
