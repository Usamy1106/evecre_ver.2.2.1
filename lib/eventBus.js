// ===== SSE イベントバス =====
// プロジェクトの更新・メンバー変更を SSE で配信。
// クライアントは /api/events?projects=p1,p2 で購読する。
//
// 内部的には projectId → Set<res> のマップで管理する。
// クライアント側の Cookie は標準 EventSource で送信される（withCredentials）。

const channels     = new Map(); // projectId → Set<res>
const userChannels = new Map(); // userId    → Set<res>

/**
 * クライアントを SSE チャンネルに登録
 * @param {string[]} projectIds - 購読対象
 * @param {http.ServerResponse} res
 * @returns {function} unsubscribe
 */
function subscribe(projectIds, res) {
  for (const pid of projectIds) {
    if (!channels.has(pid)) channels.set(pid, new Set());
    channels.get(pid).add(res);
  }

  return function unsubscribe() {
    for (const pid of projectIds) {
      const set = channels.get(pid);
      if (set) {
        set.delete(res);
        if (set.size === 0) channels.delete(pid);
      }
    }
  };
}

/**
 * ユーザー個別チャンネルに登録
 * @param {string} userId
 * @param {http.ServerResponse} res
 * @returns {function} unsubscribe
 */
function subscribeUser(userId, res) {
  if (!userChannels.has(userId)) userChannels.set(userId, new Set());
  userChannels.get(userId).add(res);
  return function unsubscribe() {
    const set = userChannels.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) userChannels.delete(userId);
    }
  };
}

/**
 * 特定ユーザーにイベントを配信
 * @param {string} userId
 * @param {string} event
 * @param {object} data
 */
function broadcastToUser(userId, event, data) {
  const set = userChannels.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (_) {}
  }
}

/**
 * 特定プロジェクトの全購読者にイベントを配信
 * @param {string} projectId
 * @param {string} event - イベント名
 * @param {object} data
 * @param {string} [excludeClientId] - 自分自身には送らない
 */
function broadcast(projectId, event, data, excludeClientId) {
  const set = channels.get(projectId);
  if (!set || set.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of set) {
    try {
      if (excludeClientId && res.__clientId === excludeClientId) continue;
      res.write(payload);
    } catch (_) {
      // 切れていたら次回 write 時に GC される
    }
  }
}

/**
 * ハートビート（プロキシのアイドル切断対策）
 */
function startHeartbeat() {
  setInterval(() => {
    for (const set of channels.values()) {
      for (const res of set) {
        try { res.write(': heartbeat\n\n'); } catch (_) {}
      }
    }
    // ユーザー個別チャンネルもハートビート（承認待ちユーザーの接続維持）
    for (const set of userChannels.values()) {
      for (const res of set) {
        try { res.write(': heartbeat\n\n'); } catch (_) {}
      }
    }
  }, 25_000);
}

module.exports = { subscribe, broadcast, startHeartbeat, subscribeUser, broadcastToUser };
