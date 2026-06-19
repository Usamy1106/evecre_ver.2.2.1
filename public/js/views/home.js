// ===== ホーム画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { bindEventLongPress, bindFolderLongPress } from '../modals/eventActions.js';

/**
 * ホーム画面をレンダリングする
 * @param {HTMLElement} container
 */
export function renderHome(container) {
  const tab = state.homeTab || 'EVENTS';

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      ${Components.Header(null)}
      ${Components.VerifyBanner()}
      ${state.pendingApprovalMessage ? `
        <div class="mx-4 mt-3 bg-[#F0FDE8] border border-[#9EDF05]/60 rounded-2xl px-4 py-3 flex items-start gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="2.5" class="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p class="text-[12px] font-bold text-[#5b8104] flex-1">${state.pendingApprovalMessage}</p>
          <button onclick="window.state.pendingApprovalMessage=null; window.state.render();"
            class="text-[#A7AAAC] opacity-60 p-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>` : ''}
      <!-- タブバー -->
      <div class="flex border-b border-[#E1DFDC] mx-6 mt-3">
        <button onclick="window._app.setHomeTab('EVENTS')"
          class="flex-1 py-2.5 text-[13px] font-bold transition-colors ${tab === 'EVENTS' ? 'text-[#0CA1E3] border-b-2 border-[#0CA1E3]' : 'text-[#A7AAAC]'}">
          イベント
        </button>
        <button onclick="window._app.setHomeTab('PROJECTS')"
          class="flex-1 py-2.5 text-[13px] font-bold transition-colors ${tab === 'PROJECTS' ? 'text-[#0CA1E3] border-b-2 border-[#0CA1E3]' : 'text-[#A7AAAC]'}">
          プロジェクト
        </button>
      </div>
      <main class="flex-1 px-6 pt-4 pb-36 page-transition">
        ${tab === 'EVENTS' ? _renderEventsTab() : _renderProjectsTab()}
      </main>
      ${tab === 'EVENTS' && !!state.currentUser?.isVerified ? `
        <button onclick="window._app.setView('CREATE_EVENT_INFO')"
          class="fixed bottom-10 right-6 w-14 h-14 bg-[#0CA1E3] rounded-full shadow-[0_4px_15px_rgba(12,161,227,0.4)]
          flex items-center justify-center text-white active:scale-90 transition-transform z-40">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
      ${tab === 'PROJECTS' ? `
        <button onclick="window._app.openNewProjectModal()"
          class="fixed bottom-10 right-6 w-14 h-14 rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.15)]
          flex items-center justify-center text-white active:scale-90 transition-transform z-40"
          style="background-color:#484545">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
    </div>`;

  bindEventLongPress();
  bindFolderLongPress();
}

function _renderEventsTab() {
  const ongoing   = state.events.filter(p => !p.isCompleted).sort((a, b) => b.createdAt - a.createdAt);
  const completed = state.events.filter(p => p.isCompleted).sort((a, b)  => b.createdAt - a.createdAt);
  const isEmpty   = ongoing.length === 0 && completed.length === 0;
  const verified  = !!state.currentUser?.isVerified;
  const createAction = verified ? `window._app.setView('CREATE_EVENT_INFO')` : `window._app.requireVerification()`;

  if (isEmpty) return `
    <div class="flex flex-col items-center justify-center min-h-[55vh] gap-6 text-center">
      <div class="w-32 h-32 rounded-full bg-[#EBE8E5] flex items-center justify-center">
        <img src="/images/plant/plant-jack-1.svg" class="w-20 h-20 object-contain opacity-30" onerror="this.style.display='none'">
      </div>
      <div>
        <p class="heading-m text-[#484545] font-bold mb-2">イベントを始めよう</p>
        <p class="text-rs text-[#A7AAAC] leading-relaxed">新しいイベントを作成するか<br>招待コードで参加しましょう</p>
      </div>
      <div class="flex flex-col gap-3 w-full max-w-xs">
        <button onclick="${createAction}"
          class="w-full py-4 rounded-2xl text-white font-bold heading-r shadow-lg active:scale-95 transition-transform"
          style="background-color:#0CA1E3; box-shadow:0 4px 20px rgba(12,161,227,0.4)">イベントを作成</button>
        <button onclick="window._app.openJoinByCodeModal()"
          class="w-full py-4 rounded-2xl font-bold heading-r border-2 border-[#0CA1E3] text-[#0CA1E3] active:scale-95 transition-transform bg-white">イベントに参加</button>
      </div>
    </div>`;

  return `
    <section class="mb-12">
      <h2 class="text-[#484545] heading-m mb-6 pl-1 font-bold">作成したイベント</h2>
      ${_renderGrid(ongoing)}
    </section>
    <section>
      <h2 class="text-[#484545] heading-m mb-6 pl-1 font-bold">完了したイベント</h2>
      ${_renderGrid(completed)}
    </section>`;
}

function _renderProjectsTab() {
  const folders = state.folders || [];

  if (folders.length === 0) return `
    <div class="flex flex-col items-center justify-center min-h-[55vh] gap-4 text-center">
      <div class="w-20 h-20 rounded-full bg-[#EBE8E5] flex items-center justify-center">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <p class="heading-m text-[#484545] font-bold">プロジェクトを作ろう</p>
      <p class="text-rs text-[#A7AAAC]">複数のイベントを1つにまとめて<br>管理できます</p>
    </div>`;

  return folders.map(f => `
    <div data-folder-card data-folder-id="${f.id}"
      onclick="window._app.setView('PROJECT_DETAIL', '${f.id}')"
      style="touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;"
      class="flex items-center gap-4 px-4 py-4 bg-white rounded-2xl shadow-sm mb-3 active:scale-[0.98] transition-transform cursor-pointer border border-[#E1DFDC] select-none">
      <div class="w-11 h-11 rounded-xl bg-[#EBE8E5] flex items-center justify-center flex-shrink-0">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#484545" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[14px] font-bold text-[#484545] truncate">${_esc(f.name)}</p>
        ${f.description ? `<p class="text-[11px] text-[#A7AAAC] truncate mt-0.5">${_esc(f.description)}</p>` : ''}
      </div>
      <p class="text-[12px] text-[#A7AAAC] font-bold flex-shrink-0">${f.eventCount || 0}件</p>
    </div>`).join('');
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * イベントグリッドをレンダリングする
 */
function _renderGrid(list) {
  if (list.length === 0) {
    return `
      <div class="h-24 flex items-center">
        <span class="text-rs text-[#A7AAAC]">イベントがありません</span>
      </div>
      <div class="w-full h-[1.5px] bg-[#D3D6D8] mt-1 mb-8"></div>`;
  }

  let html = '';
  for (let i = 0; i < list.length; i += 3) {
    const row = list.slice(i, i + 3);
    html += `
      <div class="grid grid-cols-3 gap-x-2 px-1 mb-2 items-end">
        ${row.map(p => {
          const currentPlant = state.getPlantImagePath(p);
          return `
            <div data-event-card data-event-id="${p.id}"
              class="flex flex-col items-center cursor-pointer group select-none"
              style="touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;"
              onclick="window._app.setView('MAIN_BOARD', '${p.id}')">
              <span class="text-[10px] text-[#484545] mb-2 truncate w-full text-center px-1 font-bold pointer-events-none">${p.name}</span>
              <div class="h-24 w-full flex items-end justify-center mb-1 pointer-events-none">
                <img src="${currentPlant}" class="max-h-full max-w-full object-contain block h-full" draggable="false">
              </div>
            </div>`;
        }).join('')}
        ${Array(3 - row.length).fill('<div class="h-28"></div>').join('')}
      </div>
      <div class="w-full h-[1.5px] bg-[#D3D6D8] mt-1 mb-8"></div>`;
  }
  return html;
}
