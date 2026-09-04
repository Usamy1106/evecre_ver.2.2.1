// ===== アーカイブ：参加時の回答一覧 =====
// イベント参加のときにメンバーが答えた内容（できること／やってみたいこと／意気込み）を
// 2つの見方で並べる。
//
//   ユーザー別 … 誰が何を答えたか（人を起点に見る）
//   質問別     … その項目を選んだのは誰か（スキルを起点に見る）
//
// ★サーバー変更は不要。回答は /api/data の members[] にそのまま載っている
//   （参加申請フォームの回答は承認時に pendingMembers から members へコピーされる）。
// ★オーナーは参加申請フォームを通らないので回答を持たない。代わりに
//   イベント作成時の意気込み（motivationTags / motivationText）がある。
//   ここでは「未回答」とだけ示し、意気込みはプロフィールモーダルに任せる
//   （出どころが違うものを1つの表に混ぜると、何の回答か読み取れなくなる）。

import { state } from '../state.js';
import { Components } from '../components.js';
import { SKILL_TAGS } from '../constants.js';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** スキルの英数キー → 日本語ラベル。★保存は英数キーのみ */
function _label(id) {
  return SKILL_TAGS.find(t => t.id === id)?.label || null;
}

function _chips(ids, modifier) {
  const labels = (Array.isArray(ids) ? ids : []).map(_label).filter(Boolean);
  if (labels.length === 0) return '<span class="p-answers__none">なし</span>';
  return labels.map(l =>
    `<span class="p-answers__chip p-answers__chip--${modifier}">${_esc(l)}</span>`).join('');
}

// ── ユーザー別 ──────────────────────────────────────────────
function _byUser(p) {
  const members = p.members || [];
  if (members.length === 0) return `<p class="p-answers__empty">メンバーがいません</p>`;

  return members.map(m => {
    const answered = !!m.joinedAnswersAt;
    const message  = String(m.joinMessage || '').trim();
    const isOwner  = p.ownerId === m.userId;
    return `
      <div class="p-answers__card">
        <div class="p-answers__card-head">
          ${Components.UserAvatar({ username: m.username, avatarUrl: m.avatarUrl }, { size: 36, userId: m.userId })}
          <div class="p-answers__card-name">
            <p class="p-answers__name">${_esc(m.username || '')}</p>
            ${isOwner ? `<span class="p-answers__owner">リーダー</span>` : ''}
          </div>
        </div>
        ${answered ? `
          <div class="p-answers__row">
            <p class="p-answers__q">できること</p>
            <div class="p-answers__a">${_chips(m.skillsGood, 'good')}</div>
          </div>
          <div class="p-answers__row">
            <p class="p-answers__q">やってみたいこと</p>
            <div class="p-answers__a">${_chips(m.skillsWant, 'want')}</div>
          </div>
          ${message ? `
            <div class="p-answers__row">
              <p class="p-answers__q">意気込み</p>
              <p class="p-answers__message">${_esc(message)}</p>
            </div>` : ''}
        ` : `
          <p class="p-answers__none">
            ${isOwner
              // ★オーナーは参加申請フォームを通らない。未回答ではなく「対象外」
              ? '参加申請フォームを通っていません（イベントの作成者）'
              : '参加申請フォームより前から参加しているため回答がありません'}
          </p>`}
      </div>`;
  }).join('');
}

// ── 質問別 ──────────────────────────────────────────────────
// ★スキルは12種あり、誰も選んでいないものも多い。0人の行も出す
//   （「誰もできる人がいない」ことが分かるのがこの見方の価値）。
function _byQuestion(p) {
  const members = (p.members || []).filter(m => m.joinedAnswersAt);
  if (members.length === 0) {
    return `<p class="p-answers__empty">まだ誰も参加申請フォームに答えていません</p>`;
  }

  const section = (title, key, modifier) => `
    <section class="p-answers__section">
      <h3 class="p-answers__section-title">${title}</h3>
      ${SKILL_TAGS.map(tag => {
        const hits = members.filter(m => (m[key] || []).includes(tag.id));
        return `
          <div class="p-answers__qrow${hits.length === 0 ? ' is-empty' : ''}">
            <div class="p-answers__qrow-head">
              <span class="p-answers__chip p-answers__chip--${modifier}">${_esc(tag.label)}</span>
              <span class="p-answers__count">${hits.length}人</span>
            </div>
            ${hits.length > 0 ? `
              <div class="p-answers__people">
                ${hits.map(m => `
                  <span class="p-answers__person">
                    ${Components.UserAvatar({ username: m.username, avatarUrl: m.avatarUrl }, { size: 24, userId: m.userId })}
                    <span class="p-answers__person-name">${_esc(m.username || '')}</span>
                  </span>`).join('')}
              </div>` : ''}
          </div>`;
      }).join('')}
    </section>`;

  const messages = members.filter(m => String(m.joinMessage || '').trim());
  return `
    ${section('できること', 'skillsGood', 'good')}
    ${section('やってみたいこと', 'skillsWant', 'want')}
    <section class="p-answers__section">
      <h3 class="p-answers__section-title">意気込み</h3>
      ${messages.length === 0
        ? `<p class="p-answers__none">まだ誰も書いていません</p>`
        : messages.map(m => `
            <div class="p-answers__voice">
              ${Components.UserAvatar({ username: m.username, avatarUrl: m.avatarUrl }, { size: 28, userId: m.userId })}
              <div>
                <p class="p-answers__person-name">${_esc(m.username || '')}</p>
                <p class="p-answers__message">${_esc(String(m.joinMessage).trim())}</p>
              </div>
            </div>`).join('')}
    </section>`;
}

/**
 * 参加時の回答ページ。
 * ★メンバー全員が見られる（アーカイブと同じ）。
 */
export function renderArchiveAnswers(container) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) { state.setView('HOME'); return; }

  const mode = state.answersMode === 'question' ? 'question' : 'user';
  const answered = (p.members || []).filter(m => m.joinedAnswersAt).length;

  // スタイル: public/css/object/project/_answers.css
  container.innerHTML = `
    <div class="p-answers u-page-transition">
      <!-- ★戻り先はアーカイブタブ。Components.Header はイベントページ用なので使わず、
           他のサブページ（イベント設定）と同じ l-header--sub で組む。 -->
      <header class="l-header l-header--sub">
        <button type="button" onclick="window._app.backToArchive()"
          class="l-header__back" aria-label="アーカイブへ戻る">
          <img src="/images/icon/iocn-Chevron.svg" class="l-header__back-icon" alt="">
        </button>
        <h1 class="l-header__heading">参加時の回答</h1>
      </header>
      <main class="p-answers__main">
        <p class="p-answers__lead">
          参加するときに答えてもらった内容です（${answered}／${(p.members || []).length}人が回答）
        </p>
        <div class="p-answers__tabs">
          <button type="button" data-answers-mode="user"
            class="p-answers__tab${mode === 'user' ? ' is-active' : ''}">ユーザー別</button>
          <button type="button" data-answers-mode="question"
            class="p-answers__tab${mode === 'question' ? ' is-active' : ''}">質問別</button>
        </div>
        ${mode === 'user' ? _byUser(p) : _byQuestion(p)}
      </main>
    </div>`;

  container.querySelectorAll('[data-answers-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.answersMode = btn.dataset.answersMode;
      state.render();
    });
  });
}
