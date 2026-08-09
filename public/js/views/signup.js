// ===== アカウント作成フロー（STEP 0〜3：認証パート） =====
//
// 旧 renderCreateAccountInfo（ユーザー名・メール・パスワードを1画面）の後継。
// 「認証を先、アンケートを後」にするため、認証だけを段階に分けている。
//
//   STEP 0  入口（Google / メールではじめる）＋規約同意
//   STEP 1  メールアドレス                    [Google はスキップ]
//   STEP 2  パスワード → ここで register + コード送信
//   STEP 3  ワンタイムコード（スキップ可）
//
// ★アカウントは STEP 2（register）で確定する。STEP 3 の検証は後追いで、
//   スキップしても未認証ユーザーとしてアプリを使える（既存仕様を維持）。
//   account.js の未認証バナーからいつでも認証できる。
//
//   STEP 4  表示名 / STEP 5 アバター / STEP 6 流入経路 / STEP 7 運営経験 / STEP 8 診断
// プロフィール質問は1問ずつ即時保存し、途中離脱しても users.onboarding から再開できる。
//   STEP 9  お知らせの受け取り方（Web Push の意向）
// COMPLETE カードは Phase E で追加する。

import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { CONSENT_VERSION } from '../constants.js';
import {
  _esc, _setSubmitting, _syncDraftFromDom, _inviteContextBanner, _setupGoogleSignIn,
} from './auth.js';
import { _processImageFile } from './account.js';
import { getPushState, enablePush } from '../push.js';

const RESEND_COOLDOWN_SEC = 60;
const OTP_LENGTH = 6;

// 再送クールダウンのタイマー（画面を離れたら必ず止める）
let _cooldownTimer = null;

function _clearCooldownTimer() {
  if (_cooldownTimer) { clearInterval(_cooldownTimer); _cooldownTimer = null; }
}

/** フロー状態の初期値。state.signup に持たせて再描画をまたいで保持する。 */
function _draft() {
  if (!state.signup) {
    state.signup = {
      step: 0,
      email: '',
      password: '',
      consented: false,
      consentVersion: null,   // 同意後にセット（Google 経路でも送る必要があるため state に置く）
      otp: '',
      otpError: '',
      otpSent: false,
      otpSending: false,
      changingEmail: false,
      newEmail: '',
      newEmailError: '',
      devCode: null,
      mailError: null,
      resendLeftSec: 0,
      errors: {},
    };
  }
  return state.signup;
}

