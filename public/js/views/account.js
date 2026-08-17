// ===== アカウント設定画面 =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { Components } from '../components.js';
import { showConfirmDialog } from '../dialog.js';
import { logEvent } from '../logger.js';
import {
  getPushState, hasSubscription, enablePush, disablePush, isStandalone, isIOS, isMacDesktop,
} from '../push.js';

/**
 * アカウント設定画面
 * @param {HTMLElement} container
 */
export function renderAccount(container) {
  const u = state.currentUser || {};
  const sec = state.accountScreen || {};

  container.innerHTML = `
    <div class="p-account u-page-transition">
      <header class="l-header l-header--sub">
        <button type="button" onclick="window._app.setView('HOME')" class="l-header__back" aria-label="ホームへ戻る">
          <img src="/images/icon/iocn-Chevron.svg" class="l-header__back-icon" alt="">
        </button>
        <h1 class="l-header__heading">アカウント設定</h1>
      </header>

      <main class="p-account__main">
        ${!u.isVerified ? _verifySection(sec) : ''}

        <div class="c-settings-card p-account__card">${_avatarSection(u, sec)}</div>
        <div class="c-settings-card p-account__card">${_usernameSection(u, sec)}</div>
        <div class="c-settings-card p-account__card">${_emailSection(u, sec)}</div>
        <div class="c-settings-card p-account__card">${_passwordSection(sec)}</div>
        <div class="c-settings-card p-account__card--last">${_notificationSection()}</div>

        <button type="button" id="acc-logout" class="p-account__logout">ログアウト</button>

        ${_dangerZoneSection()}
      </main>
    </div>`;

  _bindEvents();
}

// ----- セクション: アカウント削除（退会）-----
// 取り消せない操作なので、ログアウトから距離を置いて最下部に置き、
// 押した先で必ず確認ダイアログを出す（_confirmAndDeleteAccount）。

function _dangerZoneSection() {
  return `
    <div class="p-account__danger">
      <p class="p-account__danger-title">アカウントの削除</p>
      <p class="p-account__danger-text">
        アカウントと、あなたに紐づくデータを削除します。この操作は取り消せません。
      </p>
      <button type="button" id="acc-delete" class="p-account__danger-action">
        アカウントを削除する
      </button>
    </div>`;
}

/**
 * 削除前に「何が起きるか」を具体的に示してから確認を取る。
 * 件数は state.events（自分が所属するイベント）から数える。
 */
async function _confirmAndDeleteAccount() {
  const me = state.currentUser?.id;
  const events = state.events || [];
  const soloOwned = events.filter(p => p.ownerId === me && (p.members || []).filter(m => m.userId !== me).length === 0);
  const sharedOwned = events.filter(p => p.ownerId === me && (p.members || []).filter(m => m.userId !== me).length > 0);
  const joined = events.filter(p => p.ownerId !== me);

  const lines = ['この操作は取り消せません。'];
  if (soloOwned.length)   lines.push(`・あなただけのイベント ${soloOwned.length} 件は、ミッションやチャットごと完全に削除されます`);
  if (sharedOwned.length) lines.push(`・他のメンバーがいるイベント ${sharedOwned.length} 件は残り、管理者権限は他のメンバーへ引き継がれます`);
  if (joined.length)      lines.push(`・参加中のイベント ${joined.length} 件からは退出します`);
  lines.push('・通知の設定、操作履歴、プロフィール画像も削除されます');

  const ok = await showConfirmDialog({
    title: 'アカウントを削除しますか？',
    message: lines.join('\n'),
    confirmLabel: '削除する',
    cancelLabel: 'キャンセル',
    destructive: true,
  });
  if (!ok) return;

  // 取り消せないので二段階で確認する
  const ok2 = await showConfirmDialog({
    title: '本当によろしいですか？',
    message: '削除すると元に戻せません。\n同じメールアドレスで登録し直しても、これまでのデータは復元されません。',
    confirmLabel: '完全に削除する',
    cancelLabel: 'やめる',
    destructive: true,
  });
  if (!ok2) return;

  const btn = document.getElementById('acc-delete');
  if (btn) { btn.disabled = true; btn.textContent = '削除中…'; btn.style.opacity = '0.6'; }

  try {
    const r = await api.deleteAccount();
    if (!r.ok) {
      window._app?.showToast(r.error || 'アカウントを削除できませんでした', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'アカウントを削除する'; btn.style.opacity = '1'; }
      return;
    }
    // サーバー側で Cookie は破棄済み。クライアントの状態も完全に初期化して入口へ戻す。
    state.resetAfterAccountDeleted();
  } catch (e) {
    console.error('[account] 削除失敗:', e);
    window._app?.showToast('ネットワークエラーが発生しました', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'アカウントを削除する'; btn.style.opacity = '1'; }
  }
}

