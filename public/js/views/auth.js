// ===== 認証画面（アカウント作成 / ログイン） =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';

/**
 * ★入力欄の値を DOM から読み取って draft に同期する（送信直前に必ず呼ぶ）。
 *
 * ブラウザのパスワード自動入力（オートフィル）やパスワードマネージャーは、
 * 値を DOM に流し込むだけで `input` イベントを発火しないことがある（特に Safari）。
 * その場合 `input` リスナーだけに頼っていると draft が空のままになり、
 * 「入力しているのに『メールアドレスとパスワードを入力してください』が出る」
 * 「別アカウントに切り替えられない（前回の値のまま送信される）」という不具合になる。
 * → 送信時は draft ではなく DOM の値を正とし、読んだ値を draft にも書き戻す
 *   （書き戻すことで、バリデーション失敗後の再描画で入力が消えるのも防ぐ）。
 *
 * @param {Record<string, string>} idToKey  { 入力欄のid: draftのキー }
 * @param {object} draft
 */
export function _syncDraftFromDom(idToKey, draft) {
  for (const [id, key] of Object.entries(idToKey)) {
    const el = document.getElementById(id);
    if (el && typeof el.value === 'string') draft[key] = el.value;
  }
  return draft;
}

// ----- アカウント作成画面 -----

/**
 * @param {HTMLElement} container
 */