/** 進捗の点（Phase E で StepIndicator に統合予定。ここでは認証パートの4段だけ示す） */
function _dots(step) {
  return `
    <div class="flex items-center justify-center gap-2 mb-6">
      ${[0, 1, 2, 3].map(s => `
        <div class="h-1.5 rounded-full transition-all duration-300 ${
          s === step ? 'w-6 bg-[#0CA1E3]' : s < step ? 'w-1.5 bg-[#0CA1E3]' : 'w-1.5 bg-[#D3D6D8]'
        }"></div>`).join('')}
    </div>`;
}

function _shell(inner, { back = null } = {}) {
  return `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <main class="flex-1 px-6 pt-10 pb-8 flex flex-col">
        ${back ? `
          <button id="su-back" class="self-start p-2 -ml-2 mb-1" aria-label="戻る">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#484545" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>` : '<div class="h-9"></div>'}
        ${inner}
      </main>
    </div>`;
}

/**
 * その画面が個別に表示しないエラーを、まとめて必ず出す。
 *
 * ★これが無いと「サーバーはエラーを返しているのに画面には何も出ない」状態になり、
 *   ボタンを押しても無反応にしか見えない。実際にそれで詰まった
 *   （新クライアントが username を送らない一方、古いサーバーが username 必須で
 *   `errors.username` を返し、画面がそのキーを描画していなかった）。
 *   知らないキーが増えても取りこぼさないよう、除外指定した以外は全部出す。
 *
 * @param {object} errors
 * @param {string[]} handled  その画面が個別に描画済みのキー
 */
function _otherErrorsHtml(errors, handled = []) {
  const skip = new Set([...handled, '_toLogin']);
  const msgs = Object.entries(errors || {})
    .filter(([k, v]) => !skip.has(k) && typeof v === 'string' && v.trim())
    .map(([, v]) => v);
  if (msgs.length === 0) return '';
  return msgs.map(m =>
    `<p class="text-[12px] text-[#EE3E12] font-bold mb-2 leading-relaxed">${_esc(m)}</p>`).join('');
}

// =====================================================
// エントリポイント
// =====================================================

export function renderSignup(container) {
  const d = _draft();
  _clearCooldownTimer();

  if (d.step === 1)      _renderEmail(container, d);
  else if (d.step === 2) _renderPassword(container, d);
  else if (d.step === 3) _renderOtp(container, d);
  else if (d.step === 4) _renderName(container, d);
  else if (d.step === 5) _renderAvatar(container, d);
  else if (d.step === 6) _renderChannel(container, d);
  else if (d.step === 7) _renderExperience(container, d);
  else if (d.step === 8) _renderQuiz(container, d);
  else if (d.step === 9) _renderNotify(container, d);
  else                   _renderEntry(container, d);
}

/**
 * 中断したオンボーディングを再開する（アプリ起動時に state.init から呼ばれる）。
 *
 * ★iOS の Google サインインはフォーム POST → リダイレクトで、JS の状態が丸ごと消える。
 *   そのため進行状態はサーバー（users.onboarding）に持ち、ここで復元する。
 * ★onboarding が無いユーザー（新フロー以前からの既存ユーザー）は完了扱いにして
 *   引き戻さない（userPublic が null を返す）。
 * @returns {boolean} オンボーディング画面へ入ったか
 */
export function resumeOnboardingIfNeeded() {
  const ob = state.currentUser?.onboarding;
  if (!ob || ob.completedAt || ob.currentStep === 'complete') return false;
  const step = _stepNumFromName(ob.currentStep);
  if (!step || step < 4) return false;   // 認証パートの途中は復元しない（作り直しになるため）

  state.signup = null;                    // 前の下書きは捨てる
  state.currentView = 'CREATE_ACCOUNT_INFO';
  _enterProfilePhase();
  return true;
}

function _goto(step) {
  const d = _draft();
  d.step = step;
  d.errors = {};
  logEvent('signup_step_viewed', { step: `step${step}` });
  state.render();
  window.scrollTo(0, 0);
}

// =====================================================
// STEP 0：入口
// =====================================================

function _renderEntry(container, d) {
  container.innerHTML = _shell(`
    <h1 class="heading-l text-[#484545] font-bold text-center mb-2">イベクリをはじめる</h1>
    <p class="text-rs text-[#A7AAAC] text-center mb-6 font-bold">アカウントを作成して、イベントづくりを始めましょう</p>

    ${_inviteContextBanner()}

    <!-- Google を最上部・主導線に。GIS の renderButton は見た目の自由度が低いため、
         幅を広げ、周囲の余白で主導線に見せる -->
    <div id="ca-google-section" class="hidden mb-4">
      <div id="su-google-wrap" class="relative">
        <div id="ca-google-btn" class="flex justify-center"></div>
        <!-- 同意前はクリックを受け止めて案内する（GIS のボタン自体は disabled にできない） -->
        <div id="su-google-guard" class="absolute inset-0 ${d.consented ? 'hidden' : ''}" style="cursor:not-allowed"></div>
      </div>
    </div>

    <button id="su-email-start"
      class="w-full py-3 text-rs text-[#0CA1E3] font-bold underline mb-8">
      メールアドレスではじめる
    </button>

    <!-- 規約同意 -->
    <label class="flex items-start gap-3 mb-3 cursor-pointer">
      <input type="checkbox" id="su-consent" class="mt-0.5 w-5 h-5 accent-[#0CA1E3] flex-shrink-0" ${d.consented ? 'checked' : ''}>
      <span class="text-[12px] text-[#484545] font-bold leading-relaxed">
        <button type="button" id="su-terms" class="text-[#0CA1E3] underline">利用規約</button>と<button type="button" id="su-privacy" class="text-[#0CA1E3] underline">プライバシーポリシー</button>に同意します
      </span>
    </label>
    <p class="text-[11px] text-[#A7AAAC] font-bold leading-relaxed mb-6 pl-8">
      入力内容は、イベント運営の改善とマッチングに使います。
    </p>

    ${d.errors._consent ? `<p class="text-[12px] text-[#EE3E12] text-center font-bold mb-4">${_esc(d.errors._consent)}</p>` : ''}

    <p class="text-center text-rs text-[#484545] font-bold mt-auto pt-6">
      アカウントをお持ちですか？
      <button id="su-go-login" class="text-[#0CA1E3] font-bold ml-1">ログイン</button>
    </p>
  `);

  const consentEl = document.getElementById('su-consent');
  consentEl.addEventListener('change', (e) => {
    d.consented = e.target.checked;
    d.consentVersion = e.target.checked ? CONSENT_VERSION : null;
    d.errors = {};
    // Google ボタンのガードだけ更新する（再描画すると GIS を作り直すことになるため）
    document.getElementById('su-google-guard')?.classList.toggle('hidden', d.consented);
  });

  document.getElementById('su-google-guard')?.addEventListener('click', () => {
    window._app?.showToast('利用規約とプライバシーポリシーへの同意が必要です', 'error');
  });

  document.getElementById('su-email-start').onclick = () => {
    if (!d.consented) {
      d.errors._consent = '利用規約とプライバシーポリシーに同意してください';
      state.render();
      return;
    }
    logEvent('signup_started', { method: 'email' });
    _goto(1);
  };

  document.getElementById('su-terms').onclick   = () => state.openLegal('terms');
  document.getElementById('su-privacy').onclick = () => state.openLegal('privacy');
  document.getElementById('su-go-login').onclick = () => {
    state.authErrors = {};
    state.setView('LOGIN');
  };

  // 既存の Google 配線をそのまま流用する（iOS のフォーム POST 分岐を含む）。
  // 幅だけ広げて主導線に見せる。
  _setupGoogleSignIn('create', { width: 320, text: 'signup_with' });
}

// =====================================================
// STEP 1：メールアドレス
// =====================================================

function _renderEmail(container, d) {
  container.innerHTML = _shell(`
    ${_dots(1)}
    <h1 class="heading-l text-[#484545] font-bold mb-2">メールアドレスを<br>教えてください</h1>
    <p class="text-rs text-[#A7AAAC] mb-6 font-bold">学校のメールでも個人のメールでもOK</p>

    <input id="su-email" type="email" autocomplete="email" inputmode="email"
      class="input-field w-full px-4 py-3.5 focus:outline-none mb-2 ${d.errors.email ? 'ring-2 ring-[#EE3E12]' : ''}"
      placeholder="example@mail.com" value="${_esc(d.email)}" maxlength="100">
    ${d.errors.email ? `<p class="text-[12px] text-[#EE3E12] mb-2 font-bold">${d.errors.email}</p>` : ''}

    <button id="su-email-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-6">次へ</button>
  `, { back: true });

  const input = document.getElementById('su-email');
  for (const ev of ['input', 'change']) input.addEventListener(ev, e => d.email = e.target.value);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('su-email-next').click(); });
  setTimeout(() => input.focus(), 50);

  document.getElementById('su-back').onclick = () => _goto(0);
  document.getElementById('su-email-next').onclick = () => {
    // 自動入力で input イベントが飛ばない場合に備え、DOM の値を正として取り込む
    _syncDraftFromDom({ 'su-email': 'email' }, d);
    const email = d.email.trim();
    if (!email) { d.errors = { email: 'メールアドレスを入力してください' }; state.render(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      d.errors = { email: '正しいメールアドレスを入力してください' }; state.render(); return;
    }
    logEvent('signup_step_completed', { step: 'step1' });
    _goto(2);
  };
}

// =====================================================
// STEP 2：パスワード（ここで register とコード送信）
// =====================================================

// パスワード要件：8文字以上、かつ 英大文字/英小文字/数字/記号 のうち3種類以上。
// ★server.js の validatePassword と同じ条件にすること（片方だけ変えると
//   画面は通るのにサーバーで弾かれる、という噛み合わない状態になる）。
const PW_MIN_LEN   = 8;
const PW_MIN_KINDS = 3;

/**
 * パスワードの充足状況を返す。
 * @returns {{lenOk:boolean, kinds:number, kindsOk:boolean, ok:boolean, score:number}}
 */
function _pwCheck(pw) {
  const s = String(pw || '');
  const lenOk = s.length >= PW_MIN_LEN;
  const kinds = [/[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(s)).length;
  const kindsOk = kinds >= PW_MIN_KINDS;
  const ok = lenOk && kindsOk;
  // メーターは「満たしていない=0 / 満たした=1 / 余裕あり=2,3」
  const score = !ok ? 0 : (s.length >= 12 && kinds === 4) ? 3 : (s.length >= 12 || kinds === 4) ? 2 : 1;
  return { lenOk, kinds, kindsOk, ok, score };
}

/** サーバーと同じ文言でエラーを返す（満たしていれば null） */
function _pwError(pw) {
  const c = _pwCheck(pw);
  if (!pw) return 'パスワードを入力してください';
  if (!c.lenOk)   return `パスワードは${PW_MIN_LEN}文字以上にしてください`;
  if (!c.kindsOk) return `英大文字・英小文字・数字・記号のうち${PW_MIN_KINDS}種類以上を含めてください`;
  return null;
}

function _renderPassword(container, d) {
  const c  = _pwCheck(d.password);
  const sc = c.score;
  const label = ['要件を満たしていません', '使えます', 'よい強度です', '強力なパスワードです'][sc];
  const color = ['#D3D6D8', '#FFC300', '#9EDF05', '#9EDF05'][sc];
  const mark = (okFlag) => okFlag
    ? '<span class="text-[#9EDF05]">●</span>'
    : '<span class="text-[#D3D6D8]">○</span>';

  container.innerHTML = _shell(`
    ${_dots(2)}
    <h1 class="heading-l text-[#484545] font-bold mb-2">パスワードを<br>設定してください</h1>
    <p class="text-rs text-[#A7AAAC] mb-6 font-bold">安全のため、次の条件を満たしてください</p>

    <div class="relative mb-2">
      <input id="su-password" type="password" autocomplete="new-password"
        class="input-field w-full px-4 py-3.5 pr-14 focus:outline-none ${d.errors.password ? 'ring-2 ring-[#EE3E12]' : ''}"
        placeholder="${PW_MIN_LEN}文字以上" value="${_esc(d.password)}" maxlength="100">
      <button type="button" id="su-pw-toggle"
        class="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#A7AAAC] font-bold px-2 py-1">表示</button>
    </div>

    <!-- 強度メーター -->
    <div id="su-pw-bars" class="flex gap-1.5 mb-2">
      ${[1, 2, 3].map(i => `<div class="h-1 flex-1 rounded-full" style="background:${sc >= i ? color : '#E1DFDC'}"></div>`).join('')}
    </div>
    <p id="su-pw-label" class="text-[11px] font-bold mb-3" style="color:${sc === 0 ? '#A7AAAC' : color}">${label}</p>

    <!-- 要件チェックリスト（何が足りないかを打ちながら分かるように） -->
    <ul class="mb-3 space-y-1">
      <li id="su-pw-req-len" class="text-[12px] font-bold ${c.lenOk ? 'text-[#484545]' : 'text-[#A7AAAC]'}">
        ${mark(c.lenOk)} ${PW_MIN_LEN}文字以上
      </li>
      <li id="su-pw-req-kinds" class="text-[12px] font-bold ${c.kindsOk ? 'text-[#484545]' : 'text-[#A7AAAC]'}">
        ${mark(c.kindsOk)} 英大文字・英小文字・数字・記号のうち${PW_MIN_KINDS}種類以上
        <span class="text-[11px] text-[#A7AAAC]">（現在 ${c.kinds} 種類）</span>
      </li>
    </ul>

    ${d.errors.password ? `<p class="text-[12px] text-[#EE3E12] mb-2 font-bold">${_esc(d.errors.password)}</p>` : ''}
    ${_otherErrorsHtml(d.errors, ['password'])}
    ${d.errors._toLogin ? `
      <button id="su-to-login" class="w-full py-2 text-[12px] text-[#0CA1E3] font-bold underline mb-2">ログイン画面へ</button>` : ''}

    <button id="su-pw-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-4">アカウントを作成</button>

    <!-- ここでコードを先に送っておくので、STEP 3 に着く頃には届いている -->
    <p class="text-[11px] text-[#A7AAAC] font-bold text-center mt-4 leading-relaxed">
      作成すると <span class="text-[#484545]">${_esc(d.email)}</span> に<br>確認コードを送信します
    </p>
  `, { back: true });

  const pw = document.getElementById('su-password');
  for (const ev of ['input', 'change']) pw.addEventListener(ev, (e) => {
    d.password = e.target.value;
    // 強度メーターだけを更新（全体を再描画するとフォーカスが飛ぶ）
    _updateStrength(d);
  });
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('su-pw-next').click(); });
  setTimeout(() => pw.focus(), 50);

  document.getElementById('su-pw-toggle').onclick = () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    document.getElementById('su-pw-toggle').textContent = show ? '隠す' : '表示';
  };

  document.getElementById('su-back').onclick = () => _goto(1);
  document.getElementById('su-to-login')?.addEventListener('click', () => {
    state.loginDraft = { identifier: d.email, password: '' };
    state.authErrors = {};
    state.setView('LOGIN');
  });
  document.getElementById('su-pw-next').onclick = () => _submitRegister(d);
}

function _updateStrength(d) {
  const c     = _pwCheck(d.password);
  const sc    = c.score;
  const color = ['#D3D6D8', '#FFC300', '#9EDF05', '#9EDF05'][sc];
  const label = ['要件を満たしていません', '使えます', 'よい強度です', '強力なパスワードです'][sc];
  document.querySelectorAll('#su-pw-bars > div').forEach((el, i) => {
    el.style.background = sc >= i + 1 ? color : '#E1DFDC';
  });
  const p = document.getElementById('su-pw-label');
  if (p) { p.textContent = label; p.style.color = sc === 0 ? '#A7AAAC' : color; }

  const paint = (el, okFlag, text) => {
    if (!el) return;
    el.className = `text-[12px] font-bold ${okFlag ? 'text-[#484545]' : 'text-[#A7AAAC]'}`;
    el.innerHTML = `<span class="${okFlag ? 'text-[#9EDF05]' : 'text-[#D3D6D8]'}">${okFlag ? '\u25cf' : '\u25cb'}</span> ${text}`;
  };
  paint(document.getElementById('su-pw-req-len'), c.lenOk, `${PW_MIN_LEN}文字以上`);
  paint(document.getElementById('su-pw-req-kinds'), c.kindsOk,
    `英大文字・英小文字・数字・記号のうち${PW_MIN_KINDS}種類以上`
    + ` <span class="text-[11px] text-[#A7AAAC]">（現在 ${c.kinds} 種類）</span>`);
}

async function _submitRegister(d) {
  _syncDraftFromDom({ 'su-password': 'password' }, d);
  d.errors = {};
  const pwErr = _pwError(d.password);
  if (pwErr) { d.errors.password = pwErr; state.render(); return; }

  _setSubmitting('su-pw-next', true, '作成中…');
  try {
    // username は送らない（表示名は STEP 4 で聞く。サーバーが仮の名前を入れる）
    const r = await api.register({
      email:          d.email.trim(),
      password:       d.password,
      consentVersion: d.consentVersion || CONSENT_VERSION,
    });
    if (!r.ok) {
      d.errors = r.errors || { _global: r.error || '作成に失敗しました' };
      // 既存アカウントならログイン導線を出す
      if (r.code === 'email_taken' || r.code === 'google_account') {
        d.errors._global = r.errors?.email || d.errors._global;
        d.errors.email = null;
        d.errors._toLogin = true;
      }
      state.render();
      return;
    }

    logEvent('signup_completed');   // ★既存の集計と互換のため register 直後のまま
    state.currentUser = r.user;
    state.pendingVerifyDevCode = null;
    state.pendingMailError     = null;

    // ★先に STEP 3 へ進めてから、コード送信は背後で走らせる。
    //   メール送信は外部 API への往復があり、待ってから遷移すると
    //   「ボタンを押したのに数秒なにも起きない」ように見える。
    d.otpSending = true;
    _goto(3);
    _sendCode(d, { initial: true }).finally(() => {
      d.otpSending = false;
      // まだ STEP 3 にいるときだけ再描画する（先に進んでいたら触らない）
      if (state.signup?.step === 3) state.render();
    });
  } catch (e) {
    console.error('[signup] register 例外:', e);
    d.errors = { _global: 'ネットワークエラーが発生しました' };
    state.render();
  } finally {
    _setSubmitting('su-pw-next', false, 'アカウントを作成');
  }
}

// =====================================================
// STEP 3：ワンタイムコード
// =====================================================

async function _sendCode(d, { initial = false } = {}) {
  try {
    const r = await api.resendVerification();
    if (r.ok) {
      d.otpSent    = true;
      d.devCode    = r.devCode || null;
      d.mailError  = r.mailError || null;
      d.otpError   = '';
      d.resendLeftSec = r.cooldownSec || RESEND_COOLDOWN_SEC;
      logEvent('otp_sent', { initial });
    } else if (r.code === 'cooldown') {
      d.resendLeftSec = r.retryAfterSec || RESEND_COOLDOWN_SEC;
    } else {
      d.otpError = r.error || 'コードを送信できませんでした';
    }
  } catch (_) {
    d.otpError = 'コードを送信できませんでした';
  }
}

function _renderOtp(container, d) {
  const chars = String(d.otp || '').padEnd(OTP_LENGTH, ' ').split('').slice(0, OTP_LENGTH);
  const focusIdx = Math.min(d.otp.length, OTP_LENGTH - 1);

  container.innerHTML = _shell(`
    ${_dots(3)}
    <h1 class="heading-l text-[#484545] font-bold mb-2">確認コードを<br>入力してください</h1>
    <p class="text-rs text-[#A7AAAC] mb-1 font-bold">
      <span class="text-[#0CA1E3]">${_esc(state.currentUser?.email || d.email)}</span> 宛に
    </p>
    <p class="text-rs text-[#A7AAAC] mb-6 font-bold">${d.otpSending ? '6桁のコードを送信しています…' : '6桁のコードを送信しました'}</p>

    <!-- ★入力は「1本の input」のまま、見た目だけ6分割にしている。
         input を透明にしてマスの上に重ねることで、iOS のキーボード上部サジェスト
         （autocomplete="one-time-code"）とペーストが標準どおり動く。
         6個の input に分けるとペーストの分配処理やバックスペースの制御が必要になり、
         かつ自動入力が効かなくなる端末がある。 -->
    <div id="su-otp-boxes" class="relative mb-3">
      <div class="flex gap-2 justify-between pointer-events-none">
        ${chars.map((c, i) => `
          <div class="flex-1 aspect-square max-w-[52px] rounded-xl flex items-center justify-center text-[24px] font-bold
                      ${d.otpError ? 'bg-[#EE3E12]/5 ring-2 ring-[#EE3E12]'
                        : i === focusIdx ? 'bg-white ring-2 ring-[#0CA1E3]' : 'bg-[#E1DFDC]'}
                      text-[#484545]">${c.trim() ? _esc(c) : ''}</div>`).join('')}
      </div>
      <input id="su-otp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="${OTP_LENGTH}"
        autocomplete="one-time-code" aria-label="確認コード"
        class="absolute inset-0 w-full h-full opacity-0"
        style="font-size:16px" value="${_esc(d.otp)}">
    </div>

    ${d.mailError ? `<p class="text-[11px] text-[#EE3E12] mb-2 font-bold">⚠ メール送信に失敗：${_esc(d.mailError)}</p>` : ''}
    ${d.devCode ? `<p class="text-[11px] text-[#A7AAAC] mb-2 font-bold">（開発用）コード: ${_esc(d.devCode)}</p>` : ''}
    ${d.otpError ? `<p class="text-[12px] text-[#EE3E12] mb-2 font-bold leading-relaxed">${_esc(d.otpError)}</p>` : ''}

    <button id="su-otp-submit" class="btn-primary w-full py-3.5 heading-rs font-bold mb-3">認証する</button>

    <button id="su-otp-resend" class="w-full py-2 text-[12px] font-bold text-[#0CA1E3] disabled:text-[#A7AAAC] mb-1">
      ${d.resendLeftSec > 0 ? `コードを再送する（${d.resendLeftSec}秒）` : 'コードを再送する'}
    </button>

    <p class="text-[11px] text-[#A7AAAC] font-bold text-center leading-relaxed mb-1">
      メールが見つからないときは、迷惑メールフォルダもご確認ください
    </p>
    ${d.changingEmail ? `
      <!-- ★STEP 1 に戻さない。戻すと別メールで登録し直され、アカウントが二重にできる。
           作成済みアカウントのメールアドレスをその場で差し替える。 -->
      <div class="border border-[#E1DFDC] rounded-2xl p-4 mt-2">
        <p class="text-[12px] text-[#484545] font-bold mb-2">別のメールアドレスに送り直す</p>
        <input id="su-newmail" type="email" autocomplete="email" inputmode="email"
          class="input-field w-full px-4 py-3 focus:outline-none mb-2"
          placeholder="example@mail.com" value="${_esc(d.newEmail || '')}" maxlength="100">
        ${d.newEmailError ? `<p class="text-[12px] text-[#EE3E12] mb-2 font-bold">${_esc(d.newEmailError)}</p>` : ''}
        <div class="flex gap-2">
          <button id="su-newmail-cancel" class="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-[#484545] bg-white border border-[#E1DFDC]">キャンセル</button>
          <button id="su-newmail-save" class="flex-1 btn-primary py-2.5 text-[13px] font-bold">変更して再送信</button>
        </div>
      </div>` : `
      <button id="su-otp-change-email" class="w-full py-2 text-[12px] text-[#0CA1E3] font-bold underline">
        メールアドレスを変更する
      </button>`}

    <button id="su-otp-later" class="w-full py-3 text-[12px] text-[#A7AAAC] font-bold mt-auto">
      あとで認証する
    </button>
  `);

  const input = document.getElementById('su-otp');
  input.addEventListener('input', (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    e.target.value = v;
    d.otp = v;
    d.otpError = '';
    _paintBoxes(d);
    if (v.length === OTP_LENGTH) _verify(d);
  });
  // マスのどこを押しても入力欄にフォーカスする
  document.getElementById('su-otp-boxes').addEventListener('click', () => input.focus());
  setTimeout(() => input.focus(), 80);

  document.getElementById('su-otp-submit').onclick = () => _verify(d);

  const resendBtn = document.getElementById('su-otp-resend');
  resendBtn.disabled = d.resendLeftSec > 0;
  resendBtn.onclick = async () => {
    if (d.resendLeftSec > 0) return;
    resendBtn.disabled = true;
    await _sendCode(d);
    state.render();
  };

  document.getElementById('su-otp-change-email')?.addEventListener('click', () => {
    d.changingEmail = true;
    d.newEmail = state.currentUser?.email || d.email;
    d.newEmailError = '';
    state.render();
  });
  document.getElementById('su-newmail-cancel')?.addEventListener('click', () => {
    d.changingEmail = false; d.newEmailError = '';
    state.render();
  });
  document.getElementById('su-newmail-save')?.addEventListener('click', () => _changeSignupEmail(d));
  document.getElementById('su-newmail')?.addEventListener('input', e => d.newEmail = e.target.value);

  document.getElementById('su-otp-later').onclick = async () => {
    logEvent('otp_deferred');
    logEvent('signup_step_skipped', { step: 'step3' });
    // 認証をスキップしてもプロフィール作成へは進める（アカウントは確定済み）
    await _enterProfilePhase();
  };

  _startCooldown(d);
}

/**
 * 作成済みアカウントのメールアドレスを差し替えて、コードを送り直す。
 * ★STEP 1 に戻して作り直させないこと（アカウントが二重にできる）。
 */
async function _changeSignupEmail(d) {
  const el = document.getElementById('su-newmail');
  const email = (el?.value || d.newEmail || '').trim();
  d.newEmail = email;
  d.newEmailError = '';

  if (!email) { d.newEmailError = 'メールアドレスを入力してください'; state.render(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    d.newEmailError = '正しいメールアドレスを入力してください'; state.render(); return;
  }

  const btn = document.getElementById('su-newmail-save');
  if (btn) { btn.disabled = true; btn.textContent = '送信中…'; btn.style.opacity = '0.6'; }
  try {
    const r = await api.changeSignupEmail(email);
    if (!r.ok) {
      d.newEmailError = r.errors?.email || r.error || '変更できませんでした';
      state.render();
      return;
    }
    // 差し替え成功 → 新しいコードが新アドレスへ送られている
    state.currentUser = r.user || state.currentUser;
    d.email          = email;
    d.changingEmail  = false;
    d.otp            = '';
    d.otpError       = '';
    d.devCode        = r.devCode || null;
    d.mailError      = r.mailError || null;
    d.resendLeftSec  = r.cooldownSec || RESEND_COOLDOWN_SEC;
    logEvent('signup_email_changed');
    logEvent('otp_sent', { reason: 'email_changed' });
    state.render();
    window._app?.showToast('新しいメールアドレスにコードを送りました', 'info');
  } catch (_) {
    d.newEmailError = 'ネットワークエラーが発生しました';
    state.render();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '変更して再送信'; btn.style.opacity = '1'; }
  }
}

/** マスの表示だけを更新する（再描画するとフォーカスとIME入力が飛ぶため） */
function _paintBoxes(d) {
  const wrap = document.getElementById('su-otp-boxes');
  if (!wrap) return;
  const boxes = wrap.querySelectorAll('.flex > div');
  const focusIdx = Math.min(d.otp.length, OTP_LENGTH - 1);
  boxes.forEach((el, i) => {
    el.textContent = d.otp[i] || '';
    el.className = `flex-1 aspect-square max-w-[52px] rounded-xl flex items-center justify-center text-[24px] font-bold text-[#484545] `
      + (i === focusIdx ? 'bg-white ring-2 ring-[#0CA1E3]' : 'bg-[#E1DFDC]');
  });
}

