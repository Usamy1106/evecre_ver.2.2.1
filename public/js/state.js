// ===== 状態管理 =====
import { api } from './api.js';
import { SEED_TYPES, PROPOSAL_POOL } from './constants.js';
import { logEvent } from './logger.js';
import { calculateDaysLeft, todayStr } from './utils.js';
import { syncRealtime, disconnectRealtime } from './realtime.js';
import { showConfirmDialog } from './dialog.js';


// 保存のデバウンス待ち時間(ms)。save() は全イベント全文を PUT し、サーバは
// 更新後にイベント全文を SSE 購読者全員へブロードキャストするため、連続操作で
// 毎回走らせると負荷が大きい。
const SAVE_DEBOUNCE_MS = 400;

// ビューレンダラーの登録テーブル（循環依存を避けるため）
const _renderers = {};

/**
 * イベント作成フローの空の下書きを作る。
 * ★リセットは必ずこの関数（または state.resetDraftEvent()）を経由すること。
 *   以前は同じオブジェクトリテラルが state.js / main.js / createEvent.js の3箇所に
 *   散っており、項目を足すたびに入れ忘れる温床になっていた。
 * eventType / expectedScale / catchphrase / motivationTags / motivationText は
 * すべて任意。未入力なら保存時に落とすので、既存イベントと同じ形になる。
 */
