// ===== APIクライアント =====
// 全てhttpOnly Cookieセッションで認証

import { clientId } from './clientId.js';

const HEADERS_JSON = { 'Content-Type': 'application/json' };

// 1リクエストあたりの上限。これを過ぎたら中断する。
// ★タイムアウトが無いと、「繋がるが応答が返らない」回線（家庭回線のポート枯渇など）で
//   iOS は 75 秒前後まで待つ。その間アプリは「読み込み中」のまま固まって見える。
const TIMEOUT_MS = 8000;
const RETRY_BACKOFF_MS = 600;

/**
 * 通信できなかったときに合成して返す JSON。
 *
 * ★ネットワーク由来の失敗コードは 'network' の1語に統一する。増やさないこと
 *   （state.js の起動処理と _onSaveError がこの1語だけを見ている）。
 */
function _networkJson(reason) {
  return {
    ok:     false,
    code:   'network',
    reason,                 // 'timeout' | 'offline'
    error:  '通信できませんでした。電波状況をご確認ください',
  };
}

async function _fetchOnce(url, init, timeoutMs) {
  const ac    = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // ★AbortSignal.timeout() を使わないこと。iOS 16.0 以降にしか無く、
  //   救おうとしている古い端末で TypeError になって逆効果。
  try     { return await fetch(url, { ...init, signal: ac.signal }); }
  finally { clearTimeout(timer); }   // ★必ず消す（放置するとタブが起き続ける）
}

/**
 * 全 API（69メソッド）の共通経路。
 *
 * ★この関数は throw しない。通信できなかったときは
 *   { ok:false, status:0, json:_networkJson(...) } を返す。
 *   これで戻り値の2系統が同時に正しくなる（呼び出し側 87 箇所は無改修）：
 *     - json フォールバック型 … `return json || {...}` の json に合成結果が入る
 *     - throw 型（load / save / savePartial）… !ok で従来どおり throw し、code に 'network' が付く
 *   ★素の `await fetch(...)` に戻さないこと。回線断で TypeError が飛び、
 *     catch していない呼び出し側（タスク完了・メール認証・アカウント設定など）が
 *     無言で壊れる（unhandledrejection の受け皿もこのアプリには無い）。
 *
 * @param {{timeout?: number, retry?: number}} opts
 */
