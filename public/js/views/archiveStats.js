// ===== アーカイブ：活躍のふりかえり（グラフ）=====
// 誰がどれだけ動いたかを、既にあるデータだけで集計して見せる。
//
//   メンバー別の完了数 … 誰が手を動かしたか
//   メンバー別の作成数 … 誰がやることを見つけたか
//   ラベル別の完了数   … どの領域に力がかかったか
//
// ★サーバー変更は不要。集計元はすべて /api/data に載っている：
//     完了 … clearedData[mid].submittedBy（通常完了）＋ mission.individualClearedBy（個別完了）
//     作成 … mission.createdBy
//     ラベル … mission.tags / mission.tag
//
// ★グラフのライブラリは入れない。棒グラフ3種なら CSS の幅指定で足りるし、
//   0.5CPU / モバイル前提の端末に描画ライブラリを載せる価値がない。
// ★「0件の人」も出す。動けなかった人が見えることに意味があるので、
//   参加している全員を並べる（0件を隠すと人数が合わなくなる）。

import { state } from '../state.js';
import { Components } from '../components.js';
import { LABEL_CONFIG } from '../constants.js';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * 完了したミッションを「誰が完了させたか」で数える。
 *
 * ★個別完了（individualClear）は1つのミッションを複数人が完了する。
 *   その場合は individualClearedBy の全員を1件ずつ数える
 *   （提出物も人数ぶんあるので、実際に手を動かした人数と一致する）。
 * ★通常完了は submittedBy を見る。担当者（assignee）ではないことに注意。
 *   担当だが実際には別の人が出した、というケースがあるため。
 */
function _completedCounts(p) {
  const counts = new Map();
  const bump = (uid) => { if (uid) counts.set(uid, (counts.get(uid) || 0) + 1); };

  for (const m of (p.missions || [])) {
    if (m.individualClear) {
      for (const uid of (Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [])) bump(uid);
      continue;
    }
    if (m.status !== 'cleared') continue;
    bump(p.clearedData?.[m.id]?.submittedBy || null);
  }
  return counts;
}

/**
 * ミッションを「誰が作ったか」で数える。
 * ★createdBy は途中で入れたフィールドなので、それ以前のミッションには無い。
 *   数え漏れではなく「分からない」ので、まとめて件数だけ添える。
 */
function _createdCounts(p) {
  const counts = new Map();
  let unknown = 0;
  for (const m of (p.missions || [])) {
    if (!m.createdBy) { unknown++; continue; }
    counts.set(m.createdBy, (counts.get(m.createdBy) || 0) + 1);
  }
  return { counts, unknown };
}

/** ラベル別の完了数。★タグは新形式 tags を優先し、無ければ旧 tag */
function _tagCounts(p) {
  const counts = new Map();
  for (const m of (p.missions || [])) {
    if (m.status !== 'cleared') continue;
    const tags = (Array.isArray(m.tags) && m.tags.length > 0) ? m.tags : (m.tag ? [m.tag] : []);
    for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

/**
 * 横棒グラフ1本。
 * ★幅は「最大値に対する割合」。合計に対する割合にすると、1人が突出したときに
 *   他の全員がほぼ0幅になって差が読めなくなる。
 */
function _bar(label, value, max, color, avatarHtml) {
  const pct = max > 0 ? Math.round(value / max * 100) : 0;
  return `
    <div class="p-stats__bar-row">
      <div class="p-stats__bar-label">
        ${avatarHtml || ''}
        <span class="p-stats__bar-name">${_esc(label)}</span>
      </div>
      <div class="p-stats__bar-track">
        <div class="p-stats__bar-fill" style="width:${pct}%${color ? `;--bar-color:${color}` : ''}"></div>
      </div>
      <span class="p-stats__bar-value">${value}</span>
    </div>`;
}

/** メンバーの棒グラフ（完了数・作成数で共用）*/
function _memberChart(p, counts, emptyText) {
  const rows = (p.members || [])
    .map(m => ({ m, n: counts.get(m.userId) || 0 }))
    // ★多い順。同数なら名前順にして、再描画のたびに並びが入れ替わらないようにする
    .sort((a, b) => b.n - a.n || String(a.m.username || '').localeCompare(String(b.m.username || ''), 'ja'));

  if (rows.length === 0) return `<p class="p-stats__empty">${emptyText}</p>`;
  const max = rows[0].n;
  if (max === 0) return `<p class="p-stats__empty">${emptyText}</p>`;

  return rows.map(({ m, n }) => _bar(
    m.username || '(不明)', n, max, null,
    Components.UserAvatar({ username: m.username, avatarUrl: m.avatarUrl }, { size: 24, userId: m.userId }),
  )).join('');
}

/**
 * 活躍のふりかえりページ。
 * ★メンバー全員が見られる（アーカイブと同じ）。
 */
export function renderArchiveStats(container) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) { state.setView('HOME'); return; }

  const completed = _completedCounts(p);
  const { counts: created, unknown } = _createdCounts(p);
  const tags = _tagCounts(p);

  const totalCleared = (p.missions || []).filter(m => m.status === 'cleared').length;
  const totalMissions = (p.missions || []).length;

  const tagMax = Math.max(0, ...tags.values());
  const tagRows = [...tags.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([tag, n]) => _bar(tag, n, tagMax, LABEL_CONFIG[tag]?.color || null, null))
    .join('');

  // スタイル: public/css/object/project/_stats.css
  container.innerHTML = `
    <div class="p-stats u-page-transition">
      <header class="l-header l-header--sub">
        <button type="button" onclick="window._app.backToArchive()"
          class="l-header__back" aria-label="アーカイブへ戻る">
          <img src="/images/icon/iocn-Chevron.svg" class="l-header__back-icon" alt="">
        </button>
        <h1 class="l-header__heading">みんなの活躍</h1>
      </header>

      <main class="p-stats__main">
        <div class="p-stats__summary">
          <div class="p-stats__stat">
            <span class="p-stats__stat-value">${totalCleared}</span>
            <span class="p-stats__stat-label">完了</span>
          </div>
          <div class="p-stats__stat">
            <span class="p-stats__stat-value">${totalMissions}</span>
            <span class="p-stats__stat-label">ミッション</span>
          </div>
          <div class="p-stats__stat">
            <span class="p-stats__stat-value">${(p.members || []).length}</span>
            <span class="p-stats__stat-label">メンバー</span>
          </div>
        </div>

        <section class="p-stats__section">
          <h2 class="p-stats__title">誰が完了させたか</h2>
          <p class="p-stats__note">個別完了のミッションは、完了した人数ぶん数えています</p>
          ${_memberChart(p, completed, 'まだ完了したミッションがありません')}
        </section>

        <section class="p-stats__section">
          <h2 class="p-stats__title">誰がミッションを作ったか</h2>
          ${_memberChart(p, created, 'まだミッションがありません')}
          ${unknown > 0 ? `
            <p class="p-stats__note">
              ${unknown}件は作成者の記録が無いミッションです（記録を始める前に作られたもの）
            </p>` : ''}
        </section>

        <section class="p-stats__section">
          <h2 class="p-stats__title">ラベル別の完了数</h2>
          ${tagRows || `<p class="p-stats__empty">まだ完了したミッションがありません</p>`}
        </section>
      </main>
    </div>`;
}
