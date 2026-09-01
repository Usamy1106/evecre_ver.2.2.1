// ===== ユーザー紹介モーダル =====
// メンバーのアイコンをタップすると開く自己紹介。
// 「誰に何を頼めるか」がアイコンから1タップで分かるようにするためのもの。
//
// 出す場所：アイコンが並ぶところ全部（イベント設定のメンバー一覧・ロール設定、
// ミッション詳細のチャット、承認待ちの一覧など）。
// ★呼び出し側は Components.UserAvatar に { userId } を渡すだけでよい。
//   ラップと onclick は UserAvatar が付ける（components.js）。
//
// 表示する内容は2種類あり、出どころが違う：
//   1. タイプ    … アカウント作成時の診断（users）。/api/data の members[].profile
//                  ★サーバーが「他人に見せてよい3項目」だけを載せている（_memberProfile）。
//                    ここで members から生の users を読まないこと。
//   2. 得意 / やってみたい / 意気込み
//                … 参加申請フォームの回答（members[]。イベントごとに違う）
//   3. リーダーの意気込み
//                … ★オーナーだけ。オーナーは参加申請フォームを通らないので
//                  joinMessage を持たない（イベントを作った側のため）。代わりに
//                  イベント作成 STEP 6 の意気込み（motivationTags / motivationText）を出す。
//                  実体はイベント側にあるので、members ではなくイベントから引く。
//
// ★どちらも未回答がありうる。空欄を並べず、あるものだけ出す
//   （プロフィールカード signup.js と同じ方針）。

import { state } from '../state.js';
import { Components } from '../components.js';
import { SKILL_TAGS, MOTIVATION_CARDS } from '../constants.js';

const OVERLAY_ID = 'user-profile-overlay';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** スキルの英数キー → 日本語ラベル。★保存は英数キーのみ（文言を後から変えられるように） */
function _skillLabels(ids) {
  if (!Array.isArray(ids)) return [];
  return ids
    .map(id => SKILL_TAGS.find(t => t.id === id)?.label)
    .filter(Boolean);
}

/**
 * 診断の回答 → タグ。★signup.js の _profileTags と同じ対応にすること
 *   （同じ人が別の画面で違うラベルに見えると混乱する）。
 */
function _typeTags(profile) {
  const p = profile || {};
  const out = [];
  const exp = { first: 'はじめて', few: '経験あり', many: 'ベテラン' }[p.eventExperience];
  if (exp) out.push({ label: exp, color: 'var(--color-primary)' });
  const planning = { planner: '計画派', mover: '勢い派' }[p.workStylePlanning];
  if (planning) out.push({ label: planning, color: 'var(--color-success)' });
  const social = { group: 'ワイワイ派', solo: 'もくもく派' }[p.workStyleSocial];
  if (social) out.push({ label: social, color: 'var(--color-warning)' });
  return out;
}

/** 現在開いているイベント */
function _currentEvent() {
  return state.events.find(x => x.id === state.selectedEventId) || null;
}

/** 現在開いているイベントから、そのユーザーのメンバー情報を引く */
function _findMember(userId) {
  return (_currentEvent()?.members || []).find(m => m.userId === userId) || null;
}

/**
 * オーナーの意気込み（イベント作成 STEP 6 の回答）。
 * ★カードと一言は別フィールドで持っている。片方だけの人がいるので両方見る。
 * ★オーナー以外に対しては呼ばない。イベントの意気込みは「作った人の言葉」なので、
 *   他のメンバーのカードに出すと発言者を取り違える。
 */
function _leaderMotivation(p) {
  const ids  = Array.isArray(p?.motivationTags) ? p.motivationTags : [];
  const cards = ids
    .map(id => MOTIVATION_CARDS.find(c => c.id === id)?.label)
    .filter(Boolean);   // ★選択肢から消えた id（例: 旧 'trust'）はここで落ちる
  const text = String(p?.motivationText || '').trim();
  return { cards, text };
}

function _chipsHtml(labels, modifier) {
  if (labels.length === 0) return '';
  return `<div class="p-user-profile__chips">${labels.map(l =>
    `<span class="p-user-profile__chip p-user-profile__chip--${modifier}">${_esc(l)}</span>`).join('')}</div>`;
}

/**
 * ユーザー紹介モーダルを開く。
 * ★メンバーが見つからないときは開かない（退会者のアイコンが残っている場合など）。
 *   空のモーダルを出すより、何も起きないほうがまだ良い。
 */
export function openUserProfileModal(userId) {
  if (!userId) return;
  document.getElementById(OVERLAY_ID)?.remove();

  const mem = _findMember(userId);
  if (!mem) return;

  const p        = _currentEvent();
  const isOwner  = !!p && p.ownerId === userId;
  const typeTags = _typeTags(mem.profile);
  const good     = _skillLabels(mem.skillsGood);
  const want     = _skillLabels(mem.skillsWant);
  const message  = String(mem.joinMessage || '').trim();
  // ★オーナーは参加申請フォームを通らないので joinMessage が空。
  //   代わりにイベント作成時の意気込みを出す（この人がこのイベントを始めた理由）。
  const leader   = isOwner ? _leaderMotivation(p) : { cards: [], text: '' };
  const hasLeader = leader.cards.length > 0 || !!leader.text;
  // ★何も答えていない人がいる（参加申請フォームより前から居るメンバーなど）。
  //   その場合でも名前とアイコンは出す。無言のカードにしないため一文添える。
  const isEmpty = typeTags.length === 0 && good.length === 0 && want.length === 0
                  && !message && !hasLeader;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // スタイル: public/css/object/project/_user-profile.css
  overlay.className = 'c-overlay c-overlay--center';
  overlay.innerHTML = `
    <div class="c-modal c-modal--compact u-animate-fade p-user-profile">
      <button type="button" data-up-close class="c-modal__close" aria-label="閉じる">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div class="p-user-profile__head">
        ${Components.UserAvatar({ username: mem.username, avatarUrl: mem.avatarUrl }, { size: 72, ring: true })}
        <p class="p-user-profile__name">${_esc(mem.username || '')}</p>
        ${isOwner ? `<p class="p-user-profile__role">リーダー</p>` : ''}
        ${typeTags.length ? `
          <div class="p-user-profile__types">
            ${typeTags.map(t => `<span class="p-user-profile__type" style="--type-color:${t.color}">${_esc(t.label)}</span>`).join('')}
          </div>` : ''}
      </div>

      ${hasLeader ? `
        <section class="p-user-profile__section">
          <p class="p-user-profile__label">このイベントへの意気込み</p>
          ${leader.cards.length ? _chipsHtml(leader.cards, 'motivation') : ''}
          ${leader.text ? `<p class="p-user-profile__message">${_esc(leader.text)}</p>` : ''}
        </section>` : ''}

      ${message ? `
        <section class="p-user-profile__section">
          <p class="p-user-profile__label">意気込み</p>
          <p class="p-user-profile__message">${_esc(message)}</p>
        </section>` : ''}

      ${good.length ? `
        <section class="p-user-profile__section">
          <p class="p-user-profile__label">できること</p>
          ${_chipsHtml(good, 'good')}
        </section>` : ''}

      ${want.length ? `
        <section class="p-user-profile__section">
          <p class="p-user-profile__label">やってみたいこと</p>
          ${_chipsHtml(want, 'want')}
        </section>` : ''}

      ${isEmpty ? `
        <p class="p-user-profile__empty">まだ自己紹介が登録されていません</p>` : ''}
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('[data-up-close]').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}
