// ===== パスワードリセット =====
// 2つの画面:
//  - renderPasswordResetRequest: メールアドレスを入力してリセットメールを送信
//  - renderPasswordResetConfirm: メール内リンクから来て、新パスワードを設定

import { state } from '../state.js';
import { api }   from '../api.js';

// =====================================================
// リセット申請画面（メールアドレス入力）
// =====================================================
export function renderPasswordResetRequest(container) {
  const sec = state.passwordResetReqScreen || (state.passwordResetReqScreen = {
    email: '',
    sending: false,
    sent: false,
    error: '',
    devUrl: null,
  });

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <main class="flex-1 px-6 pt-16 pb-8 flex flex-col">
        <h1 class="heading-l text-[#484545] font-bold text-center mb-2">パスワードを忘れた</h1>
        <p class="text-rs text-[#A7AAAC] text-center mb-8 font-bold leading-relaxed">
          ご登録のメールアドレスを入力してください。<br>
          パスワード再設定のリンクをお送りします。
        </p>

        ${sec.sent ? _sentBlock(sec) : _formBlock(sec)}

        <p class="text-center text-rs text-[#484545] font-bold mt-6">
          <button id="pr-go-login" class="text-[#0CA1E3] font-bold">ログイン画面に戻る</button>
        </p>
      </main>
    </div>`;

  if (!sec.sent) {
    document.getElementById('pr-email')?.addEventListener('input', e => sec.email = e.target.value);
    document.getElementById('pr-submit')?.addEventListener('click', _submitRequest);
  }
  document.getElementById('pr-go-login')?.addEventListener('click', () => {
    state.passwordResetReqScreen = null;
    state.setView('LOGIN');
  });
}

function _formBlock(sec) {
  return `
    <div class="space-y-4 mb-6">
      <div>
        <label class="block text-rs text-[#484545] font-bold mb-2">メールアドレス</label>
        <input id="pr-email" type="email" autocomplete="email"
          class="input-field w-full px-4 py-3 focus:outline-none"
          placeholder="your@example.com"
          value="${_esc(sec.email)}">
      </div>
    </div>
    ${sec.error ? `<p class="text-[13px] text-[#EE3E12] text-center font-bold mb-4">${_esc(sec.error)}</p>` : ''}
    <button id="pr-submit" class="btn-primary w-full py-3.5 heading-rs font-bold mb-4"
      ${sec.sending ? 'disabled style="opacity:.6"' : ''}>
      ${sec.sending ? '送信中…' : 'リセットメールを送る'}
    </button>`;
}

function _sentBlock(sec) {
  return `
    <div class="bg-[#E8F6FD] border border-[#0CA1E3] rounded-2xl p-5 mb-6">
      <p class="text-[24px] text-center mb-2">📧</p>
      <p class="text-[13px] text-[#484545] font-bold text-center leading-relaxed">
        メールをお送りしました。<br>
        受信トレイをご確認ください。
      </p>
      <p class="text-[11px] text-[#A7AAAC] font-bold text-center mt-3">
        リンクの有効期限は30分です
      </p>
    </div>
    ${sec.devUrl ? `
      <div class="bg-[#FFF7E6] border border-[#FFC300] rounded-xl p-3 mb-4">
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">開発モード: リセット URL</p>
        <p class="text-[10px] text-[#484545] font-mono break-all">${_esc(sec.devUrl)}</p>
      </div>
    ` : ''}`;
}

async function _submitRequest() {
  const sec = state.passwordResetReqScreen;
  const email = String(sec.email || '').trim();
  if (!email) {
    sec.error = 'メールアドレスを入力してください';
    state.render();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sec.error = '正しいメールアドレスを入力してください';
    state.render();
    return;
  }

  sec.sending = true;
  sec.error = '';
  state.render();

  try {
    const r = await api.requestPasswordReset(email);
    if (r.ok) {
      sec.sent = true;
      sec.devUrl = r.devUrl || null;
      sec.sending = false;
      state.render();
    } else {
      sec.sending = false;
      sec.error = r.error || 'メール送信に失敗しました';
      state.render();
    }
  } catch (e) {
    console.error('[password-reset] エラー:', e);
    sec.sending = false;
    sec.error = 'ネットワークエラーが発生しました';
    state.render();
  }
}

// =====================================================
// リセット適用画面（新パスワード入力）
// =====================================================
export function renderPasswordResetConfirm(container) {
  const sec = state.passwordResetConfirmScreen;
  if (!sec) {
    state.setView('LOGIN');
    return;
  }

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <main class="flex-1 px-6 pt-16 pb-8 flex flex-col">
        <h1 class="heading-l text-[#484545] font-bold text-center mb-2">新しいパスワード</h1>
        <p class="text-rs text-[#A7AAAC] text-center mb-8 font-bold">
          新しいパスワードを入力してください
        </p>

        ${sec.verifying  ? _verifyingBlock()
        : sec.verifyError ? _verifyErrorBlock(sec)
        : sec.done        ? _doneBlock()
        : _confirmForm(sec)}

        ${(sec.verifyError || sec.done) ? `
          <button id="pc-go-login" class="text-[#0CA1E3] font-bold mt-4">ログイン画面に戻る</button>` : ''}
      </main>
    </div>`;

  document.getElementById('pc-pw')?.addEventListener('input', e => sec.newPassword = e.target.value);
  document.getElementById('pc-pw2')?.addEventListener('input', e => sec.newPassword2 = e.target.value);
  document.getElementById('pc-submit')?.addEventListener('click', _submitConfirm);
  document.getElementById('pc-go-login')?.addEventListener('click', () => {
    state.passwordResetConfirmScreen = null;
    state.setView('LOGIN');
  });
}