function _startCooldown(d) {
  _clearCooldownTimer();
  if (d.resendLeftSec <= 0) return;
  _cooldownTimer = setInterval(() => {
    d.resendLeftSec -= 1;
    const btn = document.getElementById('su-otp-resend');
    if (!btn) { _clearCooldownTimer(); return; }   // 画面を離れた
    if (d.resendLeftSec > 0) {
      btn.textContent = `コードを再送する（${d.resendLeftSec}秒）`;
    } else {
      btn.textContent = 'コードを再送する';
      btn.disabled = false;
      _clearCooldownTimer();
    }
  }, 1000);
}

async function _verify(d) {
  const code = (document.getElementById('su-otp')?.value || '').trim();
  if (code.length !== OTP_LENGTH) {
    d.otpError = `${OTP_LENGTH}桁の数字を入力してください`;
    state.render();
    return;
  }
  _setSubmitting('su-otp-submit', true, '確認中…');
  try {
    const r = await api.verifyEmail(code);
    if (r.ok) {
      state.currentUser = r.user || { ...state.currentUser, isVerified: true };
      logEvent('otp_verified');
      logEvent('signup_step_completed', { step: 'step3' });
      // 招待の着地情報は最後まで持ち越す（プロフィール完了後に使う）
      d.pendingLanding = r;
      await _enterProfilePhase();
      return;
    }
    // 期限切れと不一致で文言を出し分ける（サーバーが code を返す）
    logEvent('otp_failed', { reason: r.code || 'unknown' });
    d.otpError =
      r.code === 'expired'  ? 'コードの有効期限が切れました。「コードを再送する」から新しいコードを受け取ってください'
    : r.code === 'locked'   ? '入力回数の上限に達しました。「コードを再送する」から新しいコードを受け取ってください'
    : r.code === 'mismatch' ? `コードが正しくありません${typeof r.triesLeft === 'number' ? `（あと${r.triesLeft}回）` : ''}`
    : (r.error || '認証に失敗しました');
    // ★入力欄は消さない（打ち直しではなく、間違えた桁だけ直せるようにする）
    state.render();
  } catch (_) {
    d.otpError = 'ネットワークエラーが発生しました';
    state.render();
  } finally {
    _setSubmitting('su-otp-submit', false, '認証する');
  }
}

