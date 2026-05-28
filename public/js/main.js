// ===== エントリーポイント =====
// 全モジュールをインポートし、グローバルバインディングを設定する

import { state, registerRenderer } from './state.js';
import { api } from './api.js';

// ビュー
import { renderHome }               from './views/home.js';
import { renderCreateProjectInfo, renderCreateProjectDates, renderCreateProjectInvite } from './views/createProject.js';
import { renderProjectSettings } from './views/projectSettings.js';
import { renderMainBoard }          from './views/mainBoard.js';
import { renderCreateAccountInfo, renderLogin } from './views/auth.js';
import { renderAccount } from './views/account.js';
import { renderPasswordResetRequest, renderPasswordResetConfirm } from './views/passwordReset.js';

// モーダル
import { openCalendarModal, moveCalendarMonth, toggleDate } from './modals/calendar.js';
import {
  openMissionModal, closeMissionModal, deleteMission,
  renderMissionModalContent,
  addProposalToMission, showProposalHelp,
  toggleMissionMenu, toggleSortMenu,
  showMissionListModal, changeMissionSort,
  openAssigneeSheet, closeAssigneeSheet,
  openTagCreator, closeTagCreator,
  openSelectClaimModal,
} from './modals/mission.js';
import {
  editArchiveItem, openEditModal,
  openClearMissionModal, submitMissionClear, handleImageSelect,
  handleGoodClick,
  copyInviteCode, shareInvite, showProjectInviteModal,
  updateDraftInfo, removeDraftDateGroup,
} from './modals/helpers.js';
import { openRenameDialog, openDeleteConfirm } from './modals/projectActions.js';
import { openVerifyEmailModal } from './modals/verifyEmailModal.js';
import { openJoinByCodeModal } from './modals/joinByCodeModal.js';
import { openInviteIssueModal } from './modals/inviteIssueModal.js';
import { openProjectCalendarSheet } from './modals/projectCalendarSheet.js';

// ===== ビューレンダラーの登録 =====
registerRenderer('CREATE_ACCOUNT_INFO',   renderCreateAccountInfo);
registerRenderer('LOGIN',                 renderLogin);
registerRenderer('PASSWORD_RESET_REQUEST', renderPasswordResetRequest);
registerRenderer('PASSWORD_RESET_CONFIRM', renderPasswordResetConfirm);
registerRenderer('ACCOUNT',               renderAccount);
registerRenderer('HOME',                  renderHome);
registerRenderer('CREATE_PROJECT_INFO',   renderCreateProjectInfo);
registerRenderer('CREATE_PROJECT_DATES',  renderCreateProjectDates);
registerRenderer('CREATE_PROJECT_INVITE', renderCreateProjectInvite);
registerRenderer('MAIN_BOARD',            renderMainBoard);
registerRenderer('PROJECT_SETTINGS',      renderProjectSettings);

