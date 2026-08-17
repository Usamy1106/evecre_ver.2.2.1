// ===== プロジェクト詳細画面 =====
// フォルダに所属するイベント一覧と設定を表示する。
import { state } from '../state.js';
import { Components } from '../components.js';
import { bindEventLongPress } from '../modals/eventActions.js';

export function renderProjectDetail(container) {
  const folder = (state.folders || []).find(f => f.id === state.selectedFolderId);
  if (!folder) { state.setView('HOME'); return; }

  const folderEvents = (state.events || [])
    .filter(e => e.folderId === folder.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  // スタイル: public/css/object/project/_project-detail.css
  container.innerHTML = `
    <div class="p-project-detail">
      <header class="p-project-detail__header">
        <div class="p-project-detail__header-inner">
          <button type="button" onclick="window._app.setView('HOME')"
            class="p-project-detail__round-button" aria-label="ホームへ戻る">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div class="p-project-detail__titles">
            <h1 class="p-project-detail__name">${_esc(folder.name)}</h1>
            ${folder.description ? `<p class="p-project-detail__description">${_esc(folder.description)}</p>` : ''}
          </div>
          <!-- ★ここで作るとそのままこのプロジェクトに格納される（state の selectedFolderId 経由）-->
          ${!!state.currentUser?.isVerified ? `
            <button type="button" onclick="window._app.createEventInFolder('${folder.id}')"
              class="p-project-detail__add">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              イベント
            </button>` : ''}
          <button type="button" onclick="window._app.openProjectMenu('${folder.id}')"
            class="p-project-detail__round-button" aria-label="プロジェクトのメニュー">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
          </button>
        </div>
      </header>
      ${Components.VerifyBanner()}
      <main class="p-project-detail__main u-page-transition">
        ${folderEvents.length === 0 ? `
          <div class="p-project-detail__empty">
            <div class="p-project-detail__empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p class="p-project-detail__empty-title">このプロジェクトにイベントがありません</p>
            <p class="p-project-detail__empty-hint">ここで作るか、イベント一覧から長押しで追加できます</p>
            ${!!state.currentUser?.isVerified ? `
              <button type="button" onclick="window._app.createEventInFolder('${folder.id}')"
                class="p-project-detail__empty-action">イベントを作成</button>` : ''}
          </div>
        ` : `
          <section>
            <h2 class="p-project-detail__heading">イベント</h2>
            ${_renderEventList(folderEvents)}
          </section>
        `}
      </main>
    </div>`;

  // イベントカードの長押しメニュー（プロジェクトから外す / 名前を変更 / 削除）。
  // inFolder: true で1項目目が「プロジェクトに追加」→「プロジェクトから外す」に変わる。
  bindEventLongPress({ inFolder: true });
}

function _renderEventList(list) {
  return list.map(p => `
      <div data-event-card data-event-id="${p.id}"
        onclick="window._app.setView('MAIN_BOARD', '${p.id}')"
        class="p-project-detail__event">
        <div class="p-project-detail__event-thumb">
          ${Components.EventThumbnail(p, { rounded: 'c-thumbnail--sm' })}
        </div>
        <div class="p-project-detail__event-body">
          <p class="p-project-detail__event-name">${_esc(p.name)}</p>
          ${p.dates?.length ? `<p class="p-project-detail__event-dates">${p.dates[0]}${p.dates.length > 1 ? ` 〜 ${p.dates[p.dates.length - 1]}` : ''}</p>` : ''}
        </div>
        <svg class="p-project-detail__event-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>`).join('');
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
