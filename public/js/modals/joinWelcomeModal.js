// ===== 参加した人への「ようこそ」モーダル（2026-10-12）=====
//
// 参加申請が承認されてイベントに入った人（管理者・メンバー。オーナー以外）に、最初に1回だけ出す。
// 役割（ロール）が割り当てられていれば「あなたの役割は〇〇です」と明示する。
// メンバーのまま（member だけ）なら「ようこそ」だけ。
//
// ★参加した人の歓迎の順番（ここが先頭）：
//     ようこそ（これ）→ 進め方（管理者＝初期オンボーディング①の STEP 1〜5／メンバー＝M1 の STEP01〜03）
//     → 🔥リーダーの意気込み（leaderMotivationModal）→（管理者は）コーチマーク
//   ★後ろの段階は isJoinWelcomePending() を見て順番を譲る：
//     onboardingIntro.nextIntroStep / onboarding.checkOnboarding / leaderMotivationModal
// ★既読は「次へ」を押したとき（閉じたとき）に立てる。出しただけでは立てない
//   （読む前に再読み込みした人には、次にイベントを開いたときまた出す。初期オンボーディング①と同じ考え方）
// ★JOIN_WELCOME_START_AT より前に参加した人には出さない（既存のメンバーに今さら「ようこそ」と言わない）
// ★判定は state.render() からのみ（バックグラウンドタイマー厳禁。ほかの自動モーダルと同じ）

import { state } from '../state.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { logEvent } from '../logger.js';

export const JOIN_WELCOME_OVERLAY_ID = 'join-welcome-overlay';

// この日時以降に参加した人だけが対象（リリース日）
const JOIN_WELCOME_START_AT = Date.parse('2026-10-12T00:00:00+09:00');

// 組み込みのロールの名前（サーバーの eventStore.defaultRoles と同じ）。
// ★多くのイベントは roles を保存していないので、組み込みで補う（publicBasicInfoModal.js の isManagerStrict と同じ考え方）
const BUILTIN_ROLE_NAMES = { owner: 'オーナー', admin: '管理者', member: 'メンバー' };

const _key = (userId, eventId) => `evecre:joinWelcome:v1:${userId}:${eventId}`;

/** このユーザー×イベントで、まだ「ようこそ」を出す予定が残っているか（副作用なし） */
export function isJoinWelcomePending(p, userId) {
  if (!p || !userId) return false;
  if (p.ownerId === userId) return false;                      // 作った本人は参加者ではない
  const me = (p.members || []).find(m => m.userId === userId);
  if (!me) return false;                                       // ★members から厳密に（まだ入っていなければ持ち越し）
  if (!(me.joinedAt >= JOIN_WELCOME_START_AT)) return false;   // 以前から居る人には出さない
  try { return !localStorage.getItem(_key(userId, p.id)); } catch (_) { return false; }
}

/** 自分に割り当てられた役割の名前（member だけなら空配列） */
export function assignedRoleNames(p, userId) {
  const me = (p?.members || []).find(m => m.userId === userId);
  if (!me) return [];
  const ids = Array.isArray(me.roles) && me.roles.length > 0 ? me.roles : [me.role];
  const defs = Array.isArray(p.roles) ? p.roles : [];
  return [...new Set(ids)]
    .filter(id => id && id !== 'member' && id !== 'owner')
    .map(id => defs.find(r => r.id === id)?.name || BUILTIN_ROLE_NAMES[id] || null)
    .filter(Boolean);
}

/** ★state.render() からのみ呼ぶ */
export function checkJoinWelcomeModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const userId = state.currentUser?.id;
  if (!p || !userId) return;
  if (!isJoinWelcomePending(p, userId)) return;
  if (isAnyAutoModalOpen(JOIN_WELCOME_OVERLAY_ID)) return;   // 重なったら持ち越す（既読は立てない）
  if (document.getElementById(JOIN_WELCOME_OVERLAY_ID)) return;
  _open(p, userId);
}

function _open(p, userId) {
  const roles = assignedRoleNames(p, userId);
  const overlay = document.createElement('div');
  overlay.id = JOIN_WELCOME_OVERLAY_ID;
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--auto';
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade" role="dialog" aria-modal="true" aria-labelledby="join-welcome-title">
      <img src="/images/onboarding/onboarding-welcome.webp" class="c-modal__stage-art" width="1081" height="721" alt="">
      <p class="c-modal__eyebrow">ようこそ</p>
      <h3 id="join-welcome-title" class="c-modal__title c-modal__title--wide">「${_esc(p.name || 'イベント')}」へ<br>ようこそ！</h3>
      ${roles.length ? `
      <div class="c-modal__body">
        <p class="c-modal__lead">あなたの役割は<strong>${_esc(roles.join('・'))}</strong>です</p>
      </div>` : ''}
      <button type="button" data-jw="next" class="c-button c-button--primary c-modal__button c-modal__button--roomy">次へ</button>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('join_welcome_shown', { eventId: p.id, roleCount: roles.length });

  // ★外側のタップでは閉じない（出口は「次へ」だけ。次の段階へ確実につなぐ）
  overlay.querySelector('[data-jw="next"]').onclick = () => {
    try { localStorage.setItem(_key(userId, p.id), '1'); } catch (_) {}
    logEvent('join_welcome_next', { eventId: p.id });
    overlay.remove();
    // ★閉じたら必ず描き直す。次の段階（進め方 → 🔥）の判定は render() 駆動
    state.render();
  };
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