/**
 * 認証パートの完了。Phase C でプロフィール質問（STEP 4〜）へ繋ぐ。
 * 現時点では従来どおり loadAfterAuth() に任せて HOME／招待の着地へ進む。
 */
async function _finish(verifyResp = null) {
  _clearCooldownTimer();
  verifyResp = verifyResp || state.signup?.pendingLanding || null;
  state.signup = null;
  state.authDraft  = { username: '', email: '', password: '' };
  state.authErrors = {};

  if (verifyResp?.needsJoinConfirm && verifyResp?.inviteToken) {
    await state.loadAfterAuth();
    setTimeout(() => window._app?.openJoinEventModal?.(verifyResp.pendingEventName, verifyResp.inviteToken), 300);
    return;
  }
  if (verifyResp?.pendingEventId) {
    if (verifyResp.pendingApproval) {
      state.pendingApprovalMessage =
        `「${verifyResp.pendingEventName || 'イベント'}」への参加申請を送りました。管理者の承認後に参加できます。`;
      await state.loadAfterAuth();
    } else {
      await state._enterInvitedEvent(verifyResp.pendingEventId);
      state.render();
    }
    return;
  }
  await state.loadAfterAuth();
}

// =====================================================
// プロフィール質問（STEP 4〜8）
// =====================================================
//
// ★1ステップ完了ごとに api.saveOnboarding() で即時保存する。
//   まとめて最後に保存すると、途中で離脱したときに全部消える。
//   state.save()（/api/data）は経由させない（デバウンスも権限チェックも無関係なため）。
//
// 経路によって出る画面が変わる：
//   メール経由        … 4,5,6,7,8
//   Google 経由       … 6,7,8      （表示名とアバターは Google から埋まる）
//   Google ＋ 招待    … 7,8        （流入経路は聞かずに 'invite' で自動記録）

