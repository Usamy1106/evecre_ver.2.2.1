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
  // 生のレスポンス（user + pendingProjectId 等を含む）を取得
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

  // ----- プロジェクトデータ -----
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
  async listMembers(projectId) {
    const { json } = await _send('GET', `/api/projects/${projectId}/members`);
    return json || { ok: false };
  },
  async leaveProject(projectId, userId) {
    const { json } = await _send('DELETE', `/api/projects/${projectId}/members/${userId}`);
    return json || { ok: false };
  },
  async updateMemberRole(projectId, userId, role) {
    const { json } = await _send('PUT', `/api/projects/${projectId}/members/${userId}/role`, { role });
    return json || { ok: false };
  },
  async updateMemberRoles(projectId, userId, roles) {
    const { json } = await _send('PUT', `/api/projects/${projectId}/members/${userId}/roles`, { roles });
    return json || { ok: false };
  },

  // ----- ミッション自己申告 -----
  async claimMission(projectId, missionId) {
    const { json } = await _send('POST', `/api/projects/${projectId}/missions/${missionId}/claim`);
    return json || { ok: false };
  },
  async unclaimMission(projectId, missionId) {
    const { json } = await _send('DELETE', `/api/projects/${projectId}/missions/${missionId}/claim`);
    return json || { ok: false };
  },
  // 応募締切（複数人可モード）
  async closeMissionClaims(projectId, missionId) {
    const { json } = await _send('POST', `/api/projects/${projectId}/missions/${missionId}/close-claims`);
    return json || { ok: false };
  },
  // 選定（選定ありモード）
  async selectMissionClaims(projectId, missionId, userIds) {
    const { json } = await _send('POST', `/api/projects/${projectId}/missions/${missionId}/select-claims`, { userIds });
    return json || { ok: false };
  },

  // ----- リーダーチェック承認 / 差し戻し -----
  async approveMission(projectId, missionId) {
    const { json } = await _send('POST', `/api/projects/${projectId}/missions/${missionId}/approve`);
    return json || { ok: false };
  },
  async rejectMission(projectId, missionId) {
    const { json } = await _send('POST', `/api/projects/${projectId}/missions/${missionId}/reject`);
    return json || { ok: false };
  },

  // ----- 通知 -----
  async listNotifications() {
    const { json } = await _send('GET', '/api/notifications');
    return json || { ok: false, notifications: [] };
  },
  async markAllNotificationsRead() {
    const { json } = await _send('POST', '/api/notifications/read-all');
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
  async listRoles(projectId) {
    const { json } = await _send('GET', `/api/projects/${projectId}/roles`);
    return json || { ok: false };
  },
  async createRole(projectId, name, canManage) {
    const { json } = await _send('POST', `/api/projects/${projectId}/roles`, { name, canManage });
    return json || { ok: false };
  },
  async updateRole(projectId, roleId, patch) {
    const { json } = await _send('PUT', `/api/projects/${projectId}/roles/${roleId}`, patch);
    return json || { ok: false };
  },
  async deleteRole(projectId, roleId) {
    const { json } = await _send('DELETE', `/api/projects/${projectId}/roles/${roleId}`);
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
  async listInvites(projectId) {
    const { json } = await _send('GET', `/api/projects/${projectId}/invites`);
    return json || { ok: false };
  },
  async createInvite(projectId, opts = {}) {
    const { json } = await _send('POST', `/api/projects/${projectId}/invites`, opts);
    return json || { ok: false };
  },
  async revokeInvite(projectId, token) {
    const { json } = await _send('DELETE', `/api/projects/${projectId}/invites/${token}`);
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
};
