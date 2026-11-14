// ===== 柱をキャラクター（mizu / mori / iwa）で描く（2026-10-02）=====
//
// 柱は最大3つ。体の中に柱の名前を書く。
// ★キャラは柱の区分（cat）で決まる（2026-11-14）：運営・進行＝mizu（青）／制作＝mori（緑）／企画＝iwa（黄）。
//   区分の無い柱（それ以前の柱）は、名前が候補と同じならその区分、それ以外は順番（1つ目＝mizu・2つ目＝mori・3つ目＝iwa）。
//   判定は utils.js の pillarCategoryOf だけ。
// 使う場所：柱の設定ページ（views/pillarEdit.js）・タスク作成の2画面目（modals/mission.js）。
//
// ★体と目は character.js の characterFigureHtml を使う（提案ボックス・HOME のひとことと同じ部品）。
// ★キャラの色はラベルの色（運営=青・制作=緑・企画=黄）と重なる。了承済み（2026-10-02）。

import { PROPOSAL_CHARACTERS, PILLAR_CATEGORIES } from './constants.js';
import { pillarCategoryOf } from './utils.js';
import { characterFigureHtml } from './character.js';

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 何番目の柱がどのキャラか（0=mizu / 1=mori / 2=iwa）。★区分の無い古い柱だけが使う */
export function pillarCharacter(index) {
  return PROPOSAL_CHARACTERS[index % PROPOSAL_CHARACTERS.length];
}

/** 区分（ops / make / plan）のキャラ。知らない区分なら null */
export function categoryCharacter(cat) {
  const c = PILLAR_CATEGORIES.find(x => x.id === cat);
  return c ? PROPOSAL_CHARACTERS.find(ch => ch.id === c.char) || null : null;
}

/** 柱のキャラ（区分 → 無ければ順番） */
export function pillarCharacterFor(pillar, index) {
  return categoryCharacter(pillarCategoryOf(pillar)) || pillarCharacter(index);
}

/**
 * 柱1つぶんのキャラ。
 * @param {number} index  柱の順番（出てくる順の演出。区分が無いときはキャラも決める）
 * @param {string} name   体の中に書く名前（空なら placeholder）
 * @param {object} [o]
 * @param {string} [o.tag]        要素名（button / div）
 * @param {string} [o.attrs]      追加の属性（data-* など。エスケープ済みで渡す）
 * @param {boolean} [o.selected]  選ばれている（タスク作成）
 * @param {boolean} [o.dimmed]    選ばれていない（薄く）
 * @param {boolean} [o.isNew]     いま足した（下からぽこっと出る）
 * @param {boolean} [o.active]    編集中（枠を出す）
 * @param {string} [o.placeholder]
 * @param {string|null} [o.cat]   柱の区分（ops / make / plan）。キャラはこれで決まる
 * @param {boolean} [o.uncategorized] 区分をまだ選んでいない自由記述の柱（灰色で出す）
 */
export function pillarCharHtml(index, name, o = {}) {
  const ch = categoryCharacter(o.cat) || pillarCharacter(index);
  const tag = o.tag || 'div';
  const cls = ['p-pillar-char', 'p-char', `p-char--${ch.id}`, 'p-char--ready',
    o.selected ? 'is-selected' : '', o.dimmed ? 'is-dimmed' : '', o.isNew ? 'is-new' : '', o.active ? 'is-active' : '',
    o.uncategorized ? 'is-uncategorized' : '']
    .filter(Boolean).join(' ');
  const label = String(name || '').trim();
  return `
    <${tag} class="${cls}" style="--char-index:${index}"${tag === 'button' ? ' type="button"' : ''} ${o.attrs || ''}>
      ${characterFigureHtml(ch)}
      <span class="p-pillar-char__name${label ? '' : ' is-placeholder'}"><span class="p-pillar-char__name-text">${_esc(label || o.placeholder || '名前を入力')}</span></span>
      ${o.selected ? '<span class="p-pillar-char__check" aria-hidden="true">✓</span>' : ''}
    </${tag}>`;
}

/** まだ埋まっていない枠（点線） */
export function pillarSlotHtml(index) {
  return `<div class="p-pillar-char p-pillar-char--empty" style="--char-index:${index}" aria-hidden="true"><span class="p-pillar-char__slot-num">${index + 1}</span></div>`;
}
