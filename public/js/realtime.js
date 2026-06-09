// ===== リアルタイム同期 (SSE クライアント) =====
//
// state.events と /api/events を結びつけて、他のメンバーの編集をリアルタイムで反映する。
// CRDT は サーバー側で実施するので、クライアントは「サーバーが解決した最新版」を受け取って差し替えるだけでよい。
//
// 主な責務:
//   - 接続: state.currentUser がいる時だけ
//   - 購読対象: state.events 全部の id
//   - メッセージ受信: eventUpdated → state.events を置換、メンバー変更 → loadAfterAuth で再取得
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
  const ids = state.events.map(p => p.id).sort().join(',');
  if (ids === _subscribedIds && _es && _es.readyState !== 2 /* CLOSED */) return;

  _disconnect();
  _subscribedIds = ids;

  if (!ids) return; // 購読対象なし

  const url = `/api/events?cid=${encodeURIComponent(clientId)}&eventIds=${encodeURIComponent(ids)}`;
  _es = new EventSource(url);

  _es.addEventListener('ready', () => {});

  _es.addEventListener('eventUpdated', (e) => {
    try {
      const { eventId, event } = JSON.parse(e.data);
      _applyEventUpdate(eventId, event);
    } catch (_) {}
  });

  _es.addEventListener('eventDeleted', (e) => {
    try {
      const { eventId } = JSON.parse(e.data);
      _applyEventDelete(eventId);
    } catch (_) {}
  });

  _es.addEventListener('memberJoined', () => {
    state.silentReloadEvents?.();
  });
  _es.addEventListener('memberLeft', () => {
    state.silentReloadEvents?.();
  });

  // 通知が増えそうなイベント → 通知一覧を再取得
  const notifEvents = [
    'missionClaimed', 'missionUnclaimed', 'missionApplicantAdded',
    'missionClaimsClosed', 'missionSelected',
    'missionApproved', 'missionRejected',
  ];
  notifEvents.forEach(ev => {
    _es.addEventListener(ev, () => {
      state.loadNotifications?.().then(() => {
        state.silentReloadEvents?.().then(() => state.render());
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
 * 受信した最新イベントを state に反映
 */
function _applyEventUpdate(eventId, event) {
  const idx = state.events.findIndex(p => p.id === eventId);
  if (idx === -1) {
    state.silentReloadEvents?.();
    return;
  }

  const prev = state.events[idx];

  const prevLeader  = (prev?.missions || []).filter(m => m.status === 'pending_leader_check').length;
  const newLeader   = (event?.missions || []).filter(m => m.status === 'pending_leader_check').length;
  const prevClaims  = (prev?.missions || []).filter(m =>
    m.selfClaim && Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
    !(Array.isArray(m.assignees) && m.assignees.length > 0)).length;
  const newClaims   = (event?.missions || []).filter(m =>
    m.selfClaim && Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
    !(Array.isArray(m.assignees) && m.assignees.length > 0)).length;
  const prevPending = (prev?.pendingMembers || []).length;
  const newPending  = (event?.pendingMembers || []).length;
  const prevPropos  = (prev?.memberProposals || []).length;
  const newPropos   = (event?.memberProposals || []).length;

  const needsReset = (newLeader > prevLeader) || (newClaims > prevClaims) ||
                     (newPending > prevPending) || (newPropos > prevPropos);
  if (needsReset && state._infoModalShownForEvent === eventId) {
    state._infoModalShownForEvent = null;
  }

  // SSE payload は crdtToFlat 出力のため folderId / lastProposalGeneratedAt を含まない。
  // prev から引き継いで上書き消失を防ぐ。
  state.events[idx] = {
    ...event,
    folderId:                  event.folderId                  ?? prev.folderId,
    lastProposalGeneratedAt:   event.lastProposalGeneratedAt   ?? prev.lastProposalGeneratedAt,
  };

  if (state.currentView === 'HOME' ||
      (state.currentView === 'MAIN_BOARD' && state.selectedEventId === eventId)) {
    state.render();
  }
}

function _applyEventDelete(eventId) {
  const idx = state.events.findIndex(p => p.id === eventId);
  if (idx === -1) return;
  state.events.splice(idx, 1);

  if (state.selectedEventId === eventId) {
    state.selectedEventId = null;
    state.currentView = 'HOME';
    _flashToast('このイベントは削除されました');
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
