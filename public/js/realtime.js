// ===== リアルタイム同期 (SSE クライアント) =====
//
// state.projects と /api/events を結びつけて、他のメンバーの編集をリアルタイムで反映する。
// CRDT は サーバー側で実施するので、クライアントは「サーバーが解決した最新版」を受け取って差し替えるだけでよい。
//
// 主な責務:
//   - 接続: state.currentUser がいる時だけ
//   - 購読対象: state.projects 全部の id
//   - メッセージ受信: projectUpdated → state.projects を置換、メンバー変更 → loadAfterAuth で再取得
//   - 自動再接続: EventSource 内蔵（接続切れたら数秒後に自動）
//   - エコーバック抑止: X-Client-Id を保存に乗せる（main.js 側で fetch をラップ）

import { state } from './state.js';
import { clientId } from './clientId.js';

let _es = null;
let _subscribedIds = '';

// 後方互換性のため再エクスポート
export { clientId };

/**
 * 必要に応じて接続を張り直す。state変更後に呼ぶ。
 */
export function syncRealtime() {
  if (!state.currentUser) {
    _disconnect();
    return;
  }
  const ids = state.projects.map(p => p.id).sort().join(',');
  if (ids === _subscribedIds && _es && _es.readyState !== 2 /* CLOSED */) return;

  _disconnect();
  _subscribedIds = ids;

  if (!ids) return; // 購読対象なし

  const url = `/api/events?cid=${encodeURIComponent(clientId)}&projects=${encodeURIComponent(ids)}`;
  // EventSource は credentials を同一オリジンで自動送信。Cookieが付く。
  _es = new EventSource(url);

  _es.addEventListener('ready', (e) => {
    // console.log('SSE ready', e.data);
  });

  _es.addEventListener('projectUpdated', (e) => {
    try {
      const { projectId, project } = JSON.parse(e.data);
      _applyProjectUpdate(projectId, project);
    } catch (_) {}
  });

  _es.addEventListener('projectDeleted', (e) => {
    try {
      const { projectId } = JSON.parse(e.data);
      _applyProjectDelete(projectId);
    } catch (_) {}
  });

  _es.addEventListener('memberJoined', () => {
    state.silentReloadProjects?.();
  });
  _es.addEventListener('memberLeft', () => {
    state.silentReloadProjects?.();
  });

  // 通知が増えそうなイベント → 通知一覧 + プロジェクトを再取得
  const notifEvents = [
    'missionClaimed', 'missionUnclaimed', 'missionApplicantAdded',
    'missionClaimsClosed', 'missionSelected',
    'missionApproved', 'missionRejected', 'projectUpdated',
  ];
  notifEvents.forEach(ev => {
    _es.addEventListener(ev, () => {
      state.loadNotifications?.().then(() => {
        state.silentReloadProjects?.().then(() => state.render());
      });
    });
  });

  _es.onerror = () => {
    // EventSource は自動で再接続するので何もしない
  };
}

function _disconnect() {
  if (_es) {
    try { _es.close(); } catch (_) {}
    _es = null;
  }
  _subscribedIds = '';
}

/**
 * 受信した最新プロジェクトを state に反映
 * - 編集中の場合は merge ではなく置換（サーバーが既に CRDT マージ済み）
 * - ローカル未保存の編集がある場合は今回はそのまま上書き（次の保存で再マージされる）
 */
function _applyProjectUpdate(projectId, project) {
  const idx = state.projects.findIndex(p => p.id === projectId);
  if (idx === -1) {
    // 自分が知らないプロジェクト（招待で誰かが追加直後など）→ 全体再取得
    state.silentReloadProjects?.();
    return;
  }
  // 自身がローカルでさらに新しい編集中の場合は、保存後の SSE が再度反映するので問題なし
  state.projects[idx] = project;

  // 表示中ならレンダリング
  if (state.currentView === 'HOME' ||
      (state.currentView === 'MAIN_BOARD' && state.selectedProjectId === projectId)) {
    state.render();
  }
}

function _applyProjectDelete(projectId) {
  const idx = state.projects.findIndex(p => p.id === projectId);
  if (idx === -1) return;
  state.projects.splice(idx, 1);

  // 今表示中だったらホームに戻す
  if (state.selectedProjectId === projectId) {
    state.selectedProjectId = null;
    state.currentView = 'HOME';
    // 軽い案内
    _flashToast('このプロジェクトは削除されました');
  }
  state.render();
}

function _flashToast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#484545] text-white px-5 py-3 rounded-full shadow-2xl text-[13px] font-bold z-[300]';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

export function disconnectRealtime() {
  _disconnect();
}
