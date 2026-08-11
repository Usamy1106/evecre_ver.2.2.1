// ===== オンボーディング（トリガー判定）=====
// 一度きりのツアーにせず、各段階に初めて到達した瞬間に1つだけ出す。
//
// ★purposeReminderModal.js と同じ方針で作ってある。踏襲すること。
//   - state.render() 駆動のみ。**バックグラウンドタイマー厳禁**
//     （誰も見ていないのに条件が進み、次に開いたとき溜まったモーダルが連続で出るため）
//   - 表示済みは localStorage（ユーザー×イベント×ステップ）
//   - 他のモーダルが開いていたら**フラグを立てずに持ち越す**（次の render() で再判定）
//   - **1回の render() で出すのは最大1つ**
//
// ★ミッションを自動追加しないこと。MountainMini は 完了数/全ミッション数 で
//   進捗を描くため、勝手に増やすと登山者が下がり、モチベーションを上げる目的の機能で
//   モチベーションの可視化を悪化させる。

import { state } from './state.js';
import { SKILL_TAGS } from './constants.js';
import { isAnyAutoModalOpen } from './modalGuard.js';
import { openOnboardingModal } from './modals/onboardingModal.js';

// ── 濃度 ────────────────────────────────────────────────────
// ★アカウント作成時の申告（users.eventExperience）ではなく、**実際に作ったイベント数**で決める。
//   申告は当てにならず、本番ユーザーは全員未設定でもある。現在のイベントも数に含める
//   （除外処理が要らず判定が3行で済む）。
export const DENSITY = { FIRST: 'first', FEW: 'few', MANY: 'many' };

/** 自分がオーナーのイベント数から濃度を決める（1件=first / 2〜5件=few / 6件以上=many）*/
export function densityOf(userId, events) {
  const n = (events || []).filter(e => e.ownerId === userId).length;
  return n <= 1 ? DENSITY.FIRST : n <= 5 ? DENSITY.FEW : DENSITY.MANY;
}

// ★この時刻より前に作られたイベントは「既存イベント」。オンボーディングを一度も
//   受けていないので、濃度に関わらず first（全部出す）として扱う。
export const EXISTING_EVENT_BEFORE = Date.parse('2026-08-11T00:00:00+09:00');

/** そのイベントで使う濃度。既存イベントは一律 first */
export function densityForEvent(userId, events, project) {
  if (project?.createdAt && project.createdAt < EXISTING_EVENT_BEFORE) return DENSITY.FIRST;
  return densityOf(userId, events);
}

// ── 表示済みフラグ ──────────────────────────────────────────
// 既存の命名（evecre:purposeReminder:v1:...）に揃える。
// iOS の容量逼迫で消えることがあるが、再表示されるだけなので許容する。
function _key(userId, eventId, stepId) {
  return `evecre:onboarding:v1:${userId}:${eventId}:${stepId}`;
}
export function isSeen(userId, eventId, stepId) {
  try { return !!localStorage.getItem(_key(userId, eventId, stepId)); } catch (_) { return false; }
}
export function markSeen(userId, eventId, stepId) {
  try { localStorage.setItem(_key(userId, eventId, stepId), String(Date.now())); } catch (_) {}
}
/** 最後に表示した時刻（未表示なら 0）。★繰り返し出すステップ（L4）で使う */
export function lastSeenAt(userId, eventId, stepId) {
  try { return Number(localStorage.getItem(_key(userId, eventId, stepId))) || 0; } catch (_) { return 0; }
}

// ── ステップ定義 ────────────────────────────────────────────
// role: 'leader'（canManage true）/ 'member'
// densities: そのステップを出す濃度。first は全部出す
// match(ctx): 表示条件。ctx = { p, userId, canManage, density }
// build(ctx): openOnboardingModal に渡す内容
// repeatEveryMs: 指定すると既読でもこの間隔で再表示する（L4 のみ。承認されるまで催促する）
//
// ★優先度は配列の並び。放置されると被害が大きいものを先に置く。
const DAY_MS = 24 * 60 * 60 * 1000;

