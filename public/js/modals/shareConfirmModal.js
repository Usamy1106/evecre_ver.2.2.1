// ===== 「他の団体にも公開してよい」の初回確認（イベントごとに1回）=====
//
// 振り返りの「他の団体にも公開してよい」に、このイベントで**初めて**チェックが入ったときだけ確認する。
// ★「いいえ」ならチェックを外す（2026-09-26 に決定。本人の意思と保存内容を一致させる）。
// ★確認を済ませた印はイベントに持たせる（p.shareConfirmedAt。サーバーが振り返りの保存時に立てる）。
//   localStorage にしないこと（端末を変えると、同じイベントでまた聞かれる）。
// ★ここで公開されるわけではない。shareable は「公開候補」。実際に外へ出るのは、管理者が
//   開催後にイベント設定で「ナレッジを公開」をオンにしたときだけ（lib/publicData.js）。
//
// 呼び出し箇所（3つ。片方だけ直さないこと）：
//   views/missionReflect.js（完了後の振り返り）／ modals/reflectionEditModal.js ／ archiveInlineEdit.js

import { logEvent } from '../logger.js';

const OVERLAY_ID = 'share-confirm-overlay';

/**
 * 必要なら確認を出し、公開してよいなら true を返す。
 * @param {object} p  イベント（flat）
 * @returns {Promise<boolean>}
 */
export function confirmFirstShare(p) {
  if (!p || p.shareConfirmedAt) return Promise.resolve(true);
  document.getElementById(OVERLAY_ID)?.remove();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--share';
    overlay.innerHTML = `
      <div class="c-modal u-animate-fade" role="dialog" aria-modal="true" aria-labelledby="share-confirm-title">
        <div class="c-modal__icon" style="--icon-bg:#E6F4FB">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#209DDB" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        </div>
        <h3 id="share-confirm-title" class="c-modal__title">このイベントの振り返りを、他の団体にも公開してよいですか？</h3>
        <p class="c-modal__text">
          チェックした振り返りと、そのタスクの内容が公開の候補になります。名前やチャットは公開されません。<br>
          実際に公開されるのは、開催後に管理者が「ナレッジを公開」をオンにしたときだけです。
        </p>
        <div class="c-modal__actions">
          <button type="button" data-action="no" class="c-button c-button--secondary c-modal__button">いいえ</button>
          <button type="button" data-action="yes" class="c-button c-button--primary c-modal__button">公開してよい</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    logEvent('share_confirm_shown', { eventId: p.id });
    const done = (value) => {
      overlay.remove();
      logEvent('share_confirm_answered', { eventId: p.id, value });
      resolve(value);
    };
    overlay.querySelector('[data-action="yes"]').onclick = () => done(true);
    overlay.querySelector('[data-action="no"]').onclick  = () => done(false);
    // ★外側のタップは「いいえ」扱い（黙って公開候補にしない）
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
  });
}

/** サーバーが返した確認済みの時刻を手元に反映する（以後、このイベントでは聞かない） */
export function applyShareConfirmed(p, r) {
  if (p && r?.shareConfirmedAt) p.shareConfirmedAt = r.shareConfirmedAt;
}
