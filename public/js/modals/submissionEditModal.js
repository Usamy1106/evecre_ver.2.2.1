// ===== 提出内容を直す（アーカイブの編集モード・管理者だけ）=====
//
// 完了フォームと同じ編集欄（clearEditor.js）に、保存済みの文章・画像・PDF を並べて直す。
// ★保存は PATCH /api/events/:id/missions/:mid/submission（サーバーも管理者だけ）。
//   振り返り・山のオブジェクト・提出者・日時は変わらない。外した画像・PDF はサーバーが R2 から消す。
// ★個別完了は userId でその人の提出物（<mid>_u_<userId>）を直す。
// ★編集欄の id（clear-input / clear-mission-modal / file-input）は完了フォームと共有している。
//   同時に存在しない前提（完了フォームはタスク詳細、これはアーカイブ）。
//   ★data-mission-id は完了フォームと別の値（edit:…）にする。同じだと選んだ画像の置き場が混ざる。

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { editorEl, readEditor, bindClearEditor, loadEditorContent, itemsForKeys, resetEditorImages } from '../clearEditor.js';
import { uploadEditorEmbeds, editorContentAndFormat, embedsPayload } from './helpers.js';

const OVERLAY_ID = 'submission-edit-overlay';

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {string} missionId
 * @param {string|null} userId  個別完了のときだけ。その人の提出物を直す
 */
export function openSubmissionEditModal(missionId, userId = null) {
  if (!state.canManageCurrentEvent()) return;
  const p = state.events.find(x => x.id === state.selectedEventId);
  const m = p?.missions?.find(x => x.id === missionId);
  if (!p || !m) return;
  const key = m.individualClear ? `${missionId}_u_${userId}` : missionId;
  const cd = p.clearedData?.[key];
  if (!cd) { window._app?.showToast('提出物が見つかりません', 'error'); return; }
  const who = userId ? (p.members || []).find(x => x.userId === userId)?.username : null;

  document.getElementById(OVERLAY_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--edit c-overlay--blur';
  const editKey = `edit:${missionId}:${userId || ''}`;
  overlay.innerHTML = `
    <div class="c-modal c-modal--left c-modal--fluid u-animate-fade p-submission-edit" role="dialog" aria-modal="true">
      <h3 class="c-modal__title c-modal__title--loose">提出内容を直す</h3>
      <p class="p-submission-edit__target">${_esc(m.title)}${who ? `（${_esc(who)} さんの提出）` : ''}</p>
      <div id="clear-mission-modal" data-mission-id="${_esc(editKey)}">
        <div class="c-editor-field">
          <div id="clear-input" class="c-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true"
            data-mission-id="${_esc(editKey)}" aria-label="提出内容" data-placeholder="提出内容"></div>
          <label for="file-input" class="c-editor-field__pick" aria-label="画像・PDF を追加">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </label>
          <input type="file" id="file-input" class="u-hidden" accept="image/*,application/pdf" multiple
            onchange="window._app.handleImageSelect(this)">
        </div>
      </div>
      <div class="c-modal__actions c-modal__actions--spaced">
        <button type="button" data-action="cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
        <button type="button" data-action="save" class="c-button c-button--primary c-modal__button">保存する</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const el = editorEl();
  loadEditorContent(el, cd);
  bindClearEditor(el, { onChange: () => {} });

  const close = () => { resetEditorImages(); overlay.remove(); };
  overlay.querySelector('[data-action="cancel"]').onclick = close;

  const saveBtn = overlay.querySelector('[data-action="save"]');
  let saving = false;
  saveBtn.onclick = async () => {
    if (saving) return;
    const read   = readEditor(el);
    const images = itemsForKeys(read.keys);
    const files  = itemsForKeys(read.fileKeys);
    if (!read.plain && images.length === 0 && files.length === 0) {
      window._app?.showToast('提出内容を空にはできません', 'error');
      return;
    }
    saving = true;
    const setBusy = (text) => {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="c-spinner__inline"><span class="c-spinner c-spinner--xs c-spinner--inverse"></span>${_esc(text)}</span>`;
    };
    const restore = () => { saveBtn.disabled = false; saveBtn.textContent = '保存する'; saving = false; };
    try {
      if (!(await uploadEditorEmbeds(p.id, missionId, images, files, setBusy, '保存する'))) { restore(); return; }
      setBusy('保存中…');
      const { content, format } = editorContentAndFormat(read, images, files);
      const r = await api.updateSubmission(p.id, missionId, {
        targetUserId: userId || undefined, content, format, ...embedsPayload(images, files),
      });
      if (!r?.ok) {
        window._app?.showToast(r?.error || '保存できませんでした。もう一度お試しください', 'error');
        restore();
        return;
      }
      // サーバーが返した提出物で手元を更新する（振り返りなどはサーバーの値のまま）
      p.clearedData = p.clearedData || {};
      p.clearedData[key] = { ...cd, ...(r.submission || {}) };
      logEvent('submission_edited', { missionId, individual: !!userId, imageCount: images.length, fileCount: files.length });
      close();
      state.render();
      window._app?.showToast('提出内容を保存しました');
    } catch (e) {
      restore();
      throw e;
    }
  };
}
