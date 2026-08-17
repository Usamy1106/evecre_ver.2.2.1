// ===== カスタム確認ダイアログ =====

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * カスタムボトムシート確認ダイアログ（confirm() の代替）
 * @param {{
 *   message: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   destructive?: boolean,
 *   title?: string
 * }} opts
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog({ message, confirmLabel = '確認', cancelLabel = 'キャンセル', destructive = false, title = '' }) {
  return new Promise((resolve) => {
    document.getElementById('confirm-dialog-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirm-dialog-overlay';
    // スタイル: public/css/object/component/_dialog.css / _overlay.css / _button.css
    overlay.className = 'c-overlay c-overlay--bottom c-overlay--dialog';
    overlay.innerHTML = `
      <div data-sheet class="c-dialog animate-fadeIn">
        <div data-sheet-handle class="c-dialog__handle"><div class="c-dialog__grip"></div></div>
        ${title ? `<h3 class="c-dialog__title">${_esc(title)}</h3>` : ''}
        <p class="c-dialog__message">${_esc(message)}</p>
        <div class="c-dialog__actions">
          <button type="button" id="cd-ok"
            class="c-button c-button--${destructive ? 'danger' : 'primary'} c-button--block">
            ${_esc(confirmLabel)}
          </button>
          ${cancelLabel ? `
          <button type="button" id="cd-cancel" class="c-button c-button--muted c-button--block">
            ${_esc(cancelLabel)}
          </button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (result) => { overlay.remove(); resolve(result); };
    // 下スワイプで閉じる（sheet.js）→ キャンセル扱い
    overlay.querySelector('[data-sheet]').__sheetClose = () => close(false);
    document.getElementById('cd-ok').onclick = () => close(true);
    document.getElementById('cd-cancel')?.addEventListener('click', () => close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  });
}

/**
 * アラートダイアログ（alert() の代替）— トースト相当のものが使えない場面用
 * @param {string} message
 * @returns {Promise<void>}
 */
export function showAlertDialog(message) {
  return showConfirmDialog({ message, confirmLabel: '閉じる', cancelLabel: '', destructive: false }).then(() => {});
}