export function renderCreateAccountInfo(container) {
  // 入力中の値（再描画後も保持）
  const draft = state.authDraft || (state.authDraft = { username: '', email: '', password: '' });
  const errors = state.authErrors || {};

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <main class="flex-1 px-6 pt-16 pb-8 flex flex-col">
        <h1 class="heading-l text-[#484545] font-bold text-center mb-2">アカウントを作成</h1>
        <p class="text-rs text-[#A7AAAC] text-center mb-6 font-bold">イベントを保存・共有するために、まずはアカウントを作成してください</p>

        ${_inviteContextBanner()}

        <div class="space-y-5 mb-8">
          <div>
            <label class="block text-rs text-[#484545] font-bold mb-2">ユーザー名</label>
            <input id="ca-username" type="text" autocomplete="username"
              class="input-field w-full px-4 py-3 focus:outline-none ${errors.username ? 'ring-2 ring-[#EE3E12]' : ''}"
              placeholder="2〜20文字（英数字・日本語・全角OK）"
              value="${_esc(draft.username)}" maxlength="20">
            ${errors.username ? `<p class="text-[12px] text-[#EE3E12] mt-1.5 font-bold">${_esc(errors.username)}</p>` : ''}
          </div>

          <div>
            <label class="block text-rs text-[#484545] font-bold mb-2">メールアドレス</label>
            <input id="ca-email" type="email" autocomplete="email"
              class="input-field w-full px-4 py-3 focus:outline-none ${errors.email ? 'ring-2 ring-[#EE3E12]' : ''}"
              placeholder="example@mail.com"
              value="${_esc(draft.email)}" maxlength="100">
            ${errors.email ? `<p class="text-[12px] text-[#EE3E12] mt-1.5 font-bold">${_esc(errors.email)}</p>` : ''}
          </div>

          <div>
            <label class="block text-rs text-[#484545] font-bold mb-2">パスワード</label>
            <div class="relative">
              <input id="ca-password" type="password" autocomplete="new-password"
                class="input-field w-full px-4 py-3 pr-12 focus:outline-none ${errors.password ? 'ring-2 ring-[#EE3E12]' : ''}"
                placeholder="8文字以上"
                value="${_esc(draft.password)}" maxlength="100">
              <button type="button" id="ca-pw-toggle"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#A7AAAC] font-bold px-2 py-1">表示</button>
            </div>
            ${errors.password ? `<p class="text-[12px] text-[#EE3E12] mt-1.5 font-bold">${_esc(errors.password)}</p>` : ''}
          </div>
        </div>

        ${errors._global ? `<p class="text-[13px] text-[#EE3E12] text-center font-bold mb-4">${_esc(errors._global)}</p>` : ''}

        <button id="ca-submit" class="btn-primary w-full py-3.5 heading-rs font-bold mb-4">アカウントを作成</button>

        <!-- Google で続行 -->
        <div id="ca-google-section" class="hidden mb-4">
          <div class="flex items-center gap-2 my-3">
            <div class="flex-1 h-px bg-[#E1DFDC]"></div>
            <span class="text-[11px] text-[#A7AAAC] font-bold">または</span>
            <div class="flex-1 h-px bg-[#E1DFDC]"></div>
          </div>
          <div id="ca-google-btn" class="flex justify-center"></div>
        </div>

        <p class="text-center text-rs text-[#484545] font-bold">
          アカウントをお持ちですか？
          <button id="ca-go-login" class="text-[#0CA1E3] font-bold ml-1">ログイン</button>
        </p>
      </main>
    </div>`;

  // ----- 入力同期 -----
  // input だけでなく change も拾う（自動入力はフォーカスアウト時に change を出すことがある）
  for (const [id, key] of Object.entries({ 'ca-username': 'username', 'ca-email': 'email', 'ca-password': 'password' })) {
    const el = document.getElementById(id);
    for (const ev of ['input', 'change']) el?.addEventListener(ev, e => draft[key] = e.target.value);
  }

  // パスワード表示切替
  const pwInput = document.getElementById('ca-password');
  const pwToggle = document.getElementById('ca-pw-toggle');
  pwToggle.onclick = () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    pwToggle.textContent = show ? '隠す' : '表示';
  };

  // 送信
  document.getElementById('ca-submit').onclick = async () => {
    state.authErrors = {};
    // 自動入力で input イベントが飛ばない場合に備え、DOM の値を正として取り込む
    _syncDraftFromDom({
      'ca-username': 'username', 'ca-email': 'email', 'ca-password': 'password',
    }, draft);

    const errs = {};
    if (!draft.username.trim()) errs.username = 'ユーザー名を入力してください';
    if (!draft.email.trim())    errs.email    = 'メールアドレスを入力してください';
    if (!draft.password)        errs.password = 'パスワードを入力してください';

    if (Object.keys(errs).length) {
      state.authErrors = errs;
      state.render();
      return;
    }

    _setSubmitting('ca-submit', true, '作成中…');
    try {
      const r = await api.register({
        username: draft.username.trim(),
        email:    draft.email.trim(),
        password: draft.password,
      });
      console.log('[register] レスポンス:', r);
      if (r.ok) {
        logEvent('signup_completed');
        state.authDraft  = { username: '', email: '', password: '' };
        state.authErrors = {};
        state.currentUser = r.user;
        state.pendingVerifyDevCode = null;
        state.pendingMailError     = null;

        // HOME へ遷移 → メール認証モーダルを自動表示
        await state.loadAfterAuth();
        setTimeout(() => window._app.openVerifyModal?.(), 50);
      } else {
        state.authErrors = r.errors || { _global: r.error || '作成に失敗しました' };
        state.render();
      }
    } catch (e) {
      console.error('[register] 例外:', e);
      state.authErrors = { _global: 'ネットワークエラーが発生しました' };
      state.render();
    } finally {
      _setSubmitting('ca-submit', false, 'アカウントを作成');
    }
  };

  document.getElementById('ca-go-login').onclick = () => {
    state.authErrors = {};
    state.setView('LOGIN');
  };

  _setupGoogleSignIn('create');
}

// ----- ログイン画面 -----

/**
 * @param {HTMLElement} container
 */
export function renderLogin(container) {
  const draft  = state.loginDraft || (state.loginDraft = { identifier: '', password: '' });
  const errors = state.authErrors || {};

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <main class="flex-1 px-6 pt-16 pb-8 flex flex-col">
        <h1 class="heading-l text-[#484545] font-bold text-center mb-2">ログイン</h1>
        <p class="text-rs text-[#A7AAAC] text-center mb-6 font-bold">登録済みのアカウント情報でサインインしてください</p>

        ${_inviteContextBanner()}

        <div class="space-y-5 mb-8">
          <div>
            <label class="block text-rs text-[#484545] font-bold mb-2">メールアドレス</label>
            <input id="lg-id" type="email" autocomplete="email"
              class="input-field w-full px-4 py-3 focus:outline-none ${errors._global ? 'ring-2 ring-[#EE3E12]' : ''}"
              placeholder="your@example.com"
              value="${_esc(draft.identifier)}" maxlength="100">
          </div>
          <div>
            <label class="block text-rs text-[#484545] font-bold mb-2">パスワード</label>
            <div class="relative">
              <input id="lg-password" type="password" autocomplete="current-password"
                class="input-field w-full px-4 py-3 pr-12 focus:outline-none ${errors._global ? 'ring-2 ring-[#EE3E12]' : ''}"
                value="${_esc(draft.password)}" maxlength="100">
              <button type="button" id="lg-pw-toggle"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#A7AAAC] font-bold px-2 py-1">表示</button>
            </div>
          </div>
        </div>

        ${errors._global ? `<p class="text-[13px] text-[#EE3E12] text-center font-bold mb-4">${_esc(errors._global)}</p>` : ''}

        <button id="lg-submit" class="btn-primary w-full py-3.5 heading-rs font-bold mb-3">ログイン</button>

        <p class="text-center mb-4">
          <button id="lg-forgot" class="text-[12px] text-[#0CA1E3] font-bold underline">パスワードをお忘れですか？</button>
        </p>

        <!-- Google で続行 -->
        <div id="lg-google-section" class="hidden mb-4">
          <div class="flex items-center gap-2 my-3">
            <div class="flex-1 h-px bg-[#E1DFDC]"></div>
            <span class="text-[11px] text-[#A7AAAC] font-bold">または</span>
            <div class="flex-1 h-px bg-[#E1DFDC]"></div>
          </div>
          <div id="lg-google-btn" class="flex justify-center"></div>
        </div>

        <p class="text-center text-rs text-[#484545] font-bold">
          アカウントをお持ちでないですか？
          <button id="lg-go-create" class="text-[#0CA1E3] font-bold ml-1">アカウント作成</button>
        </p>
      </main>
    </div>`;

  // input だけでなく change も拾う（自動入力はフォーカスアウト時に change を出すことがある）
  for (const [id, key] of Object.entries({ 'lg-id': 'identifier', 'lg-password': 'password' })) {
    const el = document.getElementById(id);
    for (const ev of ['input', 'change']) el?.addEventListener(ev, e => draft[key] = e.target.value);
  }

  const pwInput = document.getElementById('lg-password');
  const pwToggle = document.getElementById('lg-pw-toggle');
  pwToggle.onclick = () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    pwToggle.textContent = show ? '隠す' : '表示';
  };

  document.getElementById('lg-submit').onclick = async () => {
    state.authErrors = {};
    // 自動入力で input イベントが飛ばない場合に備え、DOM の値を正として取り込む
    _syncDraftFromDom({ 'lg-id': 'identifier', 'lg-password': 'password' }, draft);

    const email = draft.identifier.trim();
    if (!email || !draft.password) {
      state.authErrors = { _global: 'メールアドレスとパスワードを入力してください' };
      state.render();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      state.authErrors = { _global: '正しいメールアドレスを入力してください' };
      state.render();
      return;
    }

    _setSubmitting('lg-submit', true, '認証中…');
    try {
      const r = await api.login({
        email,
        password: draft.password,
      });
      console.log('[login] レスポンス:', r);
      if (r.ok) {
        logEvent('login_completed');
        state.loginDraft = { identifier: '', password: '' };
        state.authErrors = {};
        state.currentUser = r.user;

        if (r.pendingEventId) {
          if (r.pendingApproval) {
            state.pendingApprovalMessage = `「${r.pendingEventName || 'イベント'}」への参加申請を送りました。管理者の承認後に参加できます。`;
            await state.loadAfterAuth();
          } else {
            await state._enterInvitedEvent(r.pendingEventId);
          }
          state.render();
          return;
        }

        await state.loadAfterAuth();
      } else {
        state.authErrors = { _global: r.error || 'ログインに失敗しました' };
        state.render();
      }
    } catch (e) {
      state.authErrors = { _global: 'ネットワークエラーが発生しました' };
      state.render();
    } finally {
      _setSubmitting('lg-submit', false, 'ログイン');
    }
  };

  document.getElementById('lg-go-create').onclick = () => {
    state.authErrors = {};
    state.setView('CREATE_ACCOUNT_INFO');
  };

  document.getElementById('lg-forgot').onclick = () => {
    state.authErrors = {};
    state.passwordResetReqScreen = null; // 毎回リセット
    state.setView('PASSWORD_RESET_REQUEST');
  };

  _setupGoogleSignIn('login');
}

