// ===== 基礎情報を公開するかの確認（アーカイブの基礎情報がそろったとき）=====
//
// タイトル・ヘッダー画像・概要・場所・期間の5つがすべて入ったら、一度だけ
// 「基礎情報だけを公開するか」を管理者に聞く。答えは p.publicBasicInfo（CRDT。true / false）。
//
// ★聞くのは**イベントごとに1回**。「まだ聞いていない」＝ publicBasicInfo が undefined。
//   答え（公開する／今はしない）をイベントに保存するので、端末を変えても出直さない
//   （localStorage にしないこと）。変えたくなったらイベント設定のスイッチで変える。
// ★出すのは**管理者権限のある人だけ**（公開を決められるのは管理者だけ。サーバーも canManage を要求）。
//   members から厳密に判定する（canManageCurrentEvent の「members 未取得なら true」に乗らない）。
// ★判定は render() 駆動のみ（バックグラウンドタイマー厳禁）。他の自動モーダルと重なったら
//   何もせずに持ち越す（次の render() で再判定）。modalGuard.js の AUTO_MODAL_IDS に登録済み。
// ★ここで公開されるのは基礎情報だけ。タスク・メンバー・チャットは含めない（公開の二層構造。
//   ナレッジの公開は別のスイッチで、開催後にだけ出す予定）。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { hasAllBasicInfo } from '../utils.js';

const OVERLAY_ID = 'public-basic-info-overlay';

function _isManagerStrict(p, userId) {
  const me = (p?.members || []).find(m => m.userId === userId);
  if (!me) return false;
  const roleIds = Array.isArray(me.roles) && me.roles.length > 0 ? me.roles : [me.role];
  return roleIds.some(id => id === 'owner' || (p.roles || []).find(r => r.id === id)?.canManage);
}

export function checkPublicBasicInfoModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const userId = state.currentUser?.id;
  if (!p || !userId) return;
  if (!['MAIN_BOARD', 'EVENT_SETTINGS'].includes(state.currentView)) return;
  if (p.publicBasicInfo !== undefined) return;          // もう答えた（公開する／今はしない）
  if (!_isManagerStrict(p, userId)) return;
  if (!hasAllBasicInfo(p)) return;
  if (document.getElementById(OVERLAY_ID)) return;
  if (isAnyAutoModalOpen(OVERLAY_ID)) return;           // 重なるなら次の render() へ持ち越す
  _open(p);
}

function _open(p) {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  // ★外側のタップでは閉じない（どちらかを選んでもらう。閉じると次の render() でまた出る）
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade" role="dialog" aria-modal="true" aria-labelledby="pbi-title">
      <div class="c-modal__icon" style="--icon-bg:#E6F4FB">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#209DDB" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>
      <h3 id="pbi-title" class="c-modal__title">このイベントを公開しますか？</h3>
      <p class="c-modal__text">
        基礎情報がそろいました。タイトル・ヘッダー画像・概要・場所・期間の5つを、イベクリの外でも見られるようにできます。<br>
        タスクやメンバーの情報は公開されません。あとからイベント設定で変更できます。
      </p>
      <div class="c-modal__actions">
        <button type="button" data-action="no" class="c-button c-button--secondary c-modal__button">今はしない</button>
        <button type="button" data-action="yes" class="c-button c-button--primary c-modal__button">公開する</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('public_basic_prompt_shown', { eventId: p.id });

  const answer = async (value) => {
    overlay.remove();
    p.publicBasicInfo = value;
    logEvent('public_basic_answered', { eventId: p.id, value });
    await state.saveNow(p.id);
    state.render();
    if (value) window._app?.showToast('基礎情報を公開しました');
  };
  overlay.querySelector('[data-action="yes"]').onclick = () => answer(true);
  overlay.querySelector('[data-action="no"]').onclick  = () => answer(false);
}
