// ===== リアルタイム同期 (SSE クライアント) =====
//
// state.events と /api/events を結びつけて、他のメンバーの編集をリアルタイムで反映する。
// CRDT は サーバー側で実施するので、クライアントは「サーバーが解決した最新版」を受け取って差し替えるだけでよい。
//
// 主な責務:
//   - 接続: state.currentUser がいる時だけ
//   - 購読対象: state.events 全部の id
//   - メッセージ受信: eventUpdated → state.events を置換、メンバー変更 → loadAfterAuth で再取得
//   - 自動再接続: このファイルが持つ（15→30→60→120→300秒の指数バックオフ）。
//     サーバーの retry（SSE_RETRY_MS）は初回の待ち時間と同じ値にしてある。
//     寿命切れ（server.js が送る bye）だけは待たずに張り直す
//   - 隠れている間は切る: タブが見えていない間・圏外の間は接続を閉じ、戻ったら張り直して
//     取りこぼしを silentReloadEvents で取り直す（下の「接続を持つのは見えている間だけ」を参照）
//   - エコーバック抑止: X-Client-Id を保存に乗せる（main.js 側で fetch をラップ）

import { state } from './state.js';
import { Components } from './components.js';
import { openMemberApprovedModal } from './modals/memberApprovedModal.js';
import { clientId } from './clientId.js';

let _es = null;
let _subscribedIds = '';

// ===== 再接続の間隔（指数バックオフ）=====
//
// ★以前はサーバーの retry（15秒）固定で、EventSource 内蔵の再接続に任せていた。
//   圏外は offline イベントで止まるが、「繋がるが失敗する」状態（家庭回線の
//   ポート枯渇など）では**15秒ごとに永久に試み続ける**ため、枯渇に油を注いでいた。
// ★最初の1回はサーバーの指示（15秒）と同じにしてある。そこから倍にしていく。
// ★寿命切れ（server.js の SSE_MAX_LIFETIME_MS）は**計画的な張り直し**なので
//   バックオフの対象にしない。サーバーが閉じる直前に bye を送ってくるので、
//   それを見たら段階をリセットしてすぐ繋ぎ直す。
const RECONNECT_DELAYS = [15_000, 30_000, 60_000, 120_000, 300_000];
let _retryStep     = 0;
let _retryTimer    = null;
let _plannedByeSeen = false;

function _clearRetryTimer() {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
}

