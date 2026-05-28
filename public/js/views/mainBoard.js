// ===== メインボード画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { getSortedMissions } from '../modals/mission.js';

/**
 * メインボード画面をレンダリングする
 * @param {HTMLElement} container
 */
export function renderMainBoard(container) {
  const p = state.projects.find(x => x.id === state.selectedProjectId);
  if (!p) {
    // プロジェクトが見つからない場合：データ再取得を試み、それでも無ければ HOME へ
    console.warn('renderMainBoard: project not found in state.projects', {
      selectedProjectId: state.selectedProjectId,
      projectsCount: state.projects.length,
      projectIds: state.projects.map(x => x.id),
    });
    // 一度だけ再取得を試みる（既に試み済みでなければ）
    if (!state._mainBoardReloadAttempted) {
      state._mainBoardReloadAttempted = true;
      state.silentReloadProjects?.();
      // 再取得後 setTimeout で再レンダリング、それでも見つからなければ HOME
      setTimeout(() => {
        const found = state.projects.find(x => x.id === state.selectedProjectId);
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
  // プロジェクトが見つかったらフラグをクリア
  state._mainBoardReloadAttempted = false;

  const points        = state.getProjectPoints(p);
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
      ${state.mainBoardTab === 'MAIN' && state.canManageCurrentProject() ? `
        <button onclick="window._app.openMissionModal()"
          class="fixed bottom-10 right-6 w-14 h-14 bg-[#0CA1E3] rounded-full shadow-[0_4px_15px_rgba(12,161,227,0.4)]
          flex items-center justify-center text-white active:scale-90 transition-transform z-40">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
    </div>`;
}

// ===== メインタブ =====
function _renderMainTab(p, currentPlant, circumference, overallOffset, stageOffset) {
  const canMgr = state.canManageCurrentProject();
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
    if (m.selfClaim && (m.claimMode || 'first') === 'first' && m.assignee?.type === 'user') return true;
    return false;
  };

  // 表示するミッション：
  // - cleared と pending_leader_check は除外
  // - 管理権限あり → 全部表示
  // - 管理権限なし → 申告制で「担当が確定済み」かつ「自分が含まれない」なら隠す
  const ongoingMissions = getSortedMissions(
    p.missions
      .filter(m => m.status !== 'cleared' && m.status !== 'pending_leader_check')
      .filter(m => {
        if (canMgr) return true;
        if (!m.selfClaim) return true;
        if (!_isAssigned(m)) return true;     // まだ募集中なら見える
        return _isMyMission(m);                // 確定済みなら自分のものだけ
      })
  );

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

  const missionCards = ongoingMissions.length === 0
    ? '<p class="text-center py-10 text-[#A7AAAC] text-rs">全てのミッションが完了されました！</p>'
    : ongoingMissions.map(m => {
        const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
        const mode = m.claimMode || 'first';
        const applicants = Array.isArray(m.claimApplicants) ? m.claimApplicants : [];
        const assignees  = Array.isArray(m.assignees) ? m.assignees : [];
        const iApplied   = applicants.includes(meId);
        const assigned   = _isAssigned(m);
        const myMission  = _isMyMission(m);
        const overdue    = m.claimDeadline && Date.now() > m.claimDeadline;

        // 申告期間中／確定後の表示
        let claimLine = '';
        if (m.selfClaim) {
          // 申告制バッジ（モードは常に選定あり。旧データ後方互換でmode変数は残す）
          const modeBadge = `<span class="text-[9px] text-[#0CA1E3] font-bold border border-[#0CA1E3] px-1.5 rounded">申告制</span>`;

          let actionsBlock = '';

          if (mode === 'first') {
            if (!assigned) {
              actionsBlock = `<button onclick="event.stopPropagation(); window._app.claimMissionAsSelf('${m.id}')"
                class="px-3 py-1 rounded-full bg-[#0CA1E3] text-white text-[11px] font-bold active:scale-95">やる</button>`;
            } else if (myMission) {
              actionsBlock = `
                <span class="px-2 py-0.5 rounded-full bg-[#9EDF05]/20 text-[#5b8104] text-[10px] font-bold">担当中</span>
                <button onclick="event.stopPropagation(); window._app.unclaimMissionAsSelf('${m.id}')"
                  class="text-[10px] text-[#A7AAAC] underline">取り消し</button>`;
            }
          } else if (mode === 'multi') {
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
              if (canMgr) {
                actionsBlock += `<button onclick="event.stopPropagation(); window._app.closeMissionClaims('${m.id}')"
                  class="text-[10px] text-[#0CA1E3] underline font-bold">応募を締切る</button>`;
              }
            } else {
              const names = _resolveUsernames(p, assignees);
              actionsBlock = `<span class="text-[10px] text-[#5b8104] font-bold">担当：${names}</span>`;
            }
          } else if (mode === 'selection') {
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
          }

          claimLine = `<div class="mt-2 flex flex-wrap items-center gap-2">${actionsBlock}</div>`;

          // モードバッジは先頭に組み込む（後でテンプレートで使う）
          m._modeBadge = modeBadge;
        }

        const modeBadgeHtml = m._modeBadge || '';

        // クリックで完了モーダル：申告制で「自分の担当」じゃない場合は反応しない
        const isClickable = !m.selfClaim || myMission;
        const cardOnClick = isClickable ? `onclick="window._app.openClearMissionModal('${m.id}')"` : '';
        const cursorCls   = isClickable ? 'cursor-pointer active:bg-[#FDFBF8]' : 'cursor-default';

        return `
        <div ${cardOnClick}
          class="bg-white border border-[#D3D6D8] rounded-xl p-4 flex flex-col shadow-sm relative animate-fadeIn group ${cursorCls}">
          <div class="flex items-center gap-2 mb-2 flex-wrap">
            ${tagNames.map(t => Components.Tag(t)).join('')}
            <span class="text-[11px] text-black/40 font-bold">${m.dates?.length > 0 ? m.dates[0] : '期限なし'}</span>
            ${modeBadgeHtml}
          </div>
          <h3 class="text-[14px] font-bold text-[#484545] pr-8">${m.title}</h3>
          ${m.description ? `<p class="text-[11px] text-[#A7AAAC] mt-1 line-clamp-2 whitespace-pre-wrap">${_esc(m.description)}</p>` : ''}
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
        ['multi', 'selection'].includes(m.claimMode || 'first') &&
        Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
        !(Array.isArray(m.assignees) && m.assignees.length > 0)
      )
    : [];

  const hasDates = Array.isArray(p.dates) && p.dates.length > 0;
  return `
    <div class="px-6 pt-4 space-y-6 page-transition">
      <div onclick="window._app.openProjectCalendarSheet()"
        class="cursor-pointer bg-white border border-[#D3D6D8] rounded-full px-4 py-2 flex items-center justify-center gap-3 shadow-sm mx-auto w-fit active:scale-95 transition-transform">
        <img src="/images/icon/icon-Calender.svg" class="w-4 h-4">
        ${hasDates
          ? `<span class="text-[12px] font-bold">開催まで残り <span class="text-[18px] font-mono">${p.daysLeft}</span> 日</span>`
          : `<span class="text-[11px] font-bold text-[#A7AAAC]">開催日時が設定されていません</span>`}
      </div>

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

      <!-- 提案カード（管理可能ユーザーのみ表示）-->
      ${state.canManageCurrentProject() ? `
        <div class="grid grid-cols-3 gap-2">
          ${proposalCards}
          ${p.proposals.length === 0 ? '<div class="col-span-3 py-4 text-center text-[#A7AAAC] text-[10px] font-bold animate-pulse">12時間後に新しい提案が届きます...</div>' : ''}
        </div>` : ''}

      <!-- ミッション一覧 -->
      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="heading-m">ミッション</h2>
          <div class="relative">
            <button onclick="window._app.toggleSortMenu(event)" class="p-1 active:scale-95 transition-transform">
              <img src="/images/icon/icon-Filter.svg" class="w-5 h-4">
            </button>
          </div>
        </div>
        <div class="space-y-3 pb-10">${missionCards}</div>
      </section>
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

// ===== アーカイブタブ =====
function _renderArchiveTab(p) {
  const title  = p.clearedData['def-2']?.content || '未設定';
  const summary = p.clearedData['def-3']?.content || '未設定';

  const mainVisualKey = Object.keys(p.clearedData).find(k =>
    p.clearedData[k].title === 'メインビジュアルを作成' || p.clearedData[k].title === 'image');
  const mainVisual = mainVisualKey ? p.clearedData[mainVisualKey].content : null;

  const urlKey = Object.keys(p.clearedData).find(k =>
    p.clearedData[k].format === 'link' || p.clearedData[k].title === 'url');
  const url = urlKey ? p.clearedData[urlKey].content : '未設定';

  const venueKey = Object.keys(p.clearedData).find(k =>
    p.clearedData[k].title === '開催場所を決める' || p.clearedData[k].title === 'venue');
  const venue = venueKey ? p.clearedData[venueKey].content : '未設定';

  const period = p.clearedData['period-temp']?.content
    || (p.dates.length > 0 ? `${p.dates[0]} 〜 ${p.dates[p.dates.length - 1]}` : '未設定');

  const hasDatesA = Array.isArray(p.dates) && p.dates.length > 0;
  return `
    <div class="pb-20 page-transition space-y-6">
      <div class="px-6 pt-6 flex items-center justify-between">
        <div onclick="window._app.openProjectCalendarSheet()"
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

      <!-- メインビジュアル -->
      <div class="relative group w-full aspect-[2/1] overflow-hidden bg-[#EBE8E5] flex items-center justify-center shadow-inner">
        ${mainVisual
          ? `<img src="${mainVisual}" class="w-full h-full object-cover">`
          : `<img src="/images/icon/icon-image.svg" class="w-12 h-12 opacity-20">`}
        <div class="absolute bottom-4 right-4 bg-white/80 p-2 rounded-full shadow-lg">
          ${Components.PenIcon('image')}
        </div>
      </div>

      <!-- コンテンツ -->
      <div class="px-6 space-y-8">
        <div class="text-center">
          <div class="flex items-center justify-center gap-2 mb-1">
            <h2 class="text-[18px] font-bold text-[#484545] leading-snug">「${title}」</h2>
            ${Components.PenIcon('title')}
          </div>
        </div>
        <div class="space-y-6">
          <section>
            <div class="flex items-center gap-2 mb-2">
              <h3 class="text-[12px] font-bold text-[#A7AAAC]">概要</h3>
              ${Components.PenIcon('summary')}
            </div>
            <p class="text-[13px] text-[#484545] leading-relaxed whitespace-pre-wrap font-medium">${summary}</p>
          </section>
          <section class="grid grid-cols-[80px_1fr_40px] gap-y-6 text-[13px]">
            <div class="font-bold text-[#A7AAAC]">期間</div>
            <div class="font-bold text-[#484545] flex items-center gap-2">${period} ${Components.PenIcon('period')}</div>
            <div></div>
            <div class="font-bold text-[#A7AAAC]">URL</div>
            <div class="font-bold text-[#0CA1E3] underline truncate">${url}</div>
            <div>${Components.PenIcon('url')}</div>
            <div class="font-bold text-[#A7AAAC]">場所</div>
            <div class="font-bold text-[#484545]">${venue}</div>
            <div>${Components.PenIcon('venue')}</div>
          </section>
        </div>
        <button onclick="window._app.showMissionListModal()"
          class="btn-secondary w-full py-4 heading-r font-bold">ミッション一覧</button>
      </div>
    </div>`;
}

// ===== 通知タブ =====
function _renderNotificationsTab(p) {
  const canMgr = state.canManageCurrentProject();

  // リーダー確認待ちのミッション（管理可能ユーザーのみ）
  const pendingMissions = canMgr
    ? p.missions.filter(m => m.status === 'pending_leader_check')
    : [];

  // 申告待ちのミッション（管理可能ユーザーのみ）
  const claimingMissions = canMgr
    ? p.missions.filter(m =>
        m.selfClaim &&
        m.status !== 'cleared' &&
        m.status !== 'pending_leader_check' &&
        ['multi', 'selection'].includes(m.claimMode || 'first') &&
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

  // 通知一覧
  const notifs = Array.isArray(state.notifications) ? state.notifications : [];
  const unreadCount = notifs.filter(n => !n.read).length;

  const notifsHtml = notifs.length === 0 ? `
    <p class="text-center py-12 text-[#A7AAAC] text-rs font-bold">通知はありません</p>` : `
    <div class="space-y-2">
      ${notifs.map(n => `
        <div data-notif-id="${n.id}"
          class="${n.read ? 'bg-white' : 'bg-[#FDFBF8] border-l-4 border-[#EE3E12]'} border border-[#E1DFDC] rounded-xl p-3 flex items-start gap-3 cursor-pointer active:bg-[#EBE8E5]"
          onclick="window._app.openNotification('${n.id}', '${n.missionId || ''}')">
          <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${_notifIconBg(n.type)}">
            ${_notifIcon(n.type)}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[12px] text-[#484545] leading-snug ${n.read ? '' : 'font-bold'}">${_esc(n.message)}</p>
            <p class="text-[10px] text-[#A7AAAC] mt-1">${_formatNotifTime(n.createdAt)}</p>
          </div>
          ${!n.read ? '<span class="w-2 h-2 rounded-full bg-[#EE3E12] flex-shrink-0 mt-1"></span>' : ''}
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

// 申告期限の表示
function _fmtDeadline(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// userId 配列 → ユーザー名カンマ区切り
function _resolveUsernames(p, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return '未確定';
  const names = userIds.map(uid => {
    const member = (p.members || []).find(m => m.userId === uid);
    return member ? `@${member.username}` : '不明なユーザー';
  });
  return names.join('、');
}
