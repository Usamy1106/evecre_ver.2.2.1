// ===== 柱をキャラクター（mizu / mori / iwa）で描く（2026-10-02）=====
//
// 柱は最大3つ。1つ目＝mizu（青）、2つ目＝mori（緑）、3つ目＝iwa（黄）の順で、体の中に柱の名前を書く。
// 使う場所：柱の設定ページ（views/pillarEdit.js）・タスク作成の2画面目（modals/mission.js）。
//
// ★体と目は character.js の characterFigureHtml を使う（提案ボックス・HOME のひとことと同じ部品）。
// ★キャラの色はラベルの色（運営=青・制作=緑・企画=黄）と重なる。了承済み（2026-10-02）。
// ★柱の順番でキャラが決まる。柱を消すと後ろの柱のキャラが繰り上がる（色が変わる）。

import { PROPOSAL_CHARACTERS } from './constants.js';
import { characterFigureHtml } from './character.js';

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 何番目の柱がどのキャラか（0=mizu / 1=mori / 2=iwa） */
export function pillarCharacter(index) {
  return PROPOSAL_CHARACTERS[index % PROPOSAL_CHARACTERS.length];
}

/**
 * 柱1つぶんのキャラ。
 * @param {number} index  柱の順番（キャラを決める）
 * @param {string} name   体の中に書く名前（空なら placeholder）
 * @param {object} [o]
 * @param {string} [o.tag]        要素名（button / div）
 * @param {string} [o.attrs]      追加の属性（data-* など。エスケープ済みで渡す）
 * @param {boolean} [o.selected]  選ばれている（タスク作成）
 * @param {boolean} [o.dimmed]    選ばれていない（薄く）
 * @param {boolean} [o.isNew]     いま足した（下からぽこっと出る）
 * @param {boolean} [o.active]    編集中（枠を出す）
 * @param {string} [o.placeholder]
 */
export function pillarCharHtml(index, name, o = {}) {
  const ch = pillarCharacter(index);
  const tag = o.tag || 'div';
  const cls = ['p-pillar-char', 'p-char', `p-char--${ch.id}`, 'p-char--ready',
    o.selected ? 'is-selected' : '', o.dimmed ? 'is-dimmed' : '', o.isNew ? 'is-new' : '', o.active ? 'is-active' : '']
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
