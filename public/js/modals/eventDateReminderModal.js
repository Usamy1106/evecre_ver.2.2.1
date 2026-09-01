// ===== 開催日リマインドモーダル =====
// 全メンバーに表示する、開催日そのものに紐づく2つのお知らせ。
//   C. 開催初日（Day1）になったら「ついに今日から！」
//   D. 実施期間の最終日の翌日になったら「アーカイブから、イベントの振り返りをしよう！」
// 判定は render() 駆動のみ（バックグラウンドタイマー厳禁。purposeReminderModal.js と同方針）。
// 表示済みフラグは localStorage（ユーザー×イベント単位）に永続化し、1イベントにつき各1回。

import { state } from '../state.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { todayStr } from '../utils.js';

function _storageKey(userId, eventId, suffix) {
  return `evecre:eventDateReminder:v1:${userId}:${eventId}:${suffix}`;
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
  // 他の自動表示モーダルが開いていたら、フラグを立てずに持ち越す（次の render() で再判定）。
  // ★列挙は modalGuard.js に集約してある。ここに個別のIDを書き足さないこと
  if (isAnyAutoModalOpen()) return;

  const dates = Array.isArray(p.dates) ? [...p.dates].filter(Boolean).sort() : [];
  if (dates.length === 0) return;

  const uid = state.currentUser.id;
  const today = todayStr();
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
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade">
      <div class="c-modal__icon" style="--icon-bg:${bgColor}">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          ${iconPath}
        </svg>
      </div>
      <h3 class="c-modal__title">${title}</h3>
      <p class="c-modal__text">${desc}</p>
      ${buttonsHtml}
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function _openDayStartModal() {
  const overlay = _buildOverlay({
    bgColor: '#ECF9F2',
    color: '#28AB3D',
    iconPath: `<path d="M12 2v4"/><path d="m6.4 5.4 2.8 2.8"/><path d="M2 13h4"/><path d="m5.4 20.6 2.8-2.8"/>
      <path d="M12 22v-4"/><path d="m18.6 20.6-2.8-2.8"/><path d="M22 13h-4"/><path d="m18.6 5.4-2.8 2.8"/>
      <circle cx="12" cy="13" r="4"/>`,
    title: 'ついに今日から！',
    desc: '開催日を迎えました。準備してきたことを、当日のミッションで仕上げていきましょう。',
    buttonsHtml: `<button data-action="close" class="c-button c-button--primary c-modal__button">閉じる</button>`,
  });
  overlay.querySelector('[data-action="close"]').onclick = () => overlay.remove();
}

function _openArchiveReminderModal() {
  const overlay = _buildOverlay({
    bgColor: '#E8F7FD',
    color: '#209DDB',
    iconPath: `<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>`,
    title: 'イベントお疲れさまでした！',
    desc: 'アーカイブから、イベントの振り返りをしよう！',
    buttonsHtml: `<div class="c-modal__actions">
      <button data-action="close" class="c-button c-button--secondary c-modal__button">閉じる</button>
      <button data-action="go" class="c-modal__button c-modal__button--accent" style="--accent:#209DDB">アーカイブを見る</button>
    </div>`,
  });
  overlay.querySelector('[data-action="close"]').onclick = () => overlay.remove();
  overlay.querySelector('[data-action="go"]').onclick = () => {
    overlay.remove();
    state.mainBoardTab = 'ARCHIVE';
    state.render();
  };
}
