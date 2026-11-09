// ===== 公開の確認ページ（アーカイブ右上の「公開する」。2026-11-07。指示書B §5-2）=====
//
// ★「外に出る姿」を見せる画面。アーカイブの HTML を薄くコピーしない（非公開の部分が見えてしまい、確認の意味が無くなる）。
//   中身は必ずサーバーの GET /api/events/:id/public-preview（＝ lib/publicData.js の buildPublicEvent を
//   公開フラグだけ無視して通したもの）から描く。非公開テキスト・非公開のタスク・名前は、ここに来る前に落ちている。
// ★公開は POST /api/events/:id/publish だけ（3つのチェックが全部 true のとき。サーバーも確かめる）。
//   そこで publishCheckedAt が立ち、以後はタスクも含めた公開を切り替えられる（_guardPublicKnowledge）。
// ★mode: 'publish'（チェックと「公開する」あり）／ 'view'（公開されている内容を見るだけ。メニューから）
// ★チェック文に例を並べない（見落としやすいものは冒頭の折りたたみにだけ書く）

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { OUTCOME_CHOICES, REFLECT_LABELS } from '../constants.js';
import { formatEventPeriodLines } from '../utils.js';

const OVERLAY_ID = 'publish-confirm-overlay';

const CHECKS = [
  '写っている人・名前を確認しました',
  '連絡先やお金のことが残っていないか確認しました',
  '画像と添付ファイルの中身を確認しました',
];

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// https の URL だけ（サーバーも https だけを出しているが、描く側でも確かめる）
const _url = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');

function _basicHtml(b) {
  if (!b) return '';
  const img = _url(b.headerImage);
  const period = Array.isArray(b.dates) && b.dates.length ? formatEventPeriodLines(b.dates, b.dateTimes).map(_esc).join('<br>') : '';
  return `
    <section class="p-publish-confirm__basic">
      ${img ? `<img src="${_esc(img)}" class="p-publish-confirm__visual" alt="" data-fallback="archive-visual">` : ''}
      <h3 class="p-publish-confirm__title">${_esc(b.title)}</h3>
      ${period ? `<p class="p-publish-confirm__fact"><span class="p-publish-confirm__fact-label">期間</span>${period}</p>` : ''}
      ${b.venue ? `<p class="p-publish-confirm__fact"><span class="p-publish-confirm__fact-label">場所</span>${_esc(b.venue)}</p>` : ''}
      ${b.summary ? `<p class="p-publish-confirm__text">${_esc(b.summary)}</p>` : ''}
    </section>`;
}

// 目的と柱（タスクの記録と一緒に公開。2026-11-09）。★サーバーは記録が1件以上あるときだけ purpose / pillars を返す
function _purposeHtml(text, pillars) {
  const names = Array.isArray(pillars) ? pillars : [];
  if (!text && names.length === 0) return '';
  return `
      <article class="p-publish-confirm__entry">
        ${text ? `<h4 class="p-publish-confirm__entry-title">目的</h4>
        <p class="p-publish-confirm__text">${_esc(text)}</p>` : ''}
        ${names.length ? `<h4 class="p-publish-confirm__entry-title">柱</h4>
        <p class="p-publish-confirm__text">${names.map(_esc).join('・')}</p>` : ''}
      </article>`;
}

function _knowledgeHtml(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list.map(k => {
    const labels = REFLECT_LABELS[k.outcome] || REFLECT_LABELS.struggle;
    const outcome = OUTCOME_CHOICES[k.outcome]?.label;
    const imgs = (k.images || []).map(_url).filter(Boolean);
    return `
      <article class="p-publish-confirm__entry">
        <h4 class="p-publish-confirm__entry-title">${_esc(k.title)}</h4>
        <p class="p-publish-confirm__entry-meta">${[outcome, ...(k.tags || [])].filter(Boolean).map(_esc).join('・')}</p>
        ${k.text ? `<p class="p-publish-confirm__text">${_esc(k.text)}</p>` : ''}
        ${imgs.map(u => `<img src="${_esc(u)}" class="p-publish-confirm__image" alt="" loading="lazy" data-fallback="submission">`).join('')}
        ${(k.files || []).map(f => `<p class="p-publish-confirm__file">PDF：${_esc(f.name)}</p>`).join('')}
        ${k.struggle ? `<p class="p-publish-confirm__reflect-label">${_esc(labels.struggle)}</p><p class="p-publish-confirm__text">${_esc(k.struggle)}</p>` : ''}
        ${k.solution ? `<p class="p-publish-confirm__reflect-label">${_esc(labels.solution)}</p><p class="p-publish-confirm__text">${_esc(k.solution)}</p>` : ''}
      </article>`;
  }).join('');
}

function _close(overlay, reason) {
  overlay.remove();
  if (reason) logEvent('public_confirm_canceled', { eventId: state.selectedEventId, reason });
}

