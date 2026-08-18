// ===== 参加が承認されたことを伝えるモーダル =====
// 管理者が参加申請を承認すると、SSE の memberApproved で呼ばれる。
//
// ★以前はトーストを出してイベント一覧に増えるだけだった。承認は「待っていた側」に
//   とって一番うれしい瞬間なのに、HOME のグリッドに1枚増えるだけで気づかれず、
//   そのまま開かれないことがあった。モーダルで受け止めて、そのまま入ってもらう。
//
// ★判定は SSE 駆動（この1箇所だけ）。render() のたびに出す仕組みにはしないこと
//   （承認は一度きりの出来事で、繰り返し出す意味が無い）。

import { state } from './../state.js';
import { logEvent } from '../logger.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';

const OVERLAY_ID = 'member-approved-overlay';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * 承認おめでとうモーダルを開く。
 * @param {string} eventId  承認されたイベントの id
 */
export function openMemberApprovedModal(eventId) {
  if (document.getElementById(OVERLAY_ID)) return;
  // 他の自動表示モーダルと重なるときは出さない（次の承認まで待たず、その場で諦める）。
  // ★承認は一度きりなので持ち越さない。重なった場合はトーストで伝わっている。
  if (isAnyAutoModalOpen(OVERLAY_ID)) return;

  const p = state.events.find(x => x.id === eventId);
  const name = p?.name || 'イベント';

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // スタイル: public/css/object/component/_modal.css
  overlay.className = 'c-overlay c-overlay--auto c-overlay--center c-overlay--blur';
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade">
      <p class="c-modal__emoji">🎉</p>
      <h3 class="c-modal__title">参加が承認されました</h3>
      <p class="c-modal__text c-modal__text--tight">
        「${_esc(name)}」のメンバーになりました。<br>さっそく開いてみましょう。
      </p>
      <div class="c-modal__actions">
        <button data-approved="close" class="c-button c-button--secondary c-modal__button">閉じる</button>
        <button data-approved="open" class="c-button c-button--primary c-modal__button">イベントを開く</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('member_approved_modal_shown', { eventId });

  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector('[data-approved="close"]').onclick = () => {
    logEvent('member_approved_modal_closed', { eventId });
    close();
  };
  overlay.querySelector('[data-approved="open"]').onclick = () => {
    logEvent('member_approved_modal_opened', { eventId });
    close();
    state.setView('MAIN_BOARD', eventId);
  };
}
