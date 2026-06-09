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
  overlay.className = 'fixed inset-0 z-[200] bg-white/40 backdrop-blur-md flex items-center justify-center p-6';
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
      <div class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl text-center animate-fadeIn">
        <p class="text-[14px] font-bold text-[#484545]">招待リンクを発行中…</p>
      </div>`;
    return;
  }

  if (ctx.error) {
    overlay.innerHTML = `
      <div class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-fadeIn">
        <p class="text-[14px] font-bold text-[#EE3E12] mb-3 text-center">${_esc(ctx.error)}</p>
        <button id="iim-close" class="w-full py-3 rounded-xl text-[14px] font-bold text-[#484545] bg-[#EBE8E5]">閉じる</button>
      </div>`;
    document.getElementById('iim-close')?.addEventListener('click', () => _close(overlay));
    return;
  }

  const url = ctx.inviteUrl;
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-fadeIn">
      <button id="iim-close" class="absolute top-3 right-3 p-2 opacity-40">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="heading-r text-[#484545] font-bold mb-2 text-center">チームメンバーを招待</h2>
      <p class="text-[12px] text-[#A7AAAC] font-bold text-center mb-4 leading-relaxed">
        下のリンクを送って<br>メンバーに参加してもらいましょう
      </p>

      <div class="bg-[#FDFBF8] border border-[#E1DFDC] p-3 rounded-xl mb-4">
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-1.5 text-center">招待リンク</p>
        <p class="text-[10px] font-mono text-[#484545] text-center break-all">${_esc(url)}</p>
      </div>

      <div class="space-y-2">
        <button id="iim-line"
          class="w-full flex items-center justify-center gap-2 bg-[#06C755] text-white py-3 rounded-full font-bold text-[14px] active:scale-95 transition-transform">
          LINE で送る
        </button>
        <div class="grid grid-cols-2 gap-2">
          <button id="iim-share"
            class="bg-[#0CA1E3] text-white py-2.5 rounded-full font-bold text-[12px] active:scale-95 transition-transform">
            他のアプリで共有
          </button>
          <button id="iim-copy"
            class="bg-white border border-[#0CA1E3] text-[#0CA1E3] py-2.5 rounded-full font-bold text-[12px] active:scale-95 transition-transform">
            コピー
          </button>
        </div>
        <button id="iim-skip"
          class="w-full py-3 mt-2 text-[12px] font-bold text-[#A7AAAC]">
          後で招待する
        </button>
      </div>
    </div>`;

  document.getElementById('iim-close')?.addEventListener('click', () => _close(overlay));
  document.getElementById('iim-skip')?.addEventListener('click', () => _close(overlay));
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
  t.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#484545] text-white px-5 py-3 rounded-full shadow-2xl text-[13px] font-bold z-[300]';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