function _verifyingBlock() {
  return `
    <div class="flex items-center justify-center py-12">
      <div class="w-10 h-10 border-4 border-[#0CA1E3] border-t-transparent rounded-full animate-spin"></div>
    </div>`;
}

function _verifyErrorBlock(sec) {
  return `
    <div class="bg-[#FFEEEA] border border-[#EE3E12] rounded-2xl p-5 mb-4">
      <p class="text-[24px] text-center mb-2">⚠️</p>
      <p class="text-[13px] text-[#484545] font-bold text-center leading-relaxed">
        ${_esc(sec.verifyError)}
      </p>
    </div>`;
}

function _doneBlock() {
  return `
    <div class="bg-[#E8F6FD] border border-[#0CA1E3] rounded-2xl p-5 mb-4">
      <p class="text-[24px] text-center mb-2">✓</p>
      <p class="text-[13px] text-[#484545] font-bold text-center leading-relaxed">
        パスワードを変更しました。<br>
        新しいパスワードでログインしてください。
      </p>
    </div>`;
}

function _confirmForm(sec) {
  const errors = sec.errors || {};
  return `
    ${sec.email ? `
      <div class="bg-[#FDFBF8] border border-[#E1DFDC] rounded-xl p-3 mb-5">
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">対象のアカウント</p>
        <p class="text-[13px] text-[#484545] font-bold">${_esc(sec.email)}</p>
      </div>` : ''}

    <div class="space-y-4 mb-6">
      <div>
        <label class="block text-rs text-[#484545] font-bold mb-2">新しいパスワード</label>
        <input id="pc-pw" type="password"
          class="input-field w-full px-4 py-3 focus:outline-none ${errors.newPassword ? 'ring-2 ring-[#EE3E12]' : ''}"
          placeholder="8文字以上の英数字"
          value="${_esc(sec.newPassword || '')}" maxlength="100">
        ${errors.newPassword ? `<p class="text-[12px] text-[#EE3E12] mt-1.5 font-bold">${_esc(errors.newPassword)}</p>` : ''}
      </div>
      <div>
        <label class="block text-rs text-[#484545] font-bold mb-2">確認のため もう一度</label>
        <input id="pc-pw2" type="password"
          class="input-field w-full px-4 py-3 focus:outline-none ${errors.mismatch ? 'ring-2 ring-[#EE3E12]' : ''}"
          placeholder="同じパスワード"
          value="${_esc(sec.newPassword2 || '')}" maxlength="100">
        ${errors.mismatch ? `<p class="text-[12px] text-[#EE3E12] mt-1.5 font-bold">${_esc(errors.mismatch)}</p>` : ''}
      </div>
    </div>
    ${errors._global ? `<p class="text-[13px] text-[#EE3E12] text-center font-bold mb-4">${_esc(errors._global)}</p>` : ''}
    <button id="pc-submit" class="btn-primary w-full py-3.5 heading-rs font-bold mb-4"
      ${sec.submitting ? 'disabled style="opacity:.6"' : ''}>
      ${sec.submitting ? '変更中…' : 'パスワードを変更する'}
    </button>`;
}

async function _submitConfirm() {
  const sec = state.passwordResetConfirmScreen;
  const errors = {};
  const pw1 = String(sec.newPassword || '');
  const pw2 = String(sec.newPassword2 || '');
  if (!pw1 || pw1.length < 8) errors.newPassword = 'パスワードは8文字以上にしてください';
  if (pw1 !== pw2) errors.mismatch = 'パスワードが一致しません';
  if (Object.keys(errors).length) {
    sec.errors = errors;
    state.render();
    return;
  }

  sec.errors = {};
  sec.submitting = true;
  state.render();

  try {
    const r = await api.confirmPasswordReset(sec.token, pw1);
    if (r.ok) {
      sec.done = true;
      sec.submitting = false;
      state.render();
    } else {
      sec.submitting = false;
      if (r.errors) {
        sec.errors = r.errors;
      } else if (r.error === 'token_expired') {
        sec.verifyError = 'リンクの有効期限が切れています。もう一度メールを送信してください';
      } else if (r.error === 'token_not_found' || r.error === 'invalid_token') {
        sec.verifyError = 'リンクが無効です。もう一度メールを送信してください';
      } else {
        sec.errors = { _global: r.error || 'パスワードの変更に失敗しました' };
      }
      state.render();
    }
  } catch (e) {
    console.error('[password-reset-confirm] エラー:', e);
    sec.submitting = false;
    sec.errors = { _global: 'ネットワークエラーが発生しました' };
    state.render();
  }
}

// =====================================================
// ヘルパ
// =====================================================
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
