// ===== 招待発行モーダル =====
// イベント作成直後 or イベント画面から呼び出される。
// 半透明＋ぼかし背景でメインボードがうっすら見えるまま、招待リンクを発行・共有できる。

import { state } from '../state.js';
import { api }   from '../api.js';

const OVERLAY_ID = 'invite-issue-modal';

/**
 * モーダルを開く。指定された projectId のイベントに対して招待リンクを表示する。
 * 既存リンクがあればそれを表示、無ければ新規発行する。
 * @param {string} projectId
 */
export function openInviteIssueModal(projectId) {
  if (document.getElementById(OVERLAY_ID)) return;

  const ctx = {
    projectId,
    issuing: true,
    inviteUrl: null,
    error: null,
  };

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--frosted';
  overlay.onclick = (e) => { if (e.target === overlay) _close(overlay); };
  document.body.appendChild(overlay);

  _render(overlay, ctx);
  _loadOrIssueInvite(overlay, ctx);
}

/**
 * 既存の有効な招待リンクがあれば再利用、無ければ新規発行
 */
async function _loadOrIssueInvite(overlay, ctx) {
  try {
    // 1. 既存リンクを取得
    const list = await api.listInvites(ctx.projectId);
    if (list?.ok && Array.isArray(list.invites)) {
      const now = Date.now();
      // 期限切れでない・使用上限に達していないリンクを優先
      const valid = list.invites.find(inv => {
        if (inv.expiresAt && inv.expiresAt < now) return false;
        if (inv.maxUses && (inv.usedBy?.length || 0) >= inv.maxUses) return false;
        return true;
      });
      if (valid?.token) {
        ctx.inviteUrl = `${location.origin}/invite/${valid.token}`;
        ctx.issuing = false;
        ctx.reused = true;
        _render(overlay, ctx);
        return;
      }
    }
    // 2. 既存リンクが無い → 新規発行
    await _issueInvite(overlay, ctx);
  } catch (e) {
    console.error('invite load/issue error:', e);
    // 失敗してもとにかく新規発行を試みる
    await _issueInvite(overlay, ctx);
  }
}

async function _issueInvite(overlay, ctx) {
  try {
    const r = await api.createInvite(ctx.projectId);
    if (r.ok && r.invite?.token) {
      ctx.inviteUrl = `${location.origin}/invite/${r.invite.token}`;
      ctx.issuing = false;
      _render(overlay, ctx);
    } else {
      ctx.issuing = false;
      ctx.error = '招待リンクの発行に失敗しました';
      _render(overlay, ctx);
    }
  } catch (e) {
    console.error('invite issue error:', e);
    ctx.issuing = false;
    ctx.error = 'ネットワークエラーが発生しました';
    _render(overlay, ctx);
  }
}

function _render(overlay, ctx) {
  if (ctx.issuing) {
    overlay.innerHTML = `
      <div class="c-modal u-animate-fade">
        <p class="c-modal__note">招待リンクを発行中…</p>
      </div>`;
    return;
  }

  if (ctx.error) {
    overlay.innerHTML = `
      <div class="c-modal c-modal--compact u-animate-fade">
        <p class="p-invite__error">${_esc(ctx.error)}</p>
        <button type="button" id="iim-close" class="p-invite__close">閉じる</button>
      </div>`;
    document.getElementById('iim-close')?.addEventListener('click', () => _close(overlay));
    return;
  }

  const url = ctx.inviteUrl;
  overlay.innerHTML = `
    <div class="c-modal c-modal--compact u-animate-fade">
      <button type="button" id="iim-close" class="c-modal__close" aria-label="閉じる">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="c-modal__heading c-modal__heading--center">チームメンバーを招待</h2>
      <p class="p-invite__lead">
        下のリンクを送って<br>メンバーに参加してもらいましょう
      </p>

      <div class="p-invite__link-box">
        <p class="p-invite__link-label">招待リンク</p>
        <p class="p-invite__link-url">${_esc(url)}</p>
      </div>

      <div class="p-invite__share">
        <button type="button" id="iim-copy"
            class="p-invite__share-button p-invite__share-button--sm p-invite__share-button--copy">
            コピー
          </button>
        <div class="p-invite__share-row">
          <button type="button" id="iim-share"
            class="p-invite__share-button p-invite__share-button--sm p-invite__share-button--native">
            他のアプリで共有
          </button>
          <button type="button" id="iim-line"
          class="p-invite__share-button p-invite__share-button--line">
          LINE で送る
        </button>
        </div>
      </div>
    </div>`;

  document.getElementById('iim-close')?.addEventListener('click', () => _close(overlay));
  document.getElementById('iim-line')?.addEventListener('click', () => _shareToLine(url));
  document.getElementById('iim-share')?.addEventListener('click', () => _nativeShare(url));
  document.getElementById('iim-copy')?.addEventListener('click', () => _copyText(url));
}

function _close(overlay) {
  if (overlay && overlay.parentNode) overlay.remove();
}

function _buildInviteText(url) {
  const project = state.events.find(p => p.id === state.selectedEventId);
  const projectName = project?.name || 'イベント';
  const userName = state.currentUser?.username || '';
  return userName
    ? `${userName}が「${projectName}」に招待しています。\n${url}`
    : `「${projectName}」に招待しています。\n${url}`;
}

function _shareToLine(url) {
  const text = _buildInviteText(url);
  const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  window.open(lineUrl, '_blank', 'noopener,noreferrer');
}

function _nativeShare(url) {
  const text = _buildInviteText(url);
  const data = { title: 'イベントへの招待', text, url };
  if (navigator.share && navigator.canShare?.(data)) {
    navigator.share(data).catch(err => { if (err.name !== 'AbortError') _copyText(text); });
  } else {
    _copyText(text);
  }
}

function _copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => _toast('コピーしました'),
      () => _fallbackCopy(text)
    );
  } else {
    _fallbackCopy(text);
  }
}

function _fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); _toast('コピーしました'); } catch (_) {}
  ta.remove();
}

function _toast(msg) {
  const t = document.createElement('div');
  t.className = 'c-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
