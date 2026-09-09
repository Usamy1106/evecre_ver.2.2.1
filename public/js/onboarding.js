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
import { SKILL_TAGS, MOTIVATION_CARDS } from './constants.js';
import { getArchiveSummary, getArchiveVenue, todayStr } from './utils.js';
import { isIntroEligible, getIntroState } from './onboardingIntro.js';
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

// ★ここより上でも使うので、いちばん先に置く（const は巻き上がらない）
const DAY_MS = 24 * 60 * 60 * 1000;

// ── 参加したばかりかどうか ──────────────────────────────────
// 入ったばかりの人に「困ったら目的に立ち返ろう」と言っても、まだ何も始めていない
// ので響かない。それどころか歓迎（リーダーの意気込み＋🔥 → 進め方）の枠を奪う。
// 実際に「参加した直後に目的リマインドと『ミッションがひとつ終わりました』が出て、
// 🔥と進め方が出なかった」という報告を受けた。
//
// ★オーナーは対象外。イベントを作った本人は「参加したばかり」ではない。
// ★members に自分が居ないとき（データ未取得）は true を返す＝出さない側に倒す。
//   分からないまま案内を出すより、次の render() まで待つほうが安全。
export const NEWCOMER_MS = 7 * DAY_MS;

/**
 * このユーザーがそのイベントに参加したばかりか。
 * @param {object} p イベント（flat 形式）
 * @param {string} userId
 */
export function isNewcomer(p, userId) {
  if (!p || !userId) return false;
  if (p.ownerId === userId) return false;              // 作った本人は対象外
  const me = (p.members || []).find(m => m.userId === userId);
  if (!me) return true;                                // データ未取得。出さない側に倒す
  if (!me.joinedAt) return false;                      // 参加日時が無い古いデータは従来どおり
  return (Date.now() - me.joinedAt) < NEWCOMER_MS;
}

// ── ステップ定義 ────────────────────────────────────────────
// role: 'leader'（canManage true）/ 'member' / 'any'（どちらにも出す）
// densities: そのステップを出す濃度。first は全部出す
// match(ctx): 表示条件。ctx = { p, userId, canManage, density }
// build(ctx): openOnboardingModal に渡す内容
// repeatEveryMs: 指定すると既読でもこの間隔で再表示する（L4 のみ。承認されるまで催促する）
//
// ★優先度は配列の並び。放置されると被害が大きいものを先に置く。

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


// ── L5 で使うヘルパ ────────────────────────────────────────
// スキルタグ（12種）→ ミッションのタグ（4種）の対応。
// ★ミッションのタグは 企画/運営/制作/広報 の4つしかないので、ここで寄せて突き合わせる。
//   constants.js の SKILL_TAGS に足したらここにも足すこと（未定義は候補に出ないだけ）。
const SKILL_TO_MISSION_TAG = {
  design: '制作', photo: '制作', equipment: '制作',
  planning: '企画',
  pr: '広報', writing: '広報',
  finance: '運営', negotiation: '運営', mc: '運営', admin: '運営', onsite: '運営', physical: '運営',
};

/** ミッションのタグ（tags 優先、無ければ tag） */
function _missionTag(m) {
  return (Array.isArray(m.tags) && m.tags[0]) || m.tag || null;
}

/** 担当が決まっているか（mainBoard の _isAssigned と同じ判定） */
function _isAssigned(m) {
  if (Array.isArray(m.assignees) && m.assignees.length > 0) return true;
  if (m.assignee?.type === 'user') return true;
  if (m.assignee?.type === 'role') return true;
  return false;
}

/** 未完了で担当が空のミッション */
function _unassigned(p) {
  return (p.missions || []).filter(m =>
    m.status !== 'cleared' && m.status !== 'pending_leader_check' && !_isAssigned(m));
}

/**
 * そのミッションに向いていそうなメンバーを1人返す。
 * 「得意」を優先し、いなければ「やってみたい」から選ぶ。
 * ★やってみたい を含めるのが肝。経験が無くても挑戦したい人に機会が回る。
 */
