// ===== メインボード画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { getSortedMissions, bindMissionInteractions } from '../modals/mission.js';
import { LABEL_CONFIG } from '../constants.js';

// ── 通知スワイプ削除 ─────────────────────────────────────
// モジュールロード時に一度だけ登録。document 全体にデリゲート。
;(() => {
  let _sw = null; // { row, card, id, startX, startY, swiping }

  document.addEventListener('touchstart', e => {
    const row = e.target.closest('.notif-swipe-row');
    if (!row) { _sw = null; return; }
    _sw = {
      row,
      card:   row.querySelector('.notif-swipe-card'),
      id:     row.dataset.notifId,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      swiping: false,
    };
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!_sw) return;
    const dx = e.touches[0].clientX - _sw.startX;
    const dy = Math.abs(e.touches[0].clientY - _sw.startY);

    // 縦スクロールが主体ならスワイプキャンセル
    if (!_sw.swiping && dy > Math.abs(dx)) { _sw = null; return; }

    if (dx < 0) {
      _sw.swiping = true;
      _sw.card.style.transition = 'none';
      _sw.card.style.transform  = `translateX(${dx}px)`;
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!_sw) return;
    const dx = e.changedTouches[0].clientX - _sw.startX;
    const { row, card, id } = _sw;
    _sw = null;

    if (dx < -80) {
      // 閾値を超えたら削除アニメーション → API 呼び出し
      card.style.transition = 'transform 0.22s ease';
      card.style.transform  = 'translateX(-110%)';
      setTimeout(() => {
        row.style.transition  = 'max-height 0.22s ease, opacity 0.22s ease, margin-bottom 0.22s ease';
        row.style.maxHeight   = row.offsetHeight + 'px';
        row.style.overflow    = 'hidden';
        requestAnimationFrame(() => {
          row.style.maxHeight    = '0';
          row.style.opacity      = '0';
          row.style.marginBottom = '0';
        });
        setTimeout(() => window._app?.deleteNotification(id), 240);
      }, 220);
    } else {
      // スナップバック
      card.style.transition = 'transform 0.2s ease';
      card.style.transform  = 'translateX(0)';
    }
  }, { passive: true });
})();

/**
 * メインボード画面をレンダリングする
 * @param {HTMLElement} container
 */
