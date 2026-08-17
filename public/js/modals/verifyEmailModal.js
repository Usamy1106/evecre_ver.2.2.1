// ===== メール認証モーダル =====
// イベント画面（や HOME）から呼び出される。
// 背景は半透明 + ぼかしで現在の画面が見えるまま、前面でコード入力する。

import { state } from '../state.js';
import { api }   from '../api.js';

const OVERLAY_ID = 'verify-email-modal';

/**
 * モーダルを開く（既に開いていれば何もしない）
 */
export function openVerifyEmailModal() {
  if (document.getElementById(OVERLAY_ID)) return;
  if (state.currentUser?.isVerified) return;

  // モーダル状態
  const ctx = {
    code: '',
    sending: false,
    error: '',
    devCode: null,
    mailError: null,
    success: false,
  };

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // 背景：半透明 + backdrop-blur で背後の画面がうっすらぼやけて見える
  overlay.className = 'fixed inset-0 z-[200] bg-white/40 backdrop-blur-md flex items-center justify-center p-6';
  overlay.onclick = (e) => { if (e.target === overlay) _close(overlay); };
  document.body.appendChild(overlay);

  _render(overlay, ctx);

  // 表示と同時に最初の OTP を発行・送信
  _sendCode(overlay, ctx);
}

function _render(overlay, ctx) {
  if (ctx.success) {
    overlay.innerHTML = `
      <div class="c-modal animate-fadeIn">
        <p class="c-modal__emoji">✓</p>
        <p class="c-modal__note">認証が完了しました</p>
      </div>`;
    return;
  }

  overlay.innerHTML = `
    <div class="c-modal c-modal--compact animate-fadeIn">
      <button type="button" id="vem-close" class="c-modal__close" aria-label="閉じる">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="c-modal__heading">メール認証</h2>
      <p class="c-modal__note">
        <span class="c-modal__note-em">${_esc(state.currentUser?.email || '')}</span> 宛に
      </p>
      <p class="c-modal__note c-modal__note--muted">届いた6桁のコードを入力してください</p>

      <input id="vem-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
        class="c-input c-input--block c-input--otp"
        value="${_esc(ctx.code)}" placeholder="000000" autocomplete="one-time-code">

      ${ctx.mailError ? `<p class="c-modal__minor c-modal__minor--error">⚠ メール送信に失敗：${_esc(ctx.mailError)}</p>` : ''}
      ${ctx.devCode ? `<p class="c-modal__minor">（開発用）コード: ${_esc(ctx.devCode)}</p>` : ''}
      ${ctx.error ? `<p class="c-modal__minor c-modal__minor--error">${_esc(ctx.error)}</p>` : ''}

      <button type="button" id="vem-submit" class="c-modal__submit">
        認証する
      </button>
      <button type="button" id="vem-resend" class="c-modal__link">
        コードを再送する
      </button>
    </div>`;

  const input = document.getElementById('vem-code');
  input?.addEventListener('input', (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    e.target.value = v;
    ctx.code = v;
  });
  setTimeout(() => input?.focus(), 50);

  document.getElementById('vem-close')?.addEventListener('click', () => _close(overlay));
  document.getElementById('vem-submit')?.addEventListener('click', () => _verify(overlay, ctx));
  document.getElementById('vem-resend')?.addEventListener('click', () => _sendCode(overlay, ctx));
}

async function _sendCode(overlay, ctx) {
  if (ctx.sending) return;
  ctx.sending = true;
  try {
    const r = await api.resendVerification();
    if (r.ok) {
      ctx.devCode = r.devCode || null;
      ctx.mailError = r.mailError || null;
      ctx.error = '';
    }
  } catch (_) {}
  finally {
    ctx.sending = false;
    _render(overlay, ctx);
  }
}

async function _verify(overlay, ctx) {
  const code = (document.getElementById('vem-code')?.value || '').trim();
  if (code.length !== 6) {
    ctx.error = '6桁の数字を入力してください';
    _render(overlay, ctx);
    return;
  }
  const r = await api.verifyEmail(code);
  if (r.ok) {
    state.currentUser = r.user || { ...state.currentUser, isVerified: true };
    ctx.success = true;
    _render(overlay, ctx);
    setTimeout(async () => {
      _close(overlay);
      if (r.needsJoinConfirm && r.inviteToken) {
        // 招待リンク経由 → 参加申請確認モーダルを表示
        state.render();
        setTimeout(() => window._app?.openJoinEventModal?.(r.pendingEventName, r.inviteToken), 100);
      } else if (r.pendingEventId) {
        if (r.pendingApproval) {
          state.pendingApprovalMessage = `「${r.pendingEventName || 'イベント'}」への参加申請を送りました。管理者の承認後に参加できます。`;
        } else {
          await state._enterInvitedEvent(r.pendingEventId);
        }
        state.render();
      } else {
        state.render();
      }
    }, 900);
  } else {
    ctx.error = r.error || '認証に失敗しました';
    _render(overlay, ctx);
  }
}

function _close(overlay) {
  if (overlay && overlay.parentNode) overlay.remove();
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