// ----- セクション: 未認証バナー -----

function _verifySection(sec) {
  return `
    <div class="c-notice c-notice--warning p-account__notice">
      <p class="p-account__guide-title--plain p-account__strong">⚠ メールアドレス未認証</p>
      <p class="p-account__guide-text">
        新規プロジェクトの作成など、一部の機能はメール認証完了まで使えません。
      </p>
      <button type="button" onclick="window._app.openVerifyModal()" class="c-banner__action">認証コードを入力する</button>
    </div>`;
}

// ----- セクション: アバター画像 -----

function _avatarSection(u, sec) {
  return `
    <h2 class="c-settings-card__title">プロフィール画像</h2>
    <div class="p-account__avatar-row">
      ${Components.UserAvatar(u, { size: 72 })}
      <div class="p-account__avatar-actions">
        <!-- ★hidden は見た目のためではなく「ファイル選択を自前のボタンで代替する」ため -->
        <input id="acc-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" class="u-hidden">
        <button type="button" id="acc-avatar-pick" class="p-account__avatar-pick"
          ${sec.avatarSaving ? 'disabled' : ''}>
          ${sec.avatarSaving ? '保存中…' : '画像を選択'}
        </button>
        ${u.avatarUrl ? `
          <button type="button" id="acc-avatar-remove" class="p-account__avatar-remove"
            ${sec.avatarSaving ? 'disabled' : ''}>削除</button>
        ` : ''}
      </div>
    </div>
    ${sec.avatarError ? `<p class="c-settings-card__error">${_esc(sec.avatarError)}</p>` : ''}`;
}

// ----- セクション: ユーザー名 -----

function _usernameSection(u, sec) {
  const editing = sec.active === 'username';
  return `
    <div class="c-settings-card__row${editing ? ' is-editing' : ''}">
      <div class="c-settings-card__body">
        <p class="c-settings-card__label">ユーザー名</p>
        <p class="c-settings-card__value">${_esc(u.username || '')}</p>
      </div>
      ${!editing ? `<button type="button" id="acc-username-edit" class="c-settings-card__edit">変更</button>` : ''}
    </div>
    ${editing ? `
      <input id="acc-username-input" type="text" maxlength="20"
        class="c-input c-input--block c-settings-card__input${sec.error ? ' is-error' : ''}"
        value="${_esc(sec.newValue || '')}"
        placeholder="2〜20文字（英数字・日本語・全角OK）">
      <p class="c-settings-card__hint">英数字、日本語、全角文字、ハイフン、アンダーバー</p>
      ${sec.error ? `<p class="c-settings-card__error">${_esc(sec.error)}</p>` : ''}
      <div class="c-settings-card__actions">
        <button type="button" id="acc-username-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
        <button type="button" id="acc-username-save" class="c-settings-card__action c-settings-card__action--save">保存</button>
      </div>
    ` : ''}`;
}

// ----- セクション: メール -----

function _emailSection(u, sec) {
  const editing = sec.active === 'email';
  const step = sec.step || 'edit';
  return `
    <div class="c-settings-card__row${editing ? ' is-editing' : ''}">
      <div class="c-settings-card__body">
        <p class="c-settings-card__label">メールアドレス
          ${u.isVerified
            ? '<span class="c-settings-card__badge c-settings-card__badge--ok">✓ 認証済み</span>'
            : '<span class="c-settings-card__badge c-settings-card__badge--pending">未認証</span>'}
        </p>
        <p class="c-settings-card__value">${_esc(u.email || '')}</p>
      </div>
      ${!editing ? `<button type="button" id="acc-email-edit" class="c-settings-card__edit">変更</button>` : ''}
    </div>
    ${editing && step === 'edit' ? `
      <input id="acc-email-input" type="email"
        class="c-input c-input--block c-settings-card__input"
        value="${_esc(sec.newValue || '')}" placeholder="新しいメールアドレス">
      ${sec.errors?.email ? `<p class="c-settings-card__error">${_esc(sec.errors.email)}</p>` : ''}
      <input id="acc-email-pw" type="password"
        class="c-input c-input--block c-settings-card__input"
        value="${_esc(sec.currentPassword || '')}" placeholder="現在のパスワード">
      ${sec.errors?.password ? `<p class="c-settings-card__error">${_esc(sec.errors.password)}</p>` : ''}
      <div class="c-settings-card__actions">
        <button type="button" id="acc-email-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
        <button type="button" id="acc-email-send" class="c-settings-card__action c-settings-card__action--save">コードを送信</button>
      </div>
    ` : editing && step === 'verify' ? `
      <p class="c-settings-card__note c-settings-card__note--strong">${_esc(sec.newValue)} 宛にコードを送信しました</p>
      ${_otpInput('acc-email-code', sec.otp || '')}
      ${sec.mailError ? `<p class="c-settings-card__error">⚠ メール送信に失敗：${_esc(sec.mailError)}</p>` : ''}
      ${sec.devCode ? `<p class="c-settings-card__note">（開発用）コード: ${_esc(sec.devCode)}</p>` : ''}
      ${sec.error ? `<p class="c-settings-card__error">${_esc(sec.error)}</p>` : ''}
      <div class="c-settings-card__actions">
        <button type="button" id="acc-email-back" class="c-settings-card__action c-settings-card__action--cancel">戻る</button>
        <button type="button" id="acc-email-confirm" class="c-settings-card__action c-settings-card__action--save">確定</button>
      </div>
    ` : ''}`;
}

