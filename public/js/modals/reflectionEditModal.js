// ===== 振り返りの編集モーダル =====
// アーカイブの完了ミッションから、あとから振り返りを書き直す。
//
// ★保存は専用エンドポイント（PATCH .../reflection）を使う。completeMission を
//   再送してはいけない。あちらは呼ぶたびに山のオブジェクトを引き直し
//   （_rollMissionObject）、完了通知と Web Push も再送する。
// ★編集できるのは「提出した本人」と「管理者」。判定の担保はサーバー側にあり、
//   ここでボタンを出す／出さないは見た目の話でしかない。
// ★字数（200字）はサーバーの _sanitizeReflection が切る。ここの maxlength は
//   入力中に気づかせるためのもので、検証の本体ではない。

import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';

const OVERLAY_ID = 'reflection-edit-overlay';
const MAX = 200;

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function openReflectionEditModal(missionId) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const m = p?.missions?.find(x => x.id === missionId);
  if (!p || !m) return;
  const cd = p.clearedData?.[missionId];
  if (!cd) return;   // 提出物が無い（差し戻された等）

  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // スタイル: public/css/object/project/_archive.css の .p-reflect-edit
  overlay.className = 'c-overlay c-overlay--center';
  overlay.innerHTML = `
    <div class="c-modal c-modal--compact u-animate-fade p-reflect-edit">
      <button type="button" data-re="close" class="c-modal__close" aria-label="閉じる">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h3 class="c-modal__heading">振り返りを書く</h3>
      <p class="p-reflect-edit__mission">${_esc(m.title)}</p>

      <label class="p-reflect-edit__label" for="re-struggle">困ったこと</label>
      <textarea id="re-struggle" maxlength="${MAX}" rows="3"
        class="c-input c-input--block p-reflect-edit__input"
        placeholder="うまくいかなかったこと、迷ったこと">${_esc(cd.struggle || '')}</textarea>

      <label class="p-reflect-edit__label" for="re-solution">どう乗り越えた？</label>
      <textarea id="re-solution" maxlength="${MAX}" rows="3"
        class="c-input c-input--block p-reflect-edit__input"
        placeholder="試したこと、助けになったこと">${_esc(cd.solution || '')}</textarea>

      <label class="p-reflect-edit__share">
        <input type="checkbox" id="re-shareable" ${cd.shareable ? 'checked' : ''}>
        <span>他の団体にも公開してよい</span>
      </label>

      <div class="p-reflect-edit__actions">
        <button type="button" data-re="cancel" class="c-button c-button--ghost">キャンセル</button>
        <button type="button" data-re="save" class="c-button c-button--primary">保存する</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('[data-re="close"]').onclick = close;
  overlay.querySelector('[data-re="cancel"]').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  const saveBtn = overlay.querySelector('[data-re="save"]');
  saveBtn.onclick = async () => {
    const struggle  = overlay.querySelector('#re-struggle').value.trim();
    const solution  = overlay.querySelector('#re-solution').value.trim();
    const shareable = overlay.querySelector('#re-shareable').checked;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    const r = await api.updateReflection(p.id, missionId, { struggle, solution, shareable });
    if (!r.ok) {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存する';
      window._app?.showToast(r.error || '保存に失敗しました', 'error');
      return;
    }

    // ★本文は送らない（行動ログに自由記述を混ぜない）。書かれたかどうかだけ数える
    logEvent('reflection_edited', {
      missionId,
      hasStruggle: !!struggle,
      hasSolution: !!solution,
      shareable,
    });

    // ★サーバーが返した正規化済みの値で手元を更新する。200字で切られるので、
    //   入力値をそのまま入れると画面とサーバーで食い違う。
    Object.assign(cd, r.reflection || { struggle, solution, shareable });
    close();
    state.render();
    window._app?.showToast('振り返りを保存しました');
  };
}