/**
 * @param {{ mode?: 'publish'|'view' }} opts
 */
export async function openPublishConfirm({ mode = 'publish' } = {}) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.canManageCurrentEvent()) return;
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--publish u-animate-fade';
  overlay.innerHTML = `
    <div class="p-publish-confirm" role="dialog" aria-modal="true" aria-labelledby="pc-title">
      <header class="p-publish-confirm__head">
        <h2 id="pc-title" class="p-publish-confirm__heading">${mode === 'view' ? '公開されている内容' : '公開する内容の確認'}</h2>
        <button type="button" class="p-publish-confirm__close" data-pc-close aria-label="閉じる">×</button>
      </header>
      <div class="p-publish-confirm__body"><p class="p-publish-confirm__loading">読み込み中…</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-pc-close]').addEventListener('click', () => _close(overlay, mode === 'publish' ? 'close' : null));

  const r = await api.publicPreview(p.id);
  if (!document.body.contains(overlay)) return;
  const body = overlay.querySelector('.p-publish-confirm__body');
  if (!r?.ok) { body.innerHTML = `<p class="p-publish-confirm__loading">${_esc(r?.error || '読み込めませんでした')}</p>`; return; }

  const kn = Array.isArray(r.knowledge) ? r.knowledge : [];
  // 何が外に出るか（基礎情報は必ず。タスクの記録は開催後・公開できる記録があるときだけ）
  const scope = r.knowledgeReady
    ? `基礎情報と、タスクの記録 ${kn.length}件が公開されます。`
    : r.status === 'archive'
      ? '基礎情報が公開されます。タスクの記録は、公開の候補にした振り返りがあると公開できます。'
      : '基礎情報が公開されます。タスクの記録は、開催日を過ぎてから公開できます。';
  body.innerHTML = `
    ${mode === 'publish' ? `
      <div class="p-publish-confirm__intro">
        <p>名前・チャット・参加申請の回答は、自動で公開されません。</p>
        <p>確認していただきたいのは、<strong>書いた文章と、画像や添付ファイルの中身</strong>です。</p>
        <details class="p-publish-confirm__hints">
          <summary>気をつけたいもの</summary>
          <ul>
            <li>電話番号・メールアドレス・住所などの連絡先</li>
            <li>金額や、取引先との取り決め</li>
            <li>LINE などのやりとりのスクリーンショット</li>
            <li>ほかの人の作品が写った写真</li>
          </ul>
        </details>
      </div>` : ''}
    <p class="p-publish-confirm__scope">${_esc(scope)}<br>公開できる記録：${Number(r.publishable) || 0}件</p>
    <div class="p-publish-confirm__preview">
      ${_basicHtml(r.basic)}
      ${_purposeHtml(r.purpose, r.pillars)}
      ${_knowledgeHtml(kn)}
    </div>`;

  if (mode !== 'publish') return;
  logEvent('public_confirm_shown', { eventId: p.id, knowledge: kn.length });

  const foot = document.createElement('footer');
  foot.className = 'p-publish-confirm__foot';
  foot.innerHTML = `
    ${CHECKS.map((t, i) => `
      <label class="p-publish-confirm__check"><input type="checkbox" data-pc-check="${i}"><span>${_esc(t)}</span></label>`).join('')}
    <div class="p-publish-confirm__actions">
      <button type="button" class="c-button c-button--secondary" data-pc-cancel>キャンセル</button>
      <button type="button" class="c-button c-button--primary" data-pc-publish disabled>公開する</button>
    </div>`;
  overlay.querySelector('.p-publish-confirm').appendChild(foot);
  const boxes = [...foot.querySelectorAll('[data-pc-check]')];
  const go = foot.querySelector('[data-pc-publish]');
  boxes.forEach(b => b.addEventListener('change', () => { go.disabled = !boxes.every(x => x.checked); }));
  foot.querySelector('[data-pc-cancel]').addEventListener('click', () => _close(overlay, 'cancel'));
  go.addEventListener('click', async () => {
    if (go.disabled) return;
    go.disabled = true;
    go.textContent = '公開しています…';
    const res = await api.publishEvent(p.id, boxes.map(x => x.checked));
    if (!res?.ok) {
      go.disabled = false;
      go.textContent = '公開する';
      window._app?.showToast?.(res?.error || '公開できませんでした');
      return;
    }
    p.publicBasicInfo = true;
    p.publicKnowledge = res.publicKnowledge === true;
    p.publishCheckedAt = res.publishCheckedAt;
    logEvent('public_confirm_published', { eventId: p.id, knowledge: p.publicKnowledge });
    overlay.remove();
    window._app?.showToast?.(p.publicKnowledge ? `公開しました（タスクの記録 ${kn.length}件を含む）` : '基礎情報を公開しました');
    state.render();
  });
}
