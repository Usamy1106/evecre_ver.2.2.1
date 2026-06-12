// ===== アカウント設定画面 =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { Components } from '../components.js';
import { showConfirmDialog } from '../dialog.js';

/**
 * アカウント設定画面
 * @param {HTMLElement} container
 */
export function renderAccount(container) {
  const u = state.currentUser || {};
  const sec = state.accountScreen || {};

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <header class="flex items-center px-6 py-4 bg-[#FDFBF8] sticky top-0 z-20">
        <button onclick="window._app.setView('HOME')"
          class="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center mr-3">
          <img src="/images/icon/iocn-Chevron.svg" class="w-4 h-4 brightness-0 opacity-50">
        </button>
        <h1 class="heading-r font-bold text-[#484545]">アカウント設定</h1>
      </header>

      <main class="flex-1 px-6 pb-24">
        ${!u.isVerified ? _verifySection(sec) : ''}

        <div class="bg-white rounded-2xl shadow-sm border border-[#E1DFDC] p-5 mb-4">
          ${_avatarSection(u, sec)}
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-[#E1DFDC] p-5 mb-4">
          ${_usernameSection(u, sec)}
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-[#E1DFDC] p-5 mb-4">
          ${_emailSection(u, sec)}
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-[#E1DFDC] p-5 mb-6">
          ${_passwordSection(sec)}
        </div>

        <button id="acc-logout" class="w-full py-3 rounded-xl text-[14px] font-bold text-[#EE3E12] bg-white border border-[#E1DFDC]">
          ログアウト
        </button>
      </main>
    </div>`;

  _bindEvents();
}

// ----- セクション: 未認証バナー -----

function _verifySection(sec) {
  return `
    <div class="bg-[#FFF7E6] border border-[#FFC300] rounded-2xl p-4 mb-4">
      <p class="text-[13px] font-bold text-[#484545] mb-1">⚠ メールアドレス未認証</p>
      <p class="text-[12px] text-[#484545] leading-relaxed mb-3">
        新規プロジェクトの作成など、一部の機能はメール認証完了まで使えません。
      </p>
      <button onclick="window._app.openVerifyModal()" class="bg-[#FFC300] text-white font-bold text-[13px] px-4 py-2 rounded-lg">認証コードを入力する</button>
    </div>`;
}

// ----- セクション: アバター画像 -----

function _avatarSection(u, sec) {
  return `
    <h2 class="text-[14px] font-bold text-[#484545] mb-3">プロフィール画像</h2>
    <div class="flex items-center gap-4">
      ${Components.UserAvatar(u, { size: 72 })}
      <div class="flex-1 space-y-2">
        <input id="acc-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
        <button id="acc-avatar-pick"
          class="bg-[#0CA1E3] text-white text-[12px] font-bold px-4 py-2 rounded-full active:scale-95 transition-transform"
          ${sec.avatarSaving ? 'disabled style="opacity:.5"' : ''}>
          ${sec.avatarSaving ? '保存中…' : '画像を選択'}
        </button>
        ${u.avatarUrl ? `
          <button id="acc-avatar-remove"
            class="block bg-white border border-[#E1DFDC] text-[#484545] text-[11px] font-bold px-3 py-1.5 rounded-full active:scale-95 transition-transform"
            ${sec.avatarSaving ? 'disabled style="opacity:.5"' : ''}>削除</button>
        ` : ''}
      </div>
    </div>
    ${sec.avatarError ? `<p class="text-[11px] text-[#EE3E12] font-bold mt-2">${sec.avatarError}</p>` : ''}`;
}

// ----- セクション: ユーザー名 -----

function _usernameSection(u, sec) {
  const editing = sec.active === 'username';
  return `
    <div class="flex justify-between items-center mb-${editing ? '3' : '0'}">
      <div>
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">ユーザー名</p>
        <p class="text-[14px] text-[#484545] font-bold">${_esc(u.username || '')}</p>
      </div>
      ${!editing ? `<button id="acc-username-edit" class="text-[12px] font-bold text-[#0CA1E3] px-3 py-1.5 rounded-lg bg-[#E8F6FD]">変更</button>` : ''}
    </div>
    ${editing ? `
      <input id="acc-username-input" type="text" maxlength="20"
        class="input-field w-full px-4 py-2.5 focus:outline-none mt-2 ${sec.error ? 'ring-2 ring-[#EE3E12]' : ''}"
        value="${_esc(sec.newValue || '')}"
        placeholder="2〜20文字（英数字・日本語・全角OK）">
      <p class="text-[10px] text-[#A7AAAC] mt-1.5">英数字、日本語、全角文字、ハイフン、アンダーバー</p>
      ${sec.error ? `<p class="text-[11px] text-[#EE3E12] mt-1 font-bold">${_esc(sec.error)}</p>` : ''}
      <div class="flex gap-2 mt-3">
        <button id="acc-username-cancel" class="flex-1 py-2 text-[12px] font-bold text-[#484545] bg-[#EBE8E5] rounded-lg">キャンセル</button>
        <button id="acc-username-save" class="flex-1 py-2 text-[12px] font-bold text-white bg-[#0CA1E3] rounded-lg">保存</button>
      </div>
    ` : ''}`;
}

// ----- セクション: メール -----

function _emailSection(u, sec) {
  const editing = sec.active === 'email';
  const step = sec.step || 'edit';
  return `
    <div class="flex justify-between items-center mb-${editing ? '3' : '0'}">
      <div class="flex-1 min-w-0">
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">メールアドレス
          ${u.isVerified ? '<span class="text-[#0CA1E3] ml-1">✓ 認証済み</span>' : '<span class="text-[#FFC300] ml-1">未認証</span>'}
        </p>
        <p class="text-[14px] text-[#484545] font-bold truncate">${_esc(u.email || '')}</p>
      </div>
      ${!editing ? `<button id="acc-email-edit" class="text-[12px] font-bold text-[#0CA1E3] px-3 py-1.5 rounded-lg bg-[#E8F6FD] flex-shrink-0">変更</button>` : ''}
    </div>
    ${editing && step === 'edit' ? `
      <input id="acc-email-input" type="email"
        class="input-field w-full px-4 py-2.5 focus:outline-none mt-2"
        value="${_esc(sec.newValue || '')}" placeholder="新しいメールアドレス">
      ${sec.errors?.email ? `<p class="text-[11px] text-[#EE3E12] mt-1 font-bold">${_esc(sec.errors.email)}</p>` : ''}
      <input id="acc-email-pw" type="password"
        class="input-field w-full px-4 py-2.5 focus:outline-none mt-2"
        value="${_esc(sec.currentPassword || '')}" placeholder="現在のパスワード">
      ${sec.errors?.password ? `<p class="text-[11px] text-[#EE3E12] mt-1 font-bold">${_esc(sec.errors.password)}</p>` : ''}
      <div class="flex gap-2 mt-3">
        <button id="acc-email-cancel" class="flex-1 py-2 text-[12px] font-bold text-[#484545] bg-[#EBE8E5] rounded-lg">キャンセル</button>
        <button id="acc-email-send" class="flex-1 py-2 text-[12px] font-bold text-white bg-[#0CA1E3] rounded-lg">コードを送信</button>
      </div>
    ` : editing && step === 'verify' ? `
      <p class="text-[12px] text-[#484545] font-bold mt-2 mb-2">${_esc(sec.newValue)} 宛にコードを送信しました</p>
      ${_otpInput('acc-email-code', sec.otp || '')}
      ${sec.mailError ? `<p class="text-[11px] text-[#EE3E12] mt-2 font-bold">⚠ メール送信に失敗：${_esc(sec.mailError)}</p>` : ''}
      ${sec.devCode ? `<p class="text-[11px] text-[#A7AAAC] mt-2 font-bold">（開発用）コード: ${_esc(sec.devCode)}</p>` : ''}
      ${sec.error ? `<p class="text-[11px] text-[#EE3E12] mt-2 font-bold">${_esc(sec.error)}</p>` : ''}
      <div class="flex gap-2 mt-3">
        <button id="acc-email-back"   class="flex-1 py-2 text-[12px] font-bold text-[#484545] bg-[#EBE8E5] rounded-lg">戻る</button>
        <button id="acc-email-confirm" class="flex-1 py-2 text-[12px] font-bold text-white bg-[#0CA1E3] rounded-lg">確定</button>
      </div>
    ` : ''}`;
}

// ----- セクション: パスワード -----

function _passwordSection(sec) {
  const editing = sec.active === 'password';
  const step = sec.step || 'edit';
  return `
    <div class="flex justify-between items-center mb-${editing ? '3' : '0'}">
      <div>
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">パスワード</p>
        <p class="text-[14px] text-[#484545] font-bold tracking-widest">●●●●●●●●</p>
      </div>
      ${!editing ? `<button id="acc-pw-edit" class="text-[12px] font-bold text-[#0CA1E3] px-3 py-1.5 rounded-lg bg-[#E8F6FD]">変更</button>` : ''}
    </div>
    ${editing && step === 'edit' ? `
      <input id="acc-pw-current" type="password"
        class="input-field w-full px-4 py-2.5 focus:outline-none mt-2"
        value="${_esc(sec.currentPassword || '')}" placeholder="現在のパスワード">
      ${sec.errors?.currentPassword ? `<p class="text-[11px] text-[#EE3E12] mt-1 font-bold">${_esc(sec.errors.currentPassword)}</p>` : ''}
      <input id="acc-pw-new" type="password"
        class="input-field w-full px-4 py-2.5 focus:outline-none mt-2"
        value="${_esc(sec.newPassword || '')}" placeholder="新しいパスワード（8文字以上）">
      ${sec.errors?.newPassword ? `<p class="text-[11px] text-[#EE3E12] mt-1 font-bold">${_esc(sec.errors.newPassword)}</p>` : ''}
      <div class="flex gap-2 mt-3">
        <button id="acc-pw-cancel" class="flex-1 py-2 text-[12px] font-bold text-[#484545] bg-[#EBE8E5] rounded-lg">キャンセル</button>
        <button id="acc-pw-send" class="flex-1 py-2 text-[12px] font-bold text-white bg-[#0CA1E3] rounded-lg">コードを送信</button>
      </div>
    ` : editing && step === 'verify' ? `
      <p class="text-[12px] text-[#484545] font-bold mt-2 mb-2">${_esc(state.currentUser?.email || '')} 宛にコードを送信しました</p>
      ${_otpInput('acc-pw-code', sec.otp || '')}
      ${sec.mailError ? `<p class="text-[11px] text-[#EE3E12] mt-2 font-bold">⚠ メール送信に失敗：${_esc(sec.mailError)}</p>` : ''}
      ${sec.devCode ? `<p class="text-[11px] text-[#A7AAAC] mt-2 font-bold">（開発用）コード: ${_esc(sec.devCode)}</p>` : ''}
      ${sec.error ? `<p class="text-[11px] text-[#EE3E12] mt-2 font-bold">${_esc(sec.error)}</p>` : ''}
      <div class="flex gap-2 mt-3">
        <button id="acc-pw-back"   class="flex-1 py-2 text-[12px] font-bold text-[#484545] bg-[#EBE8E5] rounded-lg">戻る</button>
        <button id="acc-pw-confirm" class="flex-1 py-2 text-[12px] font-bold text-white bg-[#0CA1E3] rounded-lg">確定</button>
      </div>
    ` : ''}`;
}

// ----- OTP入力欄 -----

function _otpInput(id, value) {
  return `<input id="${id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
    class="input-field w-full px-4 py-3 text-center text-[20px] tracking-[0.5em] font-bold focus:outline-none"
    value="${_esc(value)}" placeholder="000000" autocomplete="one-time-code">`;
}

// ----- イベント結線 -----

function _bindEvents() {
  const sec = state.accountScreen;

  document.getElementById('acc-logout')?.addEventListener('click', () => state.logout());

  // --- アバター画像 ---
  const pickBtn  = document.getElementById('acc-avatar-pick');
  const fileEl   = document.getElementById('acc-avatar-file');
  const removeBtn = document.getElementById('acc-avatar-remove');
  pickBtn?.addEventListener('click', () => fileEl?.click());
  fileEl?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    sec.avatarSaving = true;
    sec.avatarError = '';
    state.render();
    try {
      const dataUrl = await _processImageFile(file);
      const r = await api.changeAvatar(dataUrl);
      if (r.ok) {
        if (r.user) state.currentUser = r.user;
        sec.avatarSaving = false;
        state.render();
      } else {
        sec.avatarSaving = false;
        sec.avatarError = r.error === 'image_too_large' ? '画像のサイズが大きすぎます' :
                          r.error === 'invalid_image'  ? '対応していない画像形式です' :
                          (r.error || 'アップロードに失敗しました');
        state.render();
      }
    } catch (e2) {
      console.error('avatar upload error:', e2);
      sec.avatarSaving = false;
      sec.avatarError = '画像の処理に失敗しました';
      state.render();
    }
  });
  removeBtn?.addEventListener('click', async () => {
    const ok = await showConfirmDialog({
      message: 'プロフィール画像を削除しますか？',
      confirmLabel: '削除する',
      cancelLabel: 'キャンセル',
      destructive: true,
    });
    if (!ok) return;
    sec.avatarSaving = true;
    state.render();
    const r = await api.changeAvatar('');
    if (r.ok && r.user) state.currentUser = r.user;
    sec.avatarSaving = false;
    state.render();
  });

  // --- ユーザー名 ---
  document.getElementById('acc-username-edit')?.addEventListener('click', () => {
    state.accountScreen = { active: 'username', newValue: state.currentUser?.username || '' };
    state.render();
  });
  document.getElementById('acc-username-input')?.addEventListener('input', e => sec.newValue = e.target.value);
  document.getElementById('acc-username-cancel')?.addEventListener('click', () => { state.accountScreen = {}; state.render(); });
  document.getElementById('acc-username-save')?.addEventListener('click', async () => {
    const r = await api.changeUsername((sec.newValue || '').trim());
    if (r.ok) {
      state.currentUser = r.user || state.currentUser;
      state.accountScreen = {};
      state.render();
    } else {
      sec.error = r.errors?.username || r.error || '変更に失敗しました';
      state.render();
    }
  });

  // --- メール ---
  document.getElementById('acc-email-edit')?.addEventListener('click', () => {
    state.accountScreen = { active: 'email', step: 'edit', newValue: '', currentPassword: '' };
    state.render();
  });
  document.getElementById('acc-email-input')?.addEventListener('input', e => sec.newValue = e.target.value);
  document.getElementById('acc-email-pw')?.addEventListener('input', e => sec.currentPassword = e.target.value);
  document.getElementById('acc-email-cancel')?.addEventListener('click', () => { state.accountScreen = {}; state.render(); });
  document.getElementById('acc-email-send')?.addEventListener('click', async () => {
    sec.errors = {};
    const r = await api.requestEmailChange((sec.newValue || '').trim(), sec.currentPassword || '');
    if (r.ok) { sec.step = 'verify'; sec.otp = ''; sec.devCode = r.devCode; sec.mailError = r.mailError || null; sec.error = ''; state.render(); }
    else     { sec.errors = r.errors || { email: r.error || '送信に失敗しました' }; state.render(); }
  });
  document.getElementById('acc-email-back')?.addEventListener('click', () => { sec.step = 'edit'; sec.error = ''; state.render(); });
  _bindOtp('acc-email-code', v => { sec.otp = v; });
  document.getElementById('acc-email-confirm')?.addEventListener('click', async () => {
    const code = (document.getElementById('acc-email-code')?.value || '').trim();
    if (code.length !== 6) {
      sec.error = '6桁の数字を入力してください';
      state.render();
      return;
    }
    sec.otp = code;
    const r = await api.confirmEmailChange(code);
    if (r.ok) {
      state.currentUser = r.user || state.currentUser;
      state.accountScreen = {};
      state.render();
    } else { sec.error = r.error || '確定に失敗しました'; state.render(); }
  });

  // --- パスワード ---
  document.getElementById('acc-pw-edit')?.addEventListener('click', () => {
    state.accountScreen = { active: 'password', step: 'edit', currentPassword: '', newPassword: '' };
    state.render();
  });
  document.getElementById('acc-pw-current')?.addEventListener('input', e => sec.currentPassword = e.target.value);
  document.getElementById('acc-pw-new')?.addEventListener('input',     e => sec.newPassword     = e.target.value);
  document.getElementById('acc-pw-cancel')?.addEventListener('click', () => { state.accountScreen = {}; state.render(); });
  document.getElementById('acc-pw-send')?.addEventListener('click', async () => {
    sec.errors = {};
    const r = await api.requestPasswordChange(sec.currentPassword || '', sec.newPassword || '');
    if (r.ok) { sec.step = 'verify'; sec.otp = ''; sec.devCode = r.devCode; sec.mailError = r.mailError || null; sec.error = ''; state.render(); }
    else     { sec.errors = r.errors || { newPassword: r.error || '送信に失敗しました' }; state.render(); }
  });
  document.getElementById('acc-pw-back')?.addEventListener('click', () => { sec.step = 'edit'; sec.error = ''; state.render(); });
  _bindOtp('acc-pw-code', v => { sec.otp = v; });
  document.getElementById('acc-pw-confirm')?.addEventListener('click', async () => {
    const code = (document.getElementById('acc-pw-code')?.value || '').trim();
    if (code.length !== 6) {
      sec.error = '6桁の数字を入力してください';
      state.render();
      return;
    }
    sec.otp = code;
    const r = await api.confirmPasswordChange(code);
    if (r.ok) { state.accountScreen = {}; state.render(); _toast('パスワードを変更しました'); }
    else      { sec.error = r.error || '確定に失敗しました'; state.render(); }
  });
}

function _bindOtp(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', e => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    e.target.value = v;
    onChange(v);
  });
  // フォーカスは差し戻し動作で乱されないよう、初回のみセット
  if (document.activeElement !== el) el.focus();
}

function _toast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#484545] text-white px-5 py-3 rounded-full shadow-2xl text-[13px] font-bold z-[300] animate-fadeIn';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * ファイルを読み込み、Canvas で 256x256 中央クロップした JPEG の data URL を返す
 */
function _processImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('not an image'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const SIZE = 256;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        // 中央クロップ：短辺を基準
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
