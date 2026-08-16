// ===== 初期オンボーディング（イベント作成直後のチュートリアル）=====
// リーダーがイベントを作った直後に、①使い方 → ②FABコーチマーク →
// ③作成モーダルのツールチップ → ④メインボードのコーチマーク3連 を順に通す。
//
// ★4段階は厳密に順序があり、途中で中断・再開されうる。独立したフラグを並べず、
//   **1つの進行状態（状態機械）**として持つ。
//
// ★判定は state.render() 駆動のみ。バックグラウンドタイマー禁止
//   （CLAUDE.md の既存方針・purposeReminderModal.js と同じ）。
//
// ★進行中は他の自動表示モーダルを抑止する（modalGuard.js の isIntroRunning）。
//   ②は FAB のタップ以外に出口が無いため、他モーダルが前面に出ると本当に操作不能になる。

import { state } from './state.js';
import { logEvent } from './logger.js';
import { setIntroRunningProbe } from './modalGuard.js';

// ── 進行状態 ────────────────────────────────────────────────
export const INTRO = {
  NONE:  null,          // 未開始
  USAGE: 'usage_shown', // ①表示済み。★FAB をタップするまで②を出し続ける
  FAB:   'fab_coach',   // ★FAB を実際にタップした。③待ち
  FORM:  'form_tour',   // ③表示済み。④待ち
  DONE:  'done',        // 完了。以後表示しない
};

// ★この時刻より前に作られたイベントでは①〜④を一切出さない。
//   既存のテストユーザーが作ったイベントに、いまさらチュートリアルを出さないため。
//   ★ユーザー単位ではなくイベント単位（createdAt）で判定する。
//     既存ユーザーが新しく作ったイベントでは出るのが正しい。
//   ★デプロイ時に実際のリリース日時へ差し替えること（仮値のまま出さない）。
export const ONBOARDING_INTRO_START_AT = Date.parse('2026-08-16T00:00:00+09:00');

function _key(userId, eventId) {
  return `evecre:onboardingIntro:v1:${userId}:${eventId}`;
}

/** 現在の進行状態（未開始は null） */
export function getIntroState(userId, eventId) {
  try { return localStorage.getItem(_key(userId, eventId)); } catch (_) { return null; }
}

export function setIntroState(userId, eventId, value) {
  try { localStorage.setItem(_key(userId, eventId), value); } catch (_) {}
}

/**
 * このユーザーが**他のイベントで**イントロを完了しているか。
 * ★2つ目以降のイベントでは出さない（同じ説明を繰り返さない）。
 *   状態キーはイベント単位のまま、ここで横断的に判定する。
 */
export function hasCompletedElsewhere(userId, currentEventId) {
  try {
    const prefix = `evecre:onboardingIntro:v1:${userId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (k === _key(userId, currentEventId)) continue;
      if (localStorage.getItem(k) === INTRO.DONE) return true;
    }
  } catch (_) {}
  return false;
}

/**
 * このイベントでイントロを動かしてよいか。
 * ★フラグより先に「既存イベントか」を評価する（localStorage を消しても復活させない）。
 */
export function isIntroEligible(userId, project) {
  if (!userId || !project) return false;
  if (!(project.createdAt >= ONBOARDING_INTRO_START_AT)) return false;   // 既存イベント
  if (!state.canManageCurrentEvent(project.id)) return false;            // リーダー向け
  if (getIntroState(userId, project.id) === INTRO.DONE) return false;
  if (hasCompletedElsewhere(userId, project.id)) return false;           // 2つ目以降
  return true;
}

// ── 進行中フラグ（他モーダルの抑止に使う）──────────────────
// ★DOM の有無ではなく明示フラグで持つ。②→③のようにモーダルが一瞬いなくなる
//   タイミングがあり、その隙に他モーダルが割り込むのを防ぐため。
let _running = false;
export function isIntroRunning() { return _running; }
export function setIntroRunning(v) { _running = !!v; }
// modalGuard へ注入（これで6種の自動表示モーダルが一括で抑止される）
setIntroRunningProbe(isIntroRunning);

/**
 * ★state.render() からのみ呼ぶこと。
 * 現在の進行状態を見て、次に出すべき段階を返す（表示自体は各 Phase で実装する）。
 * @returns {'usage'|'fab'|'board'|null} 次に出す段階
 */
export function nextIntroStep() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return null;
  if (!isIntroEligible(state.currentUser.id, p)) return null;

  const cur = getIntroState(state.currentUser.id, p.id);
  if (cur === INTRO.NONE || cur === null) return 'usage';   // ①
  // ★usage_shown の間は②を出し続ける。②の出口は FAB のタップだけなので、
  //   アプリを落として戻ってきたときにコーチマークが消えていると先へ進めなくなる。
  //   FAB を実際にタップしたとき（Phase C）に fab_coach へ進めること。
  if (cur === INTRO.USAGE) return 'fab';                    // ②
  // ③はミッション作成モーダルを開いた時に出すので、ここでは扱わない
  if (cur === INTRO.FORM)  return 'board';                  // ④
  return null;
}

/** 段階を進める（ログもここで出す） */
export function advanceIntro(to, extra = {}) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  setIntroState(state.currentUser.id, p.id, to);
  if (to === INTRO.DONE) {
    setIntroRunning(false);
    logEvent('intro_completed', extra);
  }
}
