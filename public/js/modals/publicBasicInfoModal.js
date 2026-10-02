// ===== 宣伝用に公開するかの確認 =====
//
// ★公開は2種類（2026-09-26 に名前を決めた）：
//   宣伝用の公開 … ヘッダー画像・タイトル・概要・期間・場所だけ。いつでも公開できる（publicBasicInfo）
//   開催後の公開 … タスクの内容・振り返りも含む。開催後だけ（publicKnowledge）
//
// ★出す条件は「概要が書かれている」こと（2026-10-02 に変更。以前は5つすべてがそろったとき）。
//   全部そろっていなくても公開できる。足りない項目（例：ヘッダー画像）はモーダルの中で伝える。
//   空の項目は空のまま公開され、あとから入れた情報もそのまま公開に反映される。
// ★公開していない限り（publicBasicInfo !== true）、**イベントを開くたびに1回**出す（2026-10-02 に変更）。
//   「今はしない」（false）と答えたイベントでも、次に開いたときにまた出す。
//   同じ訪問の中で描き直しのたびに出さないよう、state._publicBasicPromptedFor に出したイベントを覚える
//   （ホーム・フォルダ詳細へ戻ると state.setView が消す）。
// ★出すのは**管理者権限のある人だけ**（公開を決められるのは管理者だけ。サーバーも canManage を要求）。
//   members から厳密に判定する（canManageCurrentEvent の「members 未取得なら true」に乗らない）。
// ★アーカイブの編集中は出さない（欄を書き終えた瞬間に割り込むため）。「完了」で抜けたあとの render() で判定する。
// ★判定は render() 駆動のみ（バックグラウンドタイマー厳禁）。他の自動モーダルと重なったら
//   何もせずに持ち越す（次の render() で再判定）。modalGuard.js の AUTO_MODAL_IDS に登録済み。
// ★アーカイブの帯の「公開する」からは openPublicBasicInfoModal で直接開く（条件を問わない）。
// ★ここで公開されるのは基礎情報だけ。タスク・メンバー・チャットは含めない。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { basicInfoStatus, canPromptPublicBasic } from '../utils.js';

const OVERLAY_ID = 'public-basic-info-overlay';

// 組み込みのロール（lib/eventStore.js の defaultRoles と同じ）
const BUILTIN_ROLES = [
  { id: 'owner',  canManage: true },
  { id: 'admin',  canManage: true },
  { id: 'member', canManage: false },
];

// ★publicKnowledgeModal.js でも使う（管理者の厳密な判定をここ1か所に）
// ★イベントがロールの定義（p.roles）を持たない・組み込みが欠けているときは、組み込みで補う
//   （サーバーの eventStore.getRoles と同じ）。多くのイベントは roles を保存しておらず、
//   補わないと admin ロールの管理者を「管理者でない」と判定してしまう（実際にそうなっていた）
export function isManagerStrict(p, userId) {
  const me = (p?.members || []).find(m => m.userId === userId);
  if (!me) return false;
  const roleIds = Array.isArray(me.roles) && me.roles.length > 0 ? me.roles : [me.role];
  const defined = Array.isArray(p.roles) ? p.roles : [];
  const roles = [...defined, ...BUILTIN_ROLES.filter(b => !defined.some(r => r.id === b.id))];
  return roleIds.some(id => id === 'owner' || roles.find(r => r.id === id)?.canManage);
}

export function checkPublicBasicInfoModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const userId = state.currentUser?.id;
  if (!p || !userId) return;
  if (!['MAIN_BOARD', 'EVENT_SETTINGS'].includes(state.currentView)) return;
  if (p.publicBasicInfo === true) return;               // もう公開している
  if (state._publicBasicPromptedFor === p.id) return;   // この訪問ではもう出した
  if (state.archiveEditing) return;                     // 編集中は割り込まない（完了のあとに出る）
  if (!isManagerStrict(p, userId)) return;
  if (!canPromptPublicBasic(p)) return;                 // 概要がまだ無い
  if (document.getElementById(OVERLAY_ID)) return;
  if (isAnyAutoModalOpen(OVERLAY_ID)) return;           // 重なるなら次の render() へ持ち越す
  state._publicBasicPromptedFor = p.id;
  _open(p, 'auto');
}

/** アーカイブの帯の「公開する」から開く（自動表示の条件は問わない） */
export function openPublicBasicInfoModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || document.getElementById(OVERLAY_ID)) return;
  _open(p, 'archive_banner');
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _open(p, from) {
  const items = basicInfoStatus(p);
  const missing = items.filter(x => !x.ok);
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  // ★外側のタップでは閉じない（どちらかを選んでもらう）
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade" role="dialog" aria-modal="true" aria-labelledby="pbi-title">
      <div class="c-modal__icon" style="--icon-bg:#E6F4FB">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#30A23D" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>
      <h3 id="pbi-title" class="c-modal__title">このイベントを宣伝用に公開しますか？</h3>
      <p class="c-modal__text c-modal__text--tight">
        ${canPromptPublicBasic(p) ? '概要が書けたので、' : ''}下の情報をイベクリの外で宣伝に使えるように公開できます。
        タスクやメンバーの情報は公開されません。
      </p>
      <ul class="p-public-basic__list">
        ${items.map(x => `
          <li class="p-public-basic__item${x.ok ? '' : ' is-missing'}">
            <span class="p-public-basic__mark" aria-hidden="true">${x.ok ? '✓' : '−'}</span>
            <span class="p-public-basic__label">${_esc(x.label)}</span>
            <span class="p-public-basic__state">${x.ok ? '設定済み' : '未設定'}</span>
          </li>`).join('')}
      </ul>
      ${missing.length ? `
        <p class="p-public-basic__note">
          ${missing.map(x => _esc(x.label)).join('・')}がまだ設定されていません。未設定のままでも公開でき、
          あとから入れた情報も公開に反映されます。
        </p>` : ''}
      <p class="p-public-basic__note p-public-basic__note--sub">あとからイベント設定で変更できます。</p>
      <div class="c-modal__actions">
        <button type="button" data-action="no" class="c-button c-button--secondary c-modal__button">今はしない</button>
        <button type="button" data-action="yes" class="c-button c-button--primary c-modal__button">宣伝用に公開</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('public_basic_prompt_shown', { eventId: p.id, from, missing: missing.map(x => x.key) });

  const answer = async (value) => {
    overlay.remove();
    p.publicBasicInfo = value;
    logEvent('public_basic_answered', { eventId: p.id, value, from });
    await state.saveNow(p.id);
    state.render();
    if (value) window._app?.showToast('宣伝用に公開しました');
  };
  overlay.querySelector('[data-action="yes"]').onclick = () => answer(true);
  overlay.querySelector('[data-action="no"]').onclick  = () => answer(false);
}
