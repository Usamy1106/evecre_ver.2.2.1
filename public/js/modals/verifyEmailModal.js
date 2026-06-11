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
      <div class="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl text-center animate-fadeIn">
        <p class="text-[40px] mb-2">✓</p>
        <p class="text-[14px] font-bold text-[#484545]">認証が完了しました</p>
      </div>`;
    return;
  }

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-fadeIn">
      <button id="vem-close" class="absolute top-3 right-3 p-2 opacity-40">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="heading-r text-[#484545] font-bold mb-2">メール認証</h2>
      <p class="text-[12px] text-[#484545] font-bold mb-1">
        <span class="text-[#0CA1E3]">${_esc(state.currentUser?.email || '')}</span> 宛に
      </p>
      <p class="text-[12px] text-[#A7AAAC] font-bold mb-4">届いた6桁のコードを入力してください</p>

      <input id="vem-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
        class="input-field w-full px-4 py-3 text-center text-[20px] tracking-[0.5em] font-bold focus:outline-none mb-2"
        value="${_esc(ctx.code)}" placeholder="000000" autocomplete="one-time-code">

      ${ctx.mailError ? `<p class="text-[11px] text-[#EE3E12] mb-2 font-bold">⚠ メール送信に失敗：${_esc(ctx.mailError)}</p>` : ''}
      ${ctx.devCode ? `<p class="text-[11px] text-[#A7AAAC] mb-2 font-bold">（開発用）コード: ${_esc(ctx.devCode)}</p>` : ''}
      ${ctx.error ? `<p class="text-[11px] text-[#EE3E12] mb-2 font-bold">${_esc(ctx.error)}</p>` : ''}

      <button id="vem-submit" class="w-full py-3 rounded-xl text-[14px] font-bold text-white bg-[#0CA1E3] mb-2">
        認証する
      </button>
      <button id="vem-resend" class="w-full py-2 text-[12px] font-bold text-[#0CA1E3]">
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