// ----- セクション: パスワード -----

function _passwordSection(sec) {
  const editing = sec.active === 'password';
  const step = sec.step || 'edit';
  return `
    <div class="c-settings-card__row${editing ? ' is-editing' : ''}">
      <div class="c-settings-card__body">
        <p class="c-settings-card__label">パスワード</p>
        <p class="c-settings-card__value c-settings-card__value--masked">●●●●●●●●</p>
      </div>
      ${!editing ? `<button type="button" id="acc-pw-edit" class="c-settings-card__edit">変更</button>` : ''}
    </div>
    ${editing && step === 'edit' ? `
      <input id="acc-pw-current" type="password"
        class="c-input c-input--block c-settings-card__input"
        value="${_esc(sec.currentPassword || '')}" placeholder="現在のパスワード">
      ${sec.errors?.currentPassword ? `<p class="c-settings-card__error">${_esc(sec.errors.currentPassword)}</p>` : ''}
      <input id="acc-pw-new" type="password"
        class="c-input c-input--block c-settings-card__input"
        value="${_esc(sec.newPassword || '')}" placeholder="新しいパスワード（8文字以上）">
      ${sec.errors?.newPassword ? `<p class="c-settings-card__error">${_esc(sec.errors.newPassword)}</p>` : ''}
      <div class="c-settings-card__actions">
        <button type="button" id="acc-pw-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
        <button type="button" id="acc-pw-send" class="c-settings-card__action c-settings-card__action--save">コードを送信</button>
      </div>
    ` : editing && step === 'verify' ? `
      <p class="c-settings-card__note c-settings-card__note--strong">${_esc(state.currentUser?.email || '')} 宛にコードを送信しました</p>
      ${_otpInput('acc-pw-code', sec.otp || '')}
      ${sec.mailError ? `<p class="c-settings-card__error">⚠ メール送信に失敗：${_esc(sec.mailError)}</p>` : ''}
      ${sec.devCode ? `<p class="c-settings-card__note">（開発用）コード: ${_esc(sec.devCode)}</p>` : ''}
      ${sec.error ? `<p class="c-settings-card__error">${_esc(sec.error)}</p>` : ''}
      <div class="c-settings-card__actions">
        <button type="button" id="acc-pw-back" class="c-settings-card__action c-settings-card__action--cancel">戻る</button>
        <button type="button" id="acc-pw-confirm" class="c-settings-card__action c-settings-card__action--save">確定</button>
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

  const heading = `<h2 class="p-account__section-title">通知</h2>
    <p class="p-account__section-lead">
      ミッションの割り当てや締め切り、完了のお知らせをアプリを閉じている間も受け取れます。
    </p>`;

  // iOS でブラウザのまま開いている：ホーム画面への追加を案内する（購読ボタンは出さない）
  if (st === 'ios-needs-install') {
    return `${heading}
      <div class="c-notice c-notice--info c-notice--sm">
        <p class="p-account__guide-title">ホーム画面に追加すると使えます</p>
        <ol class="p-account__guide-steps">
          <li>画面下の ⋯ の「共有」ボタンをタップ</li>
          <li>「ホーム画面に追加」を選ぶ</li>
          <li>追加されたアイコンからイベクリを開く</li>
        </ol>
        <p class="p-account__note">iPhone / iPad では Safari の仕様上、この手順が必要です。</p>
      </div>`;
  }

  if (st === 'unsupported') {
    return `${heading}
      <p class="p-account__push-state">このブラウザは通知に対応していません。</p>`;
  }

  if (st === 'denied') {
    return `${heading}
      <div class="c-notice c-notice--warning c-notice--sm">
        <p class="p-account__guide-title--plain p-account__strong">通知がブロックされています</p>
        <p class="p-account__guide-text">
          ブラウザ（または端末）の設定でこのサイトの通知を「許可」に変更してから、もう一度お試しください。
        </p>
      </div>`;
  }

  // 購読可能（granted / available）
  return `${heading}
    <div class="p-account__push-row">
      <p class="p-account__push-state${on ? ' is-on' : ''}">
        ${on ? 'この端末で通知はオンです' : 'この端末では通知はオフです'}
      </p>
      <button type="button" id="acc-push-toggle" data-log="${on ? 'push_disable_tap' : 'push_enable_tap'}"
        class="p-account__push-toggle${on ? ' is-on' : ''}">
        ${on ? 'オフにする' : '通知をオンにする'}
      </button>
    </div>
    <p class="p-account__note">通知の設定は端末ごとに保存されます。</p>
    ${on ? `
      <button type="button" id="acc-push-test" class="p-account__push-test">テスト通知を送る</button>
      <p class="p-account__note p-account__note--relaxed">
        この端末に届くか確認できます。アプリを閉じた状態でも届くかを試す場合は、
        送信後すぐにアプリを閉じてください。
      </p>` : ''}
    ${on && isMacDesktop() ? _macNotificationNotice() : ''}`;
}

