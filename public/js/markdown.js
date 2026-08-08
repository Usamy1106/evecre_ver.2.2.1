// ===== 最小限の Markdown → HTML 変換 =====
// 用途は public/legal/*.md（利用規約・プライバシーポリシー）の描画のみ。
// 外部ライブラリを足さない方針のため自前で持つ。対応記法は public/legal/README.md に明記。
//
// ★依存なしの単独モジュールにしてある（他モジュールを import しない）。
//   テストしやすくするためと、views 以外からも使えるようにするため。
//
// 設計上の要点：
//  - 先に全行を HTML エスケープし、その後で装飾タグを足す（XSS 対策の順序を固定する）
//  - リストはインデントで入れ子を判定する。これをしないと
//    「1. 2. → 入れ子の箇条書き → 3. 4.」が別リスト扱いになり番号が振り直される
//    （規約の条文で実際に起きるため必須）

const ITEM_RE = /^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * インライン記法（太字・リンク）。必ずエスケープ済みの文字列に対して呼ぶ。
 */
function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-[#484545]">$1</strong>')
    // リンクは http(s) と / 始まりのみ許可（javascript: 等のスキームを混入させない）
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
      '<a href="$2" class="text-[#0CA1E3] underline" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

/**
 * リストを1つ分（入れ子を含めて）読み取る。
 * @param {string[]} lines エスケープ済みの行配列
 * @param {number} start   リスト先頭行の位置
 * @returns {[string, number]} [HTML, 次に読むべき行番号]
 */
function parseList(lines, start) {
  const first = lines[start].match(ITEM_RE);
  const baseIndent = first[1].length;
  const ordered    = first[2] !== undefined;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(ITEM_RE);
    if (!m) break;
    const indent = m[1].length;

    // 浅くなったら親のリストへ戻る
    if (indent < baseIndent) break;

    // 深くなったら入れ子リストとして直前の項目にぶら下げる
    if (indent > baseIndent) {
      const [html, next] = parseList(lines, i);
      if (items.length > 0) items[items.length - 1] += html;
      else                  items.push(html);
      i = next;
      continue;
    }

    // 同じ深さで種類が変わったら別のリストとして切る
    if ((m[2] !== undefined) !== ordered) break;

    items.push(inline(m[3]));
    i++;
  }

  const tag = ordered ? 'ol' : 'ul';
  const cls = ordered ? 'list-decimal' : 'list-disc';
  const html = `<${tag} class="${cls} pl-5 mb-3 space-y-1 text-[13px] text-[#484545] leading-relaxed">`
    + items.map(t => `<li>${t}</li>`).join('')
    + `</${tag}>`;
  return [html, i];
}

/**
 * Markdown を HTML にする。
 * @param {string} md
 * @returns {string}
 */
export function mdToHtml(md) {
  // ★先に全行エスケープしておく（以降の処理は装飾を足すだけ）。
  //   エスケープが触るのは & < > " のみで、# - | 数字 などの記法文字には影響しない。
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n').map(esc);
  const out = [];
  const para = [];
  let i = 0;

  const flush = () => {
    if (para.length === 0) return;
    out.push(`<p class="text-[13px] text-[#484545] leading-relaxed mb-3">${inline(para.join('<br>'))}</p>`);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // 空行 → 段落の区切り
    if (line.trim() === '') { flush(); i++; continue; }

    // 水平線
    if (/^-{3,}$/.test(line.trim())) {
      flush();
      out.push('<hr class="my-6 border-t border-[#E1DFDC]">');
      i++; continue;
    }

    // 見出し
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      const lv  = h[1].length;
      const cls = lv === 1 ? 'heading-l mt-1 mb-4'
                : lv === 2 ? 'heading-r mt-7 mb-2'
                :            'heading-rs mt-5 mb-2';
      out.push(`<h${lv} class="${cls} text-[#484545] font-bold">${inline(h[2])}</h${lv}>`);
      i++; continue;
    }

    // 表（ヘッダ行の次が区切り行 |---|---| のときだけ表として扱う）
    if (line.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test((lines[i + 1] || ''))) {
      flush();
      const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cells(lines[i].trimEnd()));
        i++;
      }
      out.push(
        '<div class="overflow-x-auto mb-4">'
        + '<table class="w-full text-[12px] border-collapse">'
        + '<thead><tr>'
        + head.map(c => `<th class="border border-[#E1DFDC] bg-[#F5F3F0] px-2 py-1.5 text-left font-bold text-[#484545] whitespace-nowrap">${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map(r => `<tr>${r.map(c => `<td class="border border-[#E1DFDC] px-2 py-1.5 align-top text-[#484545]">${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>',
      );
      continue;
    }

    // リスト（入れ子対応）
    if (ITEM_RE.test(line)) {
      flush();
      const [html, next] = parseList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    // 引用（エスケープ済みなので &gt; で判定）→ 注記として表示
    const q = line.match(/^&gt;\s?(.*)$/);
    if (q) {
      flush();
      out.push(`<p class="text-[12px] text-[#A7AAAC] leading-relaxed border-l-2 border-[#E1DFDC] pl-3 mb-3">${inline(q[1])}</p>`);
      i++; continue;
    }

    para.push(line);
    i++;
  }
  flush();
  return out.join('\n');
}
