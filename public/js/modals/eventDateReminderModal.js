// ===== 開催日リマインドモーダル =====
// 全メンバーに表示する、開催日そのものに紐づく2つのお知らせ。
//   C. 開催初日（Day1）になったら「ついに今日から！」
//   D. 実施期間の最終日の翌日になったら「アーカイブから、イベントの振り返りをしよう！」
// 判定は render() 駆動のみ（バックグラウンドタイマー厳禁。purposeReminderModal.js と同方針）。
// 表示済みフラグは localStorage（ユーザー×イベント単位）に永続化し、1イベントにつき各1回。

import { state } from '../state.js';

function _storageKey(userId, eventId, suffix) {
  return `evecre:eventDateReminder:v1:${userId}:${eventId}:${suffix}`;
}

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// dateStr（'YYYY-MM-DD'）の翌日を返す。new Date(dateStr) の UTC 解釈ズレを避けるため
// 年月日を分解してローカル日付として計算する（calendar.js の日ごと時刻入力と同じ方式）。
function _nextDayStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * render() から呼ばれる判定エントリポイント。
 * 開催初日 or 最終日の翌日のどちらか一方に該当し、未表示なら表示する。
 */
export function checkEventDateReminderModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  // 他のモーダルと重ねない（表示できなければフラグを立てず、次回チェック時に再判定させる）
  if (document.getElementById('event-date-reminder-overlay')) return;
  if (document.getElementById('info-modal-overlay')) return;
  if (document.getElementById('purpose-reminder-overlay')) return;

  const dates = Array.isArray(p.dates) ? [...p.dates].filter(Boolean).sort() : [];
  if (dates.length === 0) return;

  const uid = state.currentUser.id;
  const today = _todayStr();
  const firstDate = dates[0];
  const dayAfterLast = _nextDayStr(dates[dates.length - 1]);

  const startKey   = _storageKey(uid, p.id, 'dayStart');
  const archiveKey = _storageKey(uid, p.id, 'archiveReminder');

  if (today === firstDate && !localStorage.getItem(startKey)) {
    localStorage.setItem(startKey, '1');
    _openDayStartModal();
    return;
  }
  if (today === dayAfterLast && !localStorage.getItem(archiveKey)) {
    localStorage.setItem(archiveKey, '1');
    _openArchiveReminderModal();
  }
}

function _buildOverlay({ bgColor, color, iconPath, title, desc, buttonsHtml }) {
  const overlay = document.createElement('div');
  overlay.id = 'event-date-reminder-overlay';
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[180] flex items-center justify-center p-6';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
      <div class="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5" style="background-color:${bgColor}">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          ${iconPath}
        </svg>
      </div>
      <h3 class="heading-m text-[#484545] mb-3 font-bold">${title}</h3>
      <p class="text-rs text-[#A7AAAC] font-medium mb-8 leading-relaxed">${desc}</p>
      ${buttonsHtml}
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function _openDayStartModal() {
  const overlay = _buildOverlay({
    bgColor: '#F0FDE8',
    color: '#9EDF05',
    iconPath: `<path d="M12 2v4"/><path d="m6.4 5.4 2.8 2.8"/><path d="M2 13h4"/><path d="m5.4 20.6 2.8-2.8"/>
      <path d="M12 22v-4"/><path d="m18.6 20.6-2.8-2.8"/><path d="M22 13h-4"/><path d="m18.6 5.4-2.8 2.8"/>
      <circle cx="12" cy="13" r="4"/>`,
    title: 'ついに今日から！',
    desc: '開催日を迎えました。準備してきたことを、当日のミッションで仕上げていきましょう。',
    buttonsHtml: `<button data-action="close" class="btn-primary w-full py-3 heading-rs font-bold">閉じる</button>`,
  });
  overlay.querySelector('[data-action="close"]').onclick = () => overlay.remove();
}

function _openArchiveReminderModal() {
  const overlay = _buildOverlay({
    bgColor: '#E8F7FD',
    color: '#0CA1E3',
    iconPath: `<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>`,
    title: 'イベントお疲れさまでした！',
    desc: 'アーカイブから、イベントの振り返りをしよう！',
    buttonsHtml: `<div class="flex gap-3">
      <button data-action="close" class="btn-secondary flex-1 py-3 heading-rs font-bold">閉じる</button>
      <button data-action="go" class="flex-1 py-3 heading-rs font-bold text-white rounded-xl shadow-md" style="background-color:#0CA1E3">アーカイブを見る</button>
    </div>`,
  });
  overlay.querySelector('[data-action="close"]').onclick = () => overlay.remove();
  overlay.querySelector('[data-action="go"]').onclick = () => {
    overlay.remove();
    state.mainBoardTab = 'ARCHIVE';
    state.render();
  };
}
