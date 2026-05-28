// ===== 招待コードでプロジェクト参加モーダル =====
// HOME のユーザーメニューから開かれる。
// ユーザーは招待リンク全体（http://...local/invite/<token>）または トークンだけを貼り付けられる。

import { state } from '../state.js';
import { api }   from '../api.js';

const OVERLAY_ID = 'join-by-code-modal';

export function openJoinByCodeModal() {
  if (document.getElementById(OVERLAY_ID)) return;

  const ctx = {
    input: '',
    sending: false,
    error: '',
    info: null,         // 検証成功時のプレビュー情報（projectName, ownerName）
    success: false,
  };

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6';
  overlay.onclick = (e) => { if (e.target === overlay) _close(overlay); };
  document.body.appendChild(overlay);

  _render(overlay, ctx);
}

function _render(overlay, ctx) {
  if (ctx.success) {
    overlay.innerHTML = `
      <div class="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl text-center animate-fadeIn">
        <p class="text-[40px] mb-2">🎉</p>
        <p class="text-[14px] font-bold text-[#484545]">プロジェクトに参加しました</p>
      </div>`;
    return;
  }

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-fadeIn">
      <button id="jbc-close" class="absolute top-3 right-3 p-2 opacity-40">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="heading-r text-[#484545] font-bold mb-2">プロジェクトに参加する</h2>
      <p class="text-[12px] text-[#A7AAAC] font-bold mb-4">招待コードを入力してください</p>

      ${ctx.info ? _renderConfirm(ctx) : _renderInput(ctx)}
    </div>`;

  document.getElementById('jbc-close')?.addEventListener('click', () => _close(overlay));

  if (!ctx.info) {
    const input = document.getElementById('jbc-input');
    input?.addEventListener('input', e => { ctx.input = e.target.value; });
    setTimeout(() => input?.focus(), 50);
    document.getElementById('jbc-verify')?.addEventListener('click', () => _verify(overlay, ctx));
  } else {
    document.getElementById('jbc-cancel')?.addEventListener('click', () => {
      ctx.info = null;
      ctx.error = '';
      _render(overlay, ctx);
    });
    document.getElementById('jbc-accept')?.addEventListener('click', () => _accept(overlay, ctx));
  }
}

function _renderInput(ctx) {
  return `
    <input id="jbc-input" type="text" placeholder="招待コード"
      class="input-field w-full px-4 py-3 text-[13px] font-mono focus:outline-none mb-2"
      value="${_esc(ctx.input)}"
      autocomplete="off" autocapitalize="off" spellcheck="false"
      ${ctx.sending ? 'disabled' : ''}>

    ${ctx.error ? `<p class="text-[11px] text-[#EE3E12] mb-2 font-bold">${_esc(ctx.error)}</p>` : ''}

    <button id="jbc-verify" class="w-full py-3 rounded-xl text-[14px] font-bold text-white bg-[#0CA1E3] mt-2"
      ${ctx.sending ? 'disabled style="opacity:.5"' : ''}>
      ${ctx.sending ? '確認中…' : '次へ'}
    </button>`;
}

function _renderConfirm(ctx) {
  const inv = ctx.info;
  return `
    <div class="bg-[#FDFBF8] border border-[#E1DFDC] rounded-2xl p-4 mb-4">
      <p class="text-[12px] text-[#484545] font-bold text-center leading-relaxed">
        <span class="text-[#0CA1E3]">${_esc(inv.ownerName || '')}</span>さんが<br>
        「<span class="text-[#0CA1E3]">${_esc(inv.projectName || '')}</span>」<br>
        に招待しています
      </p>
    </div>

    ${ctx.error ? `<p class="text-[11px] text-[#EE3E12] mb-2 font-bold text-center">${_esc(ctx.error)}</p>` : ''}

    <div class="flex gap-2">
      <button id="jbc-cancel" class="flex-1 py-3 rounded-xl text-[13px] font-bold text-[#484545] bg-[#EBE8E5]"
        ${ctx.sending ? 'disabled' : ''}>戻る</button>
      <button id="jbc-accept" class="flex-1 py-3 rounded-xl text-[13px] font-bold text-white bg-[#0CA1E3]"
        ${ctx.sending ? 'disabled style="opacity:.5"' : ''}>
        ${ctx.sending ? '参加中…' : '参加する'}
      </button>
    </div>`;
}

/**
 * 入力からトークンを抽出
 * - フル URL: http://.../invite/<token> → トークン部分
 * - トークン単体: そのまま
 * - 余分な空白・改行は trim
 */
function _extractToken(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  // URL の場合 /invite/<token> を抽出
  const m = s.match(/\/invite\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  // 単独トークン（英数字のみ）
  if (/^[A-Za-z0-9]+$/.test(s)) return s;
  return '';
}

async function _verify(overlay, ctx) {
  if (ctx.sending) return;
  ctx.error = '';
  const token = _extractToken(ctx.input);
  if (!token) {
    ctx.error = '招待コードを入力してください';
    _render(overlay, ctx);
    return;
  }
  ctx.sending = true;
  _render(overlay, ctx);

  try {
    const r = await api.previewInvite(token);
    if (r?.ok) {
      ctx.sending = false;
      ctx.info = r.invite;
      ctx._token = token;
      _render(overlay, ctx);
    } else {
      ctx.sending = false;
      ctx.error = _explainError(r?.error);
      _render(overlay, ctx);
    }
  } catch (e) {
    ctx.sending = false;
    ctx.error = 'ネットワークエラーが発生しました';
    _render(overlay, ctx);
  }
}

async function _accept(overlay, ctx) {
  if (ctx.sending) return;
  ctx.sending = true;
  ctx.error = '';
  _render(overlay, ctx);

  try {
    const r = await api.acceptInvite(ctx._token);
    if (r.ok && r.projectId) {
      ctx.success = true;
      _render(overlay, ctx);
      setTimeout(async () => {
        try { await state.silentReloadProjects(); } catch (_) {}
        _close(overlay);
        state.setView('MAIN_BOARD', r.projectId);
      }, 900);
    } else {
      ctx.sending = false;
      ctx.error = _explainError(r.error);
      _render(overlay, ctx);
    }
  } catch (e) {
    ctx.sending = false;
    ctx.error = 'ネットワークエラーが発生しました';
    _render(overlay, ctx);
  }
}

function _close(overlay) {
  if (overlay && overlay.parentNode) overlay.remove();
}

function _explainError(code) {
  switch (code) {
    case 'invite_not_found':  return '招待コードが見つかりません。コードが間違っているか、取り消されています';
    case 'invite_expired':    return '招待の有効期限が切れています';
    case 'invite_used_up':    return '招待の使用上限に達しています';
    case 'project_not_found': return 'プロジェクトが見つかりません';
    default: return code || '参加に失敗しました';
  }
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
