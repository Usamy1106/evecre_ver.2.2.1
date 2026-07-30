// ===== APIクライアント =====
// 全てhttpOnly Cookieセッションで認証

import { clientId } from './clientId.js';

const HEADERS_JSON = { 'Content-Type': 'application/json' };

async function _send(method, url, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { ...HEADERS_JSON, 'X-Client-Id': clientId },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, json };
}

export const api = {
  // ----- 認証 -----
  async me() {
    const { ok, json } = await _send('GET', '/api/auth/me');
    if (!ok || !json?.ok) return null;
    return json.user || null;
  },
  // 生のレスポンス（user + pendingEventId 等を含む）を取得
  async meRaw() {
    const { json } = await _send('GET', '/api/auth/me');
    return json || { ok: false, user: null };
  },
  async register(payload) {
    const { json } = await _send('POST', '/api/auth/register', payload);
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async login(payload) {
    const { json } = await _send('POST', '/api/auth/login', payload);
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async logout() { await _send('POST', '/api/auth/logout'); },

  // ----- メール認証 -----
  async resendVerification() {
    const { json } = await _send('POST', '/api/auth/resend-verification');
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async verifyEmail(code) {
    const { json } = await _send('POST', '/api/auth/verify-email', { code });
    return json || { ok: false, error: 'ネットワークエラー' };
  },

  // ----- アカウント設定 -----
  async changeUsername(username) {
    const { json } = await _send('POST', '/api/account/change-username', { username });
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async requestEmailChange(email, password) {
    const { json } = await _send('POST', '/api/account/change-email/request', { email, password });
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async confirmEmailChange(code) {
    const { json } = await _send('POST', '/api/account/change-email/confirm', { code });
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async requestPasswordChange(currentPassword, newPassword) {
    const { json } = await _send('POST', '/api/account/change-password/request', { currentPassword, newPassword });
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async confirmPasswordChange(code) {
    const { json } = await _send('POST', '/api/account/change-password/confirm', { code });
    return json || { ok: false, error: 'ネットワークエラー' };
  },

  // ----- イベントデータ -----
  async load() {
    const { ok, status, json } = await _send('GET', '/api/data');
    if (!ok) {
      const err = new Error('データの読み込みに失敗しました');
      if (status === 401) err.code = 'unauthorized';
      throw err;
    }
    return json;
  },
  async save(data) {
    const { ok, status, json } = await _send('PUT', '/api/data', data);
    if (!ok) {
      const err = new Error(json?.error || 'データの保存に失敗しました');
      if (status === 401) err.code = 'unauthorized';
      if (json?.code === 'verification_required') err.code = 'verification_required';
      if (json?.code === 'no_manage_permission')  err.code = 'no_manage_permission';
      throw err;
    }
    return json;
  },

  // ----- メンバー -----
  async listMembers(eventId) {
    const { json } = await _send('GET', `/api/events/${eventId}/members`);
    return json || { ok: false };
  },
  async leaveProject(eventId, userId) {
    const { json } = await _send('DELETE', `/api/events/${eventId}/members/${userId}`);
    return json || { ok: false };
  },
  async updateMemberRole(eventId, userId, role) {
    const { json } = await _send('PUT', `/api/events/${eventId}/members/${userId}/role`, { role });
    return json || { ok: false };
  },
  async updateMemberRoles(eventId, userId, roles) {
    const { json } = await _send('PUT', `/api/events/${eventId}/members/${userId}/roles`, { roles });
    return json || { ok: false };
  },

  // ----- ミッション完了（メンバー可・サーバーで永続化）-----
  async completeMission(eventId, missionId, { content = '', format = 'text' } = {}) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/complete`, { content, format });
    return json || { ok: false };
  },

  // ----- ミッションチャット -----
  async listMissionChat(eventId, missionId) {
    const { json } = await _send('GET', `/api/events/${eventId}/missions/${missionId}/chat`);
    return json || { ok: false };
  },
  async postMissionChat(eventId, missionId, text, replyTo = null) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/chat`, { text, replyTo });
    return json || { ok: false };
  },
  async deleteMissionChat(eventId, missionId, messageId) {
    const { json } = await _send('DELETE', `/api/events/${eventId}/missions/${missionId}/chat/${messageId}`);
    return json || { ok: false };
  },
  async toggleChatReaction(eventId, missionId, messageId, emoji) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/chat/${messageId}/reactions`, { emoji });
    return json || { ok: false };
  },

  // ----- ミッション自己申告 -----
  async claimMission(eventId, missionId) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/claim`);
    return json || { ok: false };
  },
  async unclaimMission(eventId, missionId) {
    const { json } = await _send('DELETE', `/api/events/${eventId}/missions/${missionId}/claim`);
    return json || { ok: false };
  },
  // 選定（選定ありモード）
  async selectMissionClaims(eventId, missionId, userIds) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/select-claims`, { userIds });
    return json || { ok: false };
  },
  // ミッション提案を動的生成
  async generateProposals(eventId) {
    const { json } = await _send('POST', `/api/events/${eventId}/proposals/generate`);
    return json || { ok: false };
  },

  // ----- 操作履歴（行動ログ／管理者のみ） -----
  async getEventLogs(eventId, limit = 200) {
    const { json } = await _send('GET', `/api/events/${eventId}/logs?limit=${limit}`);
    return json || { ok: false, error: 'ネットワークエラー' };
  },

  // ----- 承認待ちメンバー -----
  async approvePendingMember(eventId, userId, roleIds) {
    const { json } = await _send('POST', `/api/events/${eventId}/pending-members/${userId}/approve`, { roleIds });
    return json || { ok: false };
  },
  async rejectPendingMember(eventId, userId) {
    const { json } = await _send('DELETE', `/api/events/${eventId}/pending-members/${userId}`);
    return json || { ok: false };
  },

  // ----- メンバー提案 -----
  async submitMemberProposal(eventId, text) {
    const { json } = await _send('POST', `/api/events/${eventId}/member-proposals`, { text });
    return json || { ok: false };
  },
  async deleteMemberProposal(eventId, proposalId) {
    const { json } = await _send('DELETE', `/api/events/${eventId}/member-proposals/${proposalId}`);
    return json || { ok: false };
  },

  // ----- リーダーチェック承認 / 差し戻し -----
  async approveMission(eventId, missionId) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/approve`);
    return json || { ok: false };
  },
  async rejectMission(eventId, missionId) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/reject`);
    return json || { ok: false };
  },

  // ----- 通知 -----
  async listNotifications() {
    const { json } = await _send('GET', '/api/notifications');
    return json || { ok: false, notifications: [] };
  },
  async markAllNotificationsRead(eventId = null) {
    const { json } = await _send('POST', '/api/notifications/read-all', eventId ? { eventId } : {});
    return json || { ok: false };
  },
  async markNotificationRead(id) {
    const { json } = await _send('POST', `/api/notifications/${id}/read`);
    return json || { ok: false };
  },
  async deleteNotification(id) {
    const { json } = await _send('DELETE', `/api/notifications/${id}`);
    return json || { ok: false };
  },

  // ----- カスタムロール CRUD -----
  async listRoles(eventId) {
    const { json } = await _send('GET', `/api/events/${eventId}/roles`);
    return json || { ok: false };
  },
  async createRole(eventId, name, canManage) {
    const { json } = await _send('POST', `/api/events/${eventId}/roles`, { name, canManage });
    return json || { ok: false };
  },
  async updateRole(eventId, roleId, patch) {
    const { json } = await _send('PUT', `/api/events/${eventId}/roles/${roleId}`, patch);
    return json || { ok: false };
  },
  async deleteRole(eventId, roleId) {
    const { json } = await _send('DELETE', `/api/events/${eventId}/roles/${roleId}`);
    return json || { ok: false };
  },

  // ----- パスワードリセット -----
  async requestPasswordReset(email) {
    const { json } = await _send('POST', '/api/auth/password-reset/request', { email });
    return json || { ok: false };
  },
  async verifyPasswordResetToken(token) {
    const { json } = await _send('GET', `/api/auth/password-reset/verify/${token}`);
    return json || { ok: false };
  },
  async confirmPasswordReset(token, newPassword) {
    const { json } = await _send('POST', '/api/auth/password-reset/confirm', { token, newPassword });
    return json || { ok: false };
  },

  // ----- 公開設定 -----
  async getConfig() {
    const { json } = await _send('GET', '/api/config');
    return json || { ok: false };
  },
  async googleSignIn(credential) {
    const { json } = await _send('POST', '/api/auth/google', { credential });
    return json || { ok: false };
  },

  // ----- アバター -----
  async changeAvatar(dataUrl) {
    const { json } = await _send('POST', '/api/account/change-avatar', { dataUrl });
    return json || { ok: false };
  },

  // ----- 招待 -----
  async listInvites(eventId) {
    const { json } = await _send('GET', `/api/events/${eventId}/invites`);
    return json || { ok: false };
  },
  async createInvite(eventId, opts = {}) {
    const { json } = await _send('POST', `/api/events/${eventId}/invites`, opts);
    return json || { ok: false };
  },
  async revokeInvite(eventId, token) {
    const { json } = await _send('DELETE', `/api/events/${eventId}/invites/${token}`);
    return json || { ok: false };
  },
  async previewInvite(token) {
    const { json } = await _send('GET', `/api/invites/${token}`);
    return json || { ok: false };
  },
  async acceptInvite(token) {
    const { json } = await _send('POST', `/api/invites/${token}/accept`);
    return json || { ok: false };
  },

  // ----- プロジェクト（フォルダ）-----
  async listProjects() {
    const { json } = await _send('GET', '/api/projects');
    return json || { ok: false };
  },
  async createProject(name, description = '') {
    const { json } = await _send('POST', '/api/projects', { name, description });
    return json || { ok: false };
  },
  async getProject(id) {
    const { json } = await _send('GET', `/api/projects/${id}`);
    return json || { ok: false };
  },
  async updateProject(id, patch) {
    const { json } = await _send('PUT', `/api/projects/${id}`, patch);
    return json || { ok: false };
  },
  async deleteProject(id) {
    const { json } = await _send('DELETE', `/api/projects/${id}`);
    return json || { ok: false };
  },
  async addEventToProject(projectId, eventId) {
    const { json } = await _send('POST', `/api/projects/${projectId}/events/${eventId}`);
    return json || { ok: false };
  },
  async removeEventFromProject(projectId, eventId) {
    const { json } = await _send('DELETE', `/api/projects/${projectId}/events/${eventId}`);
    return json || { ok: false };
  },
};
