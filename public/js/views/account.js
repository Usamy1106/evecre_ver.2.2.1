// ===== アカウント設定画面 =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { Components } from '../components.js';
import { showConfirmDialog } from '../dialog.js';
import { logEvent } from '../logger.js';
import {
  getPushState, hasSubscription, enablePush, disablePush, isStandalone, isIOS,
} from '../push.js';

/**
 * アカウント設定画面
 * @param {HTMLElement} container
 */
export function renderAccount(container) {
  const u = state.currentUser || {};
  const sec = state.accountScreen || {};

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <header class="flex items-center px-6 py-4 bg-[#FDFBF8] sticky top-0 z-20" style="padding-top:calc(1rem + env(safe-area-inset-top))">
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

        <div class="bg-white rounded-2xl shadow-sm border border-[#E1DFDC] p-5 mb-4">
          ${_passwordSection(sec)}
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-[#E1DFDC] p-5 mb-6">
          ${_notificationSection()}
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

// ----- セクション: 通知（Web Push）-----
// ★状態は state.accountScreen ではなくモジュール変数に持つ。
//   accountScreen はユーザー名/メール変更のキャンセル等で {} にリセットされるため、
//   そこに置くとリセットのたびに購読状態の再取得と余分な再描画が走る。
// ★iOS はホーム画面に追加した PWA でないと購読できないため、その場合は案内だけ出す。
let _pushState = undefined;      // 'ios-needs-install' | 'unsupported' | 'denied' | 'granted' | 'available'
let _pushSubscribed = false;     // この端末が購読済みか

function _notificationSection() {
  const st = _pushState || getPushState();
  const on = _pushSubscribed;

  const heading = `<h2 class="text-[14px] font-bold text-[#484545] mb-1">通知</h2>
    <p class="text-[11px] text-[#A7AAAC] mb-3 leading-relaxed">
      ミッションの割り当てや締め切り、完了のお知らせをアプリを閉じている間も受け取れます。
    </p>`;

  // iOS でブラウザのまま開いている：ホーム画面への追加を案内する（購読ボタンは出さない）
  if (st === 'ios-needs-install') {
    return `${heading}
      <div class="bg-[#EBF7FE] border border-[#0CA1E3]/40 rounded-xl p-4">
        <p class="text-[12px] font-bold text-[#0CA1E3] mb-2">ホーム画面に追加すると使えます</p>
        <ol class="text-[11px] text-[#484545] leading-relaxed list-decimal pl-4 space-y-1">
          <li>画面下の「共有」ボタンをタップ</li>
          <li>「ホーム画面に追加」を選ぶ</li>
          <li>追加されたアイコンからイベクリを開く</li>
        </ol>
        <p class="text-[10px] text-[#A7AAAC] mt-2">iPhone / iPad では Safari の仕様上、この手順が必要です。</p>
      </div>`;
  }

  if (st === 'unsupported') {
    return `${heading}
      <p class="text-[12px] text-[#A7AAAC]">このブラウザは通知に対応していません。</p>`;
  }

  if (st === 'denied') {
    return `${heading}
      <div class="bg-[#FFF7E6] border border-[#FFC300] rounded-xl p-4">
        <p class="text-[12px] font-bold text-[#484545] mb-1">通知がブロックされています</p>
        <p class="text-[11px] text-[#484545] leading-relaxed">
          ブラウザ（または端末）の設定でこのサイトの通知を「許可」に変更してから、もう一度お試しください。
        </p>
      </div>`;
  }

  // 購読可能（granted / available）
  return `${heading}
    <div class="flex items-center justify-between gap-3">
      <p class="text-[12px] font-bold ${on ? 'text-[#5b8104]' : 'text-[#A7AAAC]'}">
        ${on ? 'この端末で通知はオンです' : 'この端末では通知はオフです'}
      </p>
      <button id="acc-push-toggle" data-log="${on ? 'push_disable_tap' : 'push_enable_tap'}"
        class="flex-shrink-0 px-4 py-2 rounded-xl text-[12px] font-bold transition-colors
        ${on ? 'bg-white border border-[#D3D6D8] text-[#484545]' : 'text-white bg-[#0CA1E3]'}">
        ${on ? 'オフにする' : '通知をオンにする'}
      </button>
    </div>
    <p class="text-[10px] text-[#A7AAAC] mt-2">通知の設定は端末ごとに保存されます。</p>
    ${on ? `
      <button id="acc-push-test"
        class="mt-3 w-full py-2 rounded-xl text-[12px] font-bold text-[#0CA1E3] bg-[#EBF7FE] border border-[#0CA1E3]/30 active:scale-95 transition-transform">
        テスト通知を送る
      </button>
      <p class="text-[10px] text-[#A7AAAC] mt-1.5 leading-relaxed">
        この端末に届くか確認できます。アプリを閉じた状態でも届くかを試す場合は、
        送信後すぐにアプリを閉じてください。
      </p>` : ''}`;
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

  // --- 通知（Web Push）---
  // 購読状態の取得は非同期なので、初回は未取得のまま描画し、判明したら再描画する。
  if (_pushState === undefined) {
    _pushState = getPushState();
    if (_pushState === 'ios-needs-install') {
      logEvent('push_ios_guide_shown');
    } else if (_pushState !== 'unsupported') {
      logEvent('push_prompt_shown', { standalone: isStandalone(), ios: isIOS() });
    }
    hasSubscription().then(subscribed => {
      // 別画面に移っていたら再描画しない
      if (state.currentView !== 'ACCOUNT') return;
      if (_pushSubscribed === subscribed) return;
      _pushSubscribed = subscribed;
      state.render();
    });
  }

  document.getElementById('acc-push-toggle')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const wasOn = _pushSubscribed;
    const r = wasOn ? await disablePush() : await enablePush();
    btn.disabled = false;

    if (!r.ok) {
      const msg = {
        denied:         '通知が許可されませんでした',
        not_configured: 'サーバー側の通知設定が未完了です',
        unsupported:    'この環境では通知を使えません',
      }[r.error] || '通知の設定に失敗しました';
      _toast(msg);
      // 許可ダイアログで拒否された場合は表示状態も更新する
      _pushState = getPushState();
      state.render();
      return;
    }
    _pushSubscribed = !wasOn;
    _pushState = getPushState();
    _toast(wasOn ? '通知をオフにしました' : '通知をオンにしました');
    state.render();
  });

  // テスト通知（コンソールを開かずに疎通確認できるように）
  document.getElementById('acc-push-test')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '送信中…';
    const r = await api.sendTestPush();
    btn.disabled = false;
    btn.textContent = 'テスト通知を送る';

    if (r.ok) {
      const sent = r.result?.sent ?? 0;
      _toast(sent > 0 ? `送信しました（${sent}件の端末）` : '送信対象の端末がありませんでした');
      return;
    }
    const msg = {
      push_not_configured: 'サーバー側の通知設定が未完了です（VAPID 未設定）',
      no_subscription:     'この端末は通知を購読していません',
    }[r.error] || '送信に失敗しました';
    // 診断情報はコンソールに出す（時刻ずれの切り分け用）
    if (r.diag) console.warn('[push] diag:', r.diag);
    _toast(msg);
  });

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
