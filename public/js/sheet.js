// ===== ボトムシート 下スワイプで閉じる（共有） =====
// document レベルの委譲ハンドラ。任意のボトムシートで以下を満たせば自動で有効になる：
//   - シート本体（白いパネル）に data-sheet 属性
//   - ドラッグハンドル領域に data-sheet-handle 属性（CSS で touch-action:none を付与）
// 閉じる挙動は既定で「シートを含む .fixed オーバーレイを remove」。
// Promise を解決する等の特殊処理が要る場合は sheetEl.__sheetClose に関数をセットする。

const CLOSE_THRESHOLD = 70; // この px 以上下にドラッグしたら閉じる

let _drag = null; // { sheet, startY, dy }

function _onStart(e) {
  const handle = e.target.closest('[data-sheet-handle]');
  if (!handle) return;
  const sheet = handle.closest('[data-sheet]');
  if (!sheet) return;
  _drag = { sheet, startY: e.touches[0].clientY, dy: 0 };
  sheet.style.transition = 'none';
}

function _onMove(e) {
  if (!_drag) return;
  _drag.dy = e.touches[0].clientY - _drag.startY;
  // 下方向のみ追従（上には動かさない）
  if (_drag.dy > 0) _drag.sheet.style.transform = `translateY(${_drag.dy}px)`;
}

function _onEnd() {
  if (!_drag) return;
  const { sheet, dy } = _drag;
  _drag = null;
  sheet.style.transition = 'transform 0.25s ease';
  if (dy > CLOSE_THRESHOLD) {
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => _closeSheet(sheet), 240);
  } else {
    sheet.style.transform = 'translateY(0)';
  }
}

function _closeSheet(sheet) {
  if (typeof sheet.__sheetClose === 'function') { sheet.__sheetClose(); return; }
  const overlay = sheet.closest('.fixed') || sheet.parentElement;
  overlay?.remove();
}

let _inited = false;
export function initSheetDragClose() {
  if (_inited) return;
  _inited = true;
  document.addEventListener('touchstart', _onStart, { passive: true });
  document.addEventListener('touchmove',  _onMove,  { passive: true });
  document.addEventListener('touchend',   _onEnd,   { passive: true });
  document.addEventListener('touchcancel', _onEnd,  { passive: true });
}