function _suggestMember(p, mission, selfId) {
  const tag = _missionTag(mission);
  if (!tag) return null;
  const members = (p.members || []).filter(m => m.userId !== selfId && m.username);
  const hit = (key) => members.find(m =>
    (m[key] || []).some(sk => SKILL_TO_MISSION_TAG[sk] === tag));
  // ★「◯◯さん」に前置きする語なので、体言止めで終わらせる。
  //   以前は '得意な' / 'やってみたい' で、後者が「やってみたい 田中さん」となり
  //   意味が通らなかった（田中さんをやってみたい、と読めてしまう）。
  const good = hit('skillsGood');
  if (good) return { username: good.username, label: '得意なメンバー' };
  const want = hit('skillsWant');
  if (want) return { username: want.username, label: 'やってみたいメンバー' };
  return null;
}

// ── メンバー向けのヘルパ ──────────────────────────────────
/** 自分が担当している未完了ミッション */
function _myMissions(p, userId) {
  return (p.missions || []).filter(m =>
    m.status !== 'cleared' && (
      (Array.isArray(m.assignees) && m.assignees.includes(userId)) ||
      (m.assignee?.type === 'user' && m.assignee.userId === userId)
    ));
}

/**
 * 「**他の人から**割り当てられた」担当ミッション。M3 の案内だけがこれを使う。
 *
 * ★自分で作って自分に割り当てたものを除く。除かないと、リーダーが自分で
 *   作ったミッションに対して「あなたの担当が決まりました／お願いします」と
 *   案内され、さらに自分で書いた意気込みを自分に読み聞かせることになる。
 * ★_myMissions とは分けること。M2（担当が1件も無い人への案内）は
 *   「自分で作ったものも担当のうち」で判定する必要があり、意味が違う。
 * ★createdBy は途中で入れたフィールドなので、古いミッションには無い。
 *   その場合は除外せず従来どおり案内する（安全側に倒す）。
 */
function _assignedByOthers(p, userId) {
  return _myMissions(p, userId).filter(m => !m.createdBy || m.createdBy !== userId);
}

/**
 * リーダーの意気込みを一行で。
 * ★意気込み機能を最も活かす使い方。ひとことがあればそれを、無ければカードから1つ。
 */
function _leaderVoice(p) {
  const text = (p.motivationText || '').trim();
  if (text) return `リーダーの言葉：「${text}」`;
  const first = (p.motivationTags || [])[0];
  const label = MOTIVATION_CARDS.find(c => c.id === first)?.label;
  return label ? `リーダーの意気込み：${label}` : '';
}


// ── フェーズ判定 ────────────────────────────────────────────
// ★lib/proposalEngine.js の detectPhase と同じ区分に揃えること
//   （early >21日 / mid 8〜21日 / late 〜7日 / during 開催中 / after 終了後）。
//   サーバー側と食い違うと「直前チェック」が出るタイミングがズレる。
/** 片付けの段階に入っているか（フェーズが振り返り、または開催日を過ぎた） */
function _isWrapUp(p) {
  return p.eventPhase === '振り返り' || _detectPhase(p) === 'after';
}

/** 引き継ぎ日（正規化済み） */
function _handoverDates(p) {
  return Array.isArray(p.handoverDates) ? p.handoverDates.filter(Boolean) : [];
}

function _detectPhase(p) {
  const sorted = [...(p.dates || [])].filter(Boolean).sort();
  const today = todayStr();
  if (sorted.length === 0) return null;              // 日程未設定は中立
  if (today > sorted[sorted.length - 1]) return 'after';
  if (today >= sorted[0]) return 'during';
  const days = Math.ceil((new Date(sorted[0]) - new Date(today)) / DAY_MS);
  return days > 21 ? 'early' : days > 7 ? 'mid' : 'late';
}

/** イベント作成からの経過日数 */
function _daysSinceCreated(p) {
  return p.createdAt ? Math.floor((Date.now() - p.createdAt) / DAY_MS) : 0;
}

/** 自分の skillsWant に合う未割当ミッション（M2 用） */
function _wantMatches(p, userId) {
  const me = (p.members || []).find(m => m.userId === userId);
  const want = me?.skillsWant || [];
  if (want.length === 0) return [];
  const tags = new Set(want.map(sk => SKILL_TO_MISSION_TAG[sk]).filter(Boolean));
  return _unassigned(p).filter(m => tags.has(_missionTag(m)));
}

