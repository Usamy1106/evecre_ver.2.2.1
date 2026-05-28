// ===== 状態管理 =====
import { api } from './api.js';
import { SEED_TYPES, GROWTH_THRESHOLDS, PROPOSAL_POOL } from './constants.js';
import { calculateDaysLeft } from './utils.js';
import { syncRealtime, disconnectRealtime } from './realtime.js';


// ビューレンダラーの登録テーブル（循環依存を避けるため）
const _renderers = {};

/**
 * ビュー名とレンダリング関数を紐付ける
 * @param {string} viewName
 * @param {function} fn
 */
export function registerRenderer(viewName, fn) {
  _renderers[viewName] = fn;
}

export const state = {
  // --- 認証状態 ---
  currentUser: null,                   // { id, username, email, isVerified } | null
  authDraft:   { username: '', email: '', password: '' },
  loginDraft:  { identifier: '', password: '' },
  authErrors:  {},
  accountScreen: {},                   // アカウント設定画面のサブステート
  pendingVerifyDevCode: null,          // 新規登録直後のdev用コード（HOMEバナーで表示）
  pendingMailError: null,              // 新規登録直後のメール送信失敗メッセージ

  projects: [],
  currentView: 'CREATE_ACCOUNT_INFO',  // 起動時は認証ビュー。me() の結果次第で HOME に遷移
  selectedProjectId: null,
  pendingInviteToken: null,            // 招待リンク経由で来た場合のトークン保持
  inviteContextForAuth: null,          // アカウント作成画面で「○○に招待されています」案内表示用
  inviteLinkError: null,               // 無効な招待リンクで来た時のエラーメッセージ
  mainBoardTab: 'MAIN',
  editingMissionId: null,
  draftProject: { name: '', description: '', dates: [], seedType: 'jack' },
  draftMission: { title: '', labels: [], priority: 0, dates: [], clearFormat: 'text', note: '' },
  missionModalTab: 'BASIC',
  calendarDate: new Date(),
  missionSortMode: 'createdAt',
  notifications: [],   // [{id, type, message, projectId, missionId, read, createdAt}]

  // --- 通知を取得 ---
  async loadNotifications() {
    try {
      const r = await api.listNotifications();
      if (r.ok) {
        this.notifications = r.notifications || [];
        // components.js から参照しやすいよう
        window.state = this;
      }
    } catch (_) {}
  },

  // --- 初期化（セッション確認 → ユーザーがいればデータ取得）---
  async init() {
    console.log('[init] 開始');

    // パスワードリセットリンク（/reset-password/<token>）の検出
    // 検出したら、トークン検証 → 結果に応じて画面遷移して return（招待や me() の処理はスキップ）
    const prm = window.location.pathname.match(/^\/reset-password\/([a-f0-9]{32,})\/?$/);
    if (prm) {
      const token = prm[1];
      console.log('[init] パスワードリセットリンクを検出:', token);
      window.history.replaceState(null, '', '/'); // URL をきれいに

      this.passwordResetConfirmScreen = {
        token,
        verifying: true,
        verifyError: null,
        email: null,
        newPassword: '',
        newPassword2: '',
        errors: {},
        submitting: false,
        done: false,
      };
      this.currentView = 'PASSWORD_RESET_CONFIRM';
      this.render();
      this._hideLoading();

      // バックグラウンドでトークン検証
      try {
        const r = await api.verifyPasswordResetToken(token);
        const sec = this.passwordResetConfirmScreen;
        if (r.ok) {
          sec.verifying = false;
          sec.email = r.email;
        } else if (r.error === 'token_expired') {
          sec.verifying = false;
          sec.verifyError = 'リンクの有効期限が切れています。もう一度メールを送信してください';
        } else {
          sec.verifying = false;
          sec.verifyError = 'リンクが無効です。もう一度メールを送信してください';
        }
      } catch (e) {
        console.error('[init] リセットトークン検証エラー:', e);
        if (this.passwordResetConfirmScreen) {
          this.passwordResetConfirmScreen.verifying = false;
          this.passwordResetConfirmScreen.verifyError = 'ネットワークエラーが発生しました';
        }
      }
      this.render();
      return;
    }

    // 招待トークンを取得：
    // 1. URL マッチ（/invite/<token>）→ サーバーは Cookie をセットして / にリダイレクトしているはずだが、
    //    直接ここまで来たケース・SPA fallback で URL が残っているケースの保険
    // 2. Cookie から（サーバーがセット済みのはず）
    let inviteToken = null;
    const m = window.location.pathname.match(/^\/invite\/([A-Za-z0-9]+)\/?$/);
    if (m) {
      inviteToken = m[1];
      console.log('[init] URL から招待トークン検出:', inviteToken);
      // Cookie にもセット（サーバー側で読めるように）
      document.cookie = `invite_token=${inviteToken}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
      // URLをきれいに
      window.history.replaceState(null, '', '/');
    } else {
      const cookieMatch = document.cookie.match(/(?:^|; )invite_token=([^;]+)/);
      if (cookieMatch) {
        inviteToken = decodeURIComponent(cookieMatch[1]);
        console.log('[init] Cookie から招待トークン検出:', inviteToken);
      }
    }
    this.pendingInviteToken = inviteToken;

    // プレビュー情報取得（バナー表示用、失敗してもトークンは保持）
    if (inviteToken) {
      try {
        const r = await api.previewInvite(inviteToken);
        if (r?.ok) {
          this.inviteContextForAuth = r.invite;
          console.log('[init] プレビュー取得成功:', r.invite);
        } else {
          console.warn('[init] プレビューAPIエラー:', r);
        }
      } catch (e) {
        console.warn('[init] プレビュー取得失敗:', e);
      }
    }

    // ログイン状態確認（サーバーは me() の応答に pendingProjectId を含めることがある）
    try {
      const meResp = await api.meRaw();  // 生のレスポンスを取得
      const user = meResp?.user || null;
      if (user) {
        this.currentUser = user;
        console.log('[init] 既存ログイン検出:', user.username);

        // 既にログイン済みで招待Cookieがあれば、サーバーが自動受諾済み
        if (meResp.pendingProjectId) {
          console.log('[init] サーバー側で招待自動受諾済み projectId=', meResp.pendingProjectId);
          await this._enterInvitedProject(meResp.pendingProjectId);
          this.render();
          this._hideLoading();
          return;
        }

        // 通常のログイン後フロー
        await this.loadAfterAuth(/*skipRender*/true);
      } else {
        console.log('[init] 未ログイン → CREATE_ACCOUNT_INFO');
        this.currentView = 'CREATE_ACCOUNT_INFO';
      }
    } catch (e) {
      console.error('[init] エラー:', e);
      this.currentView = 'CREATE_ACCOUNT_INFO';
    }
    this.render();
    this._hideLoading();
  },

  _hideLoading() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
      loading.classList.add('hide');
      setTimeout(() => loading.remove(), 400);
    }
  },

  // --- 招待プロジェクトに入る共通処理 ---
  // サーバー側で受諾済みの projectId を受け取って、プロジェクト画面 + 認証モーダルを開く
  async _enterInvitedProject(projectId) {
    console.log('[enterInvitedProject] projectId=', projectId);
    // プロジェクト一覧を再取得
    try {
      const data = await api.load();
      this.projects = data.projects || [];
    } catch (e) {
      console.error('[enterInvitedProject] load 失敗:', e);
    }
    // 状態クリア
    this.pendingInviteToken = null;
    this.inviteContextForAuth = null;
    this.selectedProjectId = projectId;
    this.currentView = 'MAIN_BOARD';
    syncRealtime();

    // 未認証ユーザーは認証モーダルを自動オープン
    if (!this.currentUser?.isVerified) {
      this._autoOpenVerifyModal = true;
      console.log('[enterInvitedProject] 認証モーダル自動オープン予約');
    }
  },

  // --- 認証成功後にプロジェクトデータ取得＆遷移 ---
  // pendingInviteToken があれば自動でプロジェクトに参加させてプロジェクト画面へ
  async loadAfterAuth(skipRender = false) {
    console.log('[loadAfterAuth] 開始 user=', this.currentUser?.username,
                'pendingInviteToken=', this.pendingInviteToken);
    try {
      const data = await api.load();
      this.projects = data.projects || [];
      console.log('[loadAfterAuth] プロジェクト一覧取得:', this.projects.length, '件');
      // 通知も取得
      await this.loadNotifications();
    } catch (e) {
      console.error('[loadAfterAuth] プロジェクト読み込みエラー:', e);
      this.projects = [];
      if (e?.code === 'unauthorized') {
        this.currentUser = null;
        this.currentView = 'CREATE_ACCOUNT_INFO';
        if (!skipRender) this.render();
        return;
      }
    }

    // 招待リンクから来た場合：自動受諾してプロジェクト画面へ直接遷移
    if (this.pendingInviteToken) {
      console.log('[loadAfterAuth] 招待トークン検出 → acceptInvite を呼ぶ');
      try {
        const r = await api.acceptInvite(this.pendingInviteToken);
        console.log('[loadAfterAuth] acceptInvite レスポンス:', r);
        if (r.ok && r.projectId) {
          this.pendingInviteToken = null;
          this.inviteContextForAuth = null;
          // プロジェクトリストを再取得（参加したばかりのプロジェクトを含めるため）
          try {
            const data = await api.load();
            this.projects = data.projects || [];
            console.log('[loadAfterAuth] 再取得後プロジェクト数:', this.projects.length);
          } catch (e) {
            console.error('[loadAfterAuth] 再取得失敗:', e);
          }
          this.selectedProjectId = r.projectId;
          this.currentView = 'MAIN_BOARD';
          console.log('[loadAfterAuth] ✓ MAIN_BOARD へ遷移 projectId=', r.projectId);
          syncRealtime();

          // 未認証ユーザーが招待で参加した場合：認証モーダルを自動オープン
          if (!this.currentUser?.isVerified) {
            this._autoOpenVerifyModal = true;
            console.log('[loadAfterAuth] 認証モーダル自動オープン予約');
          }

          if (!skipRender) this.render();
          return;
        } else {
          console.warn('[loadAfterAuth] 招待受諾失敗:', r);
          this.pendingInviteToken = null;
          this.inviteContextForAuth = null;
          this.inviteLinkError = _explainInviteError(r.error || '');
        }
      } catch (e) {
        console.error('[loadAfterAuth] 招待受諾エラー:', e);
        this.pendingInviteToken = null;
        this.inviteContextForAuth = null;
      }
    }

    console.log('[loadAfterAuth] HOME へ遷移');
    this.currentView = 'HOME';
    syncRealtime();
    if (!skipRender) this.render();
  },

  // --- 静かに再取得（SSE で他人が招待を承諾した時など） ---
  async silentReloadProjects() {
    try {
      const data = await api.load();
      this.projects = data.projects || [];
      syncRealtime();        // 購読対象が変わるかもしれないので
      this.render();
    } catch (e) {
      console.error('silentReload error:', e);
    }
  },

  // --- ログアウト ---
  async logout() {
    try { await api.logout(); } catch (_) {}
    disconnectRealtime();
    this.currentUser = null;
    this.projects = [];
    this.selectedProjectId = null;
    this.currentView = 'LOGIN';
    this.render();
  },

  // --- 保存（楽観的更新：バックグラウンドで保存）---
  save() {
    api.save({ projects: this.projects })
      .then(() => {
        // 新規プロジェクトが追加されている可能性 → 購読対象を更新
        syncRealtime();
      })
      .catch(e => {
        console.error('保存エラー:', e);
        if (e?.code === 'unauthorized') {
          this.currentUser = null;
          this.currentView = 'LOGIN';
          this.render();
        } else if (e?.code === 'verification_required') {
          alert('メール認証が完了するまで新規プロジェクトを作成できません。\nアカウント設定からメール認証を完了してください。');
          this.setView('ACCOUNT');
        } else if (e?.code === 'no_manage_permission') {
          alert('このプロジェクトを編集する権限がありません。\nロール設定をご確認ください。');
        }
      });
  },

  // --- 自分が現在のプロジェクトで管理可能かどうか ---
  canManageCurrentProject() {
    const p = this.projects.find(x => x.id === this.selectedProjectId);
    if (!p || !this.currentUser) return false;

    // フォールバック1: members未取得でも、ownerId が自分なら管理可能
    if (p.ownerId && p.ownerId === this.currentUser.id) return true;

    const me = (p.members || []).find(m => m.userId === this.currentUser.id);
    if (!me) {
      // members が空 = データ未取得の可能性。新規プロジェクト直後など
      // 自分のプロジェクトリストに入っている時点で何らかのメンバーのはずなので
      // 念のため「分からないときは true」とする（オーナー本人想定）
      return !p.members || p.members.length === 0;
    }

    // 複数ロール対応：roles 配列があればそれを、無ければ [role]
    const myRoleIds = Array.isArray(me.roles) && me.roles.length > 0
      ? me.roles
      : (me.role ? [me.role] : []);

    // owner は常に管理可能
    if (myRoleIds.includes('owner')) return true;

    const roles = p.roles || [
      { id: 'owner',  canManage: true },
      { id: 'admin',  canManage: true },
      { id: 'member', canManage: true },
    ];
    return myRoleIds.some(rid => {
      const def = roles.find(r => r.id === rid);
      return !!(def && def.canManage);
    });
  },

  // --- ポイント計算（星5 = 10点）---
  getProjectPoints(project) {
    return project.missions
      .filter(m => m.status === 'cleared')
      .reduce((sum, m) => sum + ((m.priority || 1) * 2), 0);
  },

  // --- 成長段階計算（1〜10段階）---
  getGrowthStage(points) {
    for (let i = GROWTH_THRESHOLDS.length - 1; i >= 0; i--) {
      if (points >= GROWTH_THRESHOLDS[i]) return i + 1;
    }
    return 1;
  },

  // --- 次の段階への進捗率（0〜100）---
  getStageProgress(points) {
    const stage = this.getGrowthStage(points);
    const idx = stage - 1;
    if (idx >= GROWTH_THRESHOLDS.length - 1) return 100;
    const currentMin = GROWTH_THRESHOLDS[idx];
    const nextMin = GROWTH_THRESHOLDS[idx + 1];
    const range = nextMin - currentMin;
    if (range <= 0) return 0;
    return Math.min(100, Math.max(0, ((points - currentMin) / range) * 100));
  },

  // --- 全体の進捗率（滑らか：0〜100）---
  getOverallProgress(points) {
    const stage = this.getGrowthStage(points);
    const stageProgress = this.getStageProgress(points);
    return ((stage - 1) + (stageProgress / 100)) * 10;
  },

  // --- 現在のプラント画像パスを取得 ---
  getPlantImagePath(project) {
    const points = this.getProjectPoints(project);
    const stage = this.getGrowthStage(points);
    const seed = SEED_TYPES.find(s => s.id === project.seedType);
    return `${seed.plantPrefix}${stage}.svg`;
  },

  // --- ビュー遷移 ---
  setView(view, projectId = null) {
    if (view === 'CREATE_PROJECT_INFO' && this.currentView === 'HOME') {
      this.draftProject = { name: '', description: '', dates: [], seedType: 'jack' };
    }
    this.currentView = view;
    this.selectedProjectId = projectId;
    this.mainBoardTab = 'MAIN';
    this.render();
    window.scrollTo(0, 0);
  },

  // --- プロジェクト作成（旧フロー、HOME から呼ばれる用、互換）---
  async addProject() {
    const id = await this._createProjectAndReturnId();
    if (id) this.setView('MAIN_BOARD', id);
  },

  // プロジェクトを作成してIDを返す（画面遷移なし）
  // 種はランダムで自動選択される
  async _createProjectAndReturnId() {
    const { name, description, dates } = this.draftProject;
    if (!name) return null;
    const safeDescription = description || '';
    const safeDates       = Array.isArray(dates) ? dates : [];

    // 種をランダム選択
    const randomSeed = SEED_TYPES[Math.floor(Math.random() * SEED_TYPES.length)];

    const defaultMissions = [
      { id: 'def-1', title: 'イベントの目的を決める',     tag: '企画', daysLeft: 30, type: 'plan', isDeletable: false, dates: [], clearFormat: 'text', status: 'yet', createdAt: Date.now(), priority: 5 },
      { id: 'def-2', title: 'イベントのタイトルを決める', tag: '企画', daysLeft: 30, type: 'plan', isDeletable: false, dates: [], clearFormat: 'text', status: 'yet', createdAt: Date.now(), priority: 5 },
      { id: 'def-3', title: 'イベントの概要を決める',     tag: '企画', daysLeft: 30, type: 'plan', isDeletable: false, dates: [], clearFormat: 'text', status: 'yet', createdAt: Date.now(), priority: 5 },
    ];

    const newProject = {
      id: Date.now().toString(),
      name,
      description: safeDescription,
      seedType: randomSeed?.id || 'jack',
      dates: [...safeDates],
      createdAt: Date.now(),
      isCompleted: false,
      progress: 0,
      daysLeft: safeDates.length > 0 ? calculateDaysLeft(safeDates[0]) : null,
      missions: defaultMissions,
      clearedData: {},
      proposals: PROPOSAL_POOL.slice(0, 3),
      lastProposalClearedTime: null,
      likes: 0,
      hasLiked: false,
      // 自分をオーナーとしてメンバーに含める（サーバー側でも同じ処理が走る）
      ownerId: this.currentUser?.id,
      members: this.currentUser ? [{
        userId: this.currentUser.id,
        role: 'owner',
        roles: ['owner'],
        joinedAt: Date.now(),
      }] : [],
    };

    this.projects.push(newProject);
    // 同期的にサーバー保存（招待リンク発行で必要なため await する）
    try {
      await api.save({ projects: this.projects });
      syncRealtime();
      // サーバー側で members/roles などが正規化されているので再取得
      try {
        const fresh = await api.load();
        if (fresh?.projects) this.projects = fresh.projects;
      } catch (_) {}
    } catch (e) {
      console.error('プロジェクト保存エラー:', e);
      // ロールバック
      this.projects = this.projects.filter(p => p.id !== newProject.id);
      return null;
    }
    return newProject.id;
  },

  // --- プロジェクト名変更 ---
  renameProject(projectId, newName) {
    const p = this.projects.find(x => x.id === projectId);
    if (!p) return;
    p.name = String(newName).trim();
    this.save();
    this.render();
  },

  // --- プロジェクト削除 ---
  deleteProject(projectId) {
    const idx = this.projects.findIndex(x => x.id === projectId);
    if (idx === -1) return;
    this.projects.splice(idx, 1);
    // 削除中のプロジェクトを開いていた場合はHOMEに戻す
    if (this.selectedProjectId === projectId) {
      this.selectedProjectId = null;
      this.currentView = 'HOME';
    }
    this.save();
    this.render();
  },

  // --- 実施日編集のコミット（開催日が変わったらdaysLeftを再計算して保存）---
  commitProjectDatesEdit() {
    const p = this.projects.find(x => x.id === this.selectedProjectId);
    if (!p) return;
    p.dates.sort();
    p.daysLeft = p.dates.length > 0 ? calculateDaysLeft(p.dates[0]) : 99;
    this.save();
  },

  // --- レンダリング ---
  render() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    // 提案の更新チェック
    if (this.selectedProjectId) {
      const p = this.projects.find(x => x.id === this.selectedProjectId);
      if (p && p.proposals.length === 0 && p.lastProposalClearedTime) {
        const hoursDiff = (Date.now() - p.lastProposalClearedTime) / (1000 * 60 * 60);
        if (hoursDiff >= 12) this._refreshProposals(p);
      }
    }

    const fn = _renderers[this.currentView];
    if (fn) fn(appEl);

    // 招待→アカウント作成→プロジェクト画面 の直後に認証モーダルを自動オープン
    if (this._autoOpenVerifyModal && this.currentView === 'MAIN_BOARD' && !this.currentUser?.isVerified) {
      this._autoOpenVerifyModal = false;
      // 動的importでモーダルを開く（state.js が verifyEmailModal に依存しないため）
      import('./modals/verifyEmailModal.js').then(mod => {
        setTimeout(() => mod.openVerifyEmailModal(), 100);
      }).catch(e => console.error('verify modal load error:', e));
    }
  },

  // --- 提案リフレッシュ ---
  _refreshProposals(p) {
    const usedIds = p.missions.map(m => m.originProposalId).filter(Boolean);
    const available = PROPOSAL_POOL.filter(pr => !usedIds.includes(pr.id));
    p.proposals = available.sort(() => 0.5 - Math.random()).slice(0, 3);
    p.lastProposalClearedTime = null;
    this.save();
  },
};

// ===== ヘルパ =====
function _explainInviteError(code) {
  switch (code) {
    case 'invite_not_found':  return '招待が見つかりません。リンクが間違っているか、取り消されています';
    case 'invite_expired':    return '招待の有効期限が切れています';
    case 'invite_used_up':    return '招待の使用上限に達しています';
    case 'project_not_found': return 'プロジェクトが見つかりません';
    default: return code || '招待を開けませんでした';
  }
}