async function _send(method, url, body, opts = {}) {
  const init = {
    method,
    credentials: 'include',
    headers: { ...HEADERS_JSON, 'X-Client-Id': clientId },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const timeout = opts.timeout ?? TIMEOUT_MS;
  // ★再試行するのは GET だけ。POST/PUT/PATCH/DELETE を既定で再送しないこと
  //   （/complete・招待の発行・チャット送信が二重実行される。退会 DELETE は
  //     2回目が 401 を返すので「成功したのに失敗表示」になる）。
  const maxRetry = opts.retry ?? (method === 'GET' ? 1 : 0);

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await _fetchOnce(url, init, timeout);
    } catch (e) {
      const reason = (e?.name === 'AbortError') ? 'timeout' : 'offline';
      // 圏外がはっきりしているときは待たずに諦める（再試行しても結果は同じ）
      if (!(attempt < maxRetry && navigator.onLine !== false)) {
        return { ok: false, status: 0, json: _networkJson(reason) };
      }
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      continue;
    }
    // 502/503/504 は一過性のことが多い（Render の再起動中など）。GET だけ1回引き直す
    if (attempt < maxRetry && (res.status === 502 || res.status === 503 || res.status === 504)) {
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      continue;
    }
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, json };
  }
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
      // ★status 0 は '応答が返ってこなかった'（_send が合成した失敗）。401 とは別物なので先に見る
      if (status === 0)   err.code = 'network';
      if (status === 401) err.code = 'unauthorized';
      throw err;
    }
    return json;
  },
  // ★opts.returnEvents = true のとき、サーバーが正規化後のイベント一覧を同梱して返す
  //   （json.events）。イベント作成直後に GET /api/data を別途叩かないため。
  async save(data, opts = {}) {
    const path = opts.returnEvents ? '/api/data?return=events' : '/api/data';
    const { ok, status, json } = await _send('PUT', path, data);
    if (!ok) {
      const err = new Error(json?.error || 'データの保存に失敗しました');
      err.status = status;   // state.saveNow が「再送すれば通りうるか（5xx）」の判定に使う
      // ★status 0 は '応答が返ってこなかった'（_send が合成した失敗）。401 とは別物なので先に見る
      if (status === 0)   err.code = 'network';
      if (status === 401) err.code = 'unauthorized';
      if (json?.code === 'verification_required') err.code = 'verification_required';
      if (json?.code === 'no_manage_permission')  err.code = 'no_manage_permission';
      throw err;
    }
    return json;
  },

  // 変わったイベントだけを保存する（部分保存）。
  // ★PUT ではなく PATCH。PUT は「送られてこなかったイベント＝削除」という意味を持つので、
  //   一部だけを PUT に送ってはいけない（渡さなかったイベントが消える）。
  //   ここを PUT に書き換えないこと。
  // ★戻り値の savedIds は「実際に保存できた id」。呼び出し側はこれだけを
  //   保存済みとして扱い、残りは次の保存で再送する。
  async savePartial(events) {
    const { ok, status, json } = await _send('PATCH', '/api/data', { events });
    if (!ok) {
      const err = new Error(json?.error || 'データの保存に失敗しました');
      err.status = status;   // state.saveNow が「再送すれば通りうるか（5xx）」の判定に使う
      // ★status 0 は '応答が返ってこなかった'（_send が合成した失敗）。401 とは別物なので先に見る
      if (status === 0)   err.code = 'network';
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

  // ----- タスク完了（メンバー可・サーバーで永続化）-----
  // struggle / solution / shareable は振り返り（任意）。サーバーが 200 字で切り、
  // submissions コレクションに保存する（★CRDT 対象外）。
  // images は uploadSubmissionImage で先に送った R2 の URL の配列（本文と同時に持てる）。
  async completeMission(eventId, missionId,
    { content = '', format = 'text', images = [], struggle = '', solution = '', shareable = false } = {}) {
    const { json } = await _send('POST', `/api/events/${eventId}/missions/${missionId}/complete`,
      { content, format, images, struggle, solution, shareable });
    return json || { ok: false };
  },

  // 提出画像を1枚アップロードし、{ ok, url } を返す。
  // ★1枚ずつ、順番に呼ぶこと（並列にしない。サーバーは 512MB / 0.5CPU）。
  // ★タイムアウトは既定の8秒では足りない（2MB を細い回線で送る）。POST なので再試行はされない。
  async uploadSubmissionImage(eventId, dataUrl) {
    const { json } = await _send('POST', `/api/events/${eventId}/submission-images`,
      { dataUrl }, { timeout: 60000 });
    return json || { ok: false };
  },

  // 振り返りだけを後から編集する。★completeMission を再送しないこと
  //   （山のオブジェクトが引き直され、完了通知と push も再送される）。
  //   個別完了のときサーバーは自分ぶんを対象にする。管理者は targetUserId で他人ぶんも直せる。
  //   ★送るのは「渡された項目だけ」。サーバーも送られた項目だけを書くので、
  //     振り返りページのように「成否だけ先に保存」ができる（本文を空で潰さない）。
  async updateReflection(eventId, missionId, patch = {}) {
    const body = {};
    for (const k of ['struggle', 'solution', 'shareable', 'outcome', 'targetUserId']) {
      if (patch[k] !== undefined) body[k] = patch[k];
    }
    const { json } = await _send('PATCH', `/api/events/${eventId}/missions/${missionId}/reflection`, body);
    return json || { ok: false };
  },

  // ----- 通知（Web Push）のテスト送信 -----
  // 自分自身に送るだけ。診断情報（サーバ時刻・TZ・購読端末数）も返る。
  async sendTestPush() {
    const { json } = await _send('POST', '/api/push/test');
    return json || { ok: false, error: 'network' };
  },

  // ----- タスクチャット -----
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

  // ----- タスク自己申告 -----
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
  // タスク提案を動的生成
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
  async createRole(eventId, name, canManage, viewOnly = false) {
    const { json } = await _send('POST', `/api/events/${eventId}/roles`,
      { name, canManage, viewOnly });
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
  // consentVersion はアカウント作成の STEP 0 で同意した規約の版数。
  // 既存ユーザーのログイン時は undefined でよい（サーバー側で無視される）。
  async googleSignIn(credential, consentVersion) {
    const { json } = await _send('POST', '/api/auth/google', { credential, consentVersion });
    return json || { ok: false };
  },

  // ----- オンボーディング（1ステップ1保存）-----
  // state.save()（/api/data）は経由させない。専用エンドポイントを直接叩く。
  async saveOnboarding(payload) {
    const { json } = await _send('PATCH', '/api/account/onboarding', payload);
    return json || { ok: false, error: 'ネットワークエラー' };
  },
  async listAvatarPresets() {
    const { json } = await _send('GET', '/api/account/avatar-presets');
    return json || { ok: false, presets: [] };
  },
  async changeAvatarPreset(presetId) {
    const { json } = await _send('POST', '/api/account/change-avatar', { presetId });
    return json || { ok: false };
  },
  // アカウント作成中（未認証）のメールアドレス変更。認証済みの変更は changeEmail 系を使う。
  async changeSignupEmail(email) {
    const { json } = await _send('POST', '/api/auth/change-signup-email', { email });
    return json || { ok: false, error: 'ネットワークエラー' };
  },

  // ----- アカウント削除（退会）-----
  // 取り消せない操作。呼ぶ前に必ず showConfirmDialog で確認を取ること。
  async deleteAccount() {
    const { json } = await _send('DELETE', '/api/account');
    return json || { ok: false, error: 'ネットワークエラー' };
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
  // answers は参加申請フォームの回答（{ skillsGood, skillsWant, joinMessage }）。
  // 省略可（旧経路・回答なしの申請でも通る）。サーバーが pendingMembers に載せる。
  // ★暫定：既存メンバーのスキル回収（modals/skillCollectModal.js）専用。
  //   回収が済んだらこのラッパーごと削除すること。
  // 自分の「参加時の回答」を変更する（イベント設定のプロフィール設定）。恒久機能
  async saveMyJoinAnswers(eventId, { skillsGood, skillsWant, joinMessage }) {
    const { json } = await _send('PUT', `/api/events/${eventId}/my-answers`, { skillsGood, skillsWant, joinMessage });
    return json || { ok: false };
  },
  async saveMySkills(eventId, skillsGood, skillsWant) {
    const { json } = await _send('POST', `/api/events/${eventId}/my-skills`, { skillsGood, skillsWant });
    return json || { ok: false };
  },

  async acceptInvite(token, answers = null) {
    const { json } = await _send('POST', `/api/invites/${token}/accept`, answers || {});
    return json || { ok: false };
  },
  // 意気込みへのリアクション（トグル）。まだメンバーでない招待相手も押せるよう
  // inviteToken を添えて送る（サーバーがメンバー or 有効な招待かを検証する）
  async toggleMotivationReaction(eventId, emoji = '🔥', inviteToken = null) {
    const { json } = await _send('POST', `/api/events/${eventId}/motivation-reactions`, { emoji, inviteToken });
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