// ----- ヘルパ -----

export function _inviteContextBanner() {
  const ctx = state.inviteContextForAuth;
  if (!ctx) return '';
  return `
    <div class="bg-[#E8F6FD] border border-[#0CA1E3] rounded-2xl p-4 mb-6">
      <p class="text-[12px] text-[#484545] font-bold leading-relaxed text-center">
        <span class="text-[#0CA1E3]">${_esc(ctx.ownerName || '')}</span>さんから<br>
        「<span class="text-[#0CA1E3]">${_esc(ctx.eventName || ctx.projectName || '')}</span>」<br>
        への招待を受けています
      </p>
      <p class="text-[10px] text-[#A7AAAC] font-bold text-center mt-2">アカウント作成で参加が完了します</p>
    </div>`;
}

export function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// iOS 判定（iPhone/iPad。iPadOS は MacIntel + タッチで判定）。
// iOS は全ブラウザが WebKit のため、Google サインインで XHR ではなくフォーム POST を使う。
export function _isIOS() {
  const ua = navigator.userAgent || '';
  return /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function _setSubmitting(id, on, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = label;
  btn.style.opacity = on ? '0.6' : '1';
}

// =====================================================
// Google サインイン
// =====================================================
// Google Identity Services (GIS) のボタンをレンダーする。
// GIS スクリプトと Google Client ID が両方必要。
//
// 動作:
//  - サーバーから googleClientId を取得（キャッシュ）
//  - 取得できたら指定 buttonElId にボタンをレンダー
//  - サインイン完了で credential を受け取り、サーバーへ送信
//  - 成功で state を更新し、loadAfterAuth() で適切な画面へ

let _googleConfigCache = null;
async function _getGoogleConfig() {
  if (_googleConfigCache !== null) return _googleConfigCache;
  try {
    const r = await api.getConfig();
    _googleConfigCache = (r?.googleEnabled && r?.googleClientId) ? r : null;
  } catch (_) {
    _googleConfigCache = null;
  }
  return _googleConfigCache;
}

/**
 * Google ボタンを指定セクションにレンダーする
 * @param {'create'|'login'} mode - どちらの画面か
 */
export async function _setupGoogleSignIn(mode, opts = {}) {
  const sectionId = mode === 'create' ? 'ca-google-section' : 'lg-google-section';
  const buttonId  = mode === 'create' ? 'ca-google-btn'     : 'lg-google-btn';
  const sectionEl = document.getElementById(sectionId);
  const buttonEl  = document.getElementById(buttonId);
  if (!sectionEl || !buttonEl) return;

  const config = await _getGoogleConfig();
  if (!config) {
    // 未設定の場合：開発時（localhost）のみ案内を出す
    const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
    if (isLocal) {
      sectionEl.classList.remove('hidden');
      sectionEl.innerHTML = `
        <div class="flex items-center gap-2 my-3">
          <div class="flex-1 h-px bg-[#E1DFDC]"></div>
          <span class="text-[11px] text-[#A7AAAC] font-bold">または</span>
          <div class="flex-1 h-px bg-[#E1DFDC]"></div>
        </div>
        <div class="bg-[#FFF7E6] border border-[#FFC300] rounded-xl px-3 py-2.5 text-[11px] text-[#484545] font-bold leading-relaxed">
          ⚙ Google サインインは未設定です。<br>
          <span class="text-[#A7AAAC]">.env に <span class="font-mono">GOOGLE_CLIENT_ID</span> を設定すると「Googleで続行」ボタンが表示されます。手順は <span class="font-mono">.env.example</span> を参照。</span>
        </div>`;
    }
    return;
  }

  // GIS の読み込みを待つ（accounts.google.com/gsi/client は async defer）
  const ready = await _waitForGoogleAccountsId(5000);
  if (!ready) return;

  // 同じ画面で何度も初期化しないように guard
  try {
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async (resp) => {
        if (!resp?.credential) return;

        // ★メール経由（signup.js の STEP 0）と対になるログ。
        //   これが無いと「Google 経由とメール経由の完走率差」が測れない。
        //   iOS はこの直後にページが再読込されるため、ここで必ず記録しておく。
        if (mode === 'create') logEvent('signup_started', { method: 'google' });

        // iOS(iPhone/iPad) は全ブラウザが WebKit で、ITP により XHR レスポンスの
        // Set-Cookie が保存されない。トップレベルのフォーム POST で送ると Cookie が
        // first-party 文脈で保存されるため、サーバーが Cookie をセットして / にリダイレクトする。
        if (_isIOS()) {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/api/auth/google';
          const addField = (name, value) => {
            const input = document.createElement('input');
            input.type  = 'hidden';
            input.name  = name;
            input.value = value;
            form.appendChild(input);
          };
          addField('credential', resp.credential);
          // STEP 0 で同意した規約の版数も一緒に送る（この経路はリダイレクトで
          // 画面が作り直されるため、あとから記録する術がない）
          if (state.signup?.consentVersion) addField('consentVersion', state.signup.consentVersion);
          document.body.appendChild(form);
          form.submit();
          return;
        }

        try {
          const r = await api.googleSignIn(resp.credential, state.signup?.consentVersion);
          console.log('[google-signin] レスポンス:', r);
          if (r.ok) {
            state.currentUser = r.user;
            state.authDraft  = { username: '', email: '', password: '' };
            state.loginDraft = { identifier: '', password: '' };
            state.authErrors = {};

            if (r.pendingEventId) {
              if (r.pendingApproval) {
                state.pendingApprovalMessage = `「${r.pendingEventName || 'イベント'}」への参加申請を送りました。管理者の承認後に参加できます。`;
                await state.loadAfterAuth();
              } else {
                await state._enterInvitedEvent(r.pendingEventId);
              }
              state.render();
              return;
            }
            await state.loadAfterAuth();
          } else {
            window._app?.showToast(r.error || 'Google サインインに失敗しました', 'error');
          }
        } catch (e) {
          console.error('[google-signin] エラー:', e);
          window._app?.showToast('Google サインインでエラーが発生しました', 'error');
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    // ボタン本体
    google.accounts.id.renderButton(buttonEl, {
      type:    'standard',
      theme:   'outline',
      size:    'large',
      text:    opts.text || 'continue_with',
      shape:   'pill',
      logo_alignment: 'left',
      // GIS が DOM を作るため自由なカスタムボタンにはできない。
      // 指定できるのは幅・形・サイズ程度なので、幅だけ呼び出し側から渡せるようにする
      // （アカウント作成の入口では主導線として広く出す。既定は従来どおり 280）。
      width: opts.width || 280,
      locale: 'ja',
    });

    sectionEl.classList.remove('hidden');
  } catch (e) {
    console.warn('[google-signin] GIS 初期化失敗:', e);
  }
}

function _waitForGoogleAccountsId(timeoutMs) {
  return new Promise(resolve => {
    if (window.google?.accounts?.id) return resolve(true);
    const start = Date.now();
    const iv = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve(false);
      }
    }, 100);
  });
}
