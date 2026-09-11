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
 * このユーザー×イベントで、これから🔥を出す予定が残っているか。
 *
 * ★歓迎は「🔥 → 使い方 → 機能紹介」の順に見せたい。初期オンボーディング
 *   （onboardingIntro）は進行中に他のモーダルを全部止めるので、先に走ると
 *   🔥が永久に出なくなる。あちらがこれを見て順番を譲る。
 */
export function isLeaderMotivationPending(p, userId) {
  if (!p || !userId) return false;
  if (!_hasMotivation(p)) return false;          // そもそも出すものが無い
  if (p.ownerId === userId) return false;        // 書いた本人には見せない
  try { return !localStorage.getItem(_storageKey(userId, p.id)); } catch (_) { return false; }
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
  overlay.className = 'c-overlay c-overlay--center c-overlay--blur c-overlay--welcome u-page-transition';
  // Lottie のインスタンス。★閉じるときに必ず destroy する（下記 closeWithExit）
  let idleAnim = null;
  let pressedAnim = null;

  // ★閉じたら必ず state.render() を呼ぶこと。これは歓迎の1枚目で、閉じたあとに
  //   メンバー向けの案内（進め方）が続く。render() を呼ばないと次の判定が走らず、
  //   「🔥は出たのに進め方が出ない」状態になる（実際にその報告を受けた）。
  // ★Lottie は DOM を消しても requestAnimationFrame のループが止まらない。
  //   destroy() を忘れると、閉じたあともバックグラウンドで回り続ける
  //   （0.5CPU の環境で山のスクロール 60fps を削る）。
  let closed = false;
  const close = () => {
    if (closed) return;              // 退場アニメと時間切れの二重発火を防ぐ
    closed = true;
    try { idleAnim?.destroy(); } catch (_) {}
    try { pressedAnim?.destroy(); } catch (_) {}
    overlay.remove();
    state.render();
  };

  /**
   * 退場アニメーション（暗幕フェード＋白い箱が上へ抜ける）を見せてから閉じる。
   *
   * ★animationend は**バブリングする**。火の粉やボタンのバウンドは子要素で
   *   0.5秒動いているので、target を見ずに拾うと退場が始まる前に閉じてしまう。
   *   必ず overlay 自身のアニメーションだけを見ること。
   * ★時間切れの保険を必ず持つこと。prefers-reduced-motion などで animation が
   *   走らないと animationend は永久に来ず、モーダルが閉じなくなる。
   */
  const closeWithExit = () => {
    if (closed) return;
    overlay.classList.add('is-leaving');
    overlay.querySelector('.c-modal')?.classList.add('u-animate-fade-up-out');
    overlay.addEventListener('animationend', (e) => {
      if (e.target === overlay) close();
    });
    setTimeout(close, 600);          // --duration-normal(.25s) に対する充分な余裕
  };

  overlay.onclick = (e) => { if (e.target === overlay) closeWithExit(); };
  document.body.appendChild(overlay);

  // 操作は🔥の円形ボタン1つだけ（「閉じる」は置かない）。押すと応援を送って閉じる。
  // 背景タップでも閉じられる（overlay.onclick）。
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade">
      <h3 class="c-modal__title c-modal__title--wide">「${_esc(p.name || 'イベント')}」に<br>ようこそ！</h3>

      <div class="p-invite__motivation">
        <p class="p-invite__motivation-label">
          ${_esc(_leaderName(p))}さんの意気込み
        </p>
        ${p.catchphrase ? `
          <p class="p-invite__catchphrase">${_esc(p.catchphrase)}</p>
        ` : ''}
        <div class="c-invite-motivation__tags">
          ${labels.map(l => `
            <span class="c-invite-motivation__tag">${_esc(l)}</span>
          `).join('')}
        </div>
        ${text ? `<p class="p-invite__text">「${_esc(text)}」</p>` : ''}
      </div>

      <!-- ★押すとモーダルが閉じる。「閉じる」は置かない（🔥が出口を兼ねる）
           ★fallback の絵文字を必ず残すこと。json が未配置・読み込み失敗でも
             ここに落ちれば従来どおり動く（Lottie が読めたら JS が hidden にする）。
           ★火の粉は専用ラッパーの中に入れる。ボタン直下に並べると、Lottie や
             fallback を足し引きするたび CSS の nth-child がずれる。 -->
      <div class="p-invite__fire-wrap">
        <button type="button" id="lm-fire" class="p-invite__fire" aria-label="🔥で応援する">
          <span class="p-invite__fire-fallback" id="lm-fire-fallback">🔥</span>
          <span class="p-invite__fire-lottie" id="lm-fire-idle" aria-hidden="true"></span>
          <span class="p-invite__fire-lottie" id="lm-fire-pressed" aria-hidden="true" hidden></span>
          <span class="p-invite__sparks" aria-hidden="true">
            <span class="p-invite__spark"></span>
            <span class="p-invite__spark"></span>
            <span class="p-invite__spark"></span>
            <span class="p-invite__spark"></span>
            <span class="p-invite__spark"></span>
            <span class="p-invite__spark"></span>
          </span>
        </button>
      </div>
    </div>`;

  // ── Lottie の読み込み ────────────────────────────────────
  // ★読み込み元はすべて自ドメイン。CDN や LottieFiles を参照しないこと（§セルフホスト）。
  // ★json が無い／壊れている／ライブラリが読めない、のどれでも絵文字に落ちる。
  //   落ちた先でも応援の送信とモーダルの開閉は従来どおり動くこと。
  const fallbackEl = document.getElementById('lm-fire-fallback');
  const idleEl     = document.getElementById('lm-fire-idle');
  const pressedEl  = document.getElementById('lm-fire-pressed');

  /** Lottie を諦めて絵文字に戻す */
  const useFallback = () => {
    if (idleEl) idleEl.hidden = true;
    if (pressedEl) pressedEl.hidden = true;
    if (fallbackEl) fallbackEl.hidden = false;
  };

  if (window.lottie) {
    try {
      idleAnim = window.lottie.loadAnimation({
        container: idleEl, renderer: 'svg', loop: true, autoplay: true,
        path: '/animations/fire-idle.json',
      });
      // ★絵文字を消すのは**読み込めたと分かってから**。先に消すと、
      //   json が無いときに何も出ていないボタンになる。
      idleAnim.addEventListener('DOMLoaded', () => { if (fallbackEl) fallbackEl.hidden = true; });
      idleAnim.addEventListener('data_failed', useFallback);

      pressedAnim = window.lottie.loadAnimation({
        container: pressedEl, renderer: 'svg', loop: false, autoplay: false,
        path: '/animations/fire-pressed.json',
      });
      // pressed が読めなかったときは、再生完了を待たず時間で閉じる（下の分岐で見る）
      pressedAnim.addEventListener('data_failed', () => { pressedAnim = null; });
      // ★ボタンが縮む長さを、この json の**実尺**に合わせる。
      //   CSS に固定値を書くと、AE 側で尺を変えたときに噛み合わなくなる
      //   （0.5s 対 1.33s で、炎の6割が見えないまま閉じていた）。
      pressedAnim.addEventListener('DOMLoaded', () => {
        const sec = pressedAnim?.getDuration?.(false);
        if (sec > 0) {
          document.getElementById('lm-fire')
            ?.style.setProperty('--fire-launch-dur', `${sec}s`);
        }
      });
    } catch (_) {
      idleAnim = null;
      pressedAnim = null;
      useFallback();
    }
  } else {
    useFallback();     // ライブラリ自体が読めなかった（配置ミス等）
  }

  document.getElementById('lm-fire').onclick = () => {
    const btn = document.getElementById('lm-fire');
    btn.disabled = true;

    // ★押したら必ず閉じる。この画面にトグル解除はない（「閉じる」ボタンを置かない代わりに
    //   🔥が唯一の出口なので、既に押している人がうっかり取り消してしまわないようにする）。
    // ★既に押している人へは API を再送しないが、**演出は毎回見せる**。
    //   炎のアニメーションは見せ場なので、2回目だけ素通りさせない。
    if (!alreadyReacted) {
      // ★通信は投げっぱなしにする。演出を通信待ちで止めると、回線が遅いときに
      //   押しても何も起きない時間が生まれる。失敗はトーストだけで知らせる。
      api.toggleMotivationReaction(p.id, '🔥').then((r) => {
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
      }).catch(() => {
        window._app?.showToast('通信エラーが発生しました', 'error');
      });
    }

    // 演出：ボタンのバウンド＋火の粉、Lottie を idle → pressed へ
    btn.classList.add('is-launching');
    if (idleEl) idleEl.hidden = true;
    idleAnim?.pause();

    if (pressedAnim && pressedEl) {
      pressedEl.hidden = false;
      // 炎が消えきったところから退場を始める
      pressedAnim.addEventListener('complete', closeWithExit);
      pressedAnim.goToAndPlay(0, true);
    } else {
      // pressed が無い（json 未配置・絵文字フォールバック）。
      // ボタンのバウンド（.5s）が終わる頃合いで閉じる
      setTimeout(closeWithExit, 500);
    }
  };
}
