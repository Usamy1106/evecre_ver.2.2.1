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
//   COMPLETE  プロフィールカード（回答から作ったタグを載せて見せる）
//
// ★通知とホーム画面追加の案内はオンボーディングに含めない。
//   完了後の HOME で modals/pushSetupModal.js が順に出す
//   （iOS はホーム画面に追加しないと許可自体できず、作成途中に Safari の
//    共有シートへ誘導すると流れが切れるため）。

import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { CONSENT_VERSION } from '../constants.js';
import {
  _esc, _setSubmitting, _syncDraftFromDom, _inviteContextBanner, _setupGoogleSignIn,
} from './auth.js';
import { _processImageFile } from './account.js';
import { Components } from '../components.js';

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

// 認証パート（STEP 1〜3）の進捗。STEP 3 を境にラベルが
// 「アカウント作成」→「プロフィール作成」へ変わり、フェーズの転換を示す。
const AUTH_STEPS = 3;

function _dots(step) {
  return Components.StepIndicator(step, AUTH_STEPS, {
    label: `アカウント作成（${step}/${AUTH_STEPS}）`,
    compact: true,
  });
}

function _shell(inner, { back = null } = {}) {
  return `
    <div class="p-signup u-page-transition">
      <main class="p-signup__main">
        ${back ? `
          <button type="button" id="su-back" class="p-signup__back" aria-label="戻る">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>` : '<div class="p-signup__back-spacer"></div>'}
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
    `<p class="p-signup__error">${_esc(m)}</p>`).join('');
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
  else if (d.step === 'complete') _renderComplete(container, d);
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
    <h1 class="p-signup__title">イベクリをはじめる</h1>
    <p class="p-signup__lead">アカウントを作成して、イベントづくりを始めましょう</p>

    ${_inviteContextBanner()}

    <!-- Google を最上部・主導線に。GIS の renderButton は見た目の自由度が低いため、
         幅を広げ、周囲の余白で主導線に見せる -->
    <div id="ca-google-section" class="u-hidden p-signup__google-section">
      <div id="su-google-wrap" class="p-signup__google-wrap">
        <div id="ca-google-btn" class="p-signup__google"></div>
        <!-- 同意前はクリックを受け止めて案内する（GIS のボタン自体は disabled にできない） -->
        <div id="su-google-guard" class="p-signup__google-guard ${d.consented ? 'u-hidden' : ''}"></div>
      </div>
    </div>

    <button type="button" id="su-email-start"
      class="p-signup__text-button p-signup__text-button--spaced">
      メールアドレスではじめる
    </button>

    <!-- 規約同意 -->
    <label class="p-signup__consent">
      <input type="checkbox" id="su-consent" class="p-signup__consent-box" ${d.consented ? 'checked' : ''}>
      <span class="p-signup__consent-text">
        <button type="button" id="su-terms" class="p-signup__link p-signup__link--underline">利用規約</button>と<button type="button" id="su-privacy" class="p-signup__link p-signup__link--underline">プライバシーポリシー</button>に同意します
      </span>
    </label>
    <p class="p-signup__note p-signup__note--indent">
      入力内容は、イベント運営の改善とマッチングに使います。
    </p>

    ${d.errors._consent ? `<p class="p-signup__error p-signup__error--center">${_esc(d.errors._consent)}</p>` : ''}

    <p class="p-signup__footer">
      アカウントをお持ちですか？
      <button type="button" id="su-go-login" class="p-signup__link p-signup__link--inline">ログイン</button>
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
    <h1 class="p-signup__question">メールアドレスを<br>教えてください</h1>
    <p class="p-signup__question-lead">学校のメールでも個人のメールでもOK</p>

    <input id="su-email" type="email" autocomplete="email" inputmode="email"
      class="c-input p-signup__input${d.errors.email ? ' is-error' : ''}"
      placeholder="example@mail.com" value="${_esc(d.email)}" maxlength="100">
    ${d.errors.email ? `<p class="p-signup__error">${_esc(d.errors.email)}</p>` : ''}

    <button type="button" id="su-email-next" class="c-button c-button--primary p-signup__submit p-signup__next">次へ</button>
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
  // ★満たしたかどうかは記号（●/○）でも示す。色だけに頼らない
  const mark = (okFlag) => `<span class="p-signup__requirement-mark">${okFlag ? '●' : '○'}</span>`;

  container.innerHTML = _shell(`
    ${_dots(2)}
    <h1 class="p-signup__question">パスワードを<br>設定してください</h1>
    <p class="p-signup__question-lead">安全のため、次の条件を満たしてください</p>

    <div class="p-signup__password-wrap">
      <input id="su-password" type="password" autocomplete="new-password"
        class="c-input p-signup__input p-signup__input--with-action${d.errors.password ? ' is-error' : ''}"
        placeholder="${PW_MIN_LEN}文字以上" value="${_esc(d.password)}" maxlength="100">
      <button type="button" id="su-pw-toggle" class="p-signup__password-toggle">表示</button>
    </div>

    <!-- 強度メーター。色は強度で変わるので CSS 変数で渡す -->
    <div id="su-pw-bars" class="p-signup__meter">
      ${[1, 2, 3].map(i => `<div class="p-signup__meter-bar" style="--meter-color:${sc >= i ? color : 'var(--bg-textbox)'}"></div>`).join('')}
    </div>
    <p id="su-pw-label" class="p-signup__meter-label" style="--meter-color:${sc === 0 ? 'var(--color-text-muted)' : color}">${label}</p>

    <!-- 要件チェックリスト（何が足りないかを打ちながら分かるように） -->
    <ul class="p-signup__requirements">
      <li id="su-pw-req-len" class="p-signup__requirement${c.lenOk ? ' is-ok' : ''}">
        ${mark(c.lenOk)} ${PW_MIN_LEN}文字以上
      </li>
      <li id="su-pw-req-kinds" class="p-signup__requirement${c.kindsOk ? ' is-ok' : ''}">
        ${mark(c.kindsOk)} 英大文字・英小文字・数字・記号のうち${PW_MIN_KINDS}種類以上
        <span class="p-signup__requirement-sub">（現在 ${c.kinds} 種類）</span>
      </li>
    </ul>

    ${d.errors.password ? `<p class="p-signup__error">${_esc(d.errors.password)}</p>` : ''}
    ${_otherErrorsHtml(d.errors, ['password'])}
    ${d.errors._toLogin ? `
      <button type="button" id="su-to-login" class="p-signup__text-button">ログイン画面へ</button>` : ''}

    <button type="button" id="su-pw-next" class="c-button c-button--primary p-signup__submit p-signup__next--tight">アカウントを作成</button>

    <!-- ここでコードを先に送っておくので、STEP 3 に着く頃には届いている -->
    <p class="p-signup__hint">
      作成すると <span class="p-signup__hint-em">${_esc(d.email)}</span> に<br>確認コードを送信します
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
  const color = ['var(--color-border)', '#FFC300', '#9EDF05', '#9EDF05'][sc];
  const label = ['要件を満たしていません', '使えます', 'よい強度です', '強力なパスワードです'][sc];

  // ★色は --meter-color で渡す（形と余白は CSS が持つ）。
  //   以前はここで className ごと組み立てており、見た目を変えるのに JS を
  //   触る必要があった。
  document.querySelectorAll('#su-pw-bars > div').forEach((el, i) => {
    el.style.setProperty('--meter-color', sc >= i + 1 ? color : 'var(--bg-textbox)');
  });
  const p = document.getElementById('su-pw-label');
  if (p) {
    p.textContent = label;
    p.style.setProperty('--meter-color', sc === 0 ? 'var(--color-text-muted)' : color);
  }

  const paint = (el, okFlag, text) => {
    if (!el) return;
    el.classList.toggle('is-ok', okFlag);
    el.innerHTML = `<span class="p-signup__requirement-mark">${okFlag ? '\u25cf' : '\u25cb'}</span> ${text}`;
  };
  paint(document.getElementById('su-pw-req-len'), c.lenOk, `${PW_MIN_LEN}文字以上`);
  paint(document.getElementById('su-pw-req-kinds'), c.kindsOk,
    `英大文字・英小文字・数字・記号のうち${PW_MIN_KINDS}種類以上`
    + ` <span class="p-signup__requirement-sub">（現在 ${c.kinds} 種類）</span>`);
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
    <h1 class="p-signup__question">確認コードを<br>入力してください</h1>
    <p class="p-signup__question-sub">
      <span class="p-signup__question-email">${_esc(state.currentUser?.email || d.email)}</span> 宛に
    </p>
    <p class="p-signup__question-lead">${d.otpSending ? '6桁のコードを送信しています…' : '6桁のコードを送信しました'}</p>

    <!-- ★入力は「1本の input」のまま、見た目だけ6分割にしている。
         input を透明にしてマスの上に重ねることで、iOS のキーボード上部サジェスト
         （autocomplete="one-time-code"）とペーストが標準どおり動く。
         6個の input に分けるとペーストの分配処理やバックスペースの制御が必要になり、
         かつ自動入力が効かなくなる端末がある。 -->
    <div id="su-otp-boxes" class="c-otp">
      <div class="c-otp__boxes">
        ${chars.map((c, i) => `
          <div data-otp-box class="c-otp__box${
            d.otpError ? ' is-error' : i === focusIdx ? ' is-focus' : ''
          }">${c.trim() ? _esc(c) : ''}</div>`).join('')}
      </div>
      <input id="su-otp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="${OTP_LENGTH}"
        autocomplete="one-time-code" aria-label="確認コード"
        class="c-otp__input" value="${_esc(d.otp)}">
    </div>

    ${d.mailError ? `<p class="p-signup__minor p-signup__minor--error">⚠ メール送信に失敗：${_esc(d.mailError)}</p>` : ''}
    ${d.devCode ? `<p class="p-signup__minor">（開発用）コード: ${_esc(d.devCode)}</p>` : ''}
    ${d.otpError ? `<p class="p-signup__error">${_esc(d.otpError)}</p>` : ''}

    <button id="su-otp-submit" class="c-button c-button--primary p-signup__submit">認証する</button>

    <button type="button" id="su-otp-resend" class="p-signup__resend">
      ${d.resendLeftSec > 0 ? `コードを再送する（${d.resendLeftSec}秒）` : 'コードを再送する'}
    </button>

    <p class="p-signup__caption">
      メールが見つからないときは、迷惑メールフォルダもご確認ください
    </p>
    ${d.changingEmail ? `
      <!-- ★STEP 1 に戻さない。戻すと別メールで登録し直され、アカウントが二重にできる。
           作成済みアカウントのメールアドレスをその場で差し替える。 -->
      <div class="p-signup__change-email">
        <p class="p-signup__change-email-title">別のメールアドレスに送り直す</p>
        <input id="su-newmail" type="email" autocomplete="email" inputmode="email"
          class="c-input c-input--block p-signup__input"
          placeholder="example@mail.com" value="${_esc(d.newEmail || '')}" maxlength="100">
        ${d.newEmailError ? `<p class="p-signup__error">${_esc(d.newEmailError)}</p>` : ''}
        <div class="p-signup__row">
          <button type="button" id="su-newmail-cancel" class="p-signup__row-button p-signup__row-button--cancel">キャンセル</button>
          <button type="button" id="su-newmail-save" class="c-button c-button--primary p-signup__row-button">変更して再送信</button>
        </div>
      </div>` : `
      <button type="button" id="su-otp-change-email" class="p-signup__text-button">
        メールアドレスを変更する
      </button>`}

    <button type="button" id="su-otp-later" class="p-signup__later">
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
  // ★[data-otp-box] で引く。以前は '.flex > div' という Tailwind の
  //   ユーティリティ＋構造依存で引いており、flex を外した瞬間や中の div を
  //   1つ増やした瞬間に無言で壊れる状態だった。
  const boxes = wrap.querySelectorAll('[data-otp-box]');
  const focusIdx = Math.min(d.otp.length, OTP_LENGTH - 1);
  boxes.forEach((el, i) => {
    el.textContent = d.otp[i] || '';
    el.classList.toggle('is-focus', i === focusIdx);
    el.classList.remove('is-error');   // 打ち直したらエラー表示を消す
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
    // ★ここでは開かない。プロフィール作成（STEP 4〜8）を先に済ませ、
    //   完了カードの「はじめる」で消費する。作成途中に出すと質問の上に
    //   モーダルが重なって、どちらも進められなくなる。
    state.pendingJoinConfirm = {
      token: verifyResp.inviteToken,
      eventName: verifyResp.pendingEventName || 'イベント',
      eventId: verifyResp.pendingEventId || '',
    };
    await state.loadAfterAuth();
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

const PROFILE_STEPS = [4, 5, 6, 7, 8];

/** この人に実際に出るプロフィール質問のステップ一覧 */
function _visibleProfileSteps(d) {
  const skip = new Set();
  if (d.googleRoute) { skip.add(4); skip.add(5); }
  if (d.inviteRoute) skip.add(6);
  return PROFILE_STEPS.filter(s => !skip.has(s));
}

/**
 * プロフィールパートの進捗。
 * ★経路ごとの実ステップ数で出す（固定で「10問中」とは出さない）。
 *   メール経由=6、Google 経由=4、Google＋招待=3 のように分母が変わる。
 */
function _profileDots(d, step) {
  const steps = _visibleProfileSteps(d);
  const idx = steps.indexOf(step);
  return Components.StepIndicator(idx + 1, steps.length, {
    label: `プロフィール作成（${idx + 1}/${steps.length}）`,
    compact: true,
  });
}

/** プロフィールフェーズに入る（認証パート完了後、および再開時の入口） */
async function _enterProfilePhase() {
  const d = _draft();
  const ob = state.currentUser?.onboarding;
  d.googleRoute = ob?.currentStep === 'step6' && !(ob?.completedSteps || []).includes('step4');
  // ★参加確認を予約済み（招待リンク経由でアカウントを作った直後）も招待経路とみなす。
  //   loadAfterAuth が pendingInviteToken を消費した後にここへ来るため、
  //   この条件が無いと「どこで知りましたか？」を聞いてしまう。
  d.inviteRoute = !!(state.pendingInviteToken || state.inviteContextForAuth ||
                     state.pendingJoinConfirm);

  // ★招待経由なら STEP 6（流入経路）は聞かずに自動記録する。聞かずに済むものは聞かない。
  //   ここで済ませること。_gotoProfile の中でやると _normalizeStep が先に STEP 6 を
  //   飛ばしてしまい、到達せず記録漏れになる（実際にそのバグを出した）。
  if (d.inviteRoute && !(ob?.completedSteps || []).includes('step6')) {
    const eventId = state.inviteContextForAuth?.eventId ||
                    state.pendingJoinConfirm?.eventId || '';
    await _saveStep('step6', true, {
      acquisitionChannel: 'invite',
      ...(eventId ? { acquisitionInviteEventId: String(eventId) } : {}),
    });
  }

  _hydrateDraftFromUser(d);

  const first = _stepNumFromName(ob?.currentStep) ?? 4;
  await _gotoProfile(_normalizeStep(d, first));
}

/**
 * 保存済みの回答を下書きに戻す。
 *
 * ★これが無いと「戻る」で前の質問に戻ったとき、選択肢が未選択に見える。
 *   同じセッション内なら下書きが残っているが、離脱して再開した場合は
 *   下書きが空なので、サーバーに保存済みの値から復元する必要がある。
 */
function _hydrateDraftFromUser(d) {
  const u = state.currentUser || {};
  const p = u.profile || {};
  const done = new Set(u.onboarding?.completedSteps || []);

  // 表示名は「本人が設定済みのとき」だけ入れる。
  // 未設定だとサーバーが振った仮名（ユーザー1234）が入ってしまうため。
  if (done.has('step4') && u.username) d.name = u.username;

  // アバターがプリセットなら、その ID を選択状態にする
  const m = /\/images\/avatar\/(preset-avatar-\d+)\.png$/.exec(String(u.avatarUrl || ''));
  if (m) d.avatarPreset = m[1];

  if (p.acquisitionChannel)      d.acquisitionChannel      = p.acquisitionChannel;
  if (p.acquisitionChannelOther) d.acquisitionChannelOther = p.acquisitionChannelOther;
  if (p.eventExperience)         d.eventExperience         = p.eventExperience;
  if (p.workStylePlanning)       d.workStylePlanning       = p.workStylePlanning;
  if (p.workStyleSocial)         d.workStyleSocial         = p.workStyleSocial;
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

/**
 * 表示対象のうち、いま居るステップの1つ前を返す。
 * @returns {number|null} null なら先頭（＝これ以上戻れない）
 */
function _prevProfileStep(d, step) {
  const steps = _visibleProfileSteps(d);
  const idx = steps.indexOf(step);
  return idx > 0 ? steps[idx - 1] : null;
}

/** その画面に戻るボタンを出すか（先頭のプロフィール質問では出さない） */
function _canBack(d, step) {
  return _prevProfileStep(d, step) !== null;
}

/**
 * 前の質問へ戻る。回答は保持したまま戻す（消さない）。
 * ★戻った先で「次へ」を押すと _saveStep が走って上書き保存されるので、
 *   答え直しがそのまま反映される。
 */
function _backProfile(step) {
  const d = _draft();
  const prev = _prevProfileStep(d, step);
  if (prev === null) return;
  if (prev === 8) d.quizIndex = QUIZ.length - 1;   // 診断へ戻るときは最後の設問から
  d.step = prev;
  d.errors = {};
  state.render();
  window.scrollTo(0, 0);
}

/**
 * プロフィール作成を完了し、プロフィールカードを見せる。
 * 着地（HOME / 招待の参加フロー）はカードの「はじめる」を押したときに行う。
 */
async function _finishProfile() {
  const d = _draft();
  await _saveStep('complete', true);
  logEvent('onboarding_completed');
  d.step = 'complete';
  state.render();
  window.scrollTo(0, 0);
}

async function _gotoProfile(step) {
  const d = _draft();
  if (step === null || step === undefined) {
    await _finishProfile();   // 全ステップ終了 → プロフィールカードへ
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
    <button type="button" data-choice="${_esc(id)}"
      class="p-signup__choice${selected ? ' is-selected' : ''}">
      ${_esc(label)}
    </button>`;
}

function _skipButton(label = 'スキップ') {
  return `<button type="button" id="su-skip" class="p-signup__later">${label}</button>`;
}

// ----- STEP 4：表示名 -----

function _renderName(container, d) {
  container.innerHTML = _shell(`
    ${_profileDots(d, 4)}
    <h1 class="p-signup__question">イベクリへようこそ。<br>まずはあなたのニックネームを教えて</h1>
    <p class="p-signup__question-lead">あとから変更できます</p>

    <label class="p-signup__label" for="su-name">みんなに表示される名前</label>
    <input id="su-name" type="text" autocomplete="nickname"
      class="c-input p-signup__input p-signup__input--tight${d.errors.name ? ' is-error' : ''}"
      placeholder="ニックネーム" value="${_esc(d.name || '')}" maxlength="20">
    <p class="p-signup__note p-signup__note--under-input">2〜20文字（英数字・日本語・全角OK）</p>
    ${d.errors.name ? `<p class="p-signup__error">${_esc(d.errors.name)}</p>` : ''}
    ${_otherErrorsHtml(d.errors, ['name'])}

    <button type="button" id="su-name-next" class="c-button c-button--primary p-signup__submit p-signup__next">次へ</button>
    ${_skipButton('あとで設定する')}
  `, { back: _canBack(d, 4) });

  const input = document.getElementById('su-name');
  for (const ev of ['input', 'change']) input.addEventListener(ev, e => d.name = e.target.value);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('su-name-next').click(); });
  setTimeout(() => input.focus(), 50);

  document.getElementById('su-back')?.addEventListener('click', () => _backProfile(4));
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
    <h1 class="p-signup__question">アイコンを<br>選んでください</h1>
    <p class="p-signup__question-lead">あとから変更できます</p>

    <div class="p-signup__presets">
      ${choices.length === 0
        ? '<p class="p-signup__presets-loading">読み込み中…</p>'
        : choices.map(p => `
          <button type="button" data-preset="${_esc(p.id)}"
            class="p-signup__preset${d.avatarPreset === p.id ? ' is-selected' : ''}">
            <img src="${_esc(p.url)}" alt="" class="p-signup__preset-image">
          </button>`).join('')}
    </div>

    <button type="button" id="su-avatar-shuffle" class="p-signup__shuffle">
      他の候補を見る
    </button>

    ${d.avatarUploadPreview ? `
      <div class="p-signup__upload-preview">
        <img src="${_esc(d.avatarUploadPreview)}" class="p-signup__upload-image" alt="">
        <p class="p-signup__upload-text">この画像を使います</p>
      </div>` : ''}

    <!-- ★hidden は「見た目を消す」ためではなく、ファイル選択を自前のボタンで代替するため -->
    <input id="su-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" class="u-hidden">
    <button type="button" id="su-avatar-upload" class="p-signup__upload-button">
      自分の画像をアップロードする
    </button>

    ${d.errors.avatar ? `<p class="p-signup__error">${_esc(d.errors.avatar)}</p>` : ''}

    <button type="button" id="su-avatar-next" class="c-button c-button--primary p-signup__submit p-signup__next--tight">次へ</button>
    ${_skipButton('あとで設定する')}
  `, { back: _canBack(d, 5) });

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

  document.getElementById('su-back')?.addEventListener('click', () => _backProfile(5));
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
    <h1 class="p-signup__question p-signup__question--wide">イベクリを<br>どこで知りましたか？</h1>

    ${CHANNELS.map(([id, label]) => _choice(id, label, d.acquisitionChannel === id)).join('')}

    ${d.acquisitionChannel === 'other' ? `
      <input id="su-channel-other" type="text" maxlength="100"
        class="c-input c-input--block p-signup__input p-signup__input--nested"
        placeholder="よければ教えてください（任意）" value="${_esc(d.acquisitionChannelOther || '')}">` : ''}

    <button id="su-channel-next" class="c-button c-button--primary p-signup__submit p-signup__next--tight">次へ</button>
    ${_skipButton()}
  `, { back: _canBack(d, 6) });

  container.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.acquisitionChannel = btn.dataset.choice;
      state.render();
      if (d.acquisitionChannel === 'other') setTimeout(() => document.getElementById('su-channel-other')?.focus(), 50);
    });
  });
  document.getElementById('su-channel-other')?.addEventListener('input', e => d.acquisitionChannelOther = e.target.value);

  document.getElementById('su-back')?.addEventListener('click', () => _backProfile(6));
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
    <h1 class="p-signup__question p-signup__question--wide">イベント運営の<br>経験はありますか？</h1>

    ${EXPERIENCES.map(([id, label]) => _choice(id, label, d.eventExperience === id)).join('')}

    <button id="su-exp-next" class="c-button c-button--primary p-signup__submit p-signup__next--tight">次へ</button>
    ${_skipButton()}
  `, { back: _canBack(d, 7) });

  container.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', () => { d.eventExperience = btn.dataset.choice; state.render(); });
  });
  document.getElementById('su-back')?.addEventListener('click', () => _backProfile(7));
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
    <p class="p-signup__quiz-count">${qi + 1} / ${QUIZ.length}</p>
    <!-- ★esc しないこと。QUIZ の title は改行のための <br> を意図的に含む
         （「イベント準備、<br>あなたはどっち？」）。定数なのでユーザー入力は入らない。 -->
    <h1 class="p-signup__question p-signup__question--wide">${q.title}</h1>

    <div class="p-signup__quiz-options">
      ${q.options.map(([id, label, emoji]) => `
        <button type="button" data-choice="${_esc(id)}"
          class="p-signup__quiz-option${selected === id ? ' is-selected' : ''}">
          <span class="p-signup__quiz-emoji">${emoji}</span>
          <span class="p-signup__quiz-label">${_esc(label)}</span>
        </button>`).join('')}
    </div>

    ${_skipButton()}
  `, { back: qi > 0 || _canBack(d, 8) });

  container.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', async () => {
      d[q.key] = btn.dataset.choice;
      state.render();
      // タップしたら少し見せてから次へ（診断らしいテンポにする）
      setTimeout(() => _advanceQuiz(d), 250);
    });
  });
  document.getElementById('su-back')?.addEventListener('click', () => {
    // 2問目からは1問目へ、1問目からは前のステップへ戻る
    if (qi > 0) { d.quizIndex = qi - 1; state.render(); }
    else        { _backProfile(8); }
  });
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
// COMPLETE：プロフィールカード
// =====================================================
//
// 「フォームを埋めさせられた」ではなく「自分のカードができた」という読後感にする。
// 回答からタグを組み立て、カードが順に組み上がるアニメーションで見せる。

/** 回答 → カードに載せるタグ。未回答の項目は出さない（空欄を見せない）。 */
function _profileTags(u) {
  const p = u?.profile || {};
  const tags = [];
  const exp = { first: 'はじめて', few: '経験あり', many: 'ベテラン' }[p.eventExperience];
  if (exp) tags.push({ label: exp, color: '#0CA1E3' });

  const planning = { planner: '計画派', mover: '勢い派' }[p.workStylePlanning];
  if (planning) tags.push({ label: planning, color: '#9EDF05' });

  const social = { group: 'ワイワイ派', solo: 'もくもく派' }[p.workStyleSocial];
  if (social) tags.push({ label: social, color: '#FFC300' });

  return tags;
}

/** タグの組み合わせから一言そえる（診断コンテンツらしい読後感のため） */
function _profileCatch(u) {
  const p = u?.profile || {};
  const a = p.workStylePlanning, b = p.workStyleSocial;
  if (a === 'planner' && b === 'group') return '段取りよく、みんなを引っぱるタイプ';
  if (a === 'planner' && b === 'solo')  return '見通しを立てて、着実に進めるタイプ';
  if (a === 'mover'   && b === 'group') return '勢いと巻き込み力で進めるタイプ';
  if (a === 'mover'   && b === 'solo')  return '手を動かしながら形にするタイプ';
  return 'これからのイベントづくり、一緒に進めましょう';
}

function _renderComplete(container, d) {
  const u = state.currentUser || {};
  const tags = _profileTags(u);

  container.innerHTML = _shell(`
    <div class="p-signup__complete">
      <p id="cc-lead" class="p-signup__complete-lead">
        プロフィールができました！
      </p>

      <!-- カード本体。中の要素を時間差で出して「組み上がる」ように見せる。
           初期状態（透明・少し下／小さい）は CSS が持ち、JS は解除するだけ -->
      <div id="cc-card" class="p-signup__complete-card">
        <div id="cc-avatar" class="p-signup__complete-avatar">
          ${Components.UserAvatar(u, { size: 96 })}
        </div>
        <p id="cc-name" class="p-signup__complete-name">
          ${_esc(u.username || '')}
        </p>
        <p id="cc-catch" class="p-signup__complete-catch">
          ${_esc(_profileCatch(u))}
        </p>
        <div id="cc-tags" class="p-signup__complete-tags">
          ${tags.map((t, i) => `
            <span data-tag-i="${i}" class="p-signup__complete-tag"
              style="--tag-color:${_esc(t.color)}">
              ${_esc(t.label)}
            </span>`).join('')}
        </div>
      </div>

      <button type="button" id="cc-start" class="c-button c-button--primary p-signup__complete-start">
        イベクリをはじめる
      </button>
    </div>
  `, { back: true });

  // 組み上がりアニメーション（CSS だけで完結させる：外部ライブラリを足さない）
  const reveal = (id, delay, extra = '') => {
    const el = document.getElementById(id);
    if (!el) return;
    setTimeout(() => {
      el.style.transition = 'opacity .45s ease, transform .45s cubic-bezier(.2,.8,.3,1)';
      el.style.opacity = '1';
      el.style.transform = extra || 'none';
    }, delay);
  };
  reveal('cc-lead',   80);
  reveal('cc-card',  200);
  reveal('cc-avatar', 420);
  reveal('cc-name',   620);
  reveal('cc-catch',  780);
  container.querySelectorAll('[data-tag-i]').forEach((el, i) => {
    setTimeout(() => {
      el.style.transition = 'opacity .4s ease, transform .4s cubic-bezier(.2,.8,.3,1)';
      el.style.opacity = '1';
      el.style.transform = 'none';
    }, 900 + i * 130);
  });
  reveal('cc-start', 900 + tags.length * 130 + 200);

  // カードからも答え直しに戻れる（最後の質問へ）
  document.getElementById('su-back')?.addEventListener('click', () => {
    const steps = _visibleProfileSteps(d);
    const last = steps[steps.length - 1];
    if (last === 8) d.quizIndex = QUIZ.length - 1;
    d.step = last;
    state.render();
    window.scrollTo(0, 0);
  });
  document.getElementById('cc-start').onclick = () => {
    // ★招待リンクから来た人には通知の案内を出さず、参加申請を先に済ませてもらう。
    //   通知は参加後にいくらでも案内できるが、参加申請はこの流れでしか出せない。
    //   参加確認モーダルは loadAfterAuth の最後で consumePendingJoinConfirm が開く。
    if (!state.pendingJoinConfirm) {
      // HOME に着いてから、ホーム画面追加→通知の案内を順に出す（modals/pushSetupModal.js）。
      // オンボーディングの途中では出さない（iOS は追加しないと許可できず流れが切れるため）。
      state.pendingPushSetup = true;
    }
    _finish();
  };
}
