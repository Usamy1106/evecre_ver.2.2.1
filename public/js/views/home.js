// ===== ホーム画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { bindEventLongPress, bindFolderLongPress } from '../modals/eventActions.js';
import { pushBannerHtml, bindPushBanner } from '../modals/pushSetupModal.js';

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
      <!-- 通知が未設定の人へのバナー（閉じると7日間は出ない）。
           iOS は6割を占め、ホーム画面に追加しないと通知が届かないため、
           HOME から辿り直せる導線を常設している -->
      <div class="mx-4 mt-3">${pushBannerHtml()}</div>
      ${state.pendingApprovalMessage ? _pendingApprovalCard() : ''}
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
      <!-- ★右下の丸い＋ボタン（FAB）は3画面とも廃止した。
           イベント作成 → ヘッダーの「イベントを作成」
           プロジェクト作成 → プロジェクトタブ見出し横の「＋ 新規作成」 -->
    </div>`;

  bindPushBanner();

  bindEventLongPress();
  bindFolderLongPress();
}

/**
 * 承認待ちカード（M0）。
 * ★「送信しました。承認されるまでお待ちください。」の一文だけだと、待ち時間が
 *   まったくの空白になり、承認されても戻ってこない。イベントの顔（キャッチコピー）と
 *   リーダーの意気込みを見せておくことで、承認通知が来たときに開く確率を上げる。
 * 招待プレビューが取れていない場合（旧経路・取得失敗）は従来どおり一文だけ出す。
 */
function _pendingApprovalCard() {
  const inv = state.pendingApprovalInvite;
  const close = `
    <button onclick="window.state.pendingApprovalMessage=null; window.state.pendingApprovalInvite=null; window.state.render();"
      class="text-[#A7AAAC] opacity-60 p-1 flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`;

  if (!inv) return `
    <div class="mx-4 mt-3 bg-[#F0FDE8] border border-[#9EDF05]/60 rounded-2xl px-4 py-3 flex items-start gap-3">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="2.5" class="flex-shrink-0 mt-0.5">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <p class="text-[12px] font-bold text-[#5b8104] flex-1">${state.pendingApprovalMessage}</p>
      ${close}
    </div>`;

  const labels = Array.isArray(inv.motivationLabels) ? inv.motivationLabels : [];
  const text   = (inv.motivationText || '').trim();

  return `
    <div class="mx-4 mt-3 bg-[#F0FDE8] border border-[#9EDF05]/60 rounded-2xl overflow-hidden">
      <div class="px-4 py-3 flex items-start gap-3 border-b border-[#9EDF05]/30">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b8104" stroke-width="2.5" class="flex-shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] font-bold text-[#5b8104]">リーダーに通知しました</p>
          <p class="text-[11px] font-bold text-[#5b8104]/70 mt-0.5">承認されるとイベントに入れます</p>
        </div>
        ${close}
      </div>
      <div class="bg-white px-5 py-4 text-center">
        ${inv.catchphrase ? `
          <p class="text-[14px] text-[#0CA1E3] font-bold leading-snug mb-2">${_esc(inv.catchphrase)}</p>` : ''}
        <p class="text-[13px] text-[#484545] font-bold">${_esc(inv.eventName || 'イベント')}</p>
        <p class="text-[11px] text-[#A7AAAC] font-bold mt-0.5">
          ${_esc(inv.ownerName || 'リーダー')}さん${inv.memberCount > 1 ? ` ほか${inv.memberCount - 1}人が参加中` : 'が待っています'}
        </p>
        ${(labels.length || text) ? `
          <div class="mt-3 pt-3 border-t border-[#F0EEEB]">
            <p class="text-[10px] text-[#A7AAAC] font-bold mb-2">${_esc(inv.ownerName || 'リーダー')}さんの意気込み</p>
            <div class="flex flex-wrap gap-1.5 justify-center">
              ${labels.map(l => `<span class="text-[10px] font-bold text-[#EE3E12] bg-[#EE3E12]/10 px-2.5 py-1 rounded-full">${_esc(l)}</span>`).join('')}
            </div>
            ${text ? `<p class="text-[12px] text-[#484545] font-bold mt-2.5 leading-relaxed">「${_esc(text)}」</p>` : ''}
          </div>` : ''}
      </div>
    </div>`;
}

function _renderEventsTab() {
  const ongoing   = state.events.filter(p => !p.isCompleted).sort((a, b) => b.createdAt - a.createdAt);
  const completed = state.events.filter(p => p.isCompleted).sort((a, b)  => b.createdAt - a.createdAt);
  const isEmpty   = ongoing.length === 0 && completed.length === 0;
  const verified  = !!state.currentUser?.isVerified;
  const createAction = verified ? `window._app.setView('CREATE_EVENT_INFO')` : `window._app.requireVerification()`;

  if (isEmpty) return `
    <div class="flex flex-col items-center justify-center min-h-[55vh] gap-6 text-center">
      <!-- エンプティーステート画像は後日支給予定。それまではプレースホルダー正方形 -->
      <div class="w-32 h-32 rounded-full bg-[#EBE8E5] flex items-center justify-center">
        <div class="w-20 h-20 rounded-2xl bg-[#D3D6D8] opacity-50"></div>
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

  // ★FAB を廃止したので、ここがプロジェクトを新規作成する導線になる。消さないこと
  //   （他の導線はイベント長押し →「プロジェクトに追加」→「新規プロジェクトを作成」だけで、
  //     それだと空のプロジェクトを作れない）。
  const createBtn = `
    <button onclick="window._app.openNewProjectModal()"
      class="flex items-center gap-1 text-[12px] font-bold text-[#0CA1E3] px-3 py-2 rounded-lg active:opacity-50">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      新規作成
    </button>`;

  if (folders.length === 0) return `
    <div class="flex flex-col items-center justify-center min-h-[55vh] gap-4 text-center">
      <div class="w-20 h-20 rounded-full bg-[#EBE8E5] flex items-center justify-center">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <p class="heading-m text-[#484545] font-bold">プロジェクトを作ろう</p>
      <p class="text-rs text-[#A7AAAC] mb-2">複数のイベントを1つにまとめて<br>管理できます</p>
      <button onclick="window._app.openNewProjectModal()"
        class="px-6 py-3 rounded-2xl text-white font-bold heading-r shadow-lg active:scale-95 transition-transform"
        style="background-color:#0CA1E3; box-shadow:0 4px 20px rgba(12,161,227,0.4)">プロジェクトを作成</button>
    </div>`;

  return `
    <div class="flex items-center justify-between mb-3 pl-1">
      <h2 class="text-[#484545] heading-m font-bold">プロジェクト</h2>
      ${createBtn}
    </div>
  ` + folders.map(f => `
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
      <div class="grid grid-cols-3 gap-x-2 px-1 mb-2 items-start">
        ${row.map(p => `
            <div data-event-card data-event-id="${p.id}"
              class="flex flex-col items-center cursor-pointer group select-none"
              style="touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;"
              onclick="window._app.setView('MAIN_BOARD', '${p.id}')">
              <div class="w-full mb-2 pointer-events-none">
                ${Components.EventThumbnail(p)}
              </div>
              <span class="text-[10px] text-[#484545] truncate w-full text-center px-1 font-bold pointer-events-none">${p.name}</span>
            </div>`).join('')}
      </div>
      <div class="w-full h-[1.5px] bg-[#D3D6D8] mt-1 mb-8"></div>`;
  }
  return html;
}
