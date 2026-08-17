// ===== 法務ドキュメント表示画面（利用規約 / プライバシーポリシー） =====
// 本文は public/legal/*.md に置く。ここは「取ってきて描画する」だけで、
// 文面をコードに埋め込まない（改訂のたびにコードを触らないため）。
//
// 遷移：state.openLegal('terms' | 'privacy') → LEGAL ビュー
//       戻るボタンで直前のビューへ復帰（state.legalReturnView）

import { state }    from '../state.js';
import { mdToHtml } from '../markdown.js';

// slug → { file, title }。増やすときはここと public/legal/ の両方に足す。
export const LEGAL_DOCS = {
  terms:   { file: '/legal/terms-of-service.md', title: '利用規約' },
  privacy: { file: '/legal/privacy-policy.md',   title: 'プライバシーポリシー' },
};

// 取得済み本文のキャッシュ（同じセッションで開き直しても再取得しない）
const _cache = new Map();

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * LEGAL ビューの描画。
 * @param {HTMLElement} container
 */
export async function renderLegal(container) {
  const slug = state.legalDoc && LEGAL_DOCS[state.legalDoc] ? state.legalDoc : 'terms';
  const doc  = LEGAL_DOCS[slug];

  // スタイル: public/css/object/project/_legal.css
  // ★本文（markdown.js の出力）は素のタグなので、.p-legal__body の子孫として当てる。
  const shell = (body) => `
    <div class="p-legal page-transition">
      <header class="p-legal__header">
        <button type="button" id="legal-back" class="p-legal__back" aria-label="戻る">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <h1 class="p-legal__title">${_esc(doc.title)}</h1>
      </header>
      <main class="p-legal__main p-legal__body">${body}</main>
    </div>`;

  // 取得中の表示（キャッシュがあれば一瞬で差し替わる）
  container.innerHTML = shell(
    _cache.has(slug)
      ? _cache.get(slug)
      : `<p class="p-legal__status">読み込み中…</p>`
  );
  _bindBack();

  if (!_cache.has(slug)) {
    let html;
    try {
      const res = await fetch(doc.file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = mdToHtml(await res.text());
    } catch (e) {
      console.error('[legal] 読み込み失敗:', e);
      html = `<p class="p-legal__status p-legal__status--error">
                ${_esc(doc.title)}を読み込めませんでした。<br>時間をおいて再度お試しください。
              </p>`;
    }
    _cache.set(slug, html);
    // 描画中に別画面へ移っていたら書き込まない
    if (state.currentView === 'LEGAL' && state.legalDoc === slug) {
      container.innerHTML = shell(html);
      _bindBack();
    }
  }
}

function _bindBack() {
  document.getElementById('legal-back')?.addEventListener('click', () => {
    state.closeLegal();
  });
}
