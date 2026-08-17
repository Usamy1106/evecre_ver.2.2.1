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
 * イベントカードに長押しを紐付ける。
 * - 通常タップ → カードの onclick（ビュー遷移）が動く
 * - 長押し    → pressConsumed=true に設定し、onclickをキャンセルしてメニュー表示
 *
 * @param {{inFolder?: boolean}} [opts]
 *   inFolder … プロジェクト（フォルダ）詳細から呼ぶとき true。
 *              メニューの1項目目が「プロジェクトに追加」→「プロジェクトから外す」に変わる。
 */
export function bindEventLongPress(opts = {}) {
  document.querySelectorAll('[data-event-card]').forEach(card => {
    const projectId = card.dataset.eventId;
    if (!projectId) return;

    attachLongPress(card, (e) => {
      e.preventDefault();
      // 触覚フィードバック（対応端末のみ）
      if (navigator.vibrate) navigator.vibrate(15);
      openEventMenu(projectId, opts);
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

/**
 * ホーム画面のプロジェクト（フォルダ）カードに長押しを紐付ける。
 * - 通常タップ → カードの onclick（プロジェクト詳細へ遷移）が動く
 * - 長押し    → 既存のフォルダメニュー（名前変更 / 削除）を表示（main.js の openProjectMenu を再利用）
 */
export function bindFolderLongPress() {
  document.querySelectorAll('[data-folder-card]').forEach(card => {
    const folderId = card.dataset.folderId;
    if (!folderId) return;

    attachLongPress(card, (e) => {
      e.preventDefault();
      if (navigator.vibrate) navigator.vibrate(15);
      window._app?.openProjectMenu(folderId);
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
 * @param {{inFolder?: boolean}} [opts]
 *   inFolder … プロジェクト詳細から開いたとき。「プロジェクトに追加」の代わりに
 *              「プロジェクトから外す」を出す（今いるフォルダから外すのが自然なため）
 */
function openEventMenu(projectId, opts = {}) {
  const p = state.events.find(x => x.id === projectId);
  if (!p) return;

  const canMgr   = state.canManageCurrentEvent(projectId);
  const isOwner  = p.ownerId === state.currentUser?.id;
  const inFolder = !!opts.inFolder && !!p.folderId;

  // 既存メニューを除去
  document.getElementById('event-action-sheet')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'event-action-sheet';
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--action page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div data-sheet class="c-action-sheet animate-fadeIn">
      <div data-sheet-handle class="c-sheet__handle"><div class="c-sheet__grip"></div></div>
      <p class="c-action-sheet__caption">${_escapeAttr(p.name)}</p>
      ${inFolder ? `<button id="pa-remove-from-project"
        class="c-action-sheet__item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <line x1="9" y1="14" x2="15" y2="14"/>
        </svg>
        プロジェクトから外す
      </button>` : ''}
      ${canMgr ? `<button id="pa-rename"
        class="c-action-sheet__item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        名前を変更
      </button>` : ''}
      ${inFolder ? '' : `<button id="pa-add-to-project"
        class="c-action-sheet__item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        プロジェクトに追加
      </button>`}
      ${isOwner ? `
      <button id="pa-delete"
        class="c-action-sheet__item c-action-sheet__item--danger">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
        削除
      </button>` : `
      <button id="pa-leave"
        class="c-action-sheet__item c-action-sheet__item--danger">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
        このイベントから脱退
      </button>`}
      <button id="pa-cancel"
        class="c-action-sheet__cancel">キャンセル</button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('pa-rename')?.addEventListener('click', () => { overlay.remove(); openRenameDialog(projectId); });
  document.getElementById('pa-remove-from-project')?.addEventListener('click', async () => {
    overlay.remove();
    // setEventFolder(id, null) がサーバー更新と render() まで行う。
    // プロジェクト詳細を開いたままならリストからこのイベントが消える。
    await state.setEventFolder(projectId, null);
  });
  document.getElementById('pa-add-to-project')?.addEventListener('click', () => { overlay.remove(); openAddToProjectModal(projectId); });
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
  overlay.className = 'c-overlay c-overlay--action-dialog c-overlay--blur page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="c-modal c-modal--left animate-fadeIn">
      <h3 class="c-modal__title c-modal__title--loose">イベント名を変更</h3>
      <input id="rename-input" type="text" maxlength="40"
        class="c-input c-input--block c-modal__field"
        value="${_escapeAttr(p.name)}">
      <div class="c-modal__actions">
        <button id="rename-cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
        <button id="rename-save"   class="c-button c-button--primary c-modal__button">保存</button>
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
  overlay.className = 'c-overlay c-overlay--action-dialog c-overlay--blur page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="c-modal animate-fadeIn">
      <h3 class="c-modal__title">イベントを削除しますか</h3>
      <p class="c-modal__text c-modal__text--strong">一度削除されると元に戻せません。</p>
      <div class="c-modal__actions">
        <button id="del-cancel" class="c-button c-button--secondary c-modal__button">戻る</button>
        <button id="del-confirm" class="c-button c-button--danger c-modal__button c-modal__button--shadow">削除</button>
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
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--action page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const currentFolderId = ev?.folderId || null;
  const folderItems = folders.map(f => `
    <button data-folder-id="${f.id}"
      class="c-action-sheet__item${currentFolderId === f.id ? ' is-current' : ''}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="${currentFolderId === f.id ? '#0CA1E3' : '#484545'}" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      ${_escapeAttr(f.name)}
      ${currentFolderId === f.id ? '<span class="c-action-sheet__badge">追加済み</span>' : ''}
    </button>`).join('');

  overlay.innerHTML = `
    <div data-sheet class="c-action-sheet animate-fadeIn">
      <div data-sheet-handle class="c-sheet__handle"><div class="c-sheet__grip"></div></div>
      <p class="c-action-sheet__caption c-action-sheet__caption--label">プロジェクトに追加</p>
      <div id="atp-folder-list" class="c-action-sheet__list">
        ${folderItems.length ? folderItems : '<p class="c-action-sheet__empty">プロジェクトがありません</p>'}
      </div>
      <button id="atp-new"
        class="c-action-sheet__item c-action-sheet__item--primary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0CA1E3" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        新規プロジェクトを作成
      </button>
      ${currentFolderId ? `
        <button id="atp-remove" class="c-action-sheet__minor">
          プロジェクトから外す
        </button>` : ''}
      <button id="atp-cancel"
        class="c-action-sheet__cancel c-action-sheet__cancel--tight">キャンセル</button>
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