/** スキルIDを日本語ラベルに直す（表示用。保存は英数キーのまま） */
function _skillLabels(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map(id => SKILL_TAGS.find(t => t.id === id)?.label).filter(Boolean);
}

/** 24時間以上ほったらかしになっている参加申請 */
function _stalePending(p) {
  const now = Date.now();
  return (p.pendingMembers || []).filter(m => m.requestedAt && now - m.requestedAt >= DAY_MS);
}

const STEPS = [
  {
    // ★参加は承認制の1本道。リーダーが承認しない限りメンバーは1人も入れないのに、
    //   リーダー側からは「招待したのに誰も来ない」ようにしか見えない。現状いちばんの
    //   ボトルネックなので、濃度に関わらず必ず出し、承認されるまで24時間ごとに催促する。
    id: 'L4',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    repeatEveryMs: DAY_MS,          // ★これがあるステップは「既読でも」再表示される
    match: (ctx) => _stalePending(ctx.p).length > 0,
    build: (ctx) => {
      const stale = _stalePending(ctx.p);
      const first = stale[0];
      const good  = _skillLabels(first.skillsGood).slice(0, 2);
      const more  = stale.length - 1;
      return {
        eyebrow: '承認をお待ちしています',
        title: `${_escapeName(first.username)}さんが<br>参加を待っています`,
        body: (good.length ? `${good.join('・')}が得意だそうです。` : '')
          + (more > 0 ? `ほか${more}人が承認待ちです。` : '')
          + '承認するまで、この人はイベントに入れません。',
        primary: '承認画面をひらく',
        action: 'openPendingMembers',
      };
    },
  },
  {
    id: 'L1',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    // イベントを作った直後（＝管理者として初めてこのイベントを開いたとき）
    match: () => true,
    build: () => ({
      eyebrow: 'イベクリの使い方',
      title: 'イベントは<br>5つのステップで進みます',
      steps: [
        ['決める', '何をやるかを決める'],
        ['積む',   'やることを洗い出して日付を入れる'],
        ['配る',   '誰がやるかを決める'],
        ['こなす', '実行して提出する'],
        ['残す',   '振り返って次に引き継ぐ'],
      ],
      // ★def-1〜3 が最初から入っているので「最初の1件を作ろう」は不正確。
      //   「作ってみよう」に留める（指示どおり）。
      body: 'まずは、やることをミッションとして書き出すところから。',
      primary: 'ミッションを作ってみよう！',
      action: 'openMissionModal',
    }),
  },
];

/** title は raw で埋めるので、ユーザー名だけはここでエスケープする */
function _escapeName(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ── 判定の入口 ──────────────────────────────────────────────
/**
 * ★state.render() からのみ呼ぶこと。
 * 条件を満たすステップのうち、優先度が最も高い1件だけを表示する。
 */
export function checkOnboarding() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;

  // 他の自動表示モーダルが開いていたら、フラグを立てずに持ち越す
  if (isAnyAutoModalOpen()) return;

  const userId    = state.currentUser.id;
  const canManage = state.canManageCurrentEvent(p.id);
  const role      = canManage ? 'leader' : 'member';
  const density   = densityForEvent(userId, state.events, p);
  const ctx = { p, userId, canManage, density };

  for (const step of STEPS) {
    if (step.role !== role) continue;
    if (!step.densities.includes(density)) continue;
    // 通常は一度きり。repeatEveryMs があるステップは、その間隔を空けて再表示する
    if (step.repeatEveryMs) {
      if (Date.now() - lastSeenAt(userId, p.id, step.id) < step.repeatEveryMs) continue;
    } else if (isSeen(userId, p.id, step.id)) {
      continue;
    }
    let hit = false;
    try { hit = !!step.match(ctx); } catch (_) { hit = false; }
    if (!hit) continue;

    markSeen(userId, p.id, step.id);
    openOnboardingModal({ stepId: step.id, role, density, ...step.build(ctx) });
    return;   // ★1回の render() で出すのは1つだけ
  }
}
