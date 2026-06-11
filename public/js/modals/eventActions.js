// ===== イベント操作（長押しメニュー・名前変更・削除） =====
import { state } from '../state.js';

// ---- 長押し検知 ----
const LONG_PRESS_MS   = 500;     // 長押し判定のしきい値
const MOVE_TOLERANCE  = 10;      // この距離以上動いたら長押しキャンセル

let pressTimer     = null;
let pressStartPt   = null;       // {x, y}
let pressConsumed  = false;      // 長押しが発火したかどうか

/**
 * 要素に長押しリスナーを取り付ける（onclickは別途消費制御する）
 * @param {HTMLElement} el
 * @param {function(PointerEvent): void} onLongPress
 */
function attachLongPress(el, onLongPress) {
  const start = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressConsumed = false;
    pressStartPt  = { x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressConsumed = true;
      onLongPress(e);
    }, LONG_PRESS_MS);
  };

  const move = (e) => {
    if (!pressStartPt) return;
    const dx = Math.abs(e.clientX - pressStartPt.x);
    const dy = Math.abs(e.clientY - pressStartPt.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) cancel();
  };

  const cancel = () => {
    clearTimeout(pressTimer);
    pressTimer   = null;
    pressStartPt = null;
  };

  el.addEventListener('pointerdown',   start);
  el.addEventListener('pointermove',   move);
  el.addEventListener('pointerup',     cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave',  cancel);
  el.addEventListener('contextmenu',   (e) => e.preventDefault()); // 長押しメニュー(iOS/Android)を抑止
}

/**
 * ホーム画面のイベントカードに長押しを紐付ける。
 * - 通常タップ → カードの onclick（ビュー遷移）が動く
 * - 長押し    → pressConsumed=true に設定し、onclickをキャンセルしてメニュー表示
 */
export function bindEventLongPress() {
  document.querySelectorAll('[data-event-card]').forEach(card => {
    const projectId = card.dataset.eventId;
    if (!projectId) return;

    attachLongPress(card, (e) => {
      e.preventDefault();
      // 触覚フィードバック（対応端末のみ）
      if (navigator.vibrate) navigator.vibrate(15);
      openEventMenu(projectId);
    });

    // 長押し直後のclickを無効化する（タップとの誤爆防止）
    card.addEventListener('click', (e) => {
      if (pressConsumed) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pressConsumed = false;
      }
    }, true);
  });
}

// ---- メニュー（名前変更 / 削除） ----

/**
 * イベント長押しメニューを表示
 * @param {string} projectId
 */
function openEventMenu(projectId) {
  const p = state.events.find(x => x.id === projectId);
  if (!p) return;

  const canMgr  = state.canManageCurrentEvent(projectId);
  const isOwner = p.ownerId === state.currentUser?.id;

  // 既存メニューを除去
  document.getElementById('event-action-sheet')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'event-action-sheet';
  overlay.className = 'fixed inset-0 bg-black/40 z-[200] flex items-end justify-center page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white w-full max-w-md rounded-t-[32px] p-4 pb-8 shadow-2xl animate-fadeIn">
      <div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full mx-auto mb-4"></div>
      <p class="text-center text-[12px] text-[#A7AAAC] font-bold mb-3 truncate px-6">${p.name}</p>
      ${canMgr ? `<button id="pa-rename"
        class="w-full text-left px-6 py-4 rounded-xl hover:bg-[#FDFBF8] text-[15px] font-bold text-[#484545] flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        名前を変更
      </button>` : ''}
      <button id="pa-add-to-project"
        class="w-full text-left px-6 py-4 rounded-xl hover:bg-[#FDFBF8] text-[15px] font-bold text-[#484545] flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        プロジェクトに追加
      </button>
      ${isOwner ? `
      <button id="pa-delete"
        class="w-full text-left px-6 py-4 rounded-xl hover:bg-[#FFEEEA] text-[15px] font-bold text-[#EE3E12] flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
        削除
      </button>` : `
      <button id="pa-leave"
        class="w-full text-left px-6 py-4 rounded-xl hover:bg-[#FFEEEA] text-[15px] font-bold text-[#EE3E12] flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
        このイベントから脱退
      </button>`}
      <button id="pa-cancel"
        class="w-full py-3 mt-2 text-[14px] font-bold text-[#A7AAAC]">キャンセル</button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('pa-rename')?.addEventListener('click', () => { overlay.remove(); openRenameDialog(projectId); });
  document.getElementById('pa-add-to-project').onclick = () => { overlay.remove(); openAddToProjectModal(projectId); };
  document.getElementById('pa-delete')?.addEventListener('click', () => { overlay.remove(); openDeleteConfirm(projectId); });
  document.getElementById('pa-leave')?.addEventListener('click', () => { overlay.remove(); state.leaveEvent(projectId); });
  document.getElementById('pa-cancel').onclick = () => overlay.remove();
}

// ---- 名前変更ダイアログ ----

/**
 * イベント名変更ダイアログ
 * @param {string} projectId
 */