const PROFILE_STEPS = [4, 5, 6, 7, 8, 9];

/** この人に実際に出るプロフィール質問のステップ一覧 */
function _visibleProfileSteps(d) {
  const skip = new Set();
  if (d.googleRoute) { skip.add(4); skip.add(5); }
  if (d.inviteRoute) skip.add(6);
  // 通知に対応していないブラウザでは STEP 9 を出さない（分母にも入れない）
  if (getPushState() === 'unsupported') skip.add(9);
  return PROFILE_STEPS.filter(s => !skip.has(s));
}

/** 経路ごとの実ステップ数で進捗を出す（固定で「10問中」とは出さない） */
function _profileDots(d, step) {
  const steps = _visibleProfileSteps(d);
  const idx = steps.indexOf(step);
  return `
    <div class="mb-6">
      <p class="text-[11px] text-[#0CA1E3] font-bold text-center mb-2">
        プロフィール作成（${idx + 1}/${steps.length}）
      </p>
      <div class="flex items-center justify-center gap-2">
        ${steps.map((s, i) => `
          <div class="h-1.5 rounded-full transition-all duration-300 ${
            i === idx ? 'w-6 bg-[#0CA1E3]' : i < idx ? 'w-1.5 bg-[#0CA1E3]' : 'w-1.5 bg-[#D3D6D8]'
          }"></div>`).join('')}
      </div>
    </div>`;
}

/** プロフィールフェーズに入る（認証パート完了後、および再開時の入口） */
async function _enterProfilePhase() {
  const d = _draft();
  const ob = state.currentUser?.onboarding;
  d.googleRoute = ob?.currentStep === 'step6' && !(ob?.completedSteps || []).includes('step4');
  d.inviteRoute = !!(state.pendingInviteToken || state.inviteContextForAuth);

  // ★招待経由なら STEP 6（流入経路）は聞かずに自動記録する。聞かずに済むものは聞かない。
  //   ここで済ませること。_gotoProfile の中でやると _normalizeStep が先に STEP 6 を
  //   飛ばしてしまい、到達せず記録漏れになる（実際にそのバグを出した）。
  if (d.inviteRoute && !(ob?.completedSteps || []).includes('step6')) {
    const eventId = state.inviteContextForAuth?.eventId || '';
    await _saveStep('step6', true, {
      acquisitionChannel: 'invite',
      ...(eventId ? { acquisitionInviteEventId: String(eventId) } : {}),
    });
  }

  const first = _stepNumFromName(ob?.currentStep) ?? 4;
  await _gotoProfile(_normalizeStep(d, first));
}

function _stepNumFromName(name) {
  const m = /^step(\d)$/.exec(String(name || ''));
  return m ? Number(m[1]) : null;
}

/**
 * スキップ対象のステップに来たら、次の表示対象までずらす。
 * @returns {number|null} null なら残りのステップは無い（＝完了）
 *
 * ★step に null を渡さないこと。`s > null` は `s > 0` と評価されるため
 *   先頭のステップが返り、完了したはずが STEP 4 に戻る（実際にそのバグを出した）。
 *   完了させたいときは _finishProfile() を呼ぶ。
 */
function _normalizeStep(d, step) {
  if (typeof step !== 'number') return null;
  const steps = _visibleProfileSteps(d);
  if (steps.includes(step)) return step;
  return steps.find(s => s > step) ?? null;
}

/** プロフィール作成を完了して通常の着地へ進む */
async function _finishProfile() {
  await _saveStep('complete', true);
  await _finish();
}

async function _gotoProfile(step) {
  const d = _draft();
  if (step === null || step === undefined) {
    // 全ステップ終了。COMPLETE カード（プロフィールカード）は Phase E で追加する。
    await _saveStep('complete', true);
    await _finish();
    return;
  }

  d.step = step;
  d.errors = {};
  logEvent('signup_step_viewed', { step: `step${step}` });
  state.render();
  window.scrollTo(0, 0);
}

/** 1問1保存。失敗しても先へ進める（回答は後からプロフィールで補える） */
async function _saveStep(stepName, completed, fields = {}) {
  try {
    const r = await api.saveOnboarding({ step: stepName, completed, ...fields });
    if (r.ok && r.user) state.currentUser = r.user;
    logEvent(completed ? 'signup_step_completed' : 'signup_step_skipped', { step: stepName });
    return r.ok;
  } catch (e) {
    console.warn('[signup] オンボーディング保存に失敗:', e);
    return false;
  }
}

/** 選択肢カード（単一選択） */
function _choice(id, label, selected) {
  return `
    <button data-choice="${_esc(id)}"
      class="w-full text-left px-4 py-4 rounded-2xl border-2 text-[14px] font-bold mb-2.5 transition-colors
             ${selected ? 'border-[#0CA1E3] bg-[#E8F6FD] text-[#0CA1E3]' : 'border-[#E1DFDC] bg-white text-[#484545]'}">
      ${_esc(label)}
    </button>`;
}

function _skipButton(label = 'スキップ') {
  return `<button id="su-skip" class="w-full py-3 text-[12px] text-[#A7AAAC] font-bold mt-auto">${label}</button>`;
}

// ----- STEP 4：表示名 -----

function _renderName(container, d) {
  container.innerHTML = _shell(`
    ${_profileDots(d, 4)}
    <h1 class="heading-l text-[#484545] font-bold mb-2">イベクリへようこそ。<br>まずはあなたのニックネームを教えて</h1>
    <p class="text-rs text-[#A7AAAC] mb-6 font-bold">あとから変更できます</p>

    <label class="block text-rs text-[#484545] font-bold mb-2">みんなに表示される名前</label>
    <input id="su-name" type="text" autocomplete="nickname"
      class="input-field w-full px-4 py-3.5 focus:outline-none mb-1 ${d.errors.name ? 'ring-2 ring-[#EE3E12]' : ''}"
      placeholder="ニックネーム" value="${_esc(d.name || '')}" maxlength="20">
    <p class="text-[11px] text-[#A7AAAC] font-bold mb-1">2〜20文字（英数字・日本語・全角OK）</p>
    ${d.errors.name ? `<p class="text-[12px] text-[#EE3E12] mb-2 font-bold">${_esc(d.errors.name)}</p>` : ''}
    ${_otherErrorsHtml(d.errors, ['name'])}

    <button id="su-name-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-6">次へ</button>
    ${_skipButton('あとで設定する')}
  `);

  const input = document.getElementById('su-name');
  for (const ev of ['input', 'change']) input.addEventListener(ev, e => d.name = e.target.value);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('su-name-next').click(); });
  setTimeout(() => input.focus(), 50);

  document.getElementById('su-name-next').onclick = async () => {
    _syncDraftFromDom({ 'su-name': 'name' }, d);
    const name = (d.name || '').trim();
    if (!name) { d.errors = { name: 'ニックネームを入力してください' }; state.render(); return; }

    _setSubmitting('su-name-next', true, '保存中…');
    const r = await api.changeUsername(name);
    _setSubmitting('su-name-next', false, '次へ');
    if (!r.ok) {
      d.errors = r.errors || { name: r.error || '保存できませんでした' };
      state.render();
      return;
    }
    state.currentUser = r.user || state.currentUser;
    await _saveStep('step4', true);
    await _gotoProfile(_normalizeStep(d, 5));
  };

  document.getElementById('su-skip').onclick = async () => {
    await _saveStep('step4', false);
    await _gotoProfile(_normalizeStep(d, 5));
  };
}

// ----- STEP 5：アバター -----

function _pickThree(all, exclude = []) {
  const pool = all.filter(p => !exclude.includes(p.id));
  const src = pool.length >= 3 ? pool : all;
  const shuffled = [...src].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function _renderAvatar(container, d) {
  const choices = d.avatarChoices || [];
  container.innerHTML = _shell(`
    ${_profileDots(d, 5)}
    <h1 class="heading-l text-[#484545] font-bold mb-2">アイコンを<br>選んでください</h1>
    <p class="text-rs text-[#A7AAAC] mb-6 font-bold">あとから変更できます</p>

    <div class="flex justify-between gap-3 mb-3">
      ${choices.length === 0
        ? '<p class="text-[12px] text-[#A7AAAC] font-bold py-8 w-full text-center">読み込み中…</p>'
        : choices.map(p => `
          <button data-preset="${_esc(p.id)}"
            class="flex-1 aspect-square rounded-2xl border-2 p-2 transition-colors
                   ${d.avatarPreset === p.id ? 'border-[#0CA1E3] bg-[#E8F6FD]' : 'border-[#E1DFDC] bg-white'}">
            <img src="${_esc(p.url)}" alt="" class="w-full h-full object-contain rounded-full">
          </button>`).join('')}
    </div>

    <button id="su-avatar-shuffle" class="w-full py-2 text-[12px] text-[#0CA1E3] font-bold mb-4">
      他の候補を見る
    </button>

    ${d.avatarUploadPreview ? `
      <div class="flex items-center gap-3 mb-3 p-3 rounded-2xl border-2 border-[#0CA1E3] bg-[#E8F6FD]">
        <img src="${_esc(d.avatarUploadPreview)}" class="w-14 h-14 rounded-full object-cover">
        <p class="text-[12px] text-[#0CA1E3] font-bold">この画像を使います</p>
      </div>` : ''}

    <input id="su-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
    <button id="su-avatar-upload" class="w-full py-3 rounded-xl text-[13px] font-bold text-[#484545] bg-white border border-[#E1DFDC] mb-2">
      自分の画像をアップロードする
    </button>

    ${d.errors.avatar ? `<p class="text-[12px] text-[#EE3E12] mb-2 font-bold">${_esc(d.errors.avatar)}</p>` : ''}

    <button id="su-avatar-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-4">次へ</button>
    ${_skipButton('あとで設定する')}
  `);

  // プリセット一覧はサーバーから取る（ホワイトリストの実体はサーバー側）
  if (choices.length === 0 && !d.avatarLoading) {
    d.avatarLoading = true;
    api.listAvatarPresets().then(r => {
      d.avatarLoading = false;
      d.avatarAll = r.presets || [];
      d.avatarChoices = _pickThree(d.avatarAll);
      if (state.signup?.step === 5) state.render();
    }).catch(() => { d.avatarLoading = false; });
  }

  container.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.avatarPreset = btn.dataset.preset;
      d.avatarUploadDataUrl = null;
      d.avatarUploadPreview = null;
      d.errors = {};
      state.render();
    });
  });

  document.getElementById('su-avatar-shuffle').onclick = () => {
    d.avatarChoices = _pickThree(d.avatarAll || [], (d.avatarChoices || []).map(p => p.id));
    state.render();
  };

  const fileInput = document.getElementById('su-avatar-file');
  document.getElementById('su-avatar-upload').onclick = () => fileInput.click();
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // ★画像処理は account.js の実装を流用する（256x256 中央クロップ JPEG）。
      //   新規に書かない。サーバー側の MIME・サイズ検証もそのまま効く。
      const dataUrl = await _processImageFile(file);
      d.avatarUploadDataUrl = dataUrl;
      d.avatarUploadPreview = dataUrl;
      d.avatarPreset = null;
      d.errors = {};
      state.render();
    } catch (err) {
      console.error('[signup] 画像処理に失敗:', err);
      d.errors = { avatar: '画像を読み込めませんでした' };
      state.render();
    }
  });

  document.getElementById('su-avatar-next').onclick = async () => {
    if (!d.avatarPreset && !d.avatarUploadDataUrl) {
      d.errors = { avatar: 'アイコンを選ぶか、画像をアップロードしてください' };
      state.render();
      return;
    }
    _setSubmitting('su-avatar-next', true, '保存中…');
    const r = d.avatarUploadDataUrl
      ? await api.changeAvatar(d.avatarUploadDataUrl)
      : await api.changeAvatarPreset(d.avatarPreset);
    _setSubmitting('su-avatar-next', false, '次へ');
    if (!r.ok) {
      d.errors = { avatar: r.error === 'image_too_large' ? '画像のサイズが大きすぎます'
                         : r.error === 'invalid_image'  ? '対応していない画像形式です'
                         : (r.error || '保存できませんでした') };
      state.render();
      return;
    }
    state.currentUser = r.user || state.currentUser;
    await _saveStep('step5', true);
    await _gotoProfile(_normalizeStep(d, 6));
  };

  document.getElementById('su-skip').onclick = async () => {
    await _saveStep('step5', false);
    await _gotoProfile(_normalizeStep(d, 6));
  };
}

// ----- STEP 6：どこで知ったか -----

const CHANNELS = [
  ['friend', '友達・先輩に誘われた'],
  ['sns',    'X / Instagram などで見た'],
  ['search', '検索して見つけた'],
  ['school', '学校・先生から聞いた'],
  ['other',  'その他'],
];

function _renderChannel(container, d) {
  container.innerHTML = _shell(`
    ${_profileDots(d, 6)}
    <h1 class="heading-l text-[#484545] font-bold mb-6">イベクリを<br>どこで知りましたか？</h1>

    ${CHANNELS.map(([id, label]) => _choice(id, label, d.acquisitionChannel === id)).join('')}

    ${d.acquisitionChannel === 'other' ? `
      <input id="su-channel-other" type="text" maxlength="100"
        class="input-field w-full px-4 py-3 focus:outline-none mt-1 mb-2"
        placeholder="よければ教えてください（任意）" value="${_esc(d.acquisitionChannelOther || '')}">` : ''}

    <button id="su-channel-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-4">次へ</button>
    ${_skipButton()}
  `);

  container.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.acquisitionChannel = btn.dataset.choice;
      state.render();
      if (d.acquisitionChannel === 'other') setTimeout(() => document.getElementById('su-channel-other')?.focus(), 50);
    });
  });
  document.getElementById('su-channel-other')?.addEventListener('input', e => d.acquisitionChannelOther = e.target.value);

  document.getElementById('su-channel-next').onclick = async () => {
    if (!d.acquisitionChannel) { d.errors = { _global: '選択してください' }; state.render(); return; }
    _syncDraftFromDom({ 'su-channel-other': 'acquisitionChannelOther' }, d);
    await _saveStep('step6', true, {
      acquisitionChannel: d.acquisitionChannel,
      ...(d.acquisitionChannel === 'other' && d.acquisitionChannelOther
        ? { acquisitionChannelOther: d.acquisitionChannelOther } : {}),
    });
    await _gotoProfile(_normalizeStep(d, 7));
  };
  document.getElementById('su-skip').onclick = async () => {
    await _saveStep('step6', false);
    await _gotoProfile(_normalizeStep(d, 7));
  };
}

// ----- STEP 7：イベント運営の経験 -----

const EXPERIENCES = [
  ['first', '今回が初めて'],
  ['few',   '何回か手伝ったことがある'],
  ['many',  '何度も仕切ってきた'],
];

function _renderExperience(container, d) {
  container.innerHTML = _shell(`
    ${_profileDots(d, 7)}
    <h1 class="heading-l text-[#484545] font-bold mb-6">イベント運営の<br>経験はありますか？</h1>

    ${EXPERIENCES.map(([id, label]) => _choice(id, label, d.eventExperience === id)).join('')}

    <button id="su-exp-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-4">次へ</button>
    ${_skipButton()}
  `);

  container.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', () => { d.eventExperience = btn.dataset.choice; state.render(); });
  });
  document.getElementById('su-exp-next').onclick = async () => {
    if (!d.eventExperience) { d.errors = { _global: '選択してください' }; state.render(); return; }
    await _saveStep('step7', true, { eventExperience: d.eventExperience });
    await _gotoProfile(_normalizeStep(d, 8));
  };
  document.getElementById('su-skip').onclick = async () => {
    await _saveStep('step7', false);
    await _gotoProfile(_normalizeStep(d, 8));
  };
}

// ----- STEP 8：診断（内部2問）-----
// 1問ずつ出し、二択を大きなカードで並べる（診断コンテンツらしい見せ方）。

const QUIZ = [
  {
    key: 'workStylePlanning',
    title: 'イベント準備、<br>あなたはどっち？',
    options: [
      ['planner', '計画を立てて\nから動きたい', '📋'],
      ['mover',   'とりあえず動いて\nから考える',   '🏃'],
    ],
  },
  {
    key: 'workStyleSocial',
    title: '作業するなら<br>どっち？',
    options: [
      ['group', '大勢で\nワイワイ',  '🎉'],
      ['solo',  '少人数で\n黙々',    '🎧'],
    ],
  },
];

function _renderQuiz(container, d) {
  const qi = d.quizIndex || 0;
  const q  = QUIZ[qi];
  const selected = d[q.key];

  container.innerHTML = _shell(`
    ${_profileDots(d, 8)}
    <p class="text-[12px] text-[#0CA1E3] font-bold mb-2">${qi + 1} / ${QUIZ.length}</p>
    <h1 class="heading-l text-[#484545] font-bold mb-8">${q.title}</h1>

    <div class="flex gap-3 mb-4">
      ${q.options.map(([id, label, emoji]) => `
        <button data-choice="${_esc(id)}"
          class="flex-1 rounded-3xl border-2 px-3 py-8 flex flex-col items-center justify-center gap-3 transition-colors
                 ${selected === id ? 'border-[#0CA1E3] bg-[#E8F6FD]' : 'border-[#E1DFDC] bg-white'}">
          <span class="text-[40px] leading-none">${emoji}</span>
          <span class="text-[14px] font-bold whitespace-pre-line text-center
                       ${selected === id ? 'text-[#0CA1E3]' : 'text-[#484545]'}">${_esc(label)}</span>
        </button>`).join('')}
    </div>

    ${_skipButton()}
  `, { back: qi > 0 });

  container.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', async () => {
      d[q.key] = btn.dataset.choice;
      state.render();
      // タップしたら少し見せてから次へ（診断らしいテンポにする）
      setTimeout(() => _advanceQuiz(d), 250);
    });
  });
  document.getElementById('su-back')?.addEventListener('click', () => { d.quizIndex = qi - 1; state.render(); });
  document.getElementById('su-skip').onclick = () => _advanceQuiz(d, { skipped: true });
}

async function _advanceQuiz(d, { skipped = false } = {}) {
  const qi = d.quizIndex || 0;
  if (qi < QUIZ.length - 1) { d.quizIndex = qi + 1; state.render(); return; }

  // 2問とも終わったらまとめて保存（STEP 8 という1ステップの中の設問のため）
  const answered = !!d.workStylePlanning || !!d.workStyleSocial;
  await _saveStep('step8', answered && !skipped, {
    ...(d.workStylePlanning ? { workStylePlanning: d.workStylePlanning } : {}),
    ...(d.workStyleSocial   ? { workStyleSocial:   d.workStyleSocial }   : {}),
  });
  await _gotoProfile(_normalizeStep(d, 9));
}

// =====================================================
// STEP 9：お知らせの受け取り方
// =====================================================
//
// ★ここでいきなりネイティブの許可ダイアログを出さない設計にしてある。
//   Notification.requestPermission() は一度ブロックされるとプログラムからは
//   二度と出せず、ブラウザ設定からしか戻せない。さらに Chrome は許可率の低い
//   ドメインのダイアログを自動的に静音化する。
//   そのため「オンにする」を押した人にだけ、そのクリックの中で直接呼ぶ。
//
// ★enablePush() は必ずクリックハンドラから同期的に呼ぶこと。
//   前に await を挟むとユーザー操作起点とみなされず、iOS で無反応になる。
//
// 状態は push.js の getPushState() で分岐する：
//   ios-needs-install … ホーム画面追加の案内のみ（許可は求めない）
//   unsupported       … この画面自体を出さない
//   denied            … 設定から戻す案内のみ（ダイアログは呼ばない）
//   granted/available … 「オンにする（推奨）」と「スキップ」の2択

function _renderNotify(container, d) {
  const st = getPushState();

  // 対応していないブラウザには聞くだけ無駄なので、記録だけしてスキップする
  if (st === 'unsupported') {
    _saveStep('step9', false, { notificationPreference: 'unsupported' })
      .then(() => _finishProfile());
    container.innerHTML = _shell(`<p class="text-[13px] text-[#A7AAAC] font-bold text-center py-16">読み込み中…</p>`);
    return;
  }

  if (!d._notifyLogged) {
    d._notifyLogged = true;
    logEvent('push_prompt_shown', { state: st, where: 'signup' });
    if (st === 'ios-needs-install') logEvent('push_ios_guide_shown', { where: 'signup' });
  }

  const body =
    st === 'ios-needs-install' ? `
      <!-- 文面は account.js の通知セクションと揃えてある -->
      <div class="bg-[#EBF7FE] border border-[#0CA1E3]/40 rounded-2xl p-4 mb-4">
        <p class="text-[12px] font-bold text-[#0CA1E3] mb-2">ホーム画面に追加すると使えます</p>
        <ol class="text-[11px] text-[#484545] leading-relaxed list-decimal pl-4 space-y-1">
          <li>画面下の ⋯ の「共有」ボタンをタップ</li>
          <li>「ホーム画面に追加」を選ぶ</li>
          <li>追加されたアイコンからイベクリを開く</li>
        </ol>
        <p class="text-[10px] text-[#A7AAAC] mt-2">iPhone / iPad では Safari の仕様上、この手順が必要です。</p>
      </div>
      <p class="text-[11px] text-[#A7AAAC] font-bold leading-relaxed mb-2">
        あとからアカウント設定でオンにできます。
      </p>
      <button id="su-notify-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-2">次へ</button>`
  : st === 'denied' ? `
      <div class="bg-[#FFF7E6] border border-[#FFC300] rounded-2xl p-4 mb-4">
        <p class="text-[12px] font-bold text-[#484545] mb-1">通知がブロックされています</p>
        <p class="text-[11px] text-[#484545] leading-relaxed">
          ブラウザ（または端末）の設定でこのサイトの通知を「許可」に変更すると受け取れます。
        </p>
      </div>
      <p class="text-[11px] text-[#A7AAAC] font-bold leading-relaxed mb-2">
        あとからアカウント設定でオンにできます。
      </p>
      <button id="su-notify-next" class="btn-primary w-full py-3.5 heading-rs font-bold mt-2">次へ</button>`
  : `
      <button id="su-notify-on" class="btn-primary w-full py-4 heading-rs font-bold mb-3">
        プッシュ通知をオンにする（推奨）
      </button>
      ${d.notifyError ? `<p class="text-[12px] text-[#EE3E12] font-bold mb-2 leading-relaxed">${_esc(d.notifyError)}</p>` : ''}
      <p class="text-[11px] text-[#A7AAAC] font-bold leading-relaxed text-center">
        ミッションの割り当てや締め切りの前にお知らせします。<br>あとから設定で変更できます。
      </p>`;

  container.innerHTML = _shell(`
    ${_profileDots(d, 9)}
    <h1 class="heading-l text-[#484545] font-bold mb-2">お知らせの<br>受け取り方</h1>
    <p class="text-rs text-[#A7AAAC] mb-6 font-bold">大事なことだけお届けします</p>
    ${body}
    ${_skipButton('スキップ')}
  `);

  // ★ここが要点：クリックハンドラの中で直接 enablePush() を呼ぶ。
  //   手前に await を置くとユーザー操作起点でなくなり、iOS で許可ダイアログが出ない。
  document.getElementById('su-notify-on')?.addEventListener('click', () => {
    logEvent('push_enable_tap', { where: 'signup' });
    const btn = document.getElementById('su-notify-on');
    if (btn) { btn.disabled = true; btn.textContent = '設定中…'; btn.style.opacity = '0.6'; }

    enablePush().then(async (r) => {
      if (r.ok) {
        await _saveStep('step9', true, { notificationPreference: 'enabled' });
        await _finishProfile();
        return;
      }
      // 拒否された・失敗した場合も先へは進める（通知は必須ではない）
      d.notifyError = r.error === 'denied'
        ? '通知が許可されませんでした。あとから設定でオンにできます。'
        : '通知を設定できませんでした。あとから設定でオンにできます。';
      await _saveStep('step9', false, { notificationPreference: 'skipped' });
      state.render();
      setTimeout(() => _finishProfile(), 1600);
    });
  });

  // iOS 未インストール / ブロック中は「次へ」で意向だけ記録する（許可は求めない）
  document.getElementById('su-notify-next')?.addEventListener('click', async () => {
    await _saveStep('step9', false, {
      notificationPreference: st === 'ios-needs-install' ? 'ios_pending' : 'skipped',
    });
    await _finishProfile();
  });

  document.getElementById('su-skip').onclick = async () => {
    // ★スキップでは enablePush() を呼ばない。
    //   一度ブロックされるとプログラムからは戻せなくなるため。
    await _saveStep('step9', false, {
      notificationPreference: st === 'ios-needs-install' ? 'ios_pending' : 'skipped',
    });
    await _finishProfile();
  };
}
