// ===== 開発者からのお知らせモーダル =====
// 全ユーザーに配信する運営告知。内容は devAnnouncement.js の DEV_ANNOUNCEMENT を編集して差し替える。
// 表示済み判定は「ユーザー×version」で localStorage に保存するため、version を更新すれば
// 既に閉じたことのあるユーザーにも再配信される。判定は render() 駆動のみ（バックグラウンドタイマー厳禁、
// purposeReminderModal.js / eventDateReminderModal.js と同方針）。
//
// pages が複数あるときは「次へ」で切り替わり、最後のページで「閉じる」になる。
// 既読は「開いた時点」で記録するため、途中で閉じても同じ version は再表示されない。

import { state } from '../state.js';
import { DEV_ANNOUNCEMENT } from '../devAnnouncement.js';

// 画像の高さ上限。これを超える画像は縮小して全体を表示する（切り取らない）。
const IMAGE_MAX_H = '45vh';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function _storageKey(userId) {
  return `evecre:devAnnouncement:seenVersion:${userId}`;
}

/** pages 形式に正規化する（空ページは除外） */
function _getPages() {
  const pages = Array.isArray(DEV_ANNOUNCEMENT.pages) ? DEV_ANNOUNCEMENT.pages : [];
  return pages.filter(p => p && (p.title || p.body || p.imageUrl || p.action));
}

/**
 * render() から呼ばれる判定エントリポイント。
 * DEV_ANNOUNCEMENT.version が未読（＝localStorage の記録と異なる）なら表示する。
 */
export function checkDeveloperAnnouncementModal() {
  const { version } = DEV_ANNOUNCEMENT;
  if (!version || !state.currentUser) return;
  if (_getPages().length === 0) return;   // 中身が無ければ出さない
  // イベント固有のモーダルと重ねない（表示できなければフラグを立てず、次回チェック時に再判定させる）
  if (document.getElementById('dev-announcement-overlay')) return;
  if (document.getElementById('info-modal-overlay')) return;
  if (document.getElementById('purpose-reminder-overlay')) return;
  if (document.getElementById('event-date-reminder-overlay')) return;

  const key = _storageKey(state.currentUser.id);
  if (localStorage.getItem(key) === version) return;

  localStorage.setItem(key, version);
  _openModal();
}

function _openModal() {
  const pages = _getPages();

  const overlay = document.createElement('div');
  overlay.id = 'dev-announcement-overlay';
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[180] flex items-center justify-center p-5';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  _renderPage(overlay, pages, 0);
}

/**
 * 指定ページを描画する。オーバーレイは作り直さず中身だけ差し替える
 * （毎回 fadeIn させると切り替えがちらつくため）。
 */
function _renderPage(overlay, pages, index) {
  const page   = pages[index];
  const isLast = index === pages.length - 1;
  const multi  = pages.length > 1;

  // ページインジケーター（複数ページのときだけ）
  const dots = multi ? `
    <div class="flex items-center justify-center gap-1.5 mb-4">
      ${pages.map((_, i) => `
        <span class="rounded-full transition-all"
          style="width:${i === index ? 18 : 6}px;height:6px;background-color:${i === index ? '#0CA1E3' : '#D3D6D8'}"></span>
      `).join('')}
    </div>` : '';

  // 画像は上限の高さまで縮小して「全体」を見せる（object-contain）。
  // 余白が出るので下地を薄いグレーにして境界を自然にする。
  const image = page.imageUrl ? `
    <div class="bg-[#F4F1EC] flex items-center justify-center flex-shrink-0">
      <img src="${_esc(page.imageUrl)}" alt=""
        class="w-full object-contain" style="max-height:${IMAGE_MAX_H}" loading="lazy"
        onerror="this.parentElement.style.display='none'">
    </div>` : '';

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm shadow-2xl animate-fadeIn overflow-hidden flex flex-col text-center"
      style="max-height:92vh">
      ${image}
      <div class="p-6 pt-5 overflow-y-auto flex-1">
        ${page.title ? `<h3 class="heading-m text-[#484545] mb-3 font-bold">${_esc(page.title)}</h3>` : ''}
        ${page.body ? `<p class="text-rs text-[#484545] font-medium leading-relaxed whitespace-pre-wrap text-left">${_esc(page.body)}</p>` : ''}
      </div>
      <div class="px-6 pb-6 pt-1 flex-shrink-0">
        ${dots}
        ${page.action === 'push-setup' ? `
          <!-- お知らせから通知セットアップへ直接つなぐボタン。
               既存ユーザーは新しいアカウント作成フローを通らないため、
               ここが唯一の案内導線になる（devAnnouncement.js で action を指定） -->
          <button data-action="push-setup" class="btn-primary w-full py-3 heading-rs font-bold mb-2">
            ${_esc(page.actionLabel || '通知を設定する')}
          </button>` : ''}
        <button data-action="next" class="${page.action ? 'w-full py-3 rounded-xl text-[13px] font-bold text-[#484545] bg-white border border-[#E1DFDC]' : 'btn-primary w-full py-3 heading-rs font-bold'}">
          ${isLast ? '閉じる' : '次へ'}
        </button>
        ${!isLast ? `
          <button data-action="close" class="w-full pt-3 text-[12px] font-bold text-[#A7AAAC]">
            スキップ
          </button>` : ''}
      </div>
    </div>`;

  overlay.querySelector('[data-action="next"]').onclick = () => {
    if (isLast) { overlay.remove(); return; }
    _renderPage(overlay, pages, index + 1);
  };
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => overlay.remove());

  // お知らせを閉じてから通知セットアップを開く（モーダルが重ならないように）
  overlay.querySelector('[data-action="push-setup"]')?.addEventListener('click', () => {
    overlay.remove();
    setTimeout(() => window._app?.startPushSetup?.('announcement'), 250);
  });
}
