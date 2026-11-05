// ===== 初期クエスト：目的（def-1）→ 企画（def-3）を必ず書いてもらう（2026-11-05）=====
// どのイベントでも（2つ目以降・既存のイベントでも）、目的と企画が空のあいだは、イベントを作った人（オーナー）に
// コーチマークで促す。★ほかの場所はタップできない（showCoachMark に onDismiss を渡さない）。
//
//   1. メインボードを開く → 下のタスク一覧の目的のタスクを指すコーチマーク（強制）→ タップでタスク詳細へ
//   2. タスク詳細は書き終えるまで戻れない（missionDetail.js が戻るボタンを出さない・state.closeMissionDetail も止める）
//   3. 書かずにアプリを閉じた・再読み込みした → 次にこのイベントのメインボードに入ったら、タスク詳細から始める
//      （「入った」印を localStorage に持つ。redirectGoalQuest）
//   4. 目的を書く →（柱が無ければ柱のページ。ここは今どおり「あとで」でとばせる）→ ボードで企画のコーチマーク（強制）
//
// ★何を書いてもらうかの判定は utils.js の goalQuestTask だけ（開催後・完了にしたイベントでは求めない）。
// ★初めてのイベントの初期オンボーディングとは、②（主要機能のコーチマーク）のあとに続く形でつながる。
//   以前の③（目的の促し・外をタップで閉じられた）は廃止し、ここに一本化した（onboardingIntro.js）。
// ★判定は state.render() 駆動のみ（バックグラウンドタイマー禁止）。

import { state } from './state.js';
import { logEvent } from './logger.js';
import { goalQuestTask, GOAL_PURPOSE_ID } from './utils.js';
import { setGoalQuestProbe } from './modalGuard.js';
import { showCoachMark, isCoachMarkOpen } from './modals/coachMark.js';
import { nextIntroStep, isIntroRunning, takePurposeCounter } from './onboardingIntro.js';

const COPY = {
  'def-1': { title: 'まずは、イベントの目的を決めよう。', body: '迷ったときに立ち返る軸になるよ。書き終えると、ほかの準備に進めます。' },
  'def-3': { title: '次は、企画をざっくり書いてみよう。', body: 'どんなイベントにしたいか、思いつくところからでOK。' },
};

const _enteredKey = (userId, eventId, mid) => `evecre:goalQuest:entered:v1:${userId}:${eventId}:${mid}`;

/** そのタスクの詳細に一度入ったか（＝次からはボードを飛ばして詳細から始める） */
export function hasEnteredGoalTask(userId, eventId, mid) {
  try { return localStorage.getItem(_enteredKey(userId, eventId, mid)) === '1'; } catch (_) { return false; }
}
export function markEnteredGoalTask(userId, eventId, mid) {
  try { localStorage.setItem(_enteredKey(userId, eventId, mid), '1'); } catch (_) {}
}

function _current() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const userId = state.currentUser?.id;
  return { p, userId, task: goalQuestTask(p, userId) };
}

/** タスク詳細のこのタスクを、書き終えるまで抜けられないか */
export function isGoalQuestLocked(p, userId, missionId) {
  return !!missionId && goalQuestTask(p, userId) === missionId;
}

// ★書いてもらっている間（ボード・タスク詳細）は、ほかの自動モーダルを止める
setGoalQuestProbe(() => {
  if (state.currentView !== 'MAIN_BOARD' && state.currentView !== 'MISSION_DETAIL') return false;
  return !!_current().task;
});

/**
 * ★メインボードを描く前に呼ぶ（mainBoard.js）。一度詳細に入ったのに書かずに抜けた人は、
 * ボードを出さずにタスク詳細から始める。飛ばしたら true。
 */
export function redirectGoalQuest() {
  const { p, userId, task } = _current();
  if (!task || !hasEnteredGoalTask(userId, p.id, task)) return false;
  logEvent('goal_quest_redirected', { missionId: task });
  state.openMissionDetail(task, { tab: 'MAIN' });
  return true;
}

/** ★state.render() からのみ呼ぶ。目的／企画が空ならコーチマークで指す（強制） */
export function checkGoalQuest() {
  if (state.currentView !== 'MAIN_BOARD') return;
  const { p, userId, task } = _current();
  if (!task) return;
  // 初めてのイベントの初期オンボーディング（①進め方・②主要機能）が先。終わったら次の render で来る
  if (isIntroRunning() || nextIntroStep()) return;
  if (isCoachMarkOpen()) return;
  if (document.getElementById('intro-usage-overlay') || document.getElementById('mission-overlay')) return;

  if (state.mainBoardTab !== 'MAIN') {
    state.mainBoardTab = 'MAIN';
    state.render();
    return;
  }

  const open = (via) => {
    markEnteredGoalTask(userId, p.id, task);
    logEvent('goal_quest_coach_tapped', { missionId: task, via });
    state.openMissionDetail(task, { tab: 'MAIN' });
  };
  // ★指すのは下のタスク一覧のカード（2026-11-05。上の初期クエストのカードではなく、タスクそのものを指す）
  const selector = `.p-main-board__mission[data-mission-id="${task}"]`;
  const copy = COPY[task];
  const shown = showCoachMark({
    selector,
    rect: true,
    title: copy.title,
    body: copy.body,
    hint: 'タップして書いてみよう',
    // ★初期オンボーディング②から続けて出たときだけ通し番号（②の最後の1つとして数える）
    counter: task === GOAL_PURPOSE_ID ? takePurposeCounter() : '',
    finger: true,
    advanceOn: 'target',   // ★onDismiss を渡さない＝穴の外のタップでは何も起きない
    onAdvance: () => open('coach'),
  });
  if (!shown) { open('direct'); return; }   // 指す先が無い。止めずに詳細へ（書いてもらうことは変わらない）
  logEvent('goal_quest_coach_shown', { missionId: task });
}
