// ===== 公開されるイベントの描き方（2026-11-12。指示書05 §5-1）=====
//
// 「公開すると、アーカイブがほぼそのまま外に出る」ことを保つため、**公開の確認ページ**（modals/publishConfirmModal.js）と
// **公開ページ**（/explore）で、この1つの描き方を使う。★見た目を2か所に書かないこと。
//
// ★入力はサーバーの buildPublicEvent の形だけ（{ status, basic, purpose, pillars, knowledge }）。
//   events / submissions を直接描かない（非公開の部分・名前は、ここに来る前に落ちている）。
// ★項目は旧外部サイトの「みんなの記録」の詳細に合わせる（種別・最終更新・見出しや箇条書き・PDF・記録の件数）。
//   並びは本体のアーカイブに合わせる：基礎情報（画像 → タイトル → 概要 → 期間・場所・種別・最終更新）→ 目的・柱 →
//   タスクの記録（1件の中は 本文 → 振り返り）。2026-11-12 ユーザー決定
// ★文字は必ずエスケープする（_esc / linkifyText）。URL は https のものだけ（_url）

import { OUTCOME_CHOICES, REFLECT_LABELS, EVENT_TYPES } from '../constants.js';
import { formatEventPeriodLines, linkifyText, pillarCategoryOf } from '../utils.js';
import { pillarCharHtml } from '../pillarChars.js';
import { Components } from '../components.js';

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// https の URL だけ（サーバーも https だけを出しているが、描く側でも確かめる）
const _url = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');

const _typeLabel = (id) => EVENT_TYPES.find(t => t.id === id)?.label || '';

/** 'YYYY-MM-DD' → 'YYYY年M月D日' */
function _ymd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : '';
}

/** 文章（改行は保つ・URL はリンク） */
const _textHtml = (t) => `<p class="p-public-archive__text">${linkifyText(t)}</p>`;

// ★見た目はアプリのアーカイブに合わせる（2026-11-18。ヘッダー画像 → 白い紙 → タイトル・種別 → 概要 → 期間・場所 → 目的・柱 → 記録）
function _fact(label, valueHtml) {
  if (!valueHtml) return '';
  return `
          <dt class="p-public-archive__fact-label">${_esc(label)}</dt>
          <dd class="p-public-archive__fact-value">${valueHtml}</dd>`;
}

/** ヘッダー画像（アーカイブと同じ 3:2。白い紙の上に置く） */
function _visualHtml(basic) {
  const img = _url(basic?.headerImage);
  return img ? `<img src="${_esc(img)}" class="p-public-archive__visual" alt="" data-fallback="archive-visual">` : '';
}

/**
 * 基礎情報（告知／アーカイブ・タイトル・種別・最終更新・概要・期間・場所）
 * @param {object|null} basic
 * @param {{ status?: 'upcoming'|'archive', visual?: boolean }} opts … visual:false でヘッダー画像を出さない（全体を描くときは紙の外に置く）
 */
export function publicBasicHtml(basic, { status, visual = true } = {}) {
  if (!basic) return '';
  const period = Array.isArray(basic.dates) && basic.dates.length
    ? formatEventPeriodLines(basic.dates, basic.dateTimes).map(_esc).join('<br>') : '';
  const label = status === 'archive' ? 'アーカイブ' : status === 'upcoming' ? '告知' : '';
  const type = _typeLabel(basic.eventType);
  const updated = _ymd(basic.lastUpdated);
  const facts = _fact('期間', period) + _fact('場所', basic.venue ? _esc(basic.venue) : '');
  return `
    ${visual ? _visualHtml(basic) : ''}
    <section class="p-public-archive__basic">
      <h3 class="p-public-archive__title">${_esc(basic.title)}</h3>
      ${label || type || updated ? `
      <div class="p-public-archive__lead-meta">
        ${label ? `<span class="p-public-archive__label p-public-archive__label--${_esc(status)}">${label}</span>` : ''}
        ${type ? `<span class="p-public-archive__type">${_esc(type)}</span>` : ''}
        ${updated ? `<span class="p-public-archive__updated">最終更新 ${_esc(updated)}</span>` : ''}
      </div>` : ''}
      ${basic.summary ? `<h4 class="p-public-archive__heading">概要</h4>${_textHtml(basic.summary)}` : ''}
      ${facts ? `<dl class="p-public-archive__facts">${facts}</dl>` : ''}
    </section>`;
}

/**
 * 目的と柱（サーバーは記録と一緒に公開するときだけ返す）
 * ★柱はアプリの柱と同じキャラで描く（2026-11-18）。区分は cats（サーバーの publicPillarCats。本体の画面だけに来る）、
 *   無ければ名前から推定し、それも無ければ順番のキャラ
 */