function _scheduleReconnect() {
  if (_retryTimer) return;
  // 見えていない／圏外のあいだは繋ぎ直さない（visibility と offline の配線に任せる）
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  let delay;
  if (_plannedByeSeen) {
    _plannedByeSeen = false;
    _retryStep = 0;
    delay = 0;                 // 寿命切れ。待たずに繋ぎ直す
  } else {
    delay = RECONNECT_DELAYS[Math.min(_retryStep, RECONNECT_DELAYS.length - 1)];
    _retryStep++;
  }
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    if (!state.currentUser) return;
    syncRealtime();
  }, delay);
}

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

  // ids が空でも接続する（ユーザー固有チャンネルで memberApproved 等を受信するため）
  const url = `/api/events?cid=${encodeURIComponent(clientId)}&eventIds=${encodeURIComponent(ids)}`;
  _es = new EventSource(url);

  // 繋がったら段階をリセットする（次に落ちたときはまた15秒から）
  _es.onopen = () => { _retryStep = 0; };

  _es.addEventListener('ready', () => { _retryStep = 0; });

  // サーバーが寿命で閉じる合図。★障害と区別するために必要
  _es.addEventListener('bye', () => { _plannedByeSeen = true; });

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
  // ロール定義・ロール割当の変更（canManage の付け外しが画面に影響するため再取得）
  ['memberRoleChanged', 'memberRolesChanged', 'rolesChanged'].forEach(ev => {
    _es.addEventListener(ev, () => {
      state.silentReloadEvents?.().then(() => state.render());
    });
  });
  // 自分が承認されたとき: 申請中バナーを消し、イベント一覧を再取得してホームに反映
  _es.addEventListener('memberApproved', async (e) => {
    try {
      let eventId = null;
      try { eventId = JSON.parse(e.data)?.eventId || null; } catch (_) {}
      state.pendingApprovalMessage = null;
      if (state.currentView !== 'HOME') state.currentView = 'HOME';
      // ★イベント一覧を取り込んでからモーダルを出す。先に出すと、
      //   モーダルがイベント名を引けず「イベント」としか言えない。
      await state.silentReloadEvents?.();
      if (eventId) openMemberApprovedModal(eventId);
      else _flashToast('参加が承認されました');
    } catch (_) {}
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

  // タスクチャット：開いているタスク詳細ページに即時反映 + 通知バッジ更新
  _es.addEventListener('chatMessage', (e) => {
    try {
      const { missionId, message } = JSON.parse(e.data);
      const chat = state.missionChat;
      if (chat && chat.missionId === missionId && !chat.loading &&
          !chat.messages.some(x => x.id === message.id)) {
        chat.messages.push(message);
        state.render();
      }
    } catch (_) {}

    // ★以前はここで loadNotifications().then(() => state.render()) を**無条件**に呼んでいた。
    //   チャットを開いていなくても、どのタスクのメッセージでも「API 1本 + 全画面の作り直し」が
    //   走り、上の state.render() と合わせてメッセージ1通につき全画面再構築が2回起きていた。
    // ★必要なのは通知バッジの数字だけ。通知タブを**見ている**ときだけ全体を描き直し、
    //   それ以外はバッジの DOM だけ差し替える。
    // ★バッジの更新は、チャットを開いていた場合（上で描き直した直後）にも必ず当て直すこと。
    //   上の render() は loadNotifications() より**前**に走っているので、数字が古いまま。
    state.loadNotifications?.().then(() => {
      const onNotifTab = state.currentView === 'MAIN_BOARD'
                      && state.mainBoardTab === 'NOTIFICATIONS';
      if (onNotifTab) state.render();
      else Components.refreshNotifBadge();
    });
  });
  _es.addEventListener('chatDeleted', (e) => {
    try {
      const { missionId, messageId } = JSON.parse(e.data);
      const chat = state.missionChat;
      if (!chat || chat.missionId !== missionId) return;
      chat.messages = chat.messages.filter(x => x.id !== messageId);
      state.render();
    } catch (_) {}
  });
  _es.addEventListener('chatReaction', (e) => {
    try {
      const { missionId, messageId, reactions } = JSON.parse(e.data);
      const chat = state.missionChat;
      if (!chat || chat.missionId !== missionId) return;
      const msg = chat.messages.find(x => x.id === messageId);
      if (!msg) return;
      msg.reactions = reactions || {};
      state.render();
    } catch (_) {}
  });
  _es.onerror = () => {
    // ★内蔵の再接続に任せず、こちらで閉じて間隔を空けて張り直す。
    //   任せると retry（15秒）固定で永久に試み続ける。
    if (_es) { try { _es.close(); } catch (_) {} _es = null; }
    _subscribedIds = '';
    _scheduleReconnect();
  };
}

function _disconnect() {
  // ★予約した再接続も消すこと。残すと、意図的に切ったあと（タブが隠れた・
  //   ログアウトした）に勝手に繋ぎ直る。
  _clearRetryTimer();
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

  const prevClaims  = (prev?.missions || []).filter(m =>
    m.selfClaim && Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
    !(Array.isArray(m.assignees) && m.assignees.length > 0)).length;
  const newClaims   = (event?.missions || []).filter(m =>
    m.selfClaim && Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
    !(Array.isArray(m.assignees) && m.assignees.length > 0)).length;
  const prevPending = (prev?.pendingMembers || []).length;
  const newPending  = (event?.pendingMembers || []).length;

  // 参加申請が増えた && ボトムシートが開いている → シートをリアルタイム更新（インフォモーダル抑制）
  const pendingSheetOpen = !!document.getElementById('pending-members-sheet');
  if (newPending > prevPending && pendingSheetOpen) {
    // 状態を先に更新してからシートをリフレッシュ（後続の state.events[idx] = ... の後で呼ぶ必要があるため defer）
    setTimeout(() => window._app?.openPendingMembersSheet?.(), 0);
  }

  const needsReset = (newClaims > prevClaims) ||
                     (newPending > prevPending && !pendingSheetOpen);
  if (needsReset && state._infoModalShownForEvent === eventId) {
    state._infoModalShownForEvent = null;
  }

  // SSE payload は crdtToFlat 出力のため folderId / lastProposalGeneratedAt を含まない。
  // prev から引き継いで上書き消失を防ぐ。
  // members の username / avatarUrl も /api/data でのみ合成されるため prev から補完する
  // （補完できない新規メンバーは memberJoined → silentReloadEvents で再取得される）。
  const prevMembersById = new Map((prev.members || []).map(m => [m.userId, m]));
  const members = (event.members || []).map(m => {
    const pm = prevMembersById.get(m.userId);
    if (!pm) return m;
    return {
      ...m,
      username:  m.username  ?? pm.username,
      avatarUrl: m.avatarUrl ?? pm.avatarUrl,
    };
  });

  state.events[idx] = {
    ...event,
    members,
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
  t.className = 'c-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

export function disconnectRealtime() {
  _disconnect();
}

// ===== 接続を持つのは「見えている間」だけ =====
//
// ★つなぎっぱなしの接続は、開いているタブの数だけ端末・ルーター・サーバーに残り続ける。
//   見ていない間は切り、戻ったときに張り直すほうが、体験を変えずに常時接続を減らせる。
// ★すぐには切らない（HIDE_GRACE_MS）。タブの行き来やアプリの往復のたびに
//   接続を張り直すと、かえって接続の数が増える。
// ★戻ったときは **必ず silentReloadEvents で取り直す**。切れている間の更新は届かないので、
//   つなぎ直すだけだと画面が古いままになる。
// ★配線はこのファイルの中だけに閉じる（main.js に散らさない）。logger.js と main.js にも
//   visibilitychange の登録があるが、役割が違う（ログの送信・保存の確定）ので相乗りしない。
const HIDE_GRACE_MS = 60_000;
let _hideTimer = null;

function _resume() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  // 戻ってきたら待ち時間は最初から（前回の失敗を引きずらない）
  _clearRetryTimer();
  _retryStep = 0;
  if (!state.currentUser) return;
  // まず接続を戻す（取り直しが失敗しても、以降の更新は受け取れる）
  syncRealtime();
  // 切れている間の更新は届いていないので取り直す。
  // ★silentReloadEvents は中で syncRealtime と render まで済ませるので、ここで重ねて呼ばない
  state.silentReloadEvents?.();
}

function _pauseSoon() {
  if (_hideTimer) return;
  _hideTimer = setTimeout(() => { _hideTimer = null; _disconnect(); }, HIDE_GRACE_MS);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _pauseSoon();
    else _resume();
  });
  // 圏外のあいだ EventSource が無駄に再接続を試み続けるのを止める
  window.addEventListener('offline', () => _disconnect());
  window.addEventListener('online',  () => _resume());
}
