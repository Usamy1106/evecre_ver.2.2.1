// ===== タスクも含めて公開するかの確認（振り返りフェーズが終わったとき）=====
//
// フェーズが「振り返り → 完了」に進んだあと（引き継ぎ日を過ぎた自動の切り替えでも、
// イベント設定での手動の切り替えでも）、「タスクも含めて公開（開催後）」＝ publicKnowledge が
// オフなら、オンにするかを管理者に一度だけ聞く（2026-09-26）。
//
// 出す条件（すべて満たすとき）：
//   - フェーズが「完了」／publicKnowledge が true でない／まだ聞いていない（publicKnowledgePromptedAt が無い）
//   - 管理者権限がある（members から厳密に判定。publicBasicInfoModal.js の isManagerStrict）
//   - 開催日を過ぎている／公開してよい振り返りが1件以上ある
//     ★この2つはサーバーの _guardPublicKnowledge と同じ条件。満たさないと「公開する」を押しても
//       公開にならないので、そもそも聞かない（0件のときは聞かない、は 2026-09-26 に決定）
//
// ★「今はしない」は publicKnowledgePromptedAt をイベントに保存する＝このイベントではもう聞かない
//   （端末・管理者を変えても聞き直さない。localStorage にしないこと）。変えたくなったらイベント設定のスイッチで
// ★判定は render() 駆動のみ。他の自動モーダルと重なったら何もせずに持ち越す（modalGuard.js に登録済み）

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { isAfterEventDates, countPublishableReflections } from '../utils.js';
import { isManagerStrict } from './publicBasicInfoModal.js';

const OVERLAY_ID = 'public-knowledge-overlay';

export function checkPublicKnowledgeModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const userId = state.currentUser?.id;
  if (!p || !userId) return;
  if (!['MAIN_BOARD', 'EVENT_SETTINGS'].includes(state.currentView)) return;
  if (p.eventPhase !== '完了') return;
  if (p.publicKnowledge === true) return;
  if (p.publicKnowledgePromptedAt) return;             // もう聞いた（今はしない）
  if (!isManagerStrict(p, userId)) return;
  if (!isAfterEventDates(p)) return;
  const n = countPublishableReflections(p);
  if (n === 0) return;                                  // 公開できるものが無いときは聞かない
  if (document.getElementById(OVERLAY_ID)) return;
  if (isAnyAutoModalOpen(OVERLAY_ID)) return;           // 重なるなら次の render() へ持ち越す
  _open(p, n);
}

function _open(p, n) {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  // ★外側のタップでは閉じない（どちらかを選んでもらう。閉じると次の render() でまた出る）
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade" role="dialog" aria-modal="true" aria-labelledby="pk-title">
      <div class="c-modal__icon" style="--icon-bg:#E6F4FB">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#209DDB" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      </div>
      <h3 id="pk-title" class="c-modal__title">振り返りを公開しますか？</h3>
      <p class="c-modal__text">
        「他の団体にも役立ちそう」にした振り返りが${n}件あります。タスクの内容と一緒に、名前を伏せて他の団体にも公開できます。<br>
        メンバーの名前やチャットは公開されません。あとからイベント設定で変更できます。
      </p>
      <div class="c-modal__actions">
        <button type="button" data-action="no" class="c-button c-button--secondary c-modal__button">今はしない</button>
        <button type="button" data-action="yes" class="c-button c-button--primary c-modal__button">公開する</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('public_knowledge_prompt_shown', { eventId: p.id, count: n });

  const answer = async (value) => {
    overlay.remove();
    logEvent('public_knowledge_answered', { eventId: p.id, value });
    p.publicKnowledgePromptedAt = Date.now();
    if (value) p.publicKnowledge = true;
    await state.saveNow(p.id);
    if (value) {
      // ★サーバーが条件を満たさないと判断したら公開にならない。取り直して本当の値を出す（イベント設定のスイッチと同じ）
      await state.silentReloadEvents?.();
      const now = state.events.find(x => x.id === p.id);
      window._app?.showToast(now?.publicKnowledge === true ? 'タスクも含めて公開しました' : '公開できませんでした');
    }
    state.render();
  };
  overlay.querySelector('[data-action="yes"]').onclick = () => answer(true);
  overlay.querySelector('[data-action="no"]').onclick  = () => answer(false);
}