export function publicPurposeHtml(purpose, pillars, cats) {
  const names = Array.isArray(pillars) ? pillars.filter(Boolean) : [];
  if (!purpose && names.length === 0) return '';
  const catOf = (n, i) => (Array.isArray(cats) && cats[i]) || pillarCategoryOf({ name: n });
  return `
    <section class="p-public-archive__purpose">
      ${purpose ? `<h4 class="p-public-archive__heading">目的</h4>${_textHtml(purpose)}` : ''}
      ${names.length ? `<h4 class="p-public-archive__heading">柱</h4>
      <div class="p-pillar-chars p-pillar-chars--lead" role="list">${names.map((n, i) =>
        pillarCharHtml(i, n, { cat: catOf(n, i), attrs: 'role="listitem"' })).join('')}</div>` : ''}
    </section>`;
}

/** 本文：blocks（見出し・段落・箇条書き）があればそれで、無ければ text を1段落で */
function _bodyHtml(k) {
  const blocks = Array.isArray(k.blocks) ? k.blocks : [];
  if (!blocks.length) return k.text ? _textHtml(k.text) : '';
  let out = '';
  let items = [];
  const flush = () => {
    if (items.length) out += `<ul class="p-public-archive__list">${items.map(t => `<li>${linkifyText(t)}</li>`).join('')}</ul>`;
    items = [];
  };
  for (const b of blocks) {
    if (!b || typeof b.text !== 'string') continue;
    if (b.type === 'item') { items.push(b.text); continue; }
    flush();
    out += b.type === 'heading'
      ? `<h6 class="p-public-archive__block-heading">${_esc(b.text)}</h6>`
      : _textHtml(b.text);
  }
  flush();
  return out;
}

function _filesHtml(files) {
  const list = (Array.isArray(files) ? files : []).filter(f => _url(f?.url));
  if (!list.length) return '';
  return `
        <ul class="p-public-archive__files">
          ${list.map(f => `
          <li><a class="p-public-archive__file" href="${_esc(f.url)}" target="_blank" rel="noopener noreferrer">
            <span class="p-public-archive__file-kind">PDF</span><span class="p-public-archive__file-name">${_esc(f.name || 'ファイル')}</span>
          </a></li>`).join('')}
        </ul>`;
}

/**
 * 記録1件の中身（本文 → 画像・PDF → 振り返り）。タスクの記録と、引き継いだ「前回の記録」（missionDetail.js）で共用
 * @param {object} k  … { outcome, struggle, solution, text, blocks, images, files }
 * @param {{ fallback?: string }} opts … 画像が読めないときの代替（data-fallback の値。前の代の記録は 'inherited'）
 */
export function publicRecordHtml(k, { fallback = 'submission' } = {}) {
  const labels = REFLECT_LABELS[k.outcome] || REFLECT_LABELS.struggle;
  const imgs = (k.images || []).map(_url).filter(Boolean);
  return `
        ${_bodyHtml(k)}
        ${imgs.map(u => `<img src="${_esc(u)}" class="p-public-archive__image" alt="" loading="lazy" data-fallback="${_esc(fallback)}">`).join('')}
        ${_filesHtml(k.files)}
        ${k.struggle ? `<p class="p-public-archive__reflect-label">${_esc(labels.struggle)}</p>${_textHtml(k.struggle)}` : ''}
        ${k.solution ? `<p class="p-public-archive__reflect-label">${_esc(labels.solution)}</p>${_textHtml(k.solution)}` : ''}`;
}

/** タスクの記録（1件の中は 本文 → 画像・PDF → 振り返り。本体のアーカイブと同じ並び） */
export function publicKnowledgeHtml(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const entries = list.map(k => {
    // ★成否とラベルはアーカイブと同じ札（成否は灰色の札・ラベルはラベルの色。Components.Tag はラベル名をエスケープする）
    const outcome = OUTCOME_CHOICES[k.outcome]?.label;
    const tags = (k.tags || []).filter(t => typeof t === 'string' && t);
    return `
      <article class="p-public-archive__entry">
        <h5 class="p-public-archive__entry-title">${_esc(k.title)}</h5>
        ${outcome || tags.length ? `
        <div class="p-public-archive__entry-meta">
          ${outcome ? `<span class="p-public-archive__outcome">${_esc(outcome)}</span>` : ''}
          ${tags.map(t => Components.Tag(t)).join('')}
        </div>` : ''}
        ${publicRecordHtml(k)}
      </article>`;
  }).join('');
  return `
    <section class="p-public-archive__knowledge">
      <h4 class="p-public-archive__section-title">タスクの記録<span class="p-public-archive__count">${list.length}件</span></h4>
      ${entries}
    </section>`;
}

/**
 * 公開されるイベントの全体（ヘッダー画像 → 白い紙：基礎情報 → 目的・柱 → タスクの記録）
 * @param {{ status?, basic, purpose?, pillars?, knowledge? }} data … buildPublicEvent の形
 */
export function publicArchiveHtml(data) {
  if (!data) return '';
  return `
    <div class="p-public-archive">
      ${_visualHtml(data.basic)}
      <div class="p-public-archive__doc">
        ${publicBasicHtml(data.basic, { status: data.status, visual: false })}
        ${publicPurposeHtml(data.purpose, data.pillars, data.pillarCats)}
        ${publicKnowledgeHtml(data.knowledge)}
      </div>
    </div>`;
}