function newDraftEvent() {
  return {
    name: '', description: '', dates: [], seedType: 'jack',
    eventType: null, expectedScale: null, catchphrase: '',
    motivationTags: [], motivationText: '',
  };
}

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
  // 起動時は入口画面（新規登録 / ログインの2択）。me() の結果次第で HOME に遷移。
  // ★ここを CREATE_ACCOUNT_INFO に戻さないこと。既存ユーザーが毎回いきなり
  //   アカウント作成画面から始まり、ログインを探すことになる。
  currentView: 'WELCOME',
  selectedEventId: null,
  pendingInviteToken: null,            // 招待リンク経由で来た場合のトークン保持
  pendingApprovalMessage: null,        // 承認待ち中メッセージ（HOME で表示）
  inviteContextForAuth: null,          // アカウント作成画面で「○○に招待されています」案内表示用
  // 参加申請の直後に HOME で見せる承認待ちカードの中身（招待プレビュー）。
  // ★承認までの待ち時間が空白だと、承認されても戻ってこない。イベントの顔と
  //   リーダーの言葉を見せておくことで、承認通知が来たときに開く確率を上げる。
  pendingApprovalInvite: null,
  inviteLinkError: null,               // 無効な招待リンクで来た時のエラーメッセージ
  signup: null,                        // アカウント作成フロー（views/signup.js）の下書き
  pushSubscribed: null,                // この端末が push を購読済みか（null=未判定）。
                                       // HOME のバナー表示を同期で判定するためのキャッシュ
  pendingPushSetup: false,             // アカウント作成の完了直後に通知セットアップを出す予約
  // 招待リンクから来た人の「参加しますか？」モーダルの予約 { token, eventName, eventId }。
  // ★プロフィール作成（STEP 4〜8）が終わってから出す。作成途中に出すと質問の上に
  //   モーダルが重なり、どちらも進められなくなる（実際にその不具合を出した）。
  pendingJoinConfirm: null,
  legalDoc: null,                      // LEGAL ビューで表示中の文書 'terms' | 'privacy'
  legalReturnView: null,               // LEGAL を閉じたときに戻るビュー
  mainBoardTab: 'MAIN',
  _infoModalShownForEvent: null,
  _purposeReminderCheckedForEvent: null, // 目的リマインドモーダルのチェックをこのイベントで実施済みか（セッション1回）
  _eventDateReminderCheckedForEvent: null, // 開催日リマインドモーダル（初日/翌日）のチェック実施済みか（セッション1回）
  _devAnnouncementChecked: false, // 開発者からのお知らせモーダルのチェックを実施済みか（セッション1回、イベント非依存）
  _skillCollectCheckedForEvent: null, // ★暫定：既存メンバーのスキル回収チェック済みか（回収後に削除）
  // ミッション完了の演出を次の描画で1回だけ出す。submitMissionClear（helpers.js）が
  // status が 'cleared' になったときだけ立て、renderMainBoard が消費して倒す。
  // ★leaderCheck（承認待ち）と individualClear の途中では立てないこと。
  //   どちらも status が cleared にならない＝マスが増えないので、
  //   増えていないのに祝う演出になってしまう。
  mountainCelebrate: false,
  // 提案キャラクターの一度きりの演出。どちらも renderMainBoard が消費して倒す。
  //   charactersIntro    … イベント作成直後、3体が順に跳ねて登場する
  //   proposalsRevealed  … 提案が届いた瞬間、バッジが出て目線が定位置へ戻る
  // HOME 右下のひとこと。{ character, text } か null。
  // ★HOME を開いたとき（renderHome）に引き、HOME を離れるとき（setView）に捨てる。
  homeTip: null,
  // アーカイブの「参加時の回答」ページの表示モード（'user' | 'question'）
  answersMode: 'user',
  charactersIntro: false,
  proposalsRevealed: false,
  missionViewMode: 'all',      // 'all' | 'mine'  ミッション表示モード
  missionFilterTag: null,      // ミッション絞り込みタグ（null=全表示）
  archiveDisplayMode: 'label', // 'label' | 'date' | 'priority' | 'assignee'
  editingMissionId: null,
  draftEvent: newDraftEvent(),   // イベント作成フローの下書き。リセットは state.resetDraftEvent()
  draftMission: { title: '', labels: [], priority: 0, dates: [], clearFormat: 'text', note: '' },
  missionModalTab: 'BASIC',
  calendarDate: new Date(),
  missionSortMode: 'createdAt',
  notifications: [],   // [{id, type, message, eventId, missionId, read, createdAt}]
  _saveTimer: null,    // save() のデバウンスタイマー（flushPendingSave で確定させる）

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
        console.log('[init] 未ログイン → WELCOME');
        this.currentView = 'WELCOME';
      }
    } catch (e) {
      console.error('[init] エラー:', e);
      this.currentView = 'WELCOME';
    }
    this.render();
    this._hideLoading();
  },

  _hideLoading() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
      loading.classList.add('is-hidden');
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
        this.currentView = this.currentUser ? 'HOME' : 'WELCOME';
        syncRealtime();
        if (!skipRender) this.render();
        return;
      }
    }

    // 招待リンクから来た場合：確認モーダルを表示してから参加申請
    if (this.pendingInviteToken) {
      const token = this.pendingInviteToken;
      const eventName = this.inviteContextForAuth?.eventName || this.inviteContextForAuth?.name || 'イベント';
      const eventId   = this.inviteContextForAuth?.eventId || '';
      // 未認証ユーザー（新規登録直後）はメール認証後に signup.js の _finish が
      // needsJoinConfirm レスポンスを受けて予約する。
      // ここで予約するのは認証済みユーザー（ログイン・Google サインイン）のみ。
      if (this.currentUser?.isVerified === true) {
        this.pendingJoinConfirm = { token, eventName, eventId };
      }
      this.pendingInviteToken = null;
      this.inviteContextForAuth = null;
      this.currentView = 'HOME';
      syncRealtime();
      // ★プロフィール作成が途中ならそちらが先。参加確認は予約したまま持ち越し、
      //   完了カードの「はじめる」で消費する（signup.js）。
      if (this._resumeOnboarding && this._resumeOnboarding()) {
        this._hideLoading();
        return;
      }
      if (!skipRender) this.render();
      this.consumePendingJoinConfirm();
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

    // オンボーディング（プロフィール作成）が途中なら続きから再開する。
    // ★iOS の Google サインインはリダイレクトで JS の状態が消えるため、
    //   進行状態はサーバー（users.onboarding）から復元している。
    // ★招待・ミッションリンクの着地は上のブロックで先に return しているので、
    //   ここへ来るのは通常の起動・ログイン直後だけ。
    if (this._resumeOnboarding && this._resumeOnboarding()) {
      this._hideLoading();
      return;
    }

    console.log('[loadAfterAuth] HOME へ遷移');
    this.currentView = 'HOME';
    syncRealtime();
    if (!skipRender) this.render();
    this.consumePendingJoinConfirm();
  },

  /**
   * 予約してある「イベントに参加しますか？」モーダルを開く。
   * ★プロフィール作成の途中では呼ばないこと（質問の上に重なる）。
   */
  consumePendingJoinConfirm() {
    const j = this.pendingJoinConfirm;
    if (!j) return;
    this.pendingJoinConfirm = null;
    setTimeout(() => window._app?.openJoinEventModal?.(j.eventName, j.token), 300);
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
    // ★入口へ戻す。別のアカウントで入り直す人も、新しく作る人もここから分かれる
    this.currentView = 'WELCOME';
    this.render();
  },

  // --- アカウント削除後の後始末 ---
  // サーバー側でセッション Cookie は破棄済み。ログアウトと違い「戻る先のアカウントが
  // 存在しない」ので、下書きやキャッシュも含めて完全に初期化してから入口へ戻す。
  resetAfterAccountDeleted() {
    try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch (_) {}
    disconnectRealtime();
    this.currentUser = null;
    this.events = [];
    this.folders = [];
    this.notifications = [];
    this.selectedEventId = null;
    this.selectedFolderId = null;
    this.selectedMissionId = null;
    this.missionChat = null;
    this.accountScreen = {};
    this.signup = null;
    this.authDraft  = { username: '', email: '', password: '' };
    this.loginDraft = { identifier: '', password: '' };
    this.authErrors = {};
    this.pendingInviteToken = null;
    this.inviteContextForAuth = null;
    this.pendingApprovalMessage = null;
    this.pendingApprovalInvite = null;
    this.pendingMissionLink = null;
    this.currentView = 'WELCOME';
    this.render();
    setTimeout(() => window._app?.showToast?.('アカウントを削除しました', 'info'), 100);
  },

  // --- 保存（楽観的更新：バックグラウンドで保存）---
  // save() は 400ms のトレーリングデバウンス。チェックリストの連続チェックなど
  // 短時間に何度も呼ばれる操作で、毎回「全イベント全文の PUT + SSE 全文ブロードキャスト」が
  // 走るのを防ぐ。UI の反映は従来どおり即座（楽観的更新は変えない）。
  // ★保存の完了を待ちたい場合は saveNow() を使うこと（save() の await は無意味）。
  save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  },

  // --- 即時保存（await 可能）---
  // 保存完了後に続けて処理したい場合（イベント設定の保存後リロードなど）はこちらを使う。
  saveNow() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    return api.save({ events: this.events })
      .then(() => {
        // 新規イベントが追加されている可能性 → 購読対象を更新
        syncRealtime();
      })
      .catch(e => {
        console.error('保存エラー:', e);
        if (e?.code === 'unauthorized') {
          this.currentUser = null;
          this.currentView = 'WELCOME';
          this.render();
        } else if (e?.code === 'verification_required') {
          window._app?.showToast('メール認証が完了するまで新規イベントを作成できません。アカウント設定からメール認証を完了してください。', 'error');
          this.setView('ACCOUNT');
        } else if (e?.code === 'no_manage_permission') {
          window._app?.showToast('このイベントを編集する権限がありません。ロール設定をご確認ください。', 'error');
        }
      });
  },

  // --- 保留中の保存を確定させる（ページ離脱・バックグラウンド遷移時）---
  // これが無いとデバウンス待ちの変更が失われる。main.js のエントリで
  // visibilitychange / beforeunload に配線している（logger.js と同じ方式）。
  flushPendingSave() {
    if (!this._saveTimer) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this.saveNow();
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

  /**
   * いま開いているイベントで自分が「閲覧のみ」かどうか。
   *
   * ★管理者権限が優先される（サーバーの eventStore.isViewOnly と同じ規則）。
   *   両方に判定があるのは、サーバーが権限の担保、こちらは操作 UI を出さない
   *   ためのもの。★ここで許しても、サーバーが 403 で弾く。
   * ★判定を各画面に散らさず必ずこの関数を通すこと。
   */
  isViewOnlyCurrentEvent(pid = null) {
    if (this.canManageCurrentEvent(pid)) return false;   // ★管理者権限が優先
    const p = this.events.find(x => x.id === (pid || this.selectedEventId));
    if (!p || !this.currentUser) return false;
    const me = (p.members || []).find(m => m.userId === this.currentUser.id);
    if (!me) return false;
    const myRoleIds = Array.isArray(me.roles) && me.roles.length > 0
      ? me.roles
      : (me.role ? [me.role] : []);
    const roles = p.roles || [];
    return myRoleIds.some(rid => !!roles.find(r => r.id === rid)?.viewOnly);
  },

  // --- 通知タップからの遷移（ウォームスタート専用）---
  // アプリが既に開いている状態で通知をタップしたときに sw.js から
  // postMessage(PUSH_NAVIGATE) 経由で呼ばれる。URL は既存のディープリンク形式。
  // コールドスタート（アプリが閉じていた場合）は init() が pathname を読んで
  // pendingMissionLink に積み、loadAfterAuth が消費する既存経路を通る。
  handlePushNavigation(url) {
    // 未ログインなら何もしない（勝手に画面を飛ばさない）
    if (!this.currentUser) return;

    let path;
    try { path = new URL(url, window.location.origin).pathname; } catch (_) { return; }

    // init() と同じ正規表現（形式を1箇所に揃える）
    const mlm = path.match(/^\/m\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/?$/);
    if (!mlm) { this.setView('HOME'); return; }

    const [, eventId, missionId] = mlm;
    const p = this.events.find(x => x.id === eventId);
    const mission = p?.missions?.find(x => x.id === missionId);
    // 非メンバー・削除済みは白画面にせず HOME へ退避（ディープリンクと同じ扱い）
    if (!p || !mission) {
      window._app?.showToast('ミッションが見つかりませんでした');
      this.setView('HOME');
      return;
    }
    this.selectedEventId = eventId;
    this.openMissionDetail(missionId);
  },

  // --- ビュー遷移 ---
  setView(view, id = null) {
    const prevView = this.currentView;
    // ★HOME のひとことは「HOME を開くたび」に引き直す。HOME から離れるときに
    //   捨てておき、次に HOME を描くときに引かせる（renderHome が null なら引く）。
    //   render() のたびに引くと、タブ切り替えや SSE の受信で入れ替わってしまう。
    if (view !== 'HOME') this.homeTip = null;
    // イベント設定画面に入るたびにキャッシュをリセット（別イベントを開いた時のメンバー混入防止）
    if (view === 'EVENT_SETTINGS') {
      this.eventSettingsScreen = null;
    }
    if (view === 'CREATE_EVENT_INFO' && this.currentView === 'HOME') {
      this.resetDraftEvent();
      logEvent('event_create_started');
    }
    // ★selectedFolderId は _createEventAndReturnId が「作ったイベントをフォルダに入れる」
    //   判定に使う。プロジェクト詳細を一度開くと残り続けるため、そこ以外から作成に入るときは
    //   必ず消す（消さないと、HOME から作ったイベントが直前に見ていたフォルダに入ってしまう）。
    //   プロジェクト詳細からの作成は createEventInFolder が直前にセットするので影響しない。
    if (view === 'CREATE_EVENT_INFO' && this.currentView !== 'PROJECT_DETAIL') {
      this.selectedFolderId = null;
    }
    if (view === 'PROJECT_DETAIL') {
      this.selectedFolderId = id;
    } else if (view !== 'PROJECT_DETAIL') {
      this.selectedEventId = id;
    }
    // ★イベントページを離れるときは初期オンボーディングの表示だけ畳む。
    //   進行状態は消さないので、戻ってきたら同じ段階から再開する。
    //   （畳まないとコーチマークがホームに重なり、以後まったく進めなくなる）
    if (prevView === 'MAIN_BOARD' && view !== 'MAIN_BOARD') {
      window._app?.abortIntroVisuals?.();
    }
    logEvent('view_changed', { from: prevView, to: view });
    this.currentView = view;
    this.mainBoardTab = 'MAIN';
    this.missionFilterTag = null;
    this.render();
    window.scrollTo(0, 0);
  },

  // --- 法務ドキュメント（利用規約 / プライバシーポリシー）---
  // 本文は public/legal/*.md にあり、views/legal.js が fetch して描画する。
  // 認証前（アカウント作成中）からも開くため、setView の id 引数ではなく専用フィールドで持つ。
  openLegal(slug) {
    this.legalDoc = slug;
    this.legalReturnView = this.currentView;
    this.currentView = 'LEGAL';
    this.render();
    window.scrollTo(0, 0);
  },

  closeLegal() {
    this.currentView = this.legalReturnView || 'WELCOME';
    this.legalDoc = null;
    this.legalReturnView = null;
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

  // --- イベント作成フローの下書きをリセット ---
  resetDraftEvent() {
    this.draftEvent = newDraftEvent();
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

    // 作成フローで聞いた任意項目。未入力のものは newProject に載せない
    // （undefined は flatToCrdt が落とすが、空文字/空配列は「入力された空」として
    //   保存されてしまうため、ここで明示的に除外して既存イベントと同じ形にする）
    const d = this.draftEvent;
    const optional = {};
    if (d.eventType)      optional.eventType      = d.eventType;
    if (d.expectedScale)  optional.expectedScale  = d.expectedScale;
    if (d.catchphrase?.trim())    optional.catchphrase    = d.catchphrase.trim();
    if (d.motivationTags?.length) optional.motivationTags = [...d.motivationTags];
    if (d.motivationText?.trim()) optional.motivationText = d.motivationText.trim();

    // 種をランダム選択
    const randomSeed = SEED_TYPES[Math.floor(Math.random() * SEED_TYPES.length)];

    // ★自動作成するミッションは「目的」と「概要」の2件。
    //   def-2（タイトル）は作らない。タイトルはアーカイブのペンから入力でき
    //   （modals/helpers.js の editArchiveItem('title')、保存時に def-2 を作る）、
    //   ミッションとして並べるほどの作業ではないため。★この入口は消さないこと。
    //   ★def-3（概要）は utils.js の setArchiveSummary と同じ clearedData キーを使う。
    //     イベント設定・アーカイブのペンからも同じ場所を読み書きするので、
    //     どこから書いても表示が食い違わない。
    //   ★ヒント文は constants.js の MISSION_DESCRIPTIONS['def-1'] / ['def-3']。
    const defaultMissions = [
      { id: 'def-1', title: 'イベントの目的を定めよう', tag: '企画', daysLeft: 30, type: 'plan', isDeletable: false, dates: [], clearFormat: 'text', status: 'yet', createdAt: Date.now(), priority: 5 },
      { id: 'def-3', title: 'イベントの概要を定めよう', tag: '企画', daysLeft: 30, type: 'plan', isDeletable: false, dates: [], clearFormat: 'text', status: 'yet', createdAt: Date.now(), priority: 5 },
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
      proposals: [], // 固定枠は廃止。3枠すべて作成直後の初回 _checkProposalCycle で AI 生成する
                     // （生成が返るまで mainBoard がローディングカードを出す。静的提案は出さない）
      lastProposalClearedTime: null,
      likes: 0,
      hasLiked: false,
      ...optional,   // eventType / expectedScale / catchphrase / motivation*（入力があるものだけ）
      motivationReactions: [],   // CRDT対象外。専用エンドポイントの $addToSet / $pull でのみ更新する
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
    // ★作ったイベントを最初に開いたとき、提案キャラクターを登場させる
    this.charactersIntro = true;

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
    // 削除は不可逆（サーバー側で submissions / notifications / チャット / R2画像まで消える）。
    // デバウンスで遅延させず即時に確定させる。
    this.saveNow();
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

    // ★フェーズの自動遷移を先に判定する。提案の可否がフェーズに依存するため、
    //   順番を入れ替えると「開催が終わった直後の1回だけ提案が生成される」ことになる。
    this._checkEventPhase();
    // 提案の更新チェック（判定本体は _checkProposalCycle）
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

    // 参加が承認されてイベントページに入った直後、リーダーの意気込みを見せて🔥を送れるようにする。
    // 表示可否（意気込みの有無・オーナー本人か・既読か）はモーダル側が判定する。
    // ★他モーダルより先に出す（歓迎の演出なので、入った直後に見せたい）。
    // ★セッション1回ゲートにしないこと。モーダル側は他のモーダルと重なったとき
    //   「既読フラグを立てずに持ち越す」作りなので、ここでゲートを消費すると
    //   その回で永久に流れてしまう（🔥が出ないという報告の原因だった）。
    //   既読判定は localStorage 側が持っているので、毎回評価してよい。
    if (this.currentView === 'MAIN_BOARD' && this.selectedEventId) {
      setTimeout(() => window._app?.checkLeaderMotivationModal?.(), 300);
    }

    // ★初期オンボーディング（イベント作成直後のチュートリアル）を最優先で評価する。
    //   これが動いている間は modalGuard 経由で他の自動表示モーダルが止まる。
    if (this.currentView === 'MAIN_BOARD' && this.selectedEventId) {
      setTimeout(() => window._app?.checkIntro?.(), 250);
    }

    // オンボーディング（使い方の案内）。表示可否・優先度は onboarding.js が判定する。
    // ★他モーダルより後に出す（1300ms）。重なったらフラグを立てずに持ち越すので、
    //   次の render() で再判定される。★セッション1回ゲートにしないこと
    //   （1つ出したら次の段階のステップが控えているため、render のたびに評価する）。
    if (this.currentView === 'MAIN_BOARD' && this.selectedEventId) {
      setTimeout(() => window._app?.checkOnboarding?.(), 1300);
    }

    // ★暫定：既存メンバーのスキル回収（modals/skillCollectModal.js）。
    //   参加申請フォームが入る前から居るメンバーには skillsGood / skillsWant が無く、
    //   担当者のおすすめが機能しないため、後追いで聞く。
    //   ★他モーダルより後（1500ms）。重なったら表示せずスヌーズも記録しない。
    //   ★回収が済んだらこのブロックごと削除すること。
    if (this.currentView === 'MAIN_BOARD' && this.selectedEventId &&
        this._skillCollectCheckedForEvent !== this.selectedEventId) {
      this._skillCollectCheckedForEvent = this.selectedEventId;
      setTimeout(() => window._app?.checkSkillCollectModal?.(), 1500);
    }

    // アカウント作成の完了直後：ホーム画面追加 → 通知許可 を順に案内する。
    // ★オンボーディングの途中では出さない（iOS は追加しないと許可できず、
    //   作成途中に共有シートへ誘導すると流れが切れるため）。
    // ★招待リンクから来た人には出さない。参加申請を先に済ませてもらう
    //   （通知の案内は参加後にいくらでも出せるが、参加申請は今しか出せない）。
    if (this.currentView === 'HOME' && this.pendingPushSetup && this.currentUser &&
        !this.pendingJoinConfirm) {
      this.pendingPushSetup = false;
      // silent:true … すでにオン／非対応なら何も出さない（自動起動のため）
      setTimeout(() => window._app?.startPushSetup?.('signup_complete', true), 600);
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
    const ev = this.events.find(e => e.id === eventId);
    const prevFolderId = ev?.folderId || null;
    if (folderId) {
      const r = await api.addEventToProject(folderId, eventId);
      if (!r.ok) { window._app?.showToast(r.error || 'イベントの追加に失敗しました', 'error'); return; }
    } else if (prevFolderId) {
      const r = await api.removeEventFromProject(prevFolderId, eventId);
      if (!r.ok) { window._app?.showToast(r.error || 'イベントの除外に失敗しました', 'error'); return; }
    }
    if (ev) ev.folderId = folderId || null;
    // eventCount はサーバーでは動的計算のため、次の loadFolders() を待たずにここで即時反映する
    if (prevFolderId && prevFolderId !== folderId) {
      const prevFolder = this.folders.find(f => f.id === prevFolderId);
      if (prevFolder) prevFolder.eventCount = Math.max(0, (prevFolder.eventCount || 0) - 1);
    }
    if (folderId && folderId !== prevFolderId) {
      const nextFolder = this.folders.find(f => f.id === folderId);
      if (nextFolder) nextFolder.eventCount = (nextFolder.eventCount || 0) + 1;
    }
    this.render();
  },

  // --- 引き継ぎ日の編集をコミットする ---
  // ★開催日（commitEventDatesEdit）と違い daysLeft は触らない。
  //   引き継ぎ日は表示と自動フェーズ遷移にしか使わず、締切計算には入れないため。
  commitHandoverDatesEdit() {
    const p = this.events.find(x => x.id === this.selectedEventId);
    if (!p) return;
    if (!Array.isArray(p.handoverDates)) p.handoverDates = [];
    p.handoverDates.sort();
    this.save();
    this.render();
  },

  // --- フェーズの自動遷移 ---
  //
  //   企画準備 ──（最後の開催日を過ぎた）──▶ 振り返り
  //   振り返り ──（引き継ぎ日の最終日を過ぎた）──▶ 完了
  //
  // ★手で設定したフェーズを勝手に巻き戻さない。進める方向にしか動かさない。
  //   「完了」にしたイベントを開いても振り返りへ戻らないし、開催前に手で
  //   「振り返り」にした人の設定も尊重する。
  // ★render() 駆動のみ（他の自動処理と同じ方針）。バックグラウンドタイマー禁止。
  // ★保存は canManage が要るので管理者のときだけ走らせる。一般メンバーの画面では
  //   PUT /api/data が黙ってスキップされ、毎回 save を投げ続けることになる。
  // ★1セッション1回のゲートは置かない。日付は日をまたいで変わるので、
  //   長時間開きっぱなしのタブでも次の render で拾えるようにしておく
  //   （実際に書き込むのは状態が変わる瞬間だけなので、無駄な保存は起きない）。
  /**
   * このイベントで提案を生成してよいか。
   * ★「止める条件」を書くこと。判定を増やすときもここ1箇所に足す。
   */
  _proposalsAllowed(p) {
    if (p.isCompleted) return false;
    const phase = p.eventPhase || '企画準備';
    if (phase === '完了' || phase === '振り返り') return false;
    // フェーズが手で「企画準備」のままでも、開催日を過ぎていれば止める
    const dates = Array.isArray(p.dates) ? [...p.dates].filter(Boolean).sort() : [];
    const lastDate = dates.at(-1);
    if (lastDate && todayStr() > lastDate) return false;
    return true;
  },

  _checkEventPhase() {
    if (!this.selectedEventId) return;
    if (!this.canManageCurrentEvent()) return;
    const p = this.events.find(x => x.id === this.selectedEventId);
    if (!p) return;

    const cur = p.eventPhase || '企画準備';
    if (cur === '完了') return;

    const today = todayStr();
    const lastOf = (arr) => (Array.isArray(arr) && arr.length > 0)
      ? [...arr].filter(Boolean).sort().at(-1) : null;

    // 振り返り → 完了：引き継ぎ日の「最終日の翌日」から完了扱い
    if (cur === '振り返り') {
      const lastHandover = lastOf(p.handoverDates);
      if (lastHandover && today > lastHandover) {
        p.eventPhase  = '完了';
        p.isCompleted = true;
        this.save();
      }
      return;
    }

    // 企画準備 → 振り返り：最後の開催日を過ぎたら
    const lastDate = lastOf(p.dates);
    if (lastDate && today > lastDate) {
      p.eventPhase = '振り返り';
      this.save();
    }
  },

  // --- 提案の更新サイクル判定 ---
  // スロット構成（最大3件）：
  // - ★固定枠は廃止済み。3枠すべてが動的枠（Cloudflare Workers AI 生成）で、
  //   イベント内容・進捗・フェーズに合わせて12時間ごとに更新される。
  //   かつては p1「開催場所を決める」/ p2「メインビジュアルを作成する」を固定していたが、
  //   3枠のうち2枠を恒久的に占有し、序盤は生成・選出の余地が実質1枠しか無かったため廃止した。
  //   会場・メインビジュアルはアーカイブから直接編集できる（modals/helpers.js の
  //   editArchiveItem('venue') / ('image')）ので、ミッション経由で回収する必要はない。
  // - 基準時刻：直近生成 lastProposalGeneratedAt から12時間。未生成なら即時生成
  //   （作成直後にイベント適合の提案を出すため。createdAt は基準に使わない）。
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
    // ★開催が終わったイベントと完了したイベントでは提案しない。
    //   やることを増やす提案は、片付ける段階に入ったチームには邪魔でしかなく、
    //   Cloudflare Workers AI のクレジットも無駄に消費する。
    // ★状態を持たずに毎回判定する。開催日を後ろへ動かしたり、フェーズを
    //   「企画準備」に戻したりすれば、次の render で自然に再開する（指示どおり）。
    if (!this._proposalsAllowed(p)) return;
    const TWELVE_H = 12 * 60 * 60 * 1000;
    const last = p.lastProposalGeneratedAt;
    const due  = !last || (Date.now() - last >= TWELVE_H);
    if (due) this._refreshProposals(p);
  },

  // --- 提案リフレッシュ（サーバーの AI 生成エンドポイントを呼ぶ） ---
  // ★固定枠は無い。3枠すべてを新しい提案で入れ替える（＝12時間ごとに全枠更新される）。
  // 結果は saveNow() で永続化（保存しないと再読込で消え、サイクルが再発火する）。
  async _refreshProposals(p) {
    if (this._proposalFetching) return;
    this._proposalFetching = true;
    const FULL = 3;
    // ★レース対策：除外集合は「必ず await の後」に最新の p.missions から計算する。
    //   生成を待つ間にユーザーが採用（提案削除＋ミッション追加）しても、古いスナップショットで
    //   採用済みの提案を復活させない（＝ミッションと重複しない）。
    //   除外：採用済みid（originProposalId）／既存ミッション名。
    // タイトル比較は正規化して行う（表記ゆれ・空白差で重複がすり抜けるのを防ぐ）
    const normTitle = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/[\s　]/g, '');
    const buildResult = (candidates) => {
      const adoptedIds    = new Set((p.missions || []).map(m => m.originProposalId).filter(Boolean));
      const missionTitles = new Set((p.missions || []).map(m => normTitle(m.title)));
      const seenIds    = new Set();
      const seenTitles = new Set();
      const out = [];
      for (const np of candidates) {
        if (out.length >= FULL) break;
        if (!np) continue;
        if (seenIds.has(np.id) || adoptedIds.has(np.id)) continue;
        if (seenTitles.has(normTitle(np.title)) || missionTitles.has(normTitle(np.title))) continue;
        out.push(np);
        seenIds.add(np.id); seenTitles.add(normTitle(np.title));
      }
      return out;
    };
    try {
      const r = await api.generateProposals(p.id);
      if (r.ok && Array.isArray(r.proposals)) {
        // 既存の提案は破棄して3枠すべて入れ替える（12時間ごと更新）
        p.proposals = buildResult(r.proposals);
        // ★届いた瞬間だけ「完成」の演出を出す（バッジの出現・目線が定位置へ戻る）
        this.proposalsRevealed = true;
        p.lastProposalGeneratedAt = r.lastProposalGeneratedAt;
        p.lastProposalClearedTime = null;
        // AI 生成結果は失うと再生成でクレジットを消費するため即時保存
        this.saveNow();
        this.render();
      }
    } catch (_) {
      // API 失敗時は PROPOSAL_POOL フォールバック（採用済みidは除外して3枠を補充）
      const usedIds = new Set((p.missions || []).map(m => m.originProposalId).filter(Boolean));
      const available = PROPOSAL_POOL.filter(pr => !usedIds.has(pr.id));
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