// ----- Mac 向けの注意書き -----
// macOS は「ブラウザ内でサイトを許可」と「システム設定でブラウザ自体を許可」の
// 二段階が必要で、後者が無効だと送信は成功しているのに通知が一切表示されない
// （通知センターにも残らない）。実際にこれで届かない事例があったため常時表示する。
function _macNotificationNotice() {
  return `
    <div class="c-notice c-notice--warning c-notice--sm p-account__card">
      <p class="p-account__guide-title--plain p-account__strong">Mac をお使いの方へ</p>
      <p class="p-account__guide-text">
        Mac では、このアプリで通知をオンにするだけでは表示されません。
        <span class="p-account__strong">macOS 側でブラウザの通知を許可する</span>必要があります。
      </p>
      <ol class="p-account__guide-steps p-account__guide-steps--tight">
        <li>アップルメニュー →「システム設定」を開く</li>
        <li>「通知」を選ぶ</li>
        <li>お使いのブラウザ（Google Chrome、Safari など）を選ぶ</li>
        <li>「通知を許可」をオンにする</li>
      </ol>
      <p class="p-account__note p-account__note--relaxed">
        設定後に「テスト通知を送る」で届くか確認できます。
      </p>
    </div>`;
}

// ----- OTP入力欄 -----

function _otpInput(id, value) {
  return `<input id="${id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
    class="c-input c-input--block c-input--otp"
    value="${_esc(value)}" placeholder="000000" autocomplete="one-time-code">`;
}

// ----- イベント結線 -----

function _bindEvents() {
  const sec = state.accountScreen;

  document.getElementById('acc-logout')?.addEventListener('click', () => state.logout());
  document.getElementById('acc-delete')?.addEventListener('click', () => _confirmAndDeleteAccount());

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
    _syncSecFromDom({ 'acc-username-input': 'newValue' }, sec);
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
    _syncSecFromDom({ 'acc-email-input': 'newValue', 'acc-email-pw': 'currentPassword' }, sec);
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
    _syncSecFromDom({ 'acc-pw-current': 'currentPassword', 'acc-pw-new': 'newPassword' }, sec);
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
  t.className = 'c-toast u-animate-fade';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ★入力欄の値を DOM から読み取って sec に同期する（送信直前に必ず呼ぶ）。
// ブラウザのパスワード自動入力は value を入れるだけで input イベントを出さないことがあり
// （特に Safari）、リスナー任せだと「入力しているのに空扱い」になる。
// views/auth.js の _syncDraftFromDom と同じ対策。
function _syncSecFromDom(idToKey, sec) {
  for (const [id, key] of Object.entries(idToKey)) {
    const el = document.getElementById(id);
    if (el && typeof el.value === 'string') sec[key] = el.value;
  }
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * ファイルを読み込み、Canvas で 256x256 中央クロップした JPEG の data URL を返す
 */
// ★アカウント作成の STEP 5（アバター選択）からも使うため export している。
//   画像処理を二重に書かないこと（256x256 中央クロップ JPEG に統一）。
export function _processImageFile(file) {
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