/** 自分が担当していて完了済みのミッション（M4 用） */
function _myCompleted(p, userId) {
  return (p.missions || []).filter(m =>
    (m.status === 'cleared' || m.status === 'pending_leader_check') && (
      (Array.isArray(m.assignees) && m.assignees.includes(userId)) ||
      (m.assignee?.type === 'user' && m.assignee.userId === userId) ||
      (Array.isArray(m.individualClearedBy) && m.individualClearedBy.includes(userId))
    ));
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
    // ★ここが起きないとイベクリはリーダー1人のToDoアプリになり、メンバーは
    //   自分の担当が無いのでアプリを開く理由がない。「モチベーションが低い」の主因。
    id: 'L5',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => {
      const un = _unassigned(ctx.p);
      // 未完了が4件以上あり、かつ**どれも担当が決まっていない**とき
      const open = (ctx.p.missions || []).filter(m => m.status !== 'cleared');
      return open.length >= 4 && un.length === open.length;
    },
    build: (ctx) => {
      const un = _unassigned(ctx.p).slice(0, 3);
      // 抽象的な促しで終わらせず、スキルタグから具体名を出す
      const lines = un.map(m => {
        const s = _suggestMember(ctx.p, m, ctx.userId);
        return [m.title, s ? `${s.label} ${s.username}さん` : '担当を決めましょう'];
      });
      return {
        eyebrow: '3つめのステップ「配る」',
        title: '誰にお願いする？',
        steps: lines,
        bullet: true,     // 手順ではなく一覧なので番号を振らない
        body: '担当が決まると、その人の画面にミッションが出ます。',
        primary: 'ミッションを開く',
        action: 'openMissionList',
      };
    },
  },

  {
    // このアプリで最もモチベーションが上がる瞬間。演出を厚めにする
    id: 'L6',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => {
      // ★参加したばかりの人には出さない。既に完了があるイベントに今日入った人へ
      //   「はじめての完了」と言うのは事実と違ううえ、歓迎の枠を奪う。
      if (isNewcomer(ctx.p, ctx.userId)) return false;
      const done = (ctx.p.missions || []).filter(m => m.status === 'cleared').length;
      // ★既に何件も完了している既存イベントで「はじめての完了」と言わないよう上限を置く。
      //   完了数は減らないので、超えたイベントでは以後も発火しない
      return done >= 1 && done <= 3;
    },
    build: (ctx) => {
      const done = (ctx.p.missions || []).filter(m => m.status === 'cleared')[0];
      return {
        emoji: '🎉',
        eyebrow: 'はじめての完了',
        title: 'ミッションが<br>ひとつ終わりました',
        body: done?.title
          ? `「${done.title}」が完了しました。アーカイブに記録が残ります。`
          : 'アーカイブに記録が残ります。',
        primary: 'アーカイブを見る',
        action: 'openArchive',
      };
    },
  },

  {
    id: 'L1',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    // イベントを作った直後（＝管理者として初めてこのイベントを開いたとき）
    // ★初期オンボーディング（onboardingIntro.js）の①が**同じ3ステップ**を出すので、
    //   そちらが動くイベントでは出さない。リリース日時より前に作られた既存イベントや、
    //   2つ目以降のイベント（初期オンボーディングを出さない）だけ、ここが担当する。
    // ★`!isIntroEligible` だけでは足りない。初期オンボーディングを**やり終えた**
    //   イベントでも true になり、終わった直後に同じ内容がもう一度出てしまう
    //   （getIntroState が null ＝「このイベントで一度も走っていない」を必ず併せて見る）。
    match: (ctx) => !isIntroEligible(ctx.userId, ctx.p)
                 && getIntroState(ctx.userId, ctx.p.id) === null,
    // ★内容は onboardingIntro.js の USAGE_PAGES と揃えること。同じ「進め方」を
    //   2箇所で出しているので、片方だけ変えると人によって説明が食い違う。
    //   ★ここは1枚のモーダル（openOnboardingModal）なので3つ並べて出す。
    //     めくる形にするのは初期オンボーディング側だけ。
    build: () => ({
      eyebrow: 'イベントづくりの進め方',
      title: 'イベントづくりは<br>3つのステップで進みます',
      steps: [
        ['決める',   '目的や目標、概要を決めよう'],
        ['組み立てる', 'いつ、誰が、何をするかスケジュールを作ろう'],
        ['やり切る', '実行・提出して、振り返ろう'],
      ],
      // ★自動作成される「イベントの目的を定めよう」が既に入っているので、
      //   「最初の1件を作ろう」は不正確。「作ってみよう」に留める。
      body: 'やることをミッションとして書き出してスケジュールを作ってみましょう。',
      primary: 'わかった',
      action: 'openMissionModal',
    }),
  },

  {
    // 招待したのに誰も来ない状態を放置しない。L4（承認の催促）と対になる
    id: 'L3',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => _daysSinceCreated(ctx.p) >= 3
      && (ctx.p.members || []).length <= 1
      && (ctx.p.pendingMembers || []).length === 0,
    build: () => ({
      eyebrow: 'まだひとりです',
      title: '仲間を誘いませんか',
      body: 'イベクリは、担当を配って進めると力を発揮します。'
        + '招待リンクを送ると、相手は参加申請から入れます。',
      primary: '招待リンクを発行する',
      action: 'openInvite',
    }),
  },

  {
    // 開催1週間前〜前日に初めて到達したとき
    id: 'L8',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => _detectPhase(ctx.p) === 'late',
    build: (ctx) => {
      const open = (ctx.p.missions || []).filter(m => m.status !== 'cleared');
      const un   = _unassigned(ctx.p);
      return {
        emoji: '⏰',
        eyebrow: '開催が近づいています',
        title: '直前チェック',
        steps: [
          ['未完了のミッション', `${open.length}件`],
          ['担当が決まっていない', `${un.length}件`],
        ],
        bullet: true,
        body: open.length === 0
          ? '準備は整っています。当日を楽しんでください。'
          : '残っているものを確認して、必要なら担当を決めましょう。',
        primary: 'ミッションを確認する',
        action: 'openMissionList',
      };
    },
  },

  {
    // 開催が終わったあと初めて開いたとき
    // ★開催が終わると eventPhase が自動で「振り返り」になる（state.js の _checkEventPhase）。
    //   カレンダー判定（_detectPhase === 'after'）も併用しているのは、
    //   フェーズを手で「企画準備」に戻したまま開催日を過ぎている人にも出すため。
    // ★引き継ぎ日を決めてもらうのが先。決まると最終日の翌日に自動で「完了」へ
    //   進むので、イベントを畳むところまでが一本の線になる。
    id: 'L9',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => _isWrapUp(ctx.p) && _handoverDates(ctx.p).length === 0,
    build: () => ({
      emoji: '📅',
      eyebrow: 'おつかれさまでした',
      title: '引き継ぎの日を決めましょう',
      body: 'みんなで振り返る日をカレンダーから選んでください。複数日でも構いません。\n'
          + '選んだ最終日の翌日に、このイベントは自動で「完了」になります。',
      primary: '日を選ぶ',
      action: 'openHandoverCalendar',
    }),
  },

  {
    id: 'L10',
    role: 'leader',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => _isWrapUp(ctx.p) && _handoverDates(ctx.p).length > 0,
    // ★引き継ぎ日が決まるまでは出さない。先に L9 で日を決めてもらう。
    build: (ctx) => {
      const missing = [];
      if (!getArchiveSummary(ctx.p)) missing.push(['概要', 'イベント設定から書けます']);
      if (!getArchiveVenue(ctx.p))   missing.push(['開催場所', 'イベント設定から書けます']);
      if (!ctx.p.clearedData?.['archive-image']) missing.push(['メインビジュアル', 'アーカイブから登録できます']);
      return {
        emoji: '📦',
        eyebrow: 'おつかれさまでした',
        title: '記録を残しましょう',
        steps: missing.length ? missing : null,
        bullet: true,
        body: missing.length
          ? 'アーカイブが埋まっていると、次のイベントの引き継ぎが楽になります。'
          : 'アーカイブは埋まっています。振り返ってみましょう。',
        primary: 'アーカイブを見る',
        action: 'openArchive',
      };
    },
  },

  // ── メンバー向け ────────────────────────────────────────
  {
    // 承認されて初めてイベントページに入ったとき。
    // ★5ステップ全部は見せない。メンバーにとって「決める」「残す」は自分の仕事ではない。
    id: 'M1',
    role: 'member',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: () => true,
    build: () => ({
      eyebrow: 'ようこそ',
      title: 'あなたのやることは<br>3つです',
      steps: [
        ['担当を受け取る', 'リーダーが割り当てるか、自分で応募します'],
        ['やる',           '期限までに進めます'],
        ['提出する',       '成果物を出すと完了になります'],
      ],
      body: 'まずは、どんなミッションがあるか見てみましょう。',
      primary: 'ミッションを見る',
      action: 'openMissionList',
    }),
  },

  {
    // 自分に初めて担当が付いたとき。
    // ★リーダー／メンバーを問わず、担当が付いた人全員に出す（リーダーも実作業を持つため）。
    // ★ただし「自分で作って自分に割り当てた」ものは対象外（_assignedByOthers）。
    //   自分で決めた作業に「お願いします」と案内しても意味が無い。
    id: 'M3',
    role: 'any',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => _assignedByOthers(ctx.p, ctx.userId).length > 0,
    build: (ctx) => {
      const mine  = _assignedByOthers(ctx.p, ctx.userId);
      const first = mine[0];
      const voice = _leaderVoice(ctx.p);
      return {
        emoji: '📌',
        eyebrow: 'あなたの担当が決まりました',
        title: `「${_escapeName(first.title)}」を<br>お願いします`,
        body: 'ミッションを開くと、やることと期限が見られます。'
          + '終わったら成果物を出して完了にしてください。'
          + (voice ? `\n${voice}` : ''),
        primary: 'ミッションを開く',
        action: 'openMission',
        actionArg: first.id,
      };
    },
  },
  {
    // 参加から1日たっても自分の担当が無い人に、合いそうなミッションを示す
    id: 'M2',
    role: 'member',
    densities: [DENSITY.FIRST, DENSITY.FEW],
    match: (ctx) => {
      if (_myMissions(ctx.p, ctx.userId).length > 0) return false;
      const me = (ctx.p.members || []).find(m => m.userId === ctx.userId);
      const joined = me?.joinedAt || ctx.p.createdAt;
      return joined ? (Date.now() - joined) >= DAY_MS : false;
    },
    build: (ctx) => {
      const hits = _wantMatches(ctx.p, ctx.userId).slice(0, 3);
      return {
        eyebrow: 'まだ担当がありません',
        title: hits.length ? 'こんなミッションが<br>空いています' : 'リーダーに<br>声をかけてみよう',
        steps: hits.length ? hits.map(m => [m.title, 'やってみたいと答えた分野です']) : null,
        bullet: true,
        body: hits.length
          ? '気になるものがあれば、リーダーに「やりたい」と伝えてみましょう。'
          : 'いまは自分に合いそうな空きがありません。何を手伝えるか聞いてみましょう。',
        primary: 'ミッションを見る',
        action: 'openMissionList',
      };
    },
  },

  {
    // メンバーが初めてミッションを完了したとき（褒める）
    // ★M5（差し戻し時の案内）は実装しない方針
    id: 'M4',
    role: 'member',
    densities: [DENSITY.FIRST, DENSITY.FEW, DENSITY.MANY],
    match: (ctx) => _myCompleted(ctx.p, ctx.userId).length > 0,
    build: (ctx) => {
      const done = _myCompleted(ctx.p, ctx.userId)[0];
      const needsCheck = done?.status === 'pending_leader_check';
      return {
        emoji: '🎊',
        eyebrow: 'はじめての完了',
        title: 'おつかれさまでした！',
        body: (done?.title ? `「${done.title}」を提出しました。` : '提出しました。')
          + (needsCheck
              ? 'リーダーの確認待ちです。承認されるとアーカイブに残ります。'
              : 'アーカイブに記録が残ります。'),
        primary: 'アーカイブを見る',
        action: 'openArchive',
      };
    },
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

  const userId = state.currentUser.id;

  // ★役割は members から**厳密に**判定する。自分がまだ members に居ないうちは
  //   何も出さず、次の render() に持ち越す。
  //   state.canManageCurrentEvent() は members が未取得のとき「分からないので true」を
  //   返す（イベント作成直後にオーナーのボタンが消えないための保険）。参加が承認された
  //   直後のメンバーはこれに引っかかり、**リーダー向けの案内（L6 など）が出てしまう**。
  //   しかも出た時点で既読になるので、本来出るはずの M1（メンバー向けの進め方）が
  //   二度と出なくなる。実際にその報告を受けた。
  const me = (p.members || []).find(m => m.userId === userId);
  if (!me) return;

  const canManage = state.canManageCurrentEvent(p.id);
  const role      = canManage ? 'leader' : 'member';
  const density   = densityForEvent(userId, state.events, p);
  const ctx = { p, userId, canManage, density };

  for (const step of STEPS) {
    if (step.role !== 'any' && step.role !== role) continue;
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