export function renderMainBoard(container) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) {
    // イベントが見つからない場合：データ再取得を試み、それでも無ければ HOME へ
    console.warn('renderMainBoard: event not found in state.events', {
      selectedEventId: state.selectedEventId,
      eventsCount: state.events.length,
      eventIds: state.events.map(x => x.id),
    });
    // 一度だけ再取得を試みる（既に試み済みでなければ）
    if (!state._mainBoardReloadAttempted) {
      state._mainBoardReloadAttempted = true;
      state.silentReloadEvents?.();
      // 再取得後 setTimeout で再レンダリング、それでも見つからなければ HOME
      setTimeout(() => {
        const found = state.events.find(x => x.id === state.selectedEventId);
        if (!found) {
          state._mainBoardReloadAttempted = false;
          state.setView('HOME');
        }
      }, 500);
      // ローディング表示
      container.innerHTML = `
        <div class="flex items-center justify-center min-h-screen bg-[#FDFBF8]">
          <p class="text-[13px] text-[#A7AAAC] font-bold">読み込み中…</p>
        </div>`;
      return;
    }
    state._mainBoardReloadAttempted = false;
    return state.setView('HOME');
  }
  // イベントが見つかったらフラグをクリア
  state._mainBoardReloadAttempted = false;

  const points        = state.getEventPoints(p);
  const currentPlant  = state.getPlantImagePath(p);
  const stageProgress = state.getStageProgress(points);
  const overallProgress = state.getOverallProgress(points);

  const circleRadius  = 90;
  const circumference = 2 * Math.PI * circleRadius;
  const overallOffset = circumference - (overallProgress / 100) * circumference;
  const stageOffset   = circumference - (stageProgress / 100) * circumference;

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      <div class="sticky top-0 bg-[#FDFBF8] z-30 shadow-sm">
        ${Components.Header(p)}
        ${Components.Tabs(state.mainBoardTab)}
      </div>
      ${Components.VerifyBanner()}
      <main class="flex-1 overflow-y-auto no-scrollbar pb-32">
        ${state.mainBoardTab === 'MAIN'    ? _renderMainTab(p, currentPlant, circumference, overallOffset, stageOffset) : ''}
        ${state.mainBoardTab === 'ARCHIVE' ? _renderArchiveTab(p) : ''}
        ${state.mainBoardTab === 'NOTIFICATIONS' ? _renderNotificationsTab(p) : ''}
      </main>
      ${state.mainBoardTab === 'MAIN' && state.canManageCurrentEvent() ? `
        <button onclick="window._app.openMissionModal()" data-log="mission_add_open"
          class="fixed bottom-10 right-6 w-14 h-14 bg-[#0CA1E3] rounded-full shadow-[0_4px_15px_rgba(12,161,227,0.4)]
          flex items-center justify-center text-white active:scale-90 transition-transform z-40">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
      ${state.mainBoardTab === 'MAIN' && !state.canManageCurrentEvent() && state.currentUser ? `
        <button onclick="window._app.openMemberProposalSheet()"
          class="fixed bottom-10 right-6 w-14 h-14 rounded-full shadow-[0_4px_15px_rgba(158,223,5,0.4)]
          flex items-center justify-center text-white active:scale-90 transition-transform z-40"
          style="background-color: #9EDF05">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
    </div>`;

  if (state.mainBoardTab === 'MAIN') {
    _checkMissionDeadlineNotifications(p.missions || []);
    // ミッションカード：タップ＝完了モーダル（inline onclick）、管理者長押し＝編集/削除メニュー
    bindMissionInteractions(container, p, { useInlineTap: true });
  }
}

// ===== メインタブ =====
function _renderMainTab(p, currentPlant, circumference, overallOffset, stageOffset) {
  const canMgr = state.canManageCurrentEvent();
  const meId   = state.currentUser?.id;

  // ヘルパ：ミッションが「自分が担当している」と言えるか
  const _isMyMission = (m) => {
    if (Array.isArray(m.assignees) && m.assignees.length > 0) {
      return m.assignees.includes(meId);
    }
    return m.assignee?.type === 'user' && m.assignee.userId === meId;
  };
  // ヘルパ：このミッションの担当が「確定済み」か
  const _isAssigned = (m) => {
    if (Array.isArray(m.assignees) && m.assignees.length > 0) return true;
    if (!m.selfClaim && m.assignee?.type === 'user') return true;
    if (m.selfClaim && Array.isArray(m.assignees) && m.assignees.length === 0 && m.assignee?.type === 'user') return true;
    return false;
  };

  // ── ミッション表示モードの定義 ──────────────────────────────────
  // 'all'  : cleared・pending_leader_check 以外を全件表示
  // 'mine' : 自分が担当 / 未割当 / 申告受付中のミッションのみ
  const viewMode = state.missionViewMode || 'all';

  const _isMyOrOpen = (m) => {
    if (m.selfClaim) {
      if (!_isAssigned(m)) return true;  // 申告受付中
      return _isMyMission(m);
    }
    const hasAssignee = (m.assignee?.type === 'user') ||
                        (Array.isArray(m.assignees) && m.assignees.length > 0);
    if (!hasAssignee) return true;       // 未割当
    return _isMyMission(m);
  };

  const ongoingMissions = getSortedMissions(
    p.missions
      .filter(m => m.status !== 'cleared' && m.status !== 'pending_leader_check')
      .filter(m => viewMode === 'all' ? true : _isMyOrOpen(m))
  );

  // ── タグフィルター ──────────────────────────────────────────
  const allTags = [...new Set(
    ongoingMissions.flatMap(m =>
      Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : [])
    )
  )];
  let displayMissions = ongoingMissions;
  if (state.missionFilterTag && allTags.includes(state.missionFilterTag)) {
    displayMissions = ongoingMissions
      .filter(m => {
        const tags = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
        return tags.includes(state.missionFilterTag);
      })
      .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  }
  const tagFilterHtml = allTags.length > 1 ? `
    <div class="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6 mb-3" style="scrollbar-width:none;-webkit-overflow-scrolling:touch">
      <button onclick="window._app.setMissionFilterTag(null)"
        class="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${!state.missionFilterTag ? 'bg-[#484545] text-white' : 'bg-[#EBE8E5] text-[#484545]'}">
        全て
      </button>
      ${allTags.map(tag => {
        const active = state.missionFilterTag === tag;
        const cfg = LABEL_CONFIG[tag] || { color: '#A7AAAC' };
        return `<button onclick="window._app.setMissionFilterTag('${_esc(tag)}')"
          class="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${active ? 'text-white' : 'text-[#484545] bg-white'}"
          style="${active ? `background-color:${cfg.color};border-color:${cfg.color}` : `border-color:${cfg.color}40`}">
          ${_esc(tag)}</button>`;
      }).join('')}
    </div>` : '';

  const proposalCards = p.proposals.map((pr, i) => `
    <div class="relative bg-white border border-[#D3D6D8] rounded-2xl p-2.5 shadow-sm flex flex-col min-h-[120px] active:bg-[#FDFBF8] transition-colors group">
      <div onclick="window._app.addProposalToMission('${pr.id}')" class="cursor-pointer flex-1 flex flex-col">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[7.5px] text-black/40 font-bold">提案${i + 1}</span>
          ${Components.Tag(pr.tag)}
        </div>
        <h3 class="text-[13px] font-bold leading-snug flex-1 break-words">${pr.title}</h3>
      </div>
      <button onclick="window._app.showProposalHelp(event, '${pr.id}')"
        class="absolute bottom-2 right-2 p-1 opacity-40 hover:opacity-100 transition-opacity">
        <img src="/images/icon/icon-Help.svg" class="w-4 h-4">
      </button>
    </div>`).join('');

  const missionCards = displayMissions.length === 0
    ? (state.missionFilterTag
        ? `<p class="text-center py-6 text-[#A7AAAC] text-rs">このタグのミッションはありません</p>`
        : viewMode === 'mine'
          ? `<p class="text-center py-10 text-[#A7AAAC] text-rs">あなたに割り当てられたミッションはありません</p>`
          : '<p class="text-center py-10 text-[#A7AAAC] text-rs">全てのミッションが完了されました！</p>')
    : displayMissions.map(m => {
        const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
        const applicants = Array.isArray(m.claimApplicants) ? m.claimApplicants : [];
        const assignees  = Array.isArray(m.assignees) ? m.assignees : [];
        const iApplied   = applicants.includes(meId);
        const assigned   = _isAssigned(m);
        const myMission  = _isMyMission(m);
        const overdue    = m.claimDeadline && Date.now() > m.claimDeadline;

        // 申告期間中／確定後の表示
        let claimLine = '';
        if (m.selfClaim) {
          const modeBadge = `<span class="text-[9px] text-[#0CA1E3] font-bold border border-[#0CA1E3] px-1.5 rounded">申告制</span>`;
          let actionsBlock = '';

          if (!assigned) {
            const deadlineTxt = m.claimDeadline ? `期限 ${_fmtDeadline(m.claimDeadline)}` : '期限なし';
            if (iApplied) {
              actionsBlock = `
                <span class="px-2 py-0.5 rounded-full bg-[#9EDF05]/20 text-[#5b8104] text-[10px] font-bold">応募中</span>
                <button onclick="event.stopPropagation(); window._app.unclaimMissionAsSelf('${m.id}')"
                  class="text-[10px] text-[#A7AAAC] underline">取り消し</button>`;
            } else if (overdue) {
              actionsBlock = `<span class="text-[10px] text-[#EE3E12] font-bold">応募期限終了</span>`;
            } else {
              actionsBlock = `<button onclick="event.stopPropagation(); window._app.claimMissionAsSelf('${m.id}')"
                class="px-3 py-1 rounded-full bg-[#0CA1E3] text-white text-[11px] font-bold active:scale-95">応募する</button>`;
            }
            actionsBlock += `<span class="text-[10px] text-[#A7AAAC]">応募 ${applicants.length}名・${deadlineTxt}</span>`;
            if (canMgr && applicants.length > 0) {
              actionsBlock += `<button onclick="event.stopPropagation(); window._app.openSelectClaimModal('${m.id}')"
                class="text-[10px] text-[#0CA1E3] underline font-bold">選定する</button>`;
            }
          } else {
            const names = _resolveUsernames(p, assignees);
            actionsBlock = `<span class="text-[10px] text-[#5b8104] font-bold">担当：${names}</span>`;
          }

          claimLine = `<div class="mt-2 flex flex-wrap items-center gap-2">${actionsBlock}</div>`;
          m._modeBadge = modeBadge;
        }

        // 通常担当（申告制でない）の担当者表示
        let assigneeLine = '';
        if (!m.selfClaim) {
          if (assignees.length > 0) {
            const names = _resolveUsernames(p, assignees);
            assigneeLine = `<p class="text-[10px] text-[#484545] font-bold mt-1">担当：${names}</p>`;
          } else if (m.assignee?.type === 'role') {
            const roleObj = (p.roles || []).find(r => r.id === m.assignee.roleId);
            if (roleObj) assigneeLine = `<p class="text-[10px] text-[#484545] font-bold mt-1">担当：${roleObj.name}</p>`;
          }
        }

        const modeBadgeHtml = m._modeBadge || '';

        // 個別完了モード
        const indivClearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [];
        const iIndivDone = m.individualClear && indivClearedBy.includes(meId);

        // 個別完了ミッション：常に完了者リストモーダルを開く
        // 通常ミッション：申告制で自分の担当でない場合は反応しない
        const isClickable = m.individualClear ? true : (!m.selfClaim || myMission);
        const cardOnClick = isClickable
          ? (m.individualClear
              ? `onclick="window._app.openIndividualClearListModal('${m.id}')"`
              : `onclick="window._app.openClearMissionModal('${m.id}')"`)
          : '';
        const cursorCls = isClickable ? 'cursor-pointer active:bg-[#FDFBF8]' : 'cursor-default';

        const _indivHasAssignees = (Array.isArray(m.assignees) && m.assignees.length > 0) || m.assignee?.type === 'user';
        const _indivTotal = Array.isArray(m.assignees) && m.assignees.length > 0
          ? m.assignees.length : (m.assignee?.type === 'user' ? 1 : 0);
        const indivProgressBadge = m.individualClear
          ? (iIndivDone
              ? `<span class="text-[10px] font-bold text-[#5b8104] bg-[#F0FCD4] px-2 py-0.5 rounded-full">自分済み ✓</span>`
              : (_indivHasAssignees
                  ? `<span class="text-[10px] font-bold text-[#A7AAAC] bg-[#EBE8E5] px-2 py-0.5 rounded-full">${indivClearedBy.length}/${_indivTotal}人完了</span>`
                  : ''))
          : '';

        return `
        <div ${cardOnClick} data-mission-id="${m.id}"
          class="bg-white border border-[#D3D6D8] rounded-xl p-4 flex flex-col shadow-sm relative animate-fadeIn group ${cursorCls}">
          <div class="flex items-center gap-2 mb-2 flex-wrap">
            ${tagNames.map(t => Components.Tag(t)).join('')}
            ${_missionDeadlineText(m)}
            ${modeBadgeHtml}
            ${indivProgressBadge}
          </div>
          <h3 class="text-[14px] font-bold text-[#484545] pr-8" style="text-overflow:ellipsis;-webkit-line-clamp: 2;overflow: hidden;">${m.title}</h3>
          ${assigneeLine}
          ${claimLine}
          ${canMgr ? `
            <div onclick="event.stopPropagation(); window._app.toggleMissionMenu(event, '${m.id}')"
              class="absolute right-4 top-4 opacity-40 p-2 cursor-pointer hover:opacity-100 transition-opacity">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
              </svg>
            </div>` : ''}
        </div>`;}).join('');

  // 申告待ちミッション（selfClaim=true かつ applicants あり かつ未確定）
  const pendingClaimMissions = canMgr
    ? p.missions.filter(m =>
        m.selfClaim &&
        m.status !== 'cleared' &&
        m.status !== 'pending_leader_check' &&
        m.selfClaim &&
        Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
        !(Array.isArray(m.assignees) && m.assignees.length > 0)
      )
    : [];

  const memberProposals   = canMgr ? (p.memberProposals  || []) : [];
  const pendingMembers    = canMgr ? (p.pendingMembers   || []) : [];
  const leaderCheckMissions = canMgr
    ? (p.missions || []).filter(m => m.status === 'pending_leader_check')
    : [];

  const hasDates = Array.isArray(p.dates) && p.dates.length > 0;
  const _dateChip = (() => {
    if (!hasDates) return `<span class="text-[11px] font-bold text-[#A7AAAC]">開催日時が設定されていません</span>`;
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const sorted = [...p.dates].sort();
    const firstDate = sorted[0];
    const lastDate  = sorted[sorted.length - 1];
    const todayIdx  = sorted.indexOf(todayStr);
    if (todayIdx !== -1) {
      const dayNum = todayIdx + 1;
      const isFirst = dayNum === 1;
      const isLast  = todayIdx === sorted.length - 1;
      if (isFirst) return `<span class="text-[12px] font-bold">Day${dayNum} / いよいよ今日から！</span>`;
      if (isLast)  return `<span class="text-[12px] font-bold">Day${dayNum} / ついに最終日！</span>`;
      return `<span class="text-[12px] font-bold"><span class="text-[18px] font-mono">Day${dayNum}</span></span>`;
    }
    if (todayStr > lastDate) {
      const fmt = s => { const [, m, day] = s.split('-'); return `${parseInt(m)}月${parseInt(day)}日`; };
      const range = (firstDate === lastDate)
        ? `${fmt(firstDate)}開催`
        : `${fmt(firstDate)}〜${fmt(lastDate)}開催`;
      return `<span class="text-[12px] font-bold text-[#A7AAAC]">${range}</span>`;
    }
    return `<span class="text-[12px] font-bold">開催まで残り <span class="text-[18px] font-mono">${p.daysLeft}</span> 日</span>`;
  })();
  return `
    <div class="px-6 pt-4 space-y-6 page-transition">
      <div onclick="window._app.openEventCalendarSheet()" data-log="event_calendar_open"
        class="cursor-pointer bg-white border border-[#D3D6D8] rounded-full px-4 py-2 flex items-center justify-center gap-3 shadow-sm mx-auto w-fit active:scale-95 transition-transform">
        <img src="/images/icon/icon-Calender.svg" class="w-4 h-4">
        ${_dateChip}
      </div>

      <!-- アナウンスカード -->
      ${_renderAnnounceCards(p, meId)}

      <!-- 承認待ちメンバーバナー（管理者のみ・該当がある場合のみ表示）-->
      ${pendingMembers.length > 0 ? _renderPendingMembersBanner(pendingMembers) : ''}

      <!-- メンバー提案バナー（管理者のみ・該当がある場合のみ表示）-->
      ${memberProposals.length > 0 ? _renderMemberProposalsBanner(memberProposals) : ''}

      <!-- リーダーチェック待ちバナー（管理者のみ・該当がある場合のみ表示）-->
      ${leaderCheckMissions.length > 0 ? _renderLeaderCheckBanner(leaderCheckMissions) : ''}

      <!-- 申告待ちアナウンスバナー（管理者のみ・該当がある場合のみ表示）-->
      ${pendingClaimMissions.length > 0 ? _renderClaimAnnouncementBanner(p, pendingClaimMissions) : ''}

      <!-- 成長インジケーター -->
      <div class="flex justify-center -mt-2">
        <div class="relative w-52 h-52 flex items-center justify-center">
          <svg class="absolute w-full h-full transform -rotate-90" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" stroke="#EBE8E5" stroke-width="12" fill="none"/>
            <circle cx="100" cy="100" r="90" stroke="#0CA1E3" stroke-width="8" fill="none"
              stroke-dasharray="${circumference}" stroke-dashoffset="${overallOffset}"
              stroke-linecap="round" class="opacity-20" style="transition: stroke-dashoffset 1s ease-out"/>
            <circle cx="100" cy="100" r="90" stroke="#0CA1E3" stroke-width="12" fill="none"
              stroke-dasharray="${circumference}" stroke-dashoffset="${stageOffset}"
              stroke-linecap="round" style="transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)"/>
          </svg>
          <div class="w-40 h-40 bg-[#CFD8FF] rounded-full flex items-center justify-center overflow-hidden z-10 shadow-inner">
            <img src="${currentPlant}" class="w-28 h-32 object-contain mt-2 transition-all duration-500 transform hover:scale-110">
          </div>
        </div>
      </div>

      <!-- 提案カード（管理者権限のあるユーザーのみ表示）-->
      ${canMgr ? `
        <div class="grid grid-cols-3 gap-2">
          ${proposalCards}
          ${(p.proposals.length < 3 && (!p.lastProposalGeneratedAt || state._proposalFetching))
            // 動的枠を AI 生成中：空きスロットにローディングカードを出す（静的提案は出さない）
            ? Array.from({ length: 3 - p.proposals.length }).map(() => `
                <div class="bg-white border border-[#D3D6D8] rounded-2xl p-2.5 shadow-sm flex flex-col items-center justify-center gap-2 min-h-[120px]">
                  <div class="w-6 h-6 border-2 border-[#0CA1E3] border-t-transparent rounded-full animate-spin"></div>
                  <span class="text-[9px] text-[#A7AAAC] font-bold text-center leading-tight">AIが提案を<br>生成中</span>
                </div>`).join('')
            : (p.proposals.length === 0 ? (() => {
                const nextAt  = (p.lastProposalGeneratedAt || 0) + 12 * 60 * 60 * 1000;
                const remMs   = Math.max(0, nextAt - Date.now());
                const remHr   = Math.ceil(remMs / (1000 * 60 * 60));
                const label   = remMs <= 0 ? '準備中...' : `${remHr}時間後に新しい提案が届きます`;
                return `<div class="col-span-3 py-4 text-center text-[#A7AAAC] text-[10px] font-bold animate-pulse">${label}</div>`;
              })() : '')}
        </div>` : ''}

      <!-- ミッション一覧 -->
      <section>
        <div class="flex items-center justify-between mb-3">
          <h2 class="heading-m">ミッション</h2>
          <div class="relative">
            <button onclick="window._app.toggleSortMenu(event)" class="p-1 active:scale-95 transition-transform">
              <img src="/images/icon/icon-Filter.svg" class="w-5 h-4">
            </button>
          </div>
        </div>
        <!-- 表示モード切替（私のみ / 全て）-->
        <div class="flex gap-1 bg-[#EBE8E5] rounded-xl p-1 mb-3">
          <button onclick="window._app.setMissionViewMode('mine')"
            class="flex-1 py-1.5 text-[12px] font-bold rounded-lg transition-all
            ${viewMode === 'mine' ? 'bg-white text-[#484545] shadow-sm' : 'text-[#A7AAAC]'}">
            私のミッション
          </button>
          <button onclick="window._app.setMissionViewMode('all')"
            class="flex-1 py-1.5 text-[12px] font-bold rounded-lg transition-all
            ${viewMode === 'all' ? 'bg-white text-[#484545] shadow-sm' : 'text-[#A7AAAC]'}">
            全てのミッション
          </button>
        </div>
        ${tagFilterHtml}
        <div class="space-y-3 pb-10">${missionCards}</div>
      </section>
    </div>`;
}

// ===== 承認待ちメンバーバナー（管理者向け）=====
function _renderPendingMembersBanner(members) {
  return `
    <div onclick="window._app.openPendingMembersSheet()"
      class="cursor-pointer bg-[#FFF8E1] border border-[#FFC300]/60 rounded-2xl p-4 shadow-sm active:scale-[0.99] transition-transform">
      <div class="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>
        </svg>
        <p class="text-[12px] font-bold text-[#9b7700]">参加申請が届いています（${members.length}件）</p>
      </div>
    </div>`;
}

// ===== メンバー提案バナー（管理者向け）=====
function _renderMemberProposalsBanner(proposals) {
  return `
    <div onclick="window._app.openMemberProposalsSheet()"
      class="cursor-pointer bg-[#F0FDE8] border border-[#9EDF05]/60 rounded-2xl p-4 shadow-sm active:scale-[0.99] transition-transform">
      <div class="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <p class="text-[12px] font-bold text-[#5b8104]">ミッションの提案があります（${proposals.length}件）</p>
      </div>
    </div>`;
}

// ===== リーダーチェック待ちバナー（管理者向け）=====
function _renderLeaderCheckBanner(missions) {
  return `
    <div onclick="window._app.openLeaderCheckSheet()"
      class="cursor-pointer bg-[#FFF0ED] border border-[#EE3E12]/40 rounded-2xl p-4 shadow-sm active:scale-[0.99] transition-transform">
      <div class="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EE3E12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <p class="text-[12px] font-bold text-[#EE3E12]">リーダーチェック待ちがあります（${missions.length}件）</p>
      </div>
    </div>`;
}

// ===== 申告待ちアナウンスバナー（管理者向け）=====
function _renderClaimAnnouncementBanner(p, missions) {
  const rows = missions.map(m => {
    const count = m.claimApplicants.length;
    const names = m.claimApplicants.slice(0, 3).map(uid => {
      const mem = (p.members || []).find(x => x.userId === uid);
      return mem ? `@${mem.username}` : '?';
    }).join('、') + (count > 3 ? ` 他${count - 3}名` : '');

    return `
      <div class="flex items-center justify-between gap-2 py-2 border-b border-[#FFC300]/30 last:border-0">
        <div class="flex-1 min-w-0">
          <p class="text-[12px] font-bold text-[#484545] truncate">${_esc(m.title)}</p>
          <p class="text-[10px] text-[#A7AAAC] mt-0.5">${names}</p>
        </div>
        <button onclick="event.stopPropagation(); window._app.openSelectClaimModal('${m.id}')"
          class="flex-shrink-0 px-3 py-1.5 rounded-full bg-[#FFC300] text-white text-[11px] font-bold active:scale-95 transition-transform shadow-sm">
          選定する
        </button>
      </div>`;
  }).join('');

  return `
    <div class="bg-[#FFF8E1] border border-[#FFC300]/60 rounded-2xl p-4 shadow-sm">
      <div class="flex items-center gap-2 mb-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <p class="text-[12px] font-bold text-[#9b7700]">ミッションへの申告があります（${missions.length}件）</p>
      </div>
      <div>${rows}</div>
    </div>`;
}

function _renderAnnounceCards(p, meId) {
  const active = [...(p.missions || [])].filter(m => {
    if (!m.announce || m.status === 'cleared') return false;
    const hasAssignee = m.assignee || (Array.isArray(m.assignees) && m.assignees.length > 0);
    if (!hasAssignee) return true;
    if (m.assignee?.type === 'user' && m.assignee.userId === meId) return true;
    if (Array.isArray(m.assignees) && m.assignees.includes(meId)) return true;
    if (m.assignee?.type === 'role') {
      const mem = (p.members || []).find(x => x.userId === meId);
      if (mem && Array.isArray(mem.roles) && mem.roles.includes(m.assignee.roleId)) return true;
    }
    return false;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // 新しい順

  if (active.length === 0) return '';

  const _deadlineLabel = (m) => {
    if (!Array.isArray(m.dates) || m.dates.length === 0) return '';
    const end = [...m.dates].sort().at(-1);
    const target = new Date(end); target.setHours(0,0,0,0);
    const now = new Date(); now.setHours(0,0,0,0);
    const diff = Math.ceil((target - now) / 86_400_000);
    if (diff < 0)  return `<span class="text-[10px] font-bold text-[#E74C3C]">${-diff}日超過</span>`;
    if (diff === 0) return `<span class="text-[10px] font-bold text-[#E74C3C]">今日まで</span>`;
    return `<span class="text-[10px] font-bold text-[#A7AAAC]">残り${diff}日</span>`;
  };

  // タップでミッション完了モーダルを開く（個別完了は完了者リスト、通常は完了モーダル。ミッションカードと同挙動）
  const _cardClick = (m) => m.individualClear
    ? `onclick="window._app.openIndividualClearListModal('${m.id}')"`
    : `onclick="window._app.openClearMissionModal('${m.id}')"`;

  const cardHtml = (m) => `
    <div ${_cardClick(m)}
      class="bg-[#EAF6FF] border border-[#0CA1E3]/40 rounded-2xl px-4 py-3 cursor-pointer active:bg-[#D4EFFF] transition-colors">
      <div class="flex items-start gap-2">
        <svg class="flex-shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0CA1E3" stroke-width="2.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] font-bold text-[#484545] mb-1 truncate">${_esc(m.title)}</p>
          ${m.description ? `<p class="text-[11px] text-[#6b6b6b] mb-1 whitespace-pre-wrap break-words">${_esc(m.description)}</p>` : ''}
          <div class="flex items-center gap-3 flex-wrap">
            ${_deadlineLabel(m)}
          </div>
        </div>
      </div>
    </div>`;

  if (active.length === 1) {
    return cardHtml(active[0]);
  }

  // 複数の場合：折りたたみ式
  const listId = 'announce-list-' + (p.id || 'x');
  const cards = active.map(cardHtml).join('');
  return `
    <div class="bg-[#EAF6FF] border border-[#0CA1E3]/40 rounded-2xl overflow-hidden">
      <button onclick="
        const el=document.getElementById('${listId}');
        const icon=this.querySelector('.announce-chevron');
        if(el.style.display==='none'){el.style.display='';icon.style.transform='rotate(0deg)';}
        else{el.style.display='none';icon.style.transform='rotate(-90deg)';}
      " class="w-full flex items-center justify-between px-4 py-3 active:bg-[#D4EFFF]">
        <div class="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0CA1E3" stroke-width="2.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="text-[12px] font-bold text-[#0CA1E3]">アナウンス（${active.length}件）</span>
        </div>
        <svg class="announce-chevron transition-transform" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="#0CA1E3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div id="${listId}" class="space-y-2 px-4 pb-3">${cards}</div>
    </div>`;
}

// ── アーカイブ：概要カードスロット識別 ───────────────────────────
// clearedData のキーがこれらのミッションIDに一致するものは Layer 1（概要カード）専用
const _OVERVIEW_IDS     = new Set(['def-2', 'def-3']);
const _OVERVIEW_ORIGINS = new Set(['p1', 'p2', 'p3']);
const _ARCHIVE_TAG_ORDER = ['企画', '運営', '制作', '広報'];

function _isOverviewMission(m) {
  return _OVERVIEW_IDS.has(m.id) || _OVERVIEW_ORIGINS.has(m.originProposalId);
}

// originProposalId で生成されたミッションの clearedData を返す
function _getClearedByOrigin(p, originId) {
  const m = (p.missions || []).find(x => x.originProposalId === originId && x.status === 'cleared');
  return m ? (p.clearedData?.[m.id] ?? null) : null;
}

// ===== アーカイブタブ =====
function _renderArchiveTab(p) {
  const canMgr = state.canManageCurrentEvent();
  const _pen   = (type) => canMgr ? Components.PenIcon(type) : '';
  // ── Layer 1 データ取得（固定IDで紐づけ）──────────────────────
  const title   = p.clearedData?.['def-2']?.content ?? '未設定';
  const summary = p.clearedData?.['def-3']?.content ?? '未設定';
  const mainVisual = p.clearedData?.['archive-image']?.content
    ?? _getClearedByOrigin(p, 'p3')?.content
    ?? null;
  const url        = _getClearedByOrigin(p, 'p2')?.content ?? '未設定';
  const venue      = _getClearedByOrigin(p, 'p1')?.content ?? '未設定';
  // p.dates を優先し、旧 period-temp は後方互換フォールバック
  const period     = p.dates?.length > 0
    ? `${p.dates[0]} 〜 ${p.dates[p.dates.length - 1]}`
    : (p.clearedData?.['period-temp']?.content || '未設定');

  // ── Layer 2 データ取得（概要スロット以外の完了ミッション）──────
  const clearedMissions = (p.missions || []).filter(m =>
    m.status === 'cleared' && !_isOverviewMission(m)
  );

  const groups = {};
  for (const m of clearedMissions) {
    const tag = (Array.isArray(m.tags) && m.tags.length > 0 ? m.tags[0] : null) || m.tag || '企画';
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(m);
  }

  const mode = state.archiveDisplayMode || 'label';
  const archiveTabBtns = ['label','date','priority','assignee','creator'].map(m => {
    const label = { label:'ラベル別', date:'完了日順', priority:'優先度順', assignee:'完了者別', creator:'作成者別' }[m];
    const active = mode === m;
    return `<button onclick="window._app.setArchiveDisplayMode('${m}')"
      class="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${active ? 'bg-[#484545] text-white border-[#484545]' : 'bg-white text-[#484545] border-[#D3D6D8]'}">
      ${label}</button>`;
  }).join('');

  let missionsRecordHtml = '';
  if (mode === 'label') {
    missionsRecordHtml = _ARCHIVE_TAG_ORDER
      .filter(tag => groups[tag]?.length > 0)
      .map(tag => _renderArchiveCategorySection(p, tag, groups[tag]))
      .join('');
    // カスタムタグで _ARCHIVE_TAG_ORDER に含まれないものも追加
    const extraTags = Object.keys(groups).filter(t => !_ARCHIVE_TAG_ORDER.includes(t) && groups[t]?.length > 0);
    if (extraTags.length > 0) {
      missionsRecordHtml += extraTags.map(tag => _renderArchiveCategorySection(p, tag, groups[tag])).join('');
    }
  } else if (mode === 'date') {
    const sorted = [...clearedMissions].sort((a, b) =>
      (p.clearedData?.[b.id]?.timestamp ?? 0) - (p.clearedData?.[a.id]?.timestamp ?? 0)
    );
    missionsRecordHtml = `<div class="space-y-3">${sorted.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>`;
  } else if (mode === 'priority') {
    const sorted = [...clearedMissions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    missionsRecordHtml = `<div class="space-y-3">${sorted.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>`;
  } else if (mode === 'assignee') {
    const assigneeGroups = {};
    for (const m of clearedMissions) {
      // submittedBy（実際の完了者）を優先し、なければ assignee にフォールバック
      const uid = p.clearedData?.[m.id]?.submittedBy
        || (Array.isArray(m.assignees) && m.assignees.length > 0 ? m.assignees[0] : null)
        || (m.assignee?.type === 'user' ? m.assignee.userId : null);
      const mem = uid ? (p.members || []).find(x => x.userId === uid) : null;
      const key = mem?.username || uid || '不明';
      if (!assigneeGroups[key]) assigneeGroups[key] = [];
      assigneeGroups[key].push(m);
    }
    missionsRecordHtml = Object.entries(assigneeGroups).map(([name, missions]) => `
      <div class="mb-4">
        <p class="text-[12px] font-bold text-[#A7AAAC] mb-2">@${_esc(name)}（${missions.length}件）</p>
        <div class="space-y-3">${missions.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>
      </div>`).join('');
  } else if (mode === 'creator') {
    const creatorGroups = {};
    for (const m of clearedMissions) {
      const uid = m.createdBy || null;
      const mem = uid ? (p.members || []).find(x => x.userId === uid) : null;
      const key = mem?.username || (uid ? uid : '作成者不明');
      if (!creatorGroups[key]) creatorGroups[key] = [];
      creatorGroups[key].push(m);
    }
    missionsRecordHtml = Object.entries(creatorGroups).map(([name, missions]) => `
      <div class="mb-4">
        <p class="text-[12px] font-bold text-[#A7AAAC] mb-2">@${_esc(name)}（${missions.length}件）</p>
        <div class="space-y-3">${missions.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>
      </div>`).join('');
  }

  const hasDatesA = Array.isArray(p.dates) && p.dates.length > 0;
  return `
    <div class="pb-20 page-transition space-y-6">
      <div class="px-6 pt-6 flex items-center justify-between">
        <div onclick="window._app.openEventCalendarSheet()" data-log="event_calendar_open"
          class="flex items-center gap-2 bg-white border border-[#D3D6D8] rounded-full px-3 py-1.5 shadow-sm active:scale-95 transition-transform cursor-pointer">
          <img src="/images/icon/icon-Calender.svg" class="w-3.5 h-3.5">
          ${hasDatesA
            ? `<span class="text-[11px] font-bold text-[#484545]">残り <span class="text-[15px] font-mono">${p.daysLeft}</span> 日</span>`
            : `<span class="text-[10px] font-bold text-[#A7AAAC]">未設定</span>`}
        </div>
        <button onclick="window._app.handleGoodClick(event)"
          class="flex items-center gap-2 px-4 py-2 rounded-full border shadow-sm transition-all active:scale-90
          ${p.hasLiked ? 'border-[#EE3E12] bg-[#EE3E12]/5' : 'border-[#D3D6D8] bg-white'}">
          <img src="/images/icon/icon-Good${p.hasLiked ? '-pressed' : ''}.svg" class="w-6 h-6">
          <span class="text-rs font-bold font-mono ${p.hasLiked ? 'text-[#EE3E12]' : 'text-[#A7AAAC]'}">${p.likes || 0}</span>
        </button>
      </div>

      <!-- Layer 1: メインビジュアル -->
      <div class="relative group w-full aspect-[2/1] overflow-hidden bg-[#EBE8E5] flex items-center justify-center shadow-inner">
        ${mainVisual
          ? `<img src="${mainVisual}" class="w-full h-full object-cover">`
          : `<img src="/images/icon/icon-image.svg" class="w-12 h-12 opacity-20">`}
        ${canMgr ? `<div class="absolute bottom-4 right-4 bg-white/80 p-2 rounded-full shadow-lg">
          ${_pen('image')}
        </div>` : ''}
      </div>

      <!-- Layer 1: イベント概要カード -->
      <div class="px-6 space-y-8">
        <div class="text-center">
          <div class="flex items-center justify-center gap-2 mb-1">
            <h2 class="text-[18px] font-bold text-[#484545] leading-snug">「${title}」</h2>
            ${_pen('title')}
          </div>
        </div>
        <div class="space-y-6">
          <section>
            <div class="flex items-center gap-2 mb-2">
              <h3 class="text-[12px] font-bold text-[#A7AAAC]">概要</h3>
              ${_pen('summary')}
            </div>
            <p class="text-[13px] text-[#484545] leading-relaxed whitespace-pre-wrap font-medium">${summary}</p>
          </section>
          <section class="grid grid-cols-[80px_1fr_40px] gap-y-6 text-[13px]">
            <div class="font-bold text-[#A7AAAC]">期間</div>
            <div class="font-bold text-[#484545] flex items-center gap-2">${period} ${_pen('period')}</div>
            <div></div>
            <div class="font-bold text-[#A7AAAC]">URL</div>
            <div class="font-bold text-[#0CA1E3] underline truncate">${url}</div>
            <div>${_pen('url')}</div>
            <div class="font-bold text-[#A7AAAC]">場所</div>
            <div class="font-bold text-[#484545]">${venue}</div>
            <div>${_pen('venue')}</div>
          </section>
        </div>
        <button onclick="window._app.showMissionListModal()"
          class="btn-secondary w-full py-4 heading-r font-bold">ミッション一覧</button>
      </div>

      <!-- Layer 2: ミッションの記録 -->
      <div class="px-6 pt-2 pb-4">
        <div class="flex items-center gap-3 mb-3">
          <h2 class="heading-m">ミッションの記録</h2>
          ${clearedMissions.length > 0
            ? `<span class="text-[11px] text-[#A7AAAC] font-bold bg-[#EBE8E5] px-2 py-0.5 rounded-full">${clearedMissions.length}件</span>`
            : ''}
        </div>
        ${clearedMissions.length > 0 ? `
          <div class="flex gap-2 overflow-x-auto pb-3 -mx-6 px-6" style="scrollbar-width:none;-webkit-overflow-scrolling:touch">
            ${archiveTabBtns}
          </div>` : ''}
        ${missionsRecordHtml || `<p class="text-center py-8 text-[#A7AAAC] text-[12px] font-bold">完了したミッションが記録されます</p>`}
      </div>
    </div>`;
}

// カテゴリセクション（折りたたみ付き）
function _renderArchiveCategorySection(p, tag, missions) {
  const cfg       = LABEL_CONFIG[tag] || { color: '#A7AAAC' };
  const collapsed = state.archiveCollapsed?.[tag] ?? false;
  const items     = missions.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], tag)).join('');

  return `
    <div data-archive-section="${_esc(tag)}" class="mb-1">
      <button onclick="window._app.toggleArchiveSection('${_esc(tag)}')"
        class="w-full flex items-center justify-between py-3 border-b border-[#D3D6D8] active:opacity-60">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${cfg.color}"></span>
          <span class="text-[13px] font-bold text-[#484545]">${_esc(tag)}</span>
          <span class="text-[11px] text-[#A7AAAC] font-bold">${missions.length}件</span>
        </div>
        <svg class="archive-section-arrow w-4 h-4 text-[#A7AAAC] transition-transform${collapsed ? ' -rotate-90' : ''}"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="archive-section-body space-y-3 pt-3 pb-2"${collapsed ? ' style="display:none"' : ''}>
        ${items}
      </div>
    </div>`;
}

// ミッションブロック（text / image / link で表示切替）
function _renderArchiveMissionBlock(m, cd, sectionTag) {
  const canMgr      = state.canManageCurrentEvent();
  const tagNames    = (Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : [sectionTag]));
  const completedAt = cd?.timestamp ? _fmtDate(cd.timestamp) : '';

  let contentHtml = '';
  if (cd?.content) {
    if (cd.format === 'image') {
      contentHtml = `<img src="${cd.content}" class="w-full max-h-48 object-cover rounded-lg mt-2" loading="lazy">`;
    } else if (cd.format === 'link') {
      contentHtml = `
        <div class="flex items-center gap-2 mt-2 p-3 border border-[#D3D6D8] rounded-lg bg-[#FDFBF8] overflow-hidden">
          <svg class="w-4 h-4 flex-shrink-0 text-[#0CA1E3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <span class="text-[11px] text-[#0CA1E3] underline truncate break-all">${_esc(cd.content)}</span>
        </div>`;
    } else {
      contentHtml = `<p class="text-[12px] text-[#484545] bg-[#FDFBF8] p-3 rounded-lg whitespace-pre-wrap break-words mt-2 leading-relaxed">${_esc(cd.content)}</p>`;
    }
  }

  const clearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [];
  const totalAssignees = Array.isArray(m.assignees) && m.assignees.length > 0
    ? m.assignees.length
    : (m.assignee?.type === 'user' ? 1 : clearedBy.length);
  const indivSummary = m.individualClear
    ? `<span class="text-[10px] text-[#5b8104] font-bold bg-[#F0FCD4] px-2 py-0.5 rounded-full">${clearedBy.length}/${Math.max(1,totalAssignees)}人完了</span>`
    : '';
  const archiveClick = m.individualClear
    ? `onclick="window._app.openIndividualClearListModal('${m.id}')"`
    : '';
  const archiveCursor = m.individualClear ? 'cursor-pointer active:bg-[#FDFBF8]' : '';

  const meatballBtn = canMgr ? `
    <button onclick="event.stopPropagation(); window._app.openArchiveMissionMenu(event, '${m.id}')"
      class="absolute top-3 right-3 p-2 opacity-40 hover:opacity-100 transition-opacity active:scale-90">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
      </svg>
    </button>` : '';

  return `
    <div ${archiveClick} class="bg-white border border-[#D3D6D8] rounded-xl p-4 shadow-sm relative ${archiveCursor}">
      <div class="flex items-center justify-between mb-1.5 ${canMgr ? 'pr-7' : ''}">
        <div class="flex items-center gap-1.5 flex-wrap">
          ${tagNames.map(t => Components.Tag(t)).join('')}
          ${indivSummary}
        </div>
        ${completedAt ? `<span class="text-[10px] text-[#A7AAAC] flex-shrink-0">${completedAt}完了</span>` : ''}
      </div>
      <h3 class="text-[13px] font-bold text-[#484545] ${canMgr ? 'pr-6' : ''}">${_esc(m.title)}</h3>
      ${contentHtml}
      ${meatballBtn}
    </div>`;
}

// ===== 通知タブ =====
function _renderNotificationsTab(p) {
  const canMgr = state.canManageCurrentEvent();

  // リーダー確認待ちのミッション（管理者権限のあるユーザーのみ）
  const pendingMissions = canMgr
    ? p.missions.filter(m => m.status === 'pending_leader_check')
    : [];

  // 申告待ちのミッション（管理者権限のあるユーザーのみ）
  const claimingMissions = canMgr
    ? p.missions.filter(m =>
        m.selfClaim &&
        m.status !== 'cleared' &&
        m.status !== 'pending_leader_check' &&
        m.selfClaim &&
        Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
        !(Array.isArray(m.assignees) && m.assignees.length > 0)
      )
    : [];

  // 申告待ちセクション
  const claimingHtml = claimingMissions.length === 0 ? '' : `
    <section class="px-6 pt-6">
      <h2 class="heading-rs font-bold text-[#484545] mb-3">申告待ち（${claimingMissions.length}件）</h2>
      <div class="space-y-3">
        ${claimingMissions.map(m => {
          const applicants = m.claimApplicants || [];
          const applicantNames = applicants.map(uid => {
            const mem = (p.members || []).find(x => x.userId === uid);
            return mem ? `@${mem.username}` : '不明なユーザー';
          });
          return `
          <div class="bg-white border border-[#FFC300]/40 rounded-2xl p-4 shadow-sm">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <span class="text-[9px] text-[#9b7700] font-bold border border-[#FFC300] px-1.5 rounded bg-[#FFF8E1]">申告あり</span>
              <span class="text-[11px] text-[#A7AAAC] font-bold">${applicants.length}名が応募中</span>
            </div>
            <h3 class="text-[14px] font-bold text-[#484545] mb-2">${_esc(m.title)}</h3>
            <div class="mt-2 mb-3 pt-2 border-t border-[#EBE8E5]">
              <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">応募者</p>
              <p class="text-[12px] text-[#484545]">${applicantNames.join('、')}</p>
            </div>
            <button onclick="window._app.openSelectClaimModal('${m.id}')"
              class="w-full py-2 rounded-lg text-[12px] font-bold text-white bg-[#FFC300] active:scale-95">
              担当者を選定する
            </button>
          </div>`;
        }).join('')}
      </div>
    </section>`;

  const pendingHtml = pendingMissions.length === 0 ? '' : `
    <section class="px-6 pt-6">
      <h2 class="heading-rs font-bold text-[#484545] mb-3">確認待ち（${pendingMissions.length}件）</h2>
      <div class="space-y-3">
        ${pendingMissions.map(m => {
          const submitter = (p.members || []).find(x => x.userId === m.assignee?.userId);
          const cleared = p.clearedData?.[m.id];
          return `
          <div class="bg-white border border-[#0CA1E3]/30 rounded-2xl p-4 shadow-sm">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <span class="text-[9px] text-[#0CA1E3] font-bold border border-[#0CA1E3] px-1.5 rounded">確認待ち</span>
              <span class="text-[11px] text-[#A7AAAC] font-bold">${submitter ? '@' + submitter.username + ' が提出' : '提出済み'}</span>
            </div>
            <h3 class="text-[14px] font-bold text-[#484545] mb-2">${_esc(m.title)}</h3>
            ${cleared ? `
              <div class="mt-2 mb-3 pt-2 border-t border-[#EBE8E5]">
                <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">提出内容</p>
                ${cleared.format === 'image'
                  ? `<img src="${cleared.content}" class="w-full max-h-40 object-cover rounded-lg">`
                  : `<p class="text-[12px] text-[#484545] bg-[#FDFBF8] p-2 rounded break-words">${_esc(cleared.content)}</p>`}
              </div>` : ''}
            <div class="flex gap-2">
              <button onclick="window._app.rejectMission('${m.id}')"
                class="flex-1 py-2 rounded-lg text-[12px] font-bold text-[#EE3E12] bg-[#FFEEEA] active:scale-95">差し戻す</button>
              <button onclick="window._app.approveMission('${m.id}')"
                class="flex-1 py-2 rounded-lg text-[12px] font-bold text-white bg-[#0CA1E3] active:scale-95">承認する</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>`;

  // 通知一覧（このイベントに紐づく通知のみ。他イベントの通知は表示しない）
  const allNotifs = Array.isArray(state.notifications) ? state.notifications : [];
  const notifs = allNotifs.filter(n => n.eventId === p.id);
  const unreadCount = notifs.filter(n => !n.read).length;

  const notifsHtml = notifs.length === 0 ? `
    <p class="text-center py-12 text-[#A7AAAC] text-rs font-bold">通知はありません</p>` : `
    <div>
      ${notifs.map(n => `
        <div class="notif-swipe-row relative overflow-hidden rounded-xl mb-2" data-notif-id="${n.id}">
          <div class="absolute inset-0 bg-[#EE3E12] flex items-center justify-end pr-5 pointer-events-none rounded-xl">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </div>
          <div class="notif-swipe-card relative ${n.read ? 'bg-white' : 'bg-[#FDFBF8] border-l-4 border-[#EE3E12]'} border border-[#E1DFDC] rounded-xl p-3 flex items-start gap-3 cursor-pointer active:bg-[#EBE8E5]"
            onclick="window._app.openNotification('${n.id}', '${n.missionId || ''}')">
            <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${_notifIconBg(n.type)}">
              ${_notifIcon(n.type)}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-[12px] text-[#484545] leading-snug ${n.read ? '' : 'font-bold'}">${_esc(n.message)}</p>
              <p class="text-[10px] text-[#A7AAAC] mt-1">${_formatNotifTime(n.createdAt)}</p>
            </div>
            ${!n.read ? '<span class="w-2 h-2 rounded-full bg-[#EE3E12] flex-shrink-0 mt-1"></span>' : ''}
          </div>
        </div>`).join('')}
    </div>`;

  return `
    <div class="flex-1 flex flex-col page-transition pb-20">
      ${claimingHtml}
      ${pendingHtml}
      <section class="px-6 pt-6 flex-1">
        <div class="flex items-center justify-between mb-3">
          <h2 class="heading-rs font-bold text-[#484545]">通知</h2>
          ${unreadCount > 0 ? `
            <button onclick="window._app.markAllNotificationsRead()"
              class="text-[11px] text-[#0CA1E3] font-bold px-3 py-1 active:opacity-50">すべて既読</button>` : ''}
        </div>
        ${notifsHtml}
      </section>
    </div>`;
}

function _notifIconBg(type) {
  switch (type) {
    case 'mission_cleared':       return 'bg-[#9EDF05]/20';
    case 'assigned_to_me':        return 'bg-[#0CA1E3]/20';
    case 'someone_claimed':       return 'bg-[#FFC300]/20';
    case 'assignment_decided':    return 'bg-[#9EDF05]/20';
    case 'pending_leader_check':  return 'bg-[#EE3E12]/20';
    case 'leader_approved':       return 'bg-[#9EDF05]/20';
    case 'leader_rejected':       return 'bg-[#EE3E12]/20';
    case 'member_joined':         return 'bg-[#9EDF05]/20';
    case 'role_assigned':         return 'bg-[#0CA1E3]/20';
    case 'mission_created':       return 'bg-[#A78BFA]/20';
    case 'mission_updated':       return 'bg-[#A78BFA]/20';
    case 'mission_reverted':      return 'bg-[#FFC300]/20';
    case 'self_claimed':          return 'bg-[#FFC300]/20';
    default: return 'bg-[#EBE8E5]';
  }
}

function _notifIcon(type) {
  const cls = 'w-4 h-4';
  switch (type) {
    case 'mission_cleared':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'assigned_to_me':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#0CA1E3" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    case 'someone_claimed':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
    case 'assignment_decided':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>`;
    case 'pending_leader_check':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#EE3E12" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    case 'leader_approved':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'leader_rejected':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#EE3E12" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    case 'member_joined':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>`;
    case 'role_assigned':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#0CA1E3" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7"/><polyline points="15 17 17 19 21 15"/></svg>`;
    case 'mission_created':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
    case 'mission_updated':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
    case 'mission_reverted':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
    case 'self_claimed':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
    default:
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
  }
}

function _formatNotifTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000)    return 'たった今';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ミッションの残り日数テキスト（dates をソートし最終日から計算）
function _missionDeadlineText(m) {
  if (!Array.isArray(m.dates) || m.dates.length === 0) {
    return '<span class="text-[11px] text-black/40 font-bold">スケジュール未設定</span>';
  }
  const endDate = [...m.dates].sort().at(-1);
  const target = new Date(endDate);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diff = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  if (diff < 0)  return `<span class="text-[11px] font-bold" style="color:#E74C3C">${-diff}日超過</span>`;
  if (diff === 0) return `<span class="text-[11px] font-bold" style="color:#E74C3C">今日まで</span>`;
  return `<span class="text-[11px] text-black/40 font-bold">残り${diff}日</span>`;
}

// 締め切り系トースト（sessionStorage でセッション内重複抑制）
function _checkMissionDeadlineNotifications(missions) {
  if (!Array.isArray(missions)) return;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const toasts = [];
  for (const m of missions) {
    if (m.status === 'cleared' || m.status === 'pending_leader_check') continue;
    if (!Array.isArray(m.dates) || m.dates.length === 0) continue;
    const sorted    = [...m.dates].sort();
    const startDate = sorted[0];
    const endDate   = sorted[sorted.length - 1];
    const target    = new Date(endDate);
    target.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    const title = m.title.length > 15 ? m.title.slice(0, 15) + '…' : m.title;

    if (startDate === endDate && todayStr === startDate) {
      // 1日のみのミッション → 締め切り当日
      const key = `notif:${m.id}:single:${todayStr}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」締め切り当日です`); }
    } else if (todayStr === startDate) {
      // 期間スタート（複数日）
      const key = `notif:${m.id}:start:${todayStr}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」の期間が始まりました・残り${diff}日`); }
    } else if (diff === 1) {
      // 締め切り前日
      const key = `notif:${m.id}:1day:${todayStr}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」の締め切りまで残り1日`); }
    } else if (diff === 0) {
      // 締め切り当日（複数日ミッションの最終日）
      const key = `notif:${m.id}:due:${todayStr}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」の締め切り当日です`); }
    }
  }

  toasts.forEach((msg, i) => {
    setTimeout(() => {
      const t = document.createElement('div');
      t.className = 'fixed bottom-24 left-4 right-4 bg-[#484545] text-white px-4 py-3 rounded-xl shadow-2xl text-[12px] font-bold z-[300] text-center';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => { t.style.transition = 'opacity 0.4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
    }, i * 600);
  });
}

// 申告期限の表示
function _fmtDeadline(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 完了日表示（M月D日）
function _fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// userId 配列 → ユーザー名カンマ区切り
function _resolveUsernames(p, userIds, max = 3) {
  if (!Array.isArray(userIds) || userIds.length === 0) return '未確定';
  const names = userIds.map(uid => {
    const member = (p.members || []).find(m => m.userId === uid);
    return member ? `@${member.username}` : '不明なユーザー';
  });
  // ミッション欄では担当者は max（既定3）人まで表示し、超過分は「他N人」に集約
  if (names.length > max) {
    return names.slice(0, max).join('、') + ` 他${names.length - max}人`;
  }
  return names.join('、');
}