// ===== window._app : インラインイベントハンドラーから呼び出されるAPI =====
// HTMLテンプレート内の onclick="window._app.xxx()" から参照される
window._app = {
  // --- state 委譲 ---
  setView: (view, id) => state.setView(view, id),
  addProject: () => state.addProject(),
  setTab: (tab) => {
    state.mainBoardTab = tab;
    if (tab === 'NOTIFICATIONS') {
      // 通知タブを開いたら最新を取得
      state.loadNotifications().then(() => state.render());
    }
    state.render();
  },

  // --- メンバー管理（プロジェクト画面から呼ばれる）---
  openInviteIssueModal: (id) => openInviteIssueModal(id || state.selectedProjectId),

  // --- メインボードのカレンダーボトムシート（開催まで残り○日 タップで開く）---
  openProjectCalendarSheet: () => openProjectCalendarSheet(),

  // --- ミッションモーダル：担当者選択 ---
  openAssigneeSheet:  () => openAssigneeSheet(),
  closeAssigneeSheet: () => closeAssigneeSheet(),
  updateMissionAssignee: (value) => {
    if (!value) {
      state.draftMission.assignee = null;
    } else if (value.startsWith('user:')) {
      state.draftMission.assignee = { type: 'user', userId: value.slice(5) };
    } else if (value.startsWith('role:')) {
      state.draftMission.assignee = { type: 'role', roleId: value.slice(5) };
    }
  },

  // --- プロジェクト設定ページへの遷移（歯車アイコン）---
  toggleProjectMenu: (e) => {
    e.stopPropagation();
    // 旧ドロップオーバーは廃止。設定ページに直接遷移
    state.projectSettingsScreen = { members: null, loadingMembers: true };
    state.setView('PROJECT_SETTINGS', state.selectedProjectId);
  },

  // --- プロジェクト作成: ステップ間遷移（クリック時に検証）---
  tryProceedFromInfo: () => {
    const d = state.draftProject || {};
    if (!d.name?.trim()) {
      alert('プロジェクト名を入力してください');
      return;
    }
    state.setView('CREATE_PROJECT_DATES');
  },
  tryProceedFromDates: () => {
    // 開催日時は任意。何も選択していなくても進める。
    state.setView('CREATE_PROJECT_INVITE');
  },

  // --- カレンダー ---
  openCalendarModal: (target) => openCalendarModal(target),
  moveCalendarMonth: (offset, target) => moveCalendarMonth(offset, target),
  toggleDate: (dateStr, target) => toggleDate(dateStr, target),

  // --- ミッションモーダル ---
  openMissionModal: (id = null) => openMissionModal(id),
  closeMissionModal: () => closeMissionModal(),
  deleteMission: (e) => deleteMission(e),
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
  setMissionFormat: (f) => { state.draftMission.clearFormat = f; renderMissionModalContent(); },

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
  setMissionClaimMode: (mode) => {
    state.draftMission.claimMode = mode;
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
  // --- ミッション自己申告（メインボードの「やる」ボタンから）---
  claimMissionAsSelf: async (missionId) => {
    const projectId = state.selectedProjectId;
    if (!projectId) return;
    const r = await api.claimMission(projectId, missionId);
    if (r.ok) {
      // ローカル更新
      const p = state.projects.find(x => x.id === projectId);
      const m = p?.missions.find(x => x.id === missionId);
      if (m) m.assignee = { type: 'user', userId: state.currentUser.id };
      state.render();
    } else {
      alert(r.error || '申告に失敗しました');
    }
  },
  unclaimMissionAsSelf: async (missionId) => {
    const projectId = state.selectedProjectId;
    if (!projectId) return;
    if (!confirm('応募を取り消しますか？')) return;
    const r = await api.unclaimMission(projectId, missionId);
    if (r.ok) {
      await state.silentReloadProjects();
      state.render();
    } else {
      alert(r.error || '取り消しに失敗しました');
    }
  },

  // --- 申告制（複数人可）：応募を締切る ---
  closeMissionClaims: async (missionId) => {
    const projectId = state.selectedProjectId;
    if (!projectId) return;
    if (!confirm('応募を締め切ります。現在の応募者全員が担当者として確定します。よろしいですか？')) return;
    const r = await api.closeMissionClaims(projectId, missionId);
    if (r.ok) {
      await state.silentReloadProjects();
      state.render();
    } else {
      alert(r.error || '締切に失敗しました');
    }
  },

  // --- 申告制（選定あり）：選定モーダルを開く ---
  openSelectClaimModal: (missionId) => {
    openSelectClaimModal(missionId);
  },
  submitSelectClaims: async (missionId) => {
    const projectId = state.selectedProjectId;
    if (!projectId) return;
    const selected = Array.from(document.querySelectorAll('[data-select-claim]:checked')).map(el => el.value);
    if (selected.length === 0) {
      alert('1名以上選んでください');
      return;
    }
    const r = await api.selectMissionClaims(projectId, missionId, selected);
    if (r.ok) {
      document.getElementById('select-claim-overlay')?.remove();
      await state.silentReloadProjects();
      state.render();
    } else {
      alert(r.error || '選定に失敗しました');
    }
  },

  // --- リーダーチェック：承認 / 差し戻し ---
  approveMission: async (missionId) => {
    const projectId = state.selectedProjectId;
    if (!projectId) return;
    const r = await api.approveMission(projectId, missionId);
    if (r.ok) {
      const p = state.projects.find(x => x.id === projectId);
      const m = p?.missions.find(x => x.id === missionId);
      if (m) m.status = 'cleared';
      state.render();
    } else {
      alert(r.error || '承認に失敗しました');
    }
  },
  rejectMission: async (missionId) => {
    const projectId = state.selectedProjectId;
    if (!projectId) return;
    if (!confirm('このミッションを差し戻しますか？提出内容は破棄されます。')) return;
    const r = await api.rejectMission(projectId, missionId);
    if (r.ok) {
      const p = state.projects.find(x => x.id === projectId);
      const m = p?.missions.find(x => x.id === missionId);
      if (m) m.status = 'yet';
      if (p?.clearedData?.[missionId]) delete p.clearedData[missionId];
      state.render();
    } else {
      alert(r.error || '差し戻しに失敗しました');
    }
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
    await api.markAllNotificationsRead();
    state.notifications.forEach(n => n.read = true);
    state.render();
  },
  refreshNotifications: async () => {
    await state.loadNotifications();
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

    const project = state.projects.find(p => p.id === state.selectedProjectId);
    if (state.editingMissionId) {
      const idx = project.missions.findIndex(m => m.id === state.editingMissionId);
      if (idx > -1) {
        project.missions[idx] = {
          ...project.missions[idx],
          title: state.draftMission.title,
          tag: state.draftMission.labels[0],
          tags: [...(state.draftMission.labels || [])],
          dates: [...state.draftMission.dates],
          clearFormat: state.draftMission.clearFormat,
          priority: state.draftMission.priority,
          // 申告制 ON の場合、作成画面で指定した assignee は無視（メンバーの申告で再設定）
          assignee: state.draftMission.selfClaim ? null : (state.draftMission.assignee || null),
          checklist: _cleanChecklist(state.draftMission.checklist),
          description: String(state.draftMission.description || ''),
          selfClaim: !!state.draftMission.selfClaim,
          leaderCheck: !!state.draftMission.leaderCheck,
          claimMode: state.draftMission.selfClaim ? 'selection' : 'first',
          claimDeadline: (state.draftMission.selfClaim && state.draftMission.claimDeadline) ? state.draftMission.claimDeadline : null,
        };
      }
    } else {
      project.missions.push({
        id: Date.now().toString(),
        title: state.draftMission.title,
        tag: state.draftMission.labels[0],
        tags: [...(state.draftMission.labels || [])],
        daysLeft: 7,
        dates: [...state.draftMission.dates],
        clearFormat: state.draftMission.clearFormat,
        status: 'yet',
        isDeletable: true,
        createdAt: Date.now(),
        priority: state.draftMission.priority,
        assignee: state.draftMission.selfClaim ? null : (state.draftMission.assignee || null),
        checklist: _cleanChecklist(state.draftMission.checklist),
        description: String(state.draftMission.description || ''),
        selfClaim: !!state.draftMission.selfClaim,
        leaderCheck: !!state.draftMission.leaderCheck,
        claimMode: state.draftMission.selfClaim ? 'selection' : 'first',
        claimDeadline: (state.draftMission.selfClaim && state.draftMission.claimDeadline) ? state.draftMission.claimDeadline : null,
        claimApplicants: [],
        claimClosed: false,
        assignees: [],
      });
    }
    state.save();
    closeMissionModal();
    state.render();
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
  submitMissionClear: (mid) => submitMissionClear(mid),
  handleImageSelect: (input) => handleImageSelect(input),

  // --- アーカイブ編集 ---
  editArchiveItem: (type) => editArchiveItem(type),

  // --- いいね ---
  handleGoodClick: (e) => handleGoodClick(e),

  // --- 招待 ---
  copyInviteCode: (code) => copyInviteCode(code),
  shareInvite: (code) => shareInvite(code),
  showProjectInviteModal: (code) => showProjectInviteModal(code),

  // --- プロジェクト作成フォーム ---
  updateDraftInfo: (field, value) => updateDraftInfo(field, value),
  removeDraftDateGroup: (jsonGroup) => removeDraftDateGroup(jsonGroup),

  // --- プロジェクト操作（長押しメニューから呼ばれる）---
  openRenameDialog: (id) => openRenameDialog(id),
  openDeleteConfirm: (id) => openDeleteConfirm(id),
  renameProject: (id, name) => state.renameProject(id, name),
  deleteProject: (id) => state.deleteProject(id),

  // --- 認証 ---
  logout: () => state.logout(),
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
        プロジェクトに参加する
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

// ===== アプリ起動 =====
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
