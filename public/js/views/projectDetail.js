// ===== プロジェクト詳細画面 =====
// フォルダに所属するイベント一覧と設定を表示する。
import { state } from '../state.js';
import { Components } from '../components.js';

export function renderProjectDetail(container) {
  const folder = (state.folders || []).find(f => f.id === state.selectedFolderId);
  if (!folder) { state.setView('HOME'); return; }

  const folderEvents = (state.events || [])
    .filter(e => e.folderId === folder.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      <!-- ヘッダー -->
      <div class="sticky top-0 bg-[#FDFBF8] z-30 border-b border-[#E1DFDC]">
        <div class="flex items-center gap-3 px-4 py-3">
          <button onclick="window._app.setView('HOME')"
            class="w-9 h-9 rounded-full bg-black/5 flex items-center justify-center active:scale-95 flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div class="flex-1 min-w-0">
            <h1 class="text-[16px] font-bold text-[#484545] truncate">${_esc(folder.name)}</h1>
            ${folder.description ? `<p class="text-[11px] text-[#A7AAAC] truncate">${_esc(folder.description)}</p>` : ''}
          </div>
          <button onclick="window._app.openProjectMenu('${folder.id}')"
            class="w-9 h-9 rounded-full bg-black/5 flex items-center justify-center active:scale-95 flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
          </button>
        </div>
      </div>
      ${Components.VerifyBanner()}
      <main class="flex-1 px-6 pt-4 pb-36 page-transition">
        ${folderEvents.length === 0 ? `
          <div class="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
            <div class="w-20 h-20 rounded-full bg-[#EBE8E5] flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p class="text-rs text-[#A7AAAC]">このプロジェクトにイベントがありません</p>
            <p class="text-[11px] text-[#A7AAAC]">イベント一覧から長押しで追加できます</p>
          </div>
        ` : `
          <section>
            <h2 class="text-[#484545] heading-m mb-4 pl-1 font-bold">イベント</h2>
            ${_renderEventList(folderEvents)}
          </section>
        `}
      </main>
      <!-- FAB: 新規イベント作成 -->
      ${!!state.currentUser?.isVerified ? `
        <button onclick="window._app.createEventInFolder('${folder.id}')"
          class="fixed bottom-10 right-6 w-14 h-14 bg-[#0CA1E3] rounded-full shadow-[0_4px_15px_rgba(12,161,227,0.4)]
          flex items-center justify-center text-white active:scale-90 transition-transform z-40">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
    </div>`;
}

function _renderEventList(list) {
  return list.map(p => {
    const currentPlant = state.getPlantImagePath(p);
    return `
      <div onclick="window._app.setView('MAIN_BOARD', '${p.id}')"
        class="flex items-center gap-4 px-4 py-4 bg-white rounded-2xl shadow-sm mb-3 active:scale-[0.98] transition-transform cursor-pointer border border-[#E1DFDC]">
        <div class="w-12 h-12 flex items-end justify-center flex-shrink-0">
          <img src="${currentPlant}" class="max-h-full object-contain" draggable="false">
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[14px] font-bold text-[#484545] truncate">${_esc(p.name)}</p>
          ${p.dates?.length ? `<p class="text-[11px] text-[#A7AAAC] mt-0.5">${p.dates[0]}${p.dates.length > 1 ? ` 〜 ${p.dates[p.dates.length - 1]}` : ''}</p>` : ''}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>`;
  }).join('');
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
