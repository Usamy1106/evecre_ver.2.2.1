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
    overlay.className = 'fixed inset-0 bg-black/50 z-[300] flex items-end justify-center';
    overlay.innerHTML = `
      <div data-sheet class="bg-white rounded-t-3xl w-full max-w-lg px-6 pt-5 pb-10 animate-fadeIn">
        <div data-sheet-handle class="flex justify-center pt-1 pb-4 -mt-2"><div class="w-10 h-1 bg-[#D3D6D8] rounded-full"></div></div>
        ${title ? `<h3 class="text-[15px] font-bold text-[#484545] text-center mb-2">${_esc(title)}</h3>` : ''}
        <p class="text-[13px] text-[#484545] text-center leading-relaxed mb-6 whitespace-pre-wrap">${_esc(message)}</p>
        <div class="flex flex-col gap-3">
          <button id="cd-ok"
            class="w-full py-4 rounded-2xl font-bold text-[14px] active:opacity-80
              ${destructive ? 'bg-[#EE3E12] text-white' : 'bg-[#0CA1E3] text-white'}">
            ${_esc(confirmLabel)}
          </button>
          ${cancelLabel ? `
          <button id="cd-cancel"
            class="w-full py-4 rounded-2xl font-bold text-[14px] text-[#484545] bg-[#EBE8E5] active:opacity-80">
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
