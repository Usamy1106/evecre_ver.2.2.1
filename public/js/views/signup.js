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
// 表示名（STEP 4）以降のプロフィール質問は Phase C で追加する。
// 現時点では STEP 3 を抜けたら従来どおり loadAfterAuth() で HOME へ着地する。

import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { CONSENT_VERSION } from '../constants.js';
import {
  _esc, _setSubmitting, _syncDraftFromDom, _inviteContextBanner, _setupGoogleSignIn,
} from './auth.js';

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
  else                   _renderEntry(container, d);
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
    <button id="su-otp-change-email" class="w-full py-2 text-[12px] text-[#0CA1E3] font-bold underline">
      メールアドレスを変更する
    </button>

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

  document.getElementById('su-otp-change-email').onclick = () => {
    // 入力し直せるよう STEP 1 に戻す。作成済みのアカウントはそのまま残るため、
    // 別のメールで作り直す場合は新しいアカウントになる旨を伝える。
    window._app?.showToast('別のメールアドレスで登録し直せます', 'info');
    d.otp = ''; d.otpError = '';
    _goto(1);
  };

  document.getElementById('su-otp-later').onclick = async () => {
    logEvent('otp_deferred');
    logEvent('signup_step_skipped', { step: 'step3' });
    await _finish();
  };

  _startCooldown(d);
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
      await _finish(r);
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
