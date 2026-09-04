// ===== 目的リマインドモーダル =====
// 「イベントづくりで困ったら、目的という軸に立ち帰ってね」を全メンバーに表示する。
// 表示条件（いずれか）:
//   A. イベントページ立ち上げ〜開催日までの期間の1/4が経過（開催日未設定なら30日固定で代用）。
//      1イベントにつき一度きり。
//   B. 7日間ミッションの作成・完了が無い（無活発）。以後さらに7日経過するたびに再表示。
// 判定は render() 駆動のみ（バックグラウンドタイマー厳禁。CLAUDE.md「ミッション提案」節と同じ方針）。
// 表示済みフラグは localStorage（ユーザー×イベント単位）に永続化し、セッションをまたいでも
// 「表示済み」を覚えておく（他モーダルと衝突する場合は表示をスキップし、次回チェック時に再判定する）。

import { state } from '../state.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { isNewcomer } from '../onboarding.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TARGET_DAYS = 30; // 開催日未設定時の基準日数
const INACTIVITY_CYCLE_DAYS = 7;

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function _storageKey(userId, eventId, suffix) {
  return `evecre:purposeReminder:v1:${userId}:${eventId}:${suffix}`;
}

// 条件A：立ち上げ〜開催（未設定なら30日固定）の1/4を経過したか
function _isQuarterElapsed(p) {
  const created = p.createdAt;
  if (!created) return false;
  const dates = Array.isArray(p.dates) ? [...p.dates].filter(Boolean).sort() : [];
  const targetMs = dates.length > 0
    ? new Date(dates[0]).getTime()
    : created + FALLBACK_TARGET_DAYS * DAY_MS;
  const total = targetMs - created;
  if (!(total > 0)) return false; // 開催日が作成日以前など不正な場合は判定しない
  return Date.now() >= created + total / 4;
}

// 直近のミッション活動時刻（作成 or 完了のうち最新）。ミッション操作が一切無ければイベント作成時刻。
function _lastMissionActivityAt(p) {
  let last = p.createdAt || 0;
  for (const m of (p.missions || [])) {
    if (m.createdAt && m.createdAt > last) last = m.createdAt;
  }
  for (const key of Object.keys(p.clearedData || {})) {
    const ts = p.clearedData[key]?.timestamp;
    if (ts && ts > last) last = ts;
  }
  return last;
}

// 無活発サイクル数（0=7日未満、1=7〜14日、2=14〜21日...）
function _inactivityCycle(p) {
  const last = _lastMissionActivityAt(p);
  const days = (Date.now() - last) / DAY_MS;
  return Math.floor(days / INACTIVITY_CYCLE_DAYS);
}

/**
 * render() から呼ばれる判定エントリポイント。
 * 条件を満たし、他のモーダルと重ならなければ表示する。
 */
export function checkPurposeReminderModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  // 他のモーダルと重ねない（表示できなければ次回チェック時まで持ち越す＝フラグは立てない）
  // 他の自動表示モーダルが開いていたら、フラグを立てずに持ち越す（次の render() で再判定）。
  // ★列挙は modalGuard.js に集約してある。ここに個別のIDを書き足さないこと
  if (isAnyAutoModalOpen()) return;

  const uid = state.currentUser.id;

  // ★参加したばかりの人には出さない。まだ何も始めていないので「困ったら目的に
  //   立ち返ろう」が響かないうえ、歓迎（リーダーの意気込み＋🔥 → 進め方）の枠を奪う。
  //   実際に「参加直後にこれが出て、🔥と進め方が出なかった」という報告を受けた。
  //   ★フラグは立てずに戻る。参加から日が経てば通常どおり出る。
  if (isNewcomer(p, uid)) return;
  const quarterKey = _storageKey(uid, p.id, 'quarter');
  const cycleKey   = _storageKey(uid, p.id, 'inactivityCycle');

  let reason = null;
  if (!localStorage.getItem(quarterKey) && _isQuarterElapsed(p)) {
    reason = 'quarter';
  } else {
    const cycle = _inactivityCycle(p);
    if (cycle >= 1) {
      const lastShownCycle = parseInt(localStorage.getItem(cycleKey) || '0', 10);
      if (cycle > lastShownCycle) {
        reason = 'inactivity';
        localStorage.setItem(cycleKey, String(cycle));
      }
    }
  }

  if (!reason) return;
  if (reason === 'quarter') localStorage.setItem(quarterKey, '1');

  _openModal(p);
}

function _openModal(p) {
  const purposeContent = (p.clearedData?.['def-1']?.content || '').trim();
  const hasPurpose = !!purposeContent;

  const overlay = document.createElement('div');
  overlay.id = 'purpose-reminder-overlay';
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const purposeBlock = hasPurpose ? `
    <div class="c-modal__quote">
      <p class="c-modal__quote-label">このイベントの目的</p>
      <p class="c-modal__quote-text">${_esc(purposeContent)}</p>
    </div>` : '';

  const buttonsHtml = hasPurpose
    ? `<button data-action="close" class="c-button c-button--primary c-modal__button">閉じる</button>`
    : `<div class="c-modal__actions">
         <button data-action="close" class="c-button c-button--secondary c-modal__button">閉じる</button>
         <button data-action="go" class="c-modal__button c-modal__button--accent" style="--accent:#F5B600">目的を決める</button>
       </div>`;

  overlay.innerHTML = `
    <div class="c-modal u-animate-fade">
      <div class="c-modal__icon" style="--icon-bg:var(--color-warning-pale2)">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5B600" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="#F5B600"/>
        </svg>
      </div>
      <h3 class="c-modal__title c-modal__title--tight">イベントづくりで困ったら</h3>
      <p class="c-modal__text c-modal__text--tight">目的という軸に立ち帰ってね</p>
      ${purposeBlock}
      ${buttonsHtml}
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('[data-action="close"]').onclick = () => overlay.remove();
  overlay.querySelector('[data-action="go"]')?.addEventListener('click', () => {
    overlay.remove();
    const mission = (p.missions || []).find(m => m.id === 'def-1');
    if (mission) state.openMissionDetail('def-1');
  });
}
