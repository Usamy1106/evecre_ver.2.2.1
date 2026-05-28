// ===== ホーム画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { bindProjectLongPress } from '../modals/projectActions.js';

/**
 * ホーム画面をレンダリングする
 * @param {HTMLElement} container
 */
export function renderHome(container) {
  const ongoing   = state.projects.filter(p => !p.isCompleted).sort((a, b) => b.createdAt - a.createdAt);
  const completed = state.projects.filter(p => p.isCompleted).sort((a, b)  => b.createdAt - a.createdAt);

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      ${Components.Header(null)}
      ${Components.VerifyBanner()}
      <main class="flex-1 px-6 pt-2 pb-36 page-transition">
        <section class="mb-12">
          <h2 class="text-[#484545] heading-m mb-6 pl-1 font-bold">作成したプロジェクト</h2>
          ${_renderGrid(ongoing)}
        </section>
        <section>
          <h2 class="text-[#484545] heading-m mb-6 pl-1 font-bold">完了したプロジェクト</h2>
          ${_renderGrid(completed)}
        </section>
      </main>
    </div>`;

  bindProjectLongPress();
}

/**
 * プロジェクトグリッドをレンダリングする
 */
function _renderGrid(list) {
  if (list.length === 0) {
    return `
      <div class="h-24 flex items-center">
        <span class="text-rs text-[#A7AAAC]">プロジェクトがありません</span>
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
            <div data-project-card data-project-id="${p.id}"
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
