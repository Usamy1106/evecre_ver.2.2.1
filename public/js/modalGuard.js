// ===== 「いま何か開いているか」の共通判定 =====
// render() 駆動で自動的に出るモーダル（目的リマインド／開催日リマインド／お知らせ／
// リーダーの意気込み🔥／インフォメーション／オンボーディング）は、互いに重ならないよう
// 表示前にこれを呼ぶ。
//
// ★以前は各モーダルが「自分より前のモーダルID」を個別に列挙していたため、
//   追加のたびに全ファイルを直す必要があり、実際に抜けが出ていた
//   （devAnnouncement が leader-motivation を見ておらず、🔥の裏にお知らせが
//   描画されうる状態だった）。ここ1箇所に集約する。
//
// ★重なって出せなかったときは「表示済みフラグを立てずに」持ち越すこと。
//   次の render() で再判定される（purposeReminderModal.js が元の実装）。

/**
 * 自動表示モーダルの ID。z-index の低い順に並べてあるが、判定は存在するかどうかだけ。
 * 手動で開くもの（招待発行・ミッション作成など）はユーザーの意思で開いているので含めない。
 */
export const AUTO_MODAL_IDS = [
  'info-modal-overlay',            // インフォメーション（承認待ち・提案あり等）
  'purpose-reminder-overlay',      // 目的リマインド
  'event-date-reminder-overlay',   // 開催日リマインド
  'dev-announcement-overlay',      // 開発者からのお知らせ
  'leader-motivation-overlay',     // リーダーの意気込み＋🔥
  'onboarding-overlay',            // オンボーディング
];

// ★初期オンボーディング（onboardingIntro.js）が進行中かを見るためのフック。
//   循環 import を避けるため、onboardingIntro 側から関数を注入してもらう。
//   ②の FAB コーチマークは「FAB のタップ」以外に出口が無いので、そこへ他モーダルが
//   被さると本当に操作不能になる。DOM の有無ではなく明示フラグで判定する
//   （②→③のようにモーダルが一瞬いなくなる隙に割り込まれるのを防ぐため）。
let _isIntroRunning = () => false;
export function setIntroRunningProbe(fn) { _isIntroRunning = fn; }

/**
 * 自動表示モーダルが1つでも開いているか（＝いま新しいモーダルを出してはいけないか）。
 * ★初期オンボーディングの進行中も true を返す。
 * @param {string|null} exceptId 自分自身の ID（存在チェックから除きたいとき）
 * @returns {boolean}
 */
export function isAnyAutoModalOpen(exceptId = null) {
  if (_isIntroRunning()) return true;
  return AUTO_MODAL_IDS.some(id => id !== exceptId && !!document.getElementById(id));
}
