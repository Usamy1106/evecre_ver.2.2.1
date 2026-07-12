// ===== 開発者からのお知らせモーダル =====
// 全ユーザーに配信する運営告知。内容は devAnnouncement.js の DEV_ANNOUNCEMENT を編集して差し替える。
// 表示済み判定は「ユーザー×version」で localStorage に保存するため、version を更新すれば
// 既に閉じたことのあるユーザーにも再配信される。判定は render() 駆動のみ（バックグラウンドタイマー厳禁、
// purposeReminderModal.js / eventDateReminderModal.js と同方針）。

import { state } from '../state.js';
import { DEV_ANNOUNCEMENT } from '../devAnnouncement.js';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function _storageKey(userId) {
  return `evecre:devAnnouncement:seenVersion:${userId}`;
}

/**
 * render() から呼ばれる判定エントリポイント。
 * DEV_ANNOUNCEMENT.version が未読（＝localStorage の記録と異なる）なら表示する。
 */
export function checkDeveloperAnnouncementModal() {
  const { version } = DEV_ANNOUNCEMENT;
  if (!version || !state.currentUser) return;
  // イベント固有のモーダルと重ねない（表示できなければフラグを立てず、次回チェック時に再判定させる）
  if (document.getElementById('dev-announcement-overlay')) return;
  if (document.getElementById('info-modal-overlay')) return;
  if (document.getElementById('purpose-reminder-overlay')) return;
  if (document.getElementById('event-date-reminder-overlay')) return;

  const key = _storageKey(state.currentUser.id);
  if (localStorage.getItem(key) === version) return;

  localStorage.setItem(key, version);
  _openModal();
}

function _openModal() {
  const { title, body, imageUrl } = DEV_ANNOUNCEMENT;

  const overlay = document.createElement('div');
  overlay.id = 'dev-announcement-overlay';
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[180] flex items-center justify-center p-6';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm shadow-2xl animate-fadeIn overflow-hidden text-center">
      ${imageUrl ? `<img src="${_esc(imageUrl)}" class="w-full h-40 object-cover" loading="lazy">` : ''}
      <div class="p-8">
        <p class="text-[10px] text-[#0CA1E3] font-bold mb-2 tracking-wide">イベクリ開発者からのお知らせ</p>
        ${title ? `<h3 class="heading-m text-[#484545] mb-3 font-bold">${_esc(title)}</h3>` : ''}
        ${body ? `<p class="text-rs text-[#484545] font-medium mb-8 leading-relaxed whitespace-pre-wrap text-left">${_esc(body)}</p>` : '<div class="mb-8"></div>'}
        <button data-action="close" class="btn-primary w-full py-3 heading-rs font-bold">閉じる</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('[data-action="close"]').onclick = () => overlay.remove();
}
