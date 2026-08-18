// ===== ★暫定：既存メンバーのスキル回収モーダル =====
//
// ★これは一時的な特別措置である。回収が済んだらこのファイルごと削除すること。
//   削除する箇所は CLAUDE.md「既存メンバーのスキルタグ回収（暫定）」節にまとめてある。
//   目印は `grep -rn '★暫定：既存メンバーのスキル回収' .`。
//
// なぜ要るか：
//   参加申請フォーム（joinFormModal.js）が入る前から居るメンバーは
//   skillsGood / skillsWant を持たない。そのため担当者シートの「おすすめ」
//   （assigneeSuggest.js）が本番で1件も出ない。回答を後追いで集めるための措置。
//
// 恒久機能との違い：
//   - 聞くのは「できること」「やってみたいこと」の2問だけ（意気込みは聞かない）
//   - 保存先は同じ members[].skillsGood / skillsWant（＝回収後はデータが揃うだけ）
//   - 保存は専用エンドポイント POST /api/events/:id/my-skills
//
// 既存の自動表示モーダルと同じ作法に従う：
//   - 判定は state.render() 駆動のみ。バックグラウンドタイマー厳禁
//   - 他モーダルと重なるときは表示せず、フラグも立てない（次の render() で再判定）

import { state } from '../state.js';
import { api } from '../api.js';
import { SKILL_TAGS } from '../constants.js';
import { logEvent } from '../logger.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';

const OVERLAY_ID = 'skill-collect-overlay';

// 「あとで」を押したら7日間出さない（HOME の通知バナーと同じ間隔）
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const _snoozeKey = (userId, eventId) => `evecre:skillCollect:snoozedAt:${userId}:${eventId}`;

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * このイベントで自分が未回答か。
 * ★joinedAnswersAt を持つ人（参加申請フォームを通った人）には絶対に出さない。
 */
export function needsSkillCollect(project, userId) {
  if (!project || !userId) return false;
  // ★イベントを作った本人には聞かない。オーナーは参加申請フォームを通らないので
  //   必ず未回答になり、自分で作ったイベントを開くたびに聞かれてしまう。
  //   おすすめは「リーダーが誰に頼むか」を助ける機能なので、リーダー自身の
  //   スキルは要らない。
  if (project.ownerId && project.ownerId === userId) return false;
  const me = (project.members || []).find(m => m.userId === userId);
  if (!me) return false;
  if (me.joinedAnswersAt) return false;
  // 何らかの経路で回答が入っていれば聞かない
  if ((me.skillsGood || []).length > 0 || (me.skillsWant || []).length > 0) return false;
  try {
    const at = Number(localStorage.getItem(_snoozeKey(userId, project.id))) || 0;
    if (at && Date.now() - at < SNOOZE_MS) return false;
  } catch (_) {}
  return true;
}

/**
 * ★state.render() からのみ呼ぶこと。
 * 未回答の既存メンバーに、できること／やってみたいことを聞く。
 */
export function checkSkillCollectModal() {
  if (document.getElementById(OVERLAY_ID)) return;
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  if (!needsSkillCollect(p, state.currentUser.id)) return;
  // ★重なったら表示しない。スヌーズも記録しないので次の render() で再判定される
  if (isAnyAutoModalOpen(OVERLAY_ID)) return;

  openSkillCollectModal(p);
}

