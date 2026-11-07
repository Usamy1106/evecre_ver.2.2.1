// ===== アーカイブのコーチマーク（はじめてアーカイブに入ったとき。2026-11-05）=====
// アーカイブでできること（記録が1つの文書にまとまる／目次／編集する／宣伝用の公開）を順に指す。
// ★最後に「このイベントの基礎情報を宣伝用に公開するか」のモーダルを出す（管理者・まだ答えていないイベント）。
//   概要を書いた時点で出すのはやめた（publicBasicInfoModal.js）。
// ★コーチマークは**ユーザーにつき1回**（説明はイベントが変わっても同じ。onboarding.js の oncePerUser と同じ考え方）。
//   2つ目以降のイベントでは、アーカイブに入ったときに「公開するか」だけを出す（イベントごとに1回。答えはイベントに残る）。
// ★どこをタップしても次へ（advanceOn:'anywhere'。操作を強制しない）。指す先が無いステップは飛ばし、番号は残った数で詰める。
// ★判定は state.render() 駆動のみ。

import { state } from './state.js';
import { logEvent } from './logger.js';
import { showCoachMark, isCoachMarkOpen } from './modals/coachMark.js';
import { isAnyAutoModalOpen } from './modalGuard.js';
import { isIntroRunning } from './onboardingIntro.js';
import { checkPublicBasicInfoModal } from './modals/publicBasicInfoModal.js';
import { isArchiveBusy } from './archiveInlineEdit.js';

const _key = (userId) => `evecre:archiveTour:v1:${userId}`;
function _seen(userId) { try { return localStorage.getItem(_key(userId)) === 'done'; } catch (_) { return false; } }
function _markSeen(userId) { try { localStorage.setItem(_key(userId), 'done'); } catch (_) {} }

const STEPS = [
  { selector: '.p-archive__title', title: 'ここはイベントの記録だよ。',
    body: '完了したタスクの内容が、1つの文書にまとまっていくよ。' },
  { selector: '.p-archive__toc-head', title: '目次から、各記録へ飛べるよ。',
    body: 'ラベル・完了日・優先度で並べ替えられるよ。' },
  { selector: '.p-archive__view-toggle', title: '記録はそのまま書き直せるよ。',
    body: 'タイトル・概要・場所や、タスクの内容と振り返りは、タップしてそのまま書けるよ。通して読みたいときは「プレビュー」。', managerOnly: true },
  { selector: '.p-archive__public', title: 'ここの情報は、宣伝に使えるよ。',
    body: 'タイトル・概要・期間・場所・ヘッダー画像を、イベクリの外に公開できるよ。' },
];

let _running = false;

/** ★state.render() からのみ呼ぶ（アーカイブのタブを開いているとき） */
export function checkArchiveTour() {
  if (state.currentView !== 'MAIN_BOARD' || state.mainBoardTab !== 'ARCHIVE') return;
  const userId = state.currentUser?.id;
  // ★管理者は常に編集中なので、「書いている途中か」で待つ（isArchiveBusy）。プレビュー中も出してよい
  if (!userId || _running || isArchiveBusy()) return;
  if (_seen(userId)) { checkPublicBasicInfoModal(); return; }
  if (isIntroRunning() || isCoachMarkOpen() || isAnyAutoModalOpen()) return;   // 重なったら次の render へ持ち越す

  const canMgr = state.canManageCurrentEvent();
  const steps = STEPS.filter(s => (!s.managerOnly || canMgr) && document.querySelector(s.selector));
  if (steps.length === 0) return;
  _running = true;
  logEvent('archive_tour_shown', { total: steps.length });

  const finish = () => {
    _running = false;
    _markSeen(userId);
    logEvent('archive_tour_done');
    // ★最後に「宣伝用に公開するか」（管理者・まだ答えていないイベントだけ。判定はモーダル側）
    setTimeout(() => checkPublicBasicInfoModal(), 200);
  };
  const show = (i) => {
    if (state.currentView !== 'MAIN_BOARD' || state.mainBoardTab !== 'ARCHIVE') { _running = false; return; }
    const s = steps[i];
    const isLast = i === steps.length - 1;
    const ok = showCoachMark({
      selector: s.selector, title: s.title, body: s.body, rect: true,
      counter: `${i + 1}/${steps.length}`, hint: 'タップで次へ', advanceOn: 'anywhere',
      onAdvance: () => { if (isLast) finish(); else show(i + 1); },
    });
    if (!ok) { if (isLast) finish(); else show(i + 1); }
  };
  show(0);
}
