// ===== 招待リンクでイベント参加モーダル =====
// HOME のユーザーメニューから開かれる。
// ユーザーは招待リンク全体（http://...local/invite/<token>）または トークンだけを貼り付けられる。

import { state } from '../state.js';
import { api }   from '../api.js';
import { motivationBlockHtml, inviteMembersHtml } from '../views/auth.js';
import { openJoinFormModal } from './joinFormModal.js';

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
    // ★既にメンバーだった場合に「承認されるまでお待ちください」と出るのは誤り。
    //   ctx._pending を見て文言を出し分ける（以前は success だけで判定していた）。
    overlay.innerHTML = `
      <div class="c-modal u-animate-fade">
        <p class="c-modal__note">${
          ctx._pending
            ? '送信しました。<br>承認されるまでお待ちください。'
            : 'すでに参加しています。<br>イベントを開きます。'
        }</p>
      </div>`;
    return;
  }

  overlay.innerHTML = `
    <div class="c-modal c-modal--compact u-animate-fade">
      <button type="button" id="jbc-close" class="c-modal__close" aria-label="閉じる">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="c-modal__heading">イベントに参加する</h2>
      <p class="c-modal__note c-modal__note--muted">招待リンクを入力してください</p>

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
    // ★🔥はここには置かない。参加が承認されてイベントページに入った直後に
    //   modals/leaderMotivationModal.js が出す（申請時点ではまだ仲間ではないため）。
    document.getElementById('jbc-accept')?.addEventListener('click', () => _accept(overlay, ctx));
  }
}

function _renderInput(ctx) {
  return `
    <input id="jbc-input" type="text" placeholder="https://evecre..."
      class="c-input p-invite__code-input"
      value="${_esc(ctx.input)}"
      autocomplete="off" autocapitalize="off" spellcheck="false"
      ${ctx.sending ? 'disabled' : ''}>

    ${ctx.error ? `<p class="c-modal__minor c-modal__minor--error">${_esc(ctx.error)}</p>` : ''}

    <button type="button" id="jbc-verify" class="p-invite__submit"
      ${ctx.sending ? 'disabled' : ''}>
      ${ctx.sending ? '確認中…' : '次へ'}
    </button>`;
}

function _renderConfirm(ctx) {
  const inv = ctx.info;
  return `
    <div class="p-invite__preview">
      ${inv.catchphrase ? `
        <p class="p-invite__preview-catchphrase">${_esc(inv.catchphrase)}</p>
      ` : ''}
      <p class="p-invite__preview-text">
        <span class="p-invite__preview-em">${_esc(inv.ownerName || '')}</span>さんが<br>
        <!-- ★API が返すキーは eventName。projectName だけを見ていて名前が空だった -->
        「<span class="p-invite__preview-em">${_esc(inv.eventName || inv.projectName || '')}</span>」<br>
        に招待しています
      </p>
      ${inviteMembersHtml(inv)}
      ${motivationBlockHtml(inv)}
    </div>

    ${ctx.error ? `<p class="p-invite__error">${_esc(ctx.error)}</p>` : ''}

    <div class="p-invite__actions">
      <button type="button" id="jbc-cancel" class="p-invite__action p-invite__action--cancel"
        ${ctx.sending ? 'disabled' : ''}>戻る</button>
      <!-- 押すと参加申請フォームへ。accept はフォーム側が呼ぶ -->
      <button type="button" id="jbc-accept" class="p-invite__action p-invite__action--primary"
        ${ctx.sending ? 'disabled' : ''}>次へ</button>
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
    ctx.error = '招待リンクを入力してください';
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

/**
 * 「参加申請する」→ 参加申請フォームへ。
 * ★ここでは accept を呼ばない。入口A（招待リンク）と同じフォームを通し、
 *   フォームの送信ボタンが accept する（片方だけ通すとデータが欠けるため）。
 */
function _accept(overlay, ctx) {
  if (ctx.sending) return;
  _close(overlay);
  openJoinFormModal({
    invite: ctx.info,
    token:  ctx._token,
    entry:  'code',
    onDone: async (r) => {
      // 送信結果を伝えるため、このモーダルを結果表示だけで開き直す
      const done = document.createElement('div');
      done.id = OVERLAY_ID;
      done.className = 'fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6';
      document.body.appendChild(done);
      const dctx = { ...ctx, success: true, _pending: !!r.pending, _eventName: r.eventName || '', _eventId: r.eventId };
      _render(done, dctx);
      setTimeout(async () => {
        if (dctx._pending) {
          state.pendingApprovalMessage =
            `「${dctx._eventName || 'イベント'}」への参加申請を送信しました。管理者の承認後に参加できます。`;
          // ★承認待ちの時間を空白にしない（M0）。確認画面で取得済みのプレビューを渡す
          state.pendingApprovalInvite = ctx.info || null;
          _close(done);
          state.setView('HOME');
        } else {
          // 既にメンバー → MAIN_BOARD へ直接遷移
          try { await state.silentReloadEvents(); } catch (_) {}
          _close(done);
          state.setView('MAIN_BOARD', dctx._eventId);
        }
      }, 900);
    },
  });
}

function _close(overlay) {
  if (overlay && overlay.parentNode) overlay.remove();
}

function _explainError(code) {
  switch (code) {
    case 'invite_not_found':  return '招待リンクが見つかりません。コードが間違っているか、取り消されています';
    case 'invite_expired':    return '招待の有効期限が切れています';
    case 'invite_used_up':    return '招待の使用上限に達しています';
    case 'project_not_found': return 'イベントが見つかりません';
    default: return code || '参加に失敗しました';
  }
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