/** 実際に開く（デバッグ用に単体でも呼べるようにしておく） */
export function openSkillCollectModal(project) {
  const ctx = { step: 1, good: {}, want: {}, saving: false, error: '' };

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // スタイル: public/css/object/component/_step-modal.css
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--form';
  document.body.appendChild(overlay);
  logEvent('skill_collect_shown');

  const close = () => overlay.remove();

  const snooze = () => {
    try {
      localStorage.setItem(_snoozeKey(state.currentUser.id, project.id), String(Date.now()));
    } catch (_) {}
    logEvent('skill_collect_skipped', { step: ctx.step });
    close();
  };

  /** STEP 2 の候補。STEP 1 で「できる」にしたものは外す（できること ≠ やってみたいこと） */
  const wantCandidates = () => SKILL_TAGS.filter(t => !ctx.good[t.id]);

  const tagHtml = (tag, on, isGood) => {
    if (!on) {
      return `
        <button type="button" data-sc-tag="${_esc(tag.id)}" class="c-skill-tag">
          ${_esc(tag.label)}
        </button>`;
    }
    // ★色だけに頼らず、できる=チェック / やってみたい=プラス でも区別する
    const icon = isGood
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    return `
      <button type="button" data-sc-tag="${_esc(tag.id)}"
        class="c-skill-tag ${isGood ? 'is-good' : 'is-want'}">
        ${icon}${_esc(tag.label)}
      </button>`;
  };

  const render = () => {
    const isGood = ctx.step === 1;
    const tags = isGood ? SKILL_TAGS : wantCandidates();
    const sel  = isGood ? ctx.good : ctx.want;

    overlay.innerHTML = `
      <div class="c-step-modal u-animate-fade">
        <div class="c-step-modal__header">
          <p class="c-step-modal__context">
            「${_esc(project.name || 'イベント')}」のメンバー情報
          </p>
        </div>
        <div class="c-step-modal__body">
          <h3 class="c-step-modal__title">
            ${isGood ? 'できることは？' : 'やってみたいことは？'}
          </h3>
          <p class="c-step-modal__lead">
            ${isGood
              ? 'タップで選べます（複数可）<br>担当を決めるときの参考になります'
              : 'まだ得意ではないけど挑戦したいこと<br>選ばなくても大丈夫です'}
          </p>
          ${tags.length === 0
            ? '<p class="c-step-modal__empty">すべて「できること」に選びました</p>'
            : `<div class="c-skill-tags">
                ${tags.map(t => tagHtml(t, !!sel[t.id], isGood)).join('')}
              </div>`}
        </div>
        <div class="c-step-modal__footer">
          <div class="c-step-modal__dots">
            ${[1, 2].map(i => `<span class="c-step-modal__dot${i === ctx.step ? ' is-active' : ''}"></span>`).join('')}
          </div>
          ${ctx.error ? `<p class="c-step-modal__error">${_esc(ctx.error)}</p>` : ''}
          <button type="button" data-sc="next" ${ctx.saving ? 'disabled' : ''}
            class="c-button c-button--primary c-step-modal__primary">
            ${ctx.saving ? '保存中…' : (isGood ? '次へ' : '保存する')}
          </button>
          <button type="button" data-sc="${isGood ? 'later' : 'back'}" class="c-step-modal__secondary">
            ${isGood ? 'あとで' : '戻る'}
          </button>
        </div>
      </div>`;

    overlay.querySelectorAll('[data-sc-tag]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.scTag;
        if (sel[id]) delete sel[id]; else sel[id] = true;
        // ★できることを外したら、やってみたい側の同じタグも消す（両方に立たせない）
        if (isGood && !sel[id]) delete ctx.want[id];
        render();
      };
    });

    overlay.querySelector('[data-sc="next"]').onclick = () => {
      if (ctx.saving) return;
      if (ctx.step === 1) { ctx.step = 2; ctx.error = ''; render(); return; }
      save();
    };
    const sub = overlay.querySelector('[data-sc="later"]') || overlay.querySelector('[data-sc="back"]');
    if (sub) sub.onclick = () => {
      if (ctx.saving) return;
      if (sub.dataset.sc === 'later') snooze();
      else { ctx.step = 1; ctx.error = ''; render(); }
    };
  };

  const save = async () => {
    const skillsGood = Object.keys(ctx.good);
    const skillsWant = Object.keys(ctx.want).filter(id => !ctx.good[id]);
    ctx.saving = true; ctx.error = ''; render();
    try {
      const r = await api.saveMySkills(project.id, skillsGood, skillsWant);
      if (!r?.ok) throw new Error(r?.error || '保存に失敗しました');
      // 手元の state にも反映する（再取得を待たずに担当者のおすすめが効くように）
      const me = (project.members || []).find(m => m.userId === state.currentUser.id);
      if (me) {
        me.skillsGood = r.skillsGood || skillsGood;
        me.skillsWant = r.skillsWant || skillsWant;
        me.joinedAnswersAt = Date.now();
      }
      logEvent('skill_collect_submitted', { good: skillsGood.length, want: skillsWant.length });
      close();
      window._app?.showToast?.('ありがとうございます！');
    } catch (e) {
      ctx.saving = false;
      ctx.error = e.message || '保存に失敗しました';
      render();
    }
  };

  render();
}
