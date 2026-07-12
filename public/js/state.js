// ===== 状態管理 =====
import { api } from './api.js';
import { SEED_TYPES, GROWTH_THRESHOLDS, PROPOSAL_POOL } from './constants.js';
import { logEvent } from './logger.js';
import { calculateDaysLeft } from './utils.js';
import { syncRealtime, disconnectRealtime } from './realtime.js';
import { showConfirmDialog } from './dialog.js';


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

  events: [],
  folders: [],               // プロジェクト（フォルダ）一覧
  selectedFolderId: null,    // 現在表示中のフォルダID
  homeTab: 'EVENTS',         // 'EVENTS' | 'PROJECTS'
  currentView: 'CREATE_ACCOUNT_INFO',  // 起動時は認証ビュー。me() の結果次第で HOME に遷移
  selectedEventId: null,
  pendingInviteToken: null,            // 招待リンク経由で来た場合のトークン保持
  pendingApprovalMessage: null,        // 承認待ち中メッセージ（HOME で表示）
  inviteContextForAuth: null,          // アカウント作成画面で「○○に招待されています」案内表示用
  inviteLinkError: null,               // 無効な招待リンクで来た時のエラーメッセージ
  mainBoardTab: 'MAIN',
  _infoModalShownForEvent: null,
  _purposeReminderCheckedForEvent: null, // 目的リマインドモーダルのチェックをこのイベントで実施済みか（セッション1回）
  _eventDateReminderCheckedForEvent: null, // 開催日リマインドモーダル（初日/翌日）のチェック実施済みか（セッション1回）
  _devAnnouncementChecked: false, // 開発者からのお知らせモーダルのチェックを実施済みか（セッション1回、イベント非依存）
  missionViewMode: 'all',      // 'all' | 'mine'  ミッション表示モード
  missionFilterTag: null,      // ミッション絞り込みタグ（null=全表示）
  archiveDisplayMode: 'label', // 'label' | 'date' | 'priority' | 'assignee'
  editingMissionId: null,
  draftEvent: { name: '', description: '', dates: [], seedType: 'jack' },
  draftMission: { title: '', labels: [], priority: 0, dates: [], clearFormat: 'text', note: '' },
  missionModalTab: 'BASIC',
  calendarDate: new Date(),
  missionSortMode: 'createdAt',
  notifications: [],   // [{id, type, message, eventId, missionId, read, createdAt}]

  // --- ミッション詳細ページ ---
  selectedMissionId: null,     // MISSION_DETAIL で表示中のミッションID
  missionDetailReturn: null,   // 戻り先 { tab, calendarSheetView } （view は常に MAIN_BOARD）
  missionChat: null,           // { missionId, messages, loading } チャットのキャッシュ
  pendingMissionLink: null,    // ディープリンク /m/<eventId>/<missionId> の保留分
                               // （init で検出 → loadAfterAuth で消費。未ログインならログイン後に消費）

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

    // iOS の Google サインイン（フォーム POST → リダイレクト）失敗時のフィードバック
    const gerr = new URLSearchParams(window.location.search).get('gerror');
    if (gerr) {
      window.history.replaceState(null, '', window.location.pathname);
      setTimeout(() => window._app?.showToast?.(
        gerr === 'verify' ? 'Google 認証に失敗しました。もう一度お試しください'
          : 'Google サインインに失敗しました', 'error'), 600);
    }

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

    // ミッションのディープリンク（/m/<eventId>/<missionId>）の検出。
    // ここでは保留にだけして通常フロー（me() → loadAfterAuth）に乗せ、loadAfterAuth で消費する。
    const mlm = window.location.pathname.match(/^\/m\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/?$/);
    if (mlm) {
      this.pendingMissionLink = { eventId: mlm[1], missionId: mlm[2] };
      console.log('[init] ミッションリンク検出:', this.pendingMissionLink);
      window.history.replaceState(null, '', '/'); // URL をきれいに
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

    // ログイン状態確認（サーバーは me() の応答に pendingEventId を含めることがある）
    try {
      const meResp = await api.meRaw();  // 生のレスポンスを取得
      const user = meResp?.user || null;
      if (user) {
        this.currentUser = user;
        console.log('[init] 既存ログイン検出:', user.username);

        if (meResp.pendingEventId || meResp.needsJoinConfirm) {
          await this.loadAfterAuth(/*skipRender*/true);
          if (meResp.needsJoinConfirm && meResp.inviteToken) {
            // クッキー経由で来たが未申請 → 確認モーダルを表示
            this.pendingInviteToken = null;
            this.inviteContextForAuth = null;
            this.currentView = 'HOME';
            this.render();
            this._hideLoading();
            setTimeout(() => window._app?.openJoinEventModal?.(meResp.pendingEventName, meResp.inviteToken), 300);
            return;
          } else if (meResp.pendingApproval) {
            this.pendingApprovalMessage = `「${meResp.pendingEventName || 'イベント'}」への参加申請を送りました。管理者の承認後に参加できます。`;
          } else if (meResp.pendingEventId) {
            await this._enterInvitedEvent(meResp.pendingEventId);
          }
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

  // --- 招待イベントに入る共通処理 ---
  // サーバー側で受諾済みの eventId を受け取って、イベント画面 + 認証モーダルを開く
  async _enterInvitedEvent(eventId) {
    console.log('[enterInvitedEvent] eventId=', eventId);
    // イベント一覧を再取得
    try {
      const data = await api.load();
      this.events = data.events || [];
    } catch (e) {
      console.error('[enterInvitedEvent] load 失敗:', e);
    }
    // 状態クリア
    this.pendingInviteToken = null;
    this.inviteContextForAuth = null;
    this.selectedEventId = eventId;
    this.currentView = 'MAIN_BOARD';
    syncRealtime();

    // 未認証ユーザーは認証モーダルを自動オープン
    if (!this.currentUser?.isVerified) {
      this._autoOpenVerifyModal = true;
      console.log('[enterInvitedEvent] 認証モーダル自動オープン予約');
    }
  },

  // --- 認証成功後にイベントデータ取得＆遷移 ---
  // pendingInviteToken があれば自動でイベントに参加させてイベント画面へ
  async loadAfterAuth(skipRender = false) {
    console.log('[loadAfterAuth] 開始 user=', this.currentUser?.username,
                'pendingInviteToken=', this.pendingInviteToken);
    try {
      let data;
      try {
        data = await api.load();
      } catch (e1) {
        // 認証直後（login/register/google）の 401 は、Set-Cookie の伝播タイミングの
        // ばらつきで一過性に起きることがある。サーバーは ok+user を返しているので
        // 一度だけリトライしてからログアウト扱いにする（バグ：Google認証後に
        // アカウント作成画面へ戻ってしまう問題の対策）。
        if (e1?.code === 'unauthorized') {
          await new Promise(r => setTimeout(r, 400));
          data = await api.load();
        } else {
          throw e1;
        }
      }
      this.events = data.events || [];
      console.log('[loadAfterAuth] イベント一覧取得:', this.events.length, '件');
      // フォルダ一覧も取得
      try {
        const pData = await api.listProjects();
        this.folders = pData.projects || [];
      } catch (_) { this.folders = []; }
      // 通知も取得
      await this.loadNotifications();
    } catch (e) {
      console.error('[loadAfterAuth] イベント読み込みエラー:', e);
      this.events = [];
      if (e?.code === 'unauthorized') {
        // loadAfterAuth は「直前に認証が成立したユーザー」に対してのみ呼ばれる
        // （init は meRaw でユーザー確認後、login/register/google は ok レスポンス後）。
        // リトライ後もここで 401 になるのは Cookie のタイミング等が原因で、
        // 本当にログアウトしているわけではない。ここでアカウント作成画面へ飛ばすと
        // 「Google サインインのたびにアカウント作成へ戻される」症状になり、
        // 連打 → レート制限 →「ページは開けません」まで連鎖するため、
        // セッションは破棄せず HOME に留める（イベントは次回 render / 操作で再取得）。
        this.currentUser = this.currentUser || null;
        this.currentView = this.currentUser ? 'HOME' : 'CREATE_ACCOUNT_INFO';
        syncRealtime();
        if (!skipRender) this.render();
        return;
      }
    }

    // 招待リンクから来た場合：確認モーダルを表示してから参加申請
    if (this.pendingInviteToken) {
      const token = this.pendingInviteToken;
      const eventName = this.inviteContextForAuth?.eventName || this.inviteContextForAuth?.name || 'イベント';
      this.pendingInviteToken = null;
      this.inviteContextForAuth = null;
      this.currentView = 'HOME';
      syncRealtime();
      if (!skipRender) this.render();
      // 未認証ユーザー（新規登録直後）はメール認証後に verifyEmailModal.js が
      // needsJoinConfirm レスポンスを受けて openJoinEventModal を呼ぶ。
      // ここで開くのは認証済みユーザー（ログイン・Google サインイン）のみ。
      if (this.currentUser?.isVerified === true) {
        setTimeout(() => window._app?.openJoinEventModal?.(eventName, token), 300);
      }
      return;
    }

    // ミッションのディープリンク（/m/<eventId>/<missionId>）から来た場合：
    // メンバーかつミッションが存在すれば直接ミッション詳細ページへ。
    // 招待フローと同時の場合は上の pendingInviteToken ブロックが先に return する（招待優先）。
    if (this.pendingMissionLink) {
      const { eventId, missionId } = this.pendingMissionLink;
      this.pendingMissionLink = null;
      const p = this.events.find(x => x.id === eventId);
      const mission = p?.missions?.find(x => x.id === missionId);
      syncRealtime();
      if (p && mission) {
        this.selectedEventId = eventId;
        this.openMissionDetail(missionId); // 戻るは MAIN_BOARD(MAIN) へ
        this._hideLoading();
        return;
      }
      this.currentView = 'HOME';
      if (!skipRender) this.render();
      setTimeout(() => window._app?.showToast?.(
        p ? 'ミッションが見つかりません（削除された可能性があります）'
          : 'このミッションにアクセスできる権限がありません', 'error'), 300);
      return;
    }

    console.log('[loadAfterAuth] HOME へ遷移');
    this.currentView = 'HOME';
    syncRealtime();
    if (!skipRender) this.render();
  },

  // --- 静かに再取得（SSE で他人が招待を承諾した時など） ---
  async silentReloadEvents() {
    try {
      const data = await api.load();
      this.events = data.events || [];
      syncRealtime();        // 購読対象が変わるかもしれないので
      this.render();
    } catch (e) {
      console.error('silentReload error:', e);
    }
  },

  // --- ログアウト ---
  async logout() {
    logEvent('logout');
    try { await api.logout(); } catch (_) {}
    // Google Identity Services の自動選択キャッシュを解除。
    // これを呼ばないと、別アカウントでログインしようとしても前回のアカウントが
    // 自動的に返ってきてしまう（One Tap / ボタンの auto-select）。
    try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch (_) {}
    disconnectRealtime();
    this.currentUser = null;
    this.events = [];
    this.selectedEventId = null;
    this.currentView = 'LOGIN';
    this.render();
  },

  // --- 保存（楽観的更新：バックグラウンドで保存）---
  save() {
    api.save({ events: this.events })
      .then(() => {
        // 新規イベントが追加されている可能性 → 購読対象を更新
        syncRealtime();
      })
      .catch(e => {
        console.error('保存エラー:', e);
        if (e?.code === 'unauthorized') {
          this.currentUser = null;
          this.currentView = 'LOGIN';
          this.render();
        } else if (e?.code === 'verification_required') {
          window._app?.showToast('メール認証が完了するまで新規イベントを作成できません。アカウント設定からメール認証を完了してください。', 'error');
          this.setView('ACCOUNT');
        } else if (e?.code === 'no_manage_permission') {
          window._app?.showToast('このイベントを編集する権限がありません。ロール設定をご確認ください。', 'error');
        }
      });
  },

  // --- 自分が現在のイベントで管理者権限を持つかどうか ---
  canManageCurrentEvent(pid = null) {
    const p = this.events.find(x => x.id === (pid || this.selectedEventId));
    if (!p || !this.currentUser) return false;

    // フォールバック1: members未取得でも、ownerId が自分なら管理者権限あり
    if (p.ownerId && p.ownerId === this.currentUser.id) return true;

    const me = (p.members || []).find(m => m.userId === this.currentUser.id);
    if (!me) {
      // members が空 = データ未取得の可能性。新規イベント直後など
      // 自分のイベントリストに入っている時点で何らかのメンバーのはずなので
      // 念のため「分からないときは true」とする（オーナー本人想定）
      return !p.members || p.members.length === 0;
    }

    // 複数ロール対応：roles 配列があればそれを、無ければ [role]
    const myRoleIds = Array.isArray(me.roles) && me.roles.length > 0
      ? me.roles
      : (me.role ? [me.role] : []);

    // owner は常に管理者権限あり
    if (myRoleIds.includes('owner')) return true;

    const roles = p.roles || [
      { id: 'owner',  canManage: true },
      { id: 'admin',  canManage: true },
      { id: 'member', canManage: false },
    ];
    return myRoleIds.some(rid => {
      const def = roles.find(r => r.id === rid);
      return !!(def && def.canManage);
    });
  },

  // --- ポイント計算（星5 = 10点）---
  getEventPoints(project) {
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
    const points = this.getEventPoints(project);
    const stage = this.getGrowthStage(points);
    const seed = SEED_TYPES.find(s => s.id === project.seedType);
    return `${seed.plantPrefix}${stage}.svg`;
  },

  // --- ビュー遷移 ---
  setView(view, id = null) {
    const prevView = this.currentView;
    // イベント設定画面に入るたびにキャッシュをリセット（別イベントを開いた時のメンバー混入防止）
    if (view === 'EVENT_SETTINGS') {
      this.eventSettingsScreen = null;
    }
    if (view === 'CREATE_EVENT_INFO' && this.currentView === 'HOME') {
      this.draftEvent = { name: '', description: '', dates: [], seedType: 'jack' };
      logEvent('event_create_started');
    }
    if (view === 'PROJECT_DETAIL') {
      this.selectedFolderId = id;
    } else if (view !== 'PROJECT_DETAIL') {
      this.selectedEventId = id;
    }
    logEvent('view_changed', { from: prevView, to: view });
    this.currentView = view;
    this.mainBoardTab = 'MAIN';
    this.missionFilterTag = null;
    this.render();
    window.scrollTo(0, 0);
  },

  // --- ミッション詳細ページへ遷移 ---
  // 完了モーダルの後継。遷移元コンテキストを記録し、戻るボタンで元の画面へ復元する。
  // カレンダー/ガントシートから開いた場合はシートを閉じ、戻り時に同じビューで再オープン。
  openMissionDetail(missionId, opts = {}) {
    const calSheet = document.getElementById('event-cal-sheet');
    const calendarSheetView = opts.calendarSheetView
      ?? (calSheet ? (calSheet.dataset.calView || 'calendar') : null);
    calSheet?.remove();
    // ページの上に出ているモーダル類を掃除
    document.getElementById('indiv-clear-list-modal')?.remove();
    document.getElementById('clear-mission-modal')?.remove();

    this.missionDetailReturn = {
      tab: opts.tab ?? this.mainBoardTab,
      calendarSheetView,
    };
    this.selectedMissionId = missionId;
    this.missionChat = { missionId, messages: [], loading: true };
    logEvent('view_changed', { from: this.currentView, to: 'MISSION_DETAIL' });
    this.currentView = 'MISSION_DETAIL';
    this.render();
    window.scrollTo(0, 0);
  },

  // --- ミッション詳細ページから戻る ---
  closeMissionDetail() {
    const ret = this.missionDetailReturn || {};
    this.selectedMissionId = null;
    this.missionDetailReturn = null;
    this.missionChat = null;
    logEvent('view_changed', { from: 'MISSION_DETAIL', to: 'MAIN_BOARD' });
    this.currentView = 'MAIN_BOARD';
    this.mainBoardTab = ret.tab || 'MAIN';
    this.render();
    window.scrollTo(0, 0);
    // カレンダー/ガントシートから来ていた場合は同じビューで再オープン
    if (ret.calendarSheetView) {
      import('./modals/eventCalendarSheet.js').then(mod => {
        mod.openEventCalendarSheet(ret.calendarSheetView);
      }).catch(() => {});
    }
  },

  // --- イベント作成（旧フロー、HOME から呼ばれる用、互換）---
  async addProject() {
    const id = await this._createEventAndReturnId();
    if (id) this.setView('MAIN_BOARD', id);
  },

  // イベントを作成してIDを返す（画面遷移なし）
  // 種はランダムで自動選択される
  async _createEventAndReturnId() {
    const { name, description, dates } = this.draftEvent;
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
      eventPhase: '企画準備',
      isCompleted: false,
      progress: 0,
      daysLeft: safeDates.length > 0 ? calculateDaysLeft(safeDates[0]) : null,
      missions: defaultMissions,
      clearedData: {},
      proposals: PROPOSAL_POOL.slice(0, 2), // 固定枠 p1/p2 のみ。3枠目(動的)は作成後に AI 生成（静的提案は出さない）
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

    this.events.push(newProject);
    // 同期的にサーバー保存（招待リンク発行で必要なため await する）
    try {
      await api.save({ events: this.events });
      syncRealtime();
      // サーバー側で members/roles などが正規化されているので再取得
      try {
        const fresh = await api.load();
        if (fresh?.events) this.events = fresh.events;
      } catch (_) {}
    } catch (e) {
      console.error('イベント保存エラー:', e);
      // ロールバック
      this.events = this.events.filter(p => p.id !== newProject.id);
      return null;
    }
    logEvent('event_created', { seedType: randomSeed?.id });

    // フォルダ内から作成した場合は folderId を設定
    if (this.selectedFolderId) {
      try {
        await api.addEventToProject(this.selectedFolderId, newProject.id);
        const ev = this.events.find(e => e.id === newProject.id);
        if (ev) ev.folderId = this.selectedFolderId;
        const folder = this.folders.find(f => f.id === this.selectedFolderId);
        if (folder) folder.eventCount = (folder.eventCount || 0) + 1;
      } catch (_) {}
    }

    return newProject.id;
  },

  // --- イベント名変更 ---
  renameEvent(eventId, newName) {
    const p = this.events.find(x => x.id === eventId);
    if (!p) return;
    p.name = String(newName).trim();
    this.save();
    this.render();
  },

  // --- イベント脱退（非オーナー）---
  async leaveEvent(eventId) {
    const ok = await showConfirmDialog({
      message: 'このイベントから脱退しますか？\n（再度招待されないと参加できなくなります）',
      confirmLabel: '脱退する',
      cancelLabel: 'キャンセル',
      destructive: true,
    });
    if (!ok) return;
    const me = this.currentUser;
    if (!me) return;
    const r = await api.leaveProject(eventId, me.id);
    if (r.ok) {
      this.events = this.events.filter(x => x.id !== eventId);
      if (this.selectedEventId === eventId) {
        this.selectedEventId = null;
        this.currentView = 'HOME';
      }
      this.render();
    } else {
      window._app?.showToast(r.error || '脱退に失敗しました');
    }
  },

  // --- イベント削除 ---
  deleteEvent(eventId) {
    const idx = this.events.findIndex(x => x.id === eventId);
    if (idx === -1) return;
    this.events.splice(idx, 1);
    // 削除中のイベントを開いていた場合はHOMEに戻す
    if (this.selectedEventId === eventId) {
      this.selectedEventId = null;
      this.currentView = 'HOME';
    }
    this.save();
    this.render();
  },

  // --- 実施日編集のコミット（開催日が変わったらdaysLeftを再計算して保存）---
  commitEventDatesEdit() {
    const p = this.events.find(x => x.id === this.selectedEventId);
    if (!p) return;
    p.dates.sort();
    p.daysLeft = p.dates.length > 0 ? calculateDaysLeft(p.dates[0]) : 99;
    // 開催日から外れた日付の時刻設定を破棄（dateTimes は dates と整合させる）
    if (p.dateTimes && typeof p.dateTimes === 'object') {
      const valid = new Set(p.dates);
      for (const k of Object.keys(p.dateTimes)) {
        if (!valid.has(k)) delete p.dateTimes[k];
      }
    }
    this.save();
  },

  // --- レンダリング ---
  render() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    // 提案の更新チェック（判定本体は _checkProposalCycle。main.js の定期タイマーからも呼ばれる）
    this._checkProposalCycle();

    const fn = _renderers[this.currentView];
    if (fn) fn(appEl);

    // MAIN_BOARD 初回表示時にインフォモーダルをチェック（管理者のみ・セッション1回）
    if (this.currentView === 'MAIN_BOARD' &&
        this.selectedEventId &&
        this._infoModalShownForEvent !== this.selectedEventId &&
        this.canManageCurrentEvent()) {
      setTimeout(() => window._app?.checkAndShowInfoModal?.(), 500);
    }

    // MAIN_BOARD 初回表示時に目的リマインドモーダルをチェック（全メンバー・セッション1回）。
    // 実際の表示可否・頻度は localStorage フラグ側で判定するため、ここでのチェック自体は
    // セッションにつき1回で十分（条件は日〜週単位でしか変化しないため）。
    // インフォモーダルより後に判定させ、重なった場合は表示を譲る（500ms → 700ms）。
    if (this.currentView === 'MAIN_BOARD' &&
        this.selectedEventId &&
        this._purposeReminderCheckedForEvent !== this.selectedEventId) {
      this._purposeReminderCheckedForEvent = this.selectedEventId;
      setTimeout(() => window._app?.checkPurposeReminderModal?.(), 700);
    }

    // MAIN_BOARD 初回表示時に開催日リマインドモーダル（初日/最終日翌日）をチェック（全メンバー・セッション1回）。
    // 他のモーダルと時間差をつけて重なりを避ける（500 → 700 → 900ms）。
    if (this.currentView === 'MAIN_BOARD' &&
        this.selectedEventId &&
        this._eventDateReminderCheckedForEvent !== this.selectedEventId) {
      this._eventDateReminderCheckedForEvent = this.selectedEventId;
      setTimeout(() => window._app?.checkEventDateReminderModal?.(), 900);
    }

    // 開発者からのお知らせモーダル（全ユーザー・セッション1回、イベント非依存）。
    // HOME/MAIN_BOARD どちらでも表示しうるため selectedEventId は問わない。
    // 他のイベント固有モーダルより後に判定させ、重なった場合は表示を譲る。
    if ((this.currentView === 'HOME' || this.currentView === 'MAIN_BOARD') &&
        this.currentUser &&
        !this._devAnnouncementChecked) {
      this._devAnnouncementChecked = true;
      setTimeout(() => window._app?.checkDeveloperAnnouncementModal?.(), 1100);
    }

    // 招待→アカウント作成→イベント画面 の直後に認証モーダルを自動オープン
    if (this._autoOpenVerifyModal && this.currentView === 'MAIN_BOARD' && !this.currentUser?.isVerified) {
      this._autoOpenVerifyModal = false;
      // 動的importでモーダルを開く（state.js が verifyEmailModal に依存しないため）
      import('./modals/verifyEmailModal.js').then(mod => {
        setTimeout(() => mod.openVerifyEmailModal(), 100);
      }).catch(e => console.error('verify modal load error:', e));
    }
  },

  // --- フォルダ（プロジェクト）管理 ---

  async loadFolders() {
    try {
      const r = await api.listProjects();
      if (r.ok) this.folders = r.projects || [];
    } catch (_) {}
  },

  async addFolder(name, description = '') {
    const r = await api.createProject(name, description);
    if (!r.ok) { window._app?.showToast(r.error || 'プロジェクトの作成に失敗しました', 'error'); return; }
    this.folders.unshift(r.project);
    this.selectedFolderId = r.project.id;
    this.currentView = 'PROJECT_DETAIL';
    this.render();
  },

  async deleteFolder(id) {
    const r = await api.deleteProject(id);
    if (!r.ok) { window._app?.showToast(r.error || 'プロジェクトの削除に失敗しました', 'error'); return; }
    this.folders = this.folders.filter(f => f.id !== id);
    // 削除したフォルダを開いていた場合はHOMEへ
    if (this.selectedFolderId === id) {
      this.selectedFolderId = null;
      this.currentView = 'HOME';
    }
    // 所属イベントの folderId をクライアント側でも null に
    this.events.forEach(e => { if (e.folderId === id) e.folderId = null; });
    this.render();
  },

  async setEventFolder(eventId, folderId) {
    if (folderId) {
      const r = await api.addEventToProject(folderId, eventId);
      if (!r.ok) { window._app?.showToast(r.error || 'イベントの追加に失敗しました', 'error'); return; }
    } else {
      const ev = this.events.find(e => e.id === eventId);
      if (ev?.folderId) {
        const r = await api.removeEventFromProject(ev.folderId, eventId);
        if (!r.ok) { window._app?.showToast(r.error || 'イベントの除外に失敗しました', 'error'); return; }
      }
    }
    const ev = this.events.find(e => e.id === eventId);
    if (ev) ev.folderId = folderId || null;
    this.render();
  },

  // --- 提案の更新サイクル判定 ---
  // スロット構成（最大3件）：
  // - 固定枠2件（FIXED_IDS = p1 開催場所を決める / p2 メインビジュアルを作成する）。
  //   採用されるまで不変。エンジンでは置き換えない。
  // - 動的枠（残り＝最大1件、表示は末尾＝p3 の位置）。Cloudflare Workers AI 生成で
  //   イベント内容・進捗・フェーズに合わせ、12時間ごとに更新する。
  //   固定枠が採用で空けば、その枠も動的になる。
  // - 基準時刻：直近生成 lastProposalGeneratedAt から12時間。未生成なら即時生成
  //   （作成直後にイベント適合の動的枠を出すため。createdAt は基準に使わない）。
  // 提案カードは管理者UIのみのため、非管理者では走らせない（生成・保存しない）。
  //
  // ★重要：この判定は render()（＝管理者が実際にイベントページへアクセス/操作した時）からのみ呼ぶこと。
  // バックグラウンドの setInterval 等でタイマー駆動にしてはいけない（誰もアクセスしていなくても
  // 12時間経過のたびに AI 生成が走り、Cloudflare Workers AI のクレジットを浪費するため）。
  // 過去に main.js の5分間隔タイマーで駆動していたが、この理由により削除済み。
  _checkProposalCycle() {
    if (!this.selectedEventId || this._proposalFetching) return;
    if (!this.canManageCurrentEvent()) return;
    const p = this.events.find(x => x.id === this.selectedEventId);
    if (!p || !Array.isArray(p.proposals)) return;
    const TWELVE_H = 12 * 60 * 60 * 1000;
    const last = p.lastProposalGeneratedAt;
    const due  = !last || (Date.now() - last >= TWELVE_H);
    if (due) this._refreshProposals(p);
  },

  // --- 提案リフレッシュ（サーバーの AI 生成エンドポイントを呼ぶ） ---
  // 固定枠（p1/p2、非採用で残っているもの）は保持し、それ以外の「動的枠」だけを
  // 新しい提案で入れ替える（＝動的枠は12時間ごとに更新される）。固定枠が採用で空けば
  // その枠も動的枠として埋まる。表示順は p1 → p2 → 動的枠（末尾＝p3 の位置）。結果は save() で永続化。
  async _refreshProposals(p) {
    if (this._proposalFetching) return;
    this._proposalFetching = true;
    const FULL = 3;
    const FIXED_IDS = new Set(['p1', 'p2']); // 固定枠
    // ★レース対策：固定枠・除外集合・並びは「必ず await の後」に最新の p.proposals / p.missions
    //   から計算する。生成を待つ間にユーザーが採用（提案削除＋ミッション追加）しても、
    //   古いスナップショットで採用済みの固定提案を復活させない（＝ミッションと重複しない）。
    //   除外：採用済みid（originProposalId）／既存ミッション名／既に残す固定提案。
    // タイトル比較は正規化して行う（表記ゆれ・空白差で重複がすり抜けるのを防ぐ）
    const normTitle = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/[\s　]/g, '');
    const buildResult = (candidates) => {
      const adoptedIds    = new Set((p.missions || []).map(m => m.originProposalId).filter(Boolean));
      const missionTitles = new Set((p.missions || []).map(m => normTitle(m.title)));
      const fixed = (p.proposals || []).filter(pr => FIXED_IDS.has(pr.id) && !adoptedIds.has(pr.id));
      const need  = Math.max(0, FULL - fixed.length); // 動的枠の数
      const seenIds    = new Set(fixed.map(x => x.id));
      const seenTitles = new Set(fixed.map(x => normTitle(x.title)));
      const dynamic = [];
      for (const np of candidates) {
        if (dynamic.length >= need) break;
        if (!np) continue;
        if (seenIds.has(np.id) || adoptedIds.has(np.id)) continue;
        if (seenTitles.has(normTitle(np.title)) || missionTitles.has(normTitle(np.title))) continue;
        dynamic.push(np);
        seenIds.add(np.id); seenTitles.add(normTitle(np.title));
      }
      // 固定枠を先頭（p1 → p2）に置き、動的枠を末尾（p3 の位置）に並べる
      const p1 = fixed.find(x => x.id === 'p1');
      const p2 = fixed.find(x => x.id === 'p2');
      return [p1, p2, ...dynamic].filter(Boolean).slice(0, FULL);
    };
    try {
      const r = await api.generateProposals(p.id);
      if (r.ok && Array.isArray(r.proposals)) {
        // 固定枠 + 新規動的枠。既存の動的提案は破棄して入れ替える（12時間ごと更新）
        p.proposals = buildResult(r.proposals);
        p.lastProposalGeneratedAt = r.lastProposalGeneratedAt;
        p.lastProposalClearedTime = null;
        this.save();
        this.render();
      }
    } catch (_) {
      // API 失敗時は PROPOSAL_POOL フォールバック（固定id・使用済みは除外して動的枠を補充）
      const usedIds = new Set((p.missions || []).map(m => m.originProposalId).filter(Boolean));
      const available = PROPOSAL_POOL.filter(pr => !usedIds.has(pr.id) && !FIXED_IDS.has(pr.id));
      p.proposals = buildResult(available.sort(() => 0.5 - Math.random()));
      this.save();
      this.render();
    } finally {
      this._proposalFetching = false;
    }
  },
};

// ===== ヘルパ =====
function _explainInviteError(code) {
  switch (code) {
    case 'invite_not_found':  return '招待が見つかりません。リンクが間違っているか、取り消されています';
    case 'invite_expired':    return '招待の有効期限が切れています';
    case 'invite_used_up':    return '招待の使用上限に達しています';
    case 'project_not_found': return 'イベントが見つかりません';
    default: return code || '招待を開けませんでした';
  }
}
