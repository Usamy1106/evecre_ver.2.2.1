// ===== リーダーの意気込みモーダル（参加直後の歓迎）=====
// 参加が承認されてイベントページに入った直後、リーダーの意気込みを見せて
// 🔥で応援できるようにする。
//
// なぜこのタイミングか：
//   申請の時点ではまだ仲間ではないので、応援を送るのは早い。承認されて
//   「中に入った」瞬間に見せるほうが、意気込みが自分ごとになる。
//
// 表示条件（すべて満たすとき）：
//   - イベントに意気込み（カード or ひとこと）がある
//   - 自分がオーナーではない（自分で書いた言葉を自分に見せない）
//   - このユーザー×イベントで初回（localStorage で永続化）
//
// 判定は render() 駆動のみ（バックグラウンドタイマー厳禁。
// CLAUDE.md「ミッション提案」節・purposeReminderModal と同じ方針）。

import { state } from '../state.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { MOTIVATION_CARDS } from '../constants.js';

const OVERLAY_ID = 'leader-motivation-overlay';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function _storageKey(userId, eventId) {
  return `evecre:leaderMotivation:v1:${userId}:${eventId}`;
}

function _hasMotivation(p) {
  return (p.motivationTags?.length || 0) > 0 || !!(p.motivationText || '').trim();
}

/** リーダー（オーナー）の表示名。members に合成済みの username を使う */
function _leaderName(p) {
  const owner = (p.members || []).find(m => m.userId === p.ownerId);
  return owner?.username || 'リーダー';
}

/**
 * 表示条件を判定して、満たしていればモーダルを開く。
 * ★state.render() からのみ呼ぶこと。
 */
export function checkLeaderMotivationModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;

  // 他の自動表示モーダルが開いていたら、フラグを立てずに持ち越す（次の render() で再判定）。
  // ★列挙は modalGuard.js に集約してある。ここに個別のIDを書き足さないこと
  if (isAnyAutoModalOpen()) return;

  if (!_hasMotivation(p)) return;                       // 意気込みが無ければ出さない
  if (p.ownerId === state.currentUser.id) return;       // 書いた本人には見せない

  const key = _storageKey(state.currentUser.id, p.id);
  if (localStorage.getItem(key)) return;                // 既に見た
  localStorage.setItem(key, '1');

  _openModal(p);
}

/** 設定画面などから手動で開くとき用（既読でも出す） */
export function openLeaderMotivationModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (p && _hasMotivation(p)) _openModal(p);
}

function _openModal(p) {
  document.getElementById(OVERLAY_ID)?.remove();

  const labels = (p.motivationTags || [])
    .map(id => MOTIVATION_CARDS.find(c => c.id === id)?.label)
    .filter(Boolean);
  const text = (p.motivationText || '').trim();

  // 自分が既に押しているか（motivationReactions は crdtToFlat で降ってくる）
  const list = Array.isArray(p.motivationReactions) ? p.motivationReactions : [];
  const alreadyReacted = list.some(r => r.userId === state.currentUser.id && r.emoji === '🔥');

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[220] flex items-center justify-center p-6 page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  // 操作は🔥の円形ボタン1つだけ（「閉じる」は置かない）。押すと応援を送って閉じる。
  // 背景タップでも閉じられる（overlay.onclick）。
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
      <h3 class="heading-m text-[#484545] font-bold mb-6">「${_esc(p.name || 'イベント')}」に<br>ようこそ！</h3>

      <div class="bg-[#FDFBF8] border border-[#E1DFDC] rounded-2xl p-5 mb-7">
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-3">
          ${_esc(_leaderName(p))}さんの意気込み
        </p>
        ${p.catchphrase ? `
          <p class="text-[14px] text-[#0CA1E3] font-bold leading-snug mb-3">${_esc(p.catchphrase)}</p>
        ` : ''}
        <div class="flex flex-wrap gap-1.5 justify-center">
          ${labels.map(l => `
            <span class="text-[11px] font-bold text-[#EE3E12] bg-[#EE3E12]/10 px-2.5 py-1 rounded-full">${_esc(l)}</span>
          `).join('')}
        </div>
        ${text ? `<p class="text-[13px] text-[#484545] font-bold mt-3 leading-relaxed">「${_esc(text)}」</p>` : ''}
      </div>

      <div class="flex justify-center">
        <button id="lm-fire"
          class="w-24 h-24 rounded-full bg-[#EE3E12] text-white text-[40px] leading-none
            shadow-[0_6px_20px_rgba(238,62,18,0.4)] flex items-center justify-center
            active:scale-90 transition-transform">
          🔥
        </button>
      </div>
    </div>`;

  document.getElementById('lm-fire').onclick = async () => {
    const btn = document.getElementById('lm-fire');
    btn.disabled = true;
    // ★押したら必ず閉じる。この画面にトグル解除はない（「閉じる」ボタンを置かない代わりに
    //   🔥が唯一の出口なので、既に押している人がうっかり取り消してしまわないようにする）。
    if (alreadyReacted) { overlay.remove(); return; }
    try {
      const r = await api.toggleMotivationReaction(p.id, '🔥');
      if (r?.ok && r.mine) {
        logEvent('motivation_reaction_added', { emoji: '🔥' });
        // 手元のイベントにも反映しておく（再表示時に二重送信しないように）
        p.motivationReactions = [
          ...(p.motivationReactions || []).filter(x => x.userId !== state.currentUser.id),
          { userId: state.currentUser.id, emoji: '🔥', at: Date.now() },
        ];
      } else if (!r?.ok) {
        window._app?.showToast(r?.error || '送信に失敗しました', 'error');
      }
    } catch (_) {
      window._app?.showToast('通信エラーが発生しました', 'error');
    }
    overlay.remove();   // 送信の成否にかかわらず閉じる（歓迎の場で足止めしない）
  };
}