export function openRenameDialog(projectId) {
  const p = state.events.find(x => x.id === projectId);
  if (!p) return;
  if (!state.canManageCurrentEvent(projectId)) return;

  const overlay = document.createElement('div');
  overlay.id = 'event-rename-modal';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn">
      <h3 class="heading-m text-[#484545] mb-6 font-bold text-center">イベント名を変更</h3>
      <input id="rename-input" type="text" maxlength="40"
        class="input-field w-full px-4 py-3 focus:outline-none mb-6"
        value="${_escapeAttr(p.name)}">
      <div class="flex gap-3">
        <button id="rename-cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">キャンセル</button>
        <button id="rename-save"   class="btn-primary   flex-1 py-3 heading-rs font-bold">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('rename-input');
  input.focus();
  input.select();

  document.getElementById('rename-cancel').onclick = () => overlay.remove();
  document.getElementById('rename-save').onclick   = () => {
    const name = input.value.trim();
    if (!name) { input.style.borderColor = '#e8383d'; return; }
    state.renameEvent(projectId, name);
    overlay.remove();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('rename-save').click();
    if (e.key === 'Escape') overlay.remove();
  });
}

// ---- 削除確認ダイアログ ----

/**
 * イベント削除確認ダイアログ
 * @param {string} projectId
 */
export function openDeleteConfirm(projectId) {
  const overlay = document.createElement('div');
  overlay.id = 'event-delete-modal';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
      <h3 class="heading-m text-[#484545] mb-3 font-bold">イベントを削除しますか</h3>
      <p class="text-rs text-[#484545] font-medium mb-8 leading-relaxed">一度削除されると元に戻せません。</p>
      <div class="flex gap-3">
        <button id="del-cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">戻る</button>
        <button id="del-confirm"
          class="flex-1 py-3 heading-rs font-bold text-white rounded-xl shadow-md"
          style="background-color: #EE3E12;">削除</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('del-cancel').onclick  = () => overlay.remove();
  document.getElementById('del-confirm').onclick = () => {
    overlay.remove();
    state.deleteEvent(projectId);
  };
}

// ---- プロジェクトに追加モーダル ----

/**
 * イベントをプロジェクト（フォルダ）に追加するモーダル
 * @param {string} eventId
 */
export function openAddToProjectModal(eventId) {
  const ev      = state.events.find(x => x.id === eventId);
  const folders = state.folders || [];

  document.getElementById('add-to-project-sheet')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'add-to-project-sheet';
  overlay.className = 'fixed inset-0 bg-black/40 z-[200] flex items-end justify-center page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const currentFolderId = ev?.folderId || null;
  const folderItems = folders.map(f => `
    <button data-folder-id="${f.id}"
      class="w-full text-left px-6 py-4 rounded-xl text-[15px] font-bold flex items-center gap-3
        ${currentFolderId === f.id ? 'text-[#0CA1E3] bg-[#EBF7FE]' : 'text-[#484545] hover:bg-[#FDFBF8]'}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="${currentFolderId === f.id ? '#0CA1E3' : '#484545'}" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      ${_escapeAttr(f.name)}
      ${currentFolderId === f.id ? '<span class="ml-auto text-[11px] text-[#0CA1E3]">追加済み</span>' : ''}
    </button>`).join('');

  overlay.innerHTML = `
    <div class="bg-white w-full max-w-md rounded-t-[32px] p-4 pb-8 shadow-2xl animate-fadeIn">
      <div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full mx-auto mb-4"></div>
      <p class="text-center text-[13px] font-bold text-[#484545] mb-3">プロジェクトに追加</p>
      <div id="atp-folder-list" class="max-h-64 overflow-y-auto">
        ${folderItems.length ? folderItems : '<p class="text-center text-[13px] text-[#A7AAAC] py-4">プロジェクトがありません</p>'}
      </div>
      <button id="atp-new"
        class="w-full text-left px-6 py-4 rounded-xl text-[15px] font-bold text-[#0CA1E3] flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0CA1E3" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        新規プロジェクトを作成
      </button>
      ${currentFolderId ? `
        <button id="atp-remove"
          class="w-full px-6 py-3 text-[13px] font-bold text-[#A7AAAC] text-center">
          プロジェクトから外す
        </button>` : ''}
      <button id="atp-cancel"
        class="w-full py-3 mt-1 text-[14px] font-bold text-[#A7AAAC]">キャンセル</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('[data-folder-id]').forEach(btn => {
    btn.onclick = async () => {
      const fid = btn.dataset.folderId;
      overlay.remove();
      if (fid === currentFolderId) return;
      await state.setEventFolder(eventId, fid);
    };
  });

  document.getElementById('atp-new').onclick = () => {
    overlay.remove();
    window._app?.openNewProjectModalForEvent?.(eventId);
  };

  document.getElementById('atp-remove')?.addEventListener('click', async () => {
    overlay.remove();
    await state.setEventFolder(eventId, null);
  });

  document.getElementById('atp-cancel').onclick = () => overlay.remove();
}

// ---- ヘルパー ----

function _escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
