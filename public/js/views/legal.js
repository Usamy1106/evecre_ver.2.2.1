// ===== 法務ドキュメント表示画面（利用規約 / プライバシーポリシー） =====
// 本文は public/legal/*.md に置く。ここは「取ってきて描画する」だけで、
// 文面をコードに埋め込まない（改訂のたびにコードを触らないため）。
//
// 遷移：state.openLegal('terms' | 'privacy') → LEGAL ビュー
//       戻るボタンで直前のビューへ復帰（state.legalReturnView）

import { state } from '../state.js';

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
 * インライン記法（太字・リンク）を HTML にする。
 * ★必ず _esc 済みの文字列に対して呼ぶこと（HTML を先に無害化してから装飾を足す）。
 */
function _inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-[#484545]">$1</strong>')
    // リンクは http(s) と / 始まりのみ許可（javascript: 等のスキームを混入させない）
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
      '<a href="$2" class="text-[#0CA1E3] underline" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

/**
 * 最小限の Markdown → HTML 変換。
 * 対応記法は public/legal/README.md に明記したものだけ（外部ライブラリを足さない方針）。
 * @param {string} md
 * @returns {string} HTML
 */
export function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (buf.length === 0) return;
    out.push(`<p class="text-[13px] text-[#484545] leading-relaxed mb-3">${_inline(buf.join('<br>'))}</p>`);
    buf.length = 0;
  };

  let para = [];

  while (i < lines.length) {
    const raw = lines[i];
    const line = _esc(raw.trimEnd());

    // 水平線
    if (/^---+$/.test(line.trim())) {
      flushParagraph(para);
      out.push('<hr class="my-5 border-t border-[#E1DFDC]">');
      i++; continue;
    }

    // 見出し
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const lv = h[1].length;
      const cls = lv === 1 ? 'heading-l mt-2 mb-4'
                : lv === 2 ? 'heading-r mt-6 mb-2'
                :            'heading-rs mt-4 mb-2';
      out.push(`<h${lv} class="${cls} text-[#484545] font-bold">${_inline(h[2])}</h${lv}>`);
      i++; continue;
    }

    // 表：ヘッダ行の次が区切り行（|---|---|）のときだけ表として扱う
    if (line.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(_esc(lines[i + 1] || ''))) {
      flushParagraph(para);
      const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cells(_esc(lines[i].trimEnd())));
        i++;
      }
      out.push(`
        <div class="overflow-x-auto mb-4">
          <table class="w-full text-[12px] border-collapse">
            <thead><tr>${head.map(c => `<th class="border border-[#E1DFDC] bg-[#F5F3F0] px-2 py-1.5 text-left font-bold text-[#484545]">${_inline(c)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${r.map(c => `<td class="border border-[#E1DFDC] px-2 py-1.5 align-top text-[#484545]">${_inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>`);
      continue;
    }

    // 箇条書き / 番号付きリスト（連続する行をまとめて1つのリストに）
    const isUl = /^\s*[-*]\s+/.test(line);
    const isOl = /^\s*\d+\.\s+/.test(line);
    if (isUl || isOl) {
      flushParagraph(para);
      const tag = isUl ? 'ul' : 'ol';
      const re  = isUl ? /^\s*[-*]\s+/ : /^\s*\d+\.\s+/;
      const items = [];
      while (i < lines.length && re.test(_esc(lines[i]))) {
        items.push(_inline(_esc(lines[i].trimEnd()).replace(re, '')));
        i++;
      }
      const listCls = isUl ? 'list-disc' : 'list-decimal';
      out.push(`<${tag} class="${listCls} pl-5 mb-3 space-y-1 text-[13px] text-[#484545] leading-relaxed">${items.map(t => `<li>${t}</li>`).join('')}</${tag}>`);
      continue;
    }

    // 空行 → 段落の区切り
    if (line.trim() === '') { flushParagraph(para); i++; continue; }

    // 引用（> ）は注記として表示
    const q = line.match(/^&gt;\s?(.*)$/);
    if (q) {
      flushParagraph(para);
      out.push(`<p class="text-[12px] text-[#A7AAAC] leading-relaxed border-l-2 border-[#E1DFDC] pl-3 mb-3">${_inline(q[1])}</p>`);
      i++; continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);
  return out.join('\n');
}

/**
 * LEGAL ビューの描画。
 * @param {HTMLElement} container
 */
export async function renderLegal(container) {
  const slug = state.legalDoc && LEGAL_DOCS[state.legalDoc] ? state.legalDoc : 'terms';
  const doc  = LEGAL_DOCS[slug];

  const shell = (body) => `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8] page-transition">
      <header class="sticky top-0 z-10 bg-[#FDFBF8] border-b border-[#E1DFDC] px-4 py-3 flex items-center gap-2">
        <button id="legal-back" class="p-2 -ml-2" aria-label="戻る">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#484545" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <h1 class="heading-rs text-[#484545] font-bold">${_esc(doc.title)}</h1>
      </header>
      <main class="flex-1 px-5 py-5 pb-12">${body}</main>
    </div>`;

  // 取得中の表示（キャッシュがあれば一瞬で差し替わる）
  container.innerHTML = shell(
    _cache.has(slug)
      ? _cache.get(slug)
      : `<p class="text-[13px] text-[#A7AAAC] font-bold text-center py-10">読み込み中…</p>`
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
      html = `<p class="text-[13px] text-[#EE3E12] font-bold text-center py-10">
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
