// lib/pushRules.js — 定期通知（スケジュール実行）のルール定義
//
// ★ルールはここに宣言的に並べる。追加は「テーブルに1エントリ足すだけ」で済むようにしてある。
//   判定ロジックに文面を埋め込まない／時刻も優先順位もデータとして持つ／enabled で個別に止められる。
//   （通知のタイミングと内容は今後も追加・変更される前提の設計）
//
// 用語:
//   slot      … 送信する時刻（JST）。'13:00' など。スケジューラはこの値だけを見る
//   priority  … 同じ slot 内での優先順位。小さいほど優先
//   exclusive … true なら「同じ slot で1日1通まで」。優先順に評価し、最初にマッチしたら打ち切る
//   match     … 送るべきか判定する。真なら build が呼ばれる
//   build     … 通知の中身（title/body/url/tag）を作る
//
// ctx（match/build に渡る）:
//   {
//     userId, user,            // user は { lastSeenAt, createdAt } を持つ
//     events,                  // このユーザーが所属するイベント（flat 形式）の配列
//     myMissions,              // 担当している未完了ミッション [{ mission, event }]
//     preEventIds,             // 「開催前」のイベントIDの集合
//     todayStr, now,
//   }

'use strict';

const { detectPhase } = require('./proposalEngine');

// ── 日付ヘルパ ──────────────────────────────────────────────
// ★proposalEngine の _daysUntil は Math.max(0, ...) で負値を潰すため超過日数に使えない。
//   こちらはクランプせず、符号付きで返す（既存関数の挙動は変更しない）。

/** 'YYYY-MM-DD' を JST のローカル日付として Date にする（UTC 解釈のズレを避ける） */
function _toLocalDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * dateStr が todayStr から見て何日「超過」しているか。
 * @returns {number} 正=超過日数 / 0=今日が期限 / 負=まだ先
 */
function daysOverdue(dateStr, todayStr) {
  const target = _toLocalDate(dateStr);
  const today  = _toLocalDate(todayStr);
  return Math.round((today.getTime() - target.getTime()) / 86400000);
}

/** ミッションの期限（最終日）。dates は未ソートで保存されるので必ずソートしてから取る */
function missionDeadline(m) {
  const dates = m?.dates;
  if (!Array.isArray(dates) || dates.length === 0) return null;
  return [...dates].sort().at(-1);
}

/** 経過日数（ミリ秒 → 日）。基準が無ければ null */
function daysSince(ts, now) {
  if (!ts) return null;
  const t = ts instanceof Date ? ts.getTime() : Number(ts);
  if (!t || Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86400000);
}

/** イベントが「開催前」か（開催中・終了後は idle 系の対象外） */
function isPreEvent(event) {
  const phase = detectPhase({
    eventDates: event?.dates || [],
    daysLeft:   event?.daysLeft ?? null,
  });
  return phase !== 'during' && phase !== 'after';
}

// ── 閾値（1箇所にまとめる）────────────────────────────────
const OVERDUE_MIN_DAYS = 3;   // 何日以上の超過で「超過している」とみなすか
const IDLE_DAYS_1      = 7;   // 1回目の離脱リマインド
const IDLE_DAYS_2      = 14;  // 2回目の離脱リマインド

// ── ルール定義 ──────────────────────────────────────────────
// ★新しいルールはこの配列に足すだけ。スケジューラ本体は書き換えなくてよい。
const SCHEDULED_RULES = [
  {
    // 当日の朝に「今日が締め切り」を知らせる。宛先は担当者のみ（due_tomorrow / overdue と同じ）。
    // 全メンバーに送ると、自分に無関係な締め切りで毎朝鳴ってしまう。
    // 件数に関わらず1通に集約する。
    id:        'due_today',
    slot:      '09:00',
    priority:  1,
    enabled:   true,
    exclusive: true,   // 09:00 枠も1日1通
    label:     '今日締め切りのミッション',
    match: (ctx) => ctx.myMissions.some(({ mission }) => {
      const dl = missionDeadline(mission);
      return dl !== null && daysOverdue(dl, ctx.todayStr) === 0; // 期限が today
    }),
    build: (ctx) => {
      const hits = ctx.myMissions.filter(({ mission }) => {
        const dl = missionDeadline(mission);
        return dl !== null && daysOverdue(dl, ctx.todayStr) === 0;
      });
      const first = hits[0];
      return {
        title: '今日が締め切りです',
        body:  '今日締め切りのミッションがあるよ！',
        url:   `/m/${first.event.id}/${first.mission.id}`,
        tag:   'due-today',
      };
    },
  },

  {
    id:        'due_tomorrow',
    slot:      '13:00',
    priority:  1,
    enabled:   true,
    exclusive: true,   // 13:00 枠も1日1通（21:45 枠とは別枠）
    label:     '明日締め切りのミッション',
    match: (ctx) => ctx.myMissions.some(({ mission }) => {
      const dl = missionDeadline(mission);
      return dl !== null && daysOverdue(dl, ctx.todayStr) === -1; // 期限が明日
    }),
    build: (ctx) => {
      const hits = ctx.myMissions.filter(({ mission }) => {
        const dl = missionDeadline(mission);
        return dl !== null && daysOverdue(dl, ctx.todayStr) === -1;
      });
      const first = hits[0];
      const more  = hits.length - 1;
      return {
        title: '明日が締め切りです',
        body:  more > 0
          ? `「${first.mission.title}」ほか${more}件が明日締め切りです！！`
          : `「${first.mission.title}」は明日締め切りです！！`,
        url:   `/m/${first.event.id}/${first.mission.id}`,
        tag:   'due-tomorrow',
      };
    },
  },

  {
    // ★超過は「ちょうどN日」ではなく「N日以上」で判定し、件数に関わらず1通に集約する。
    //   ちょうどN日だと、その日を過ぎた放置ミッションが二度と通知されない。
    id:        'overdue',
    slot:      '21:45',
    priority:  1,
    enabled:   true,
    exclusive: true,
    label:     '締め切り超過のミッション',
    match: (ctx) => ctx.myMissions.some(({ mission }) => {
      const dl = missionDeadline(mission);
      return dl !== null && daysOverdue(dl, ctx.todayStr) >= OVERDUE_MIN_DAYS;
    }),
    build: (ctx) => {
      const hits = ctx.myMissions.filter(({ mission }) => {
        const dl = missionDeadline(mission);
        return dl !== null && daysOverdue(dl, ctx.todayStr) >= OVERDUE_MIN_DAYS;
      });
      return {
        title: '超過しているミッションがあります',
        body:  '超過しているミッションがあるよ👀確認しよう！',
        // 遷移先は最も長く超過しているもの
        url: (() => {
          const worst = hits.slice().sort((a, b) =>
            daysOverdue(missionDeadline(b.mission), ctx.todayStr)
            - daysOverdue(missionDeadline(a.mission), ctx.todayStr))[0];
          return `/m/${worst.event.id}/${worst.mission.id}`;
        })(),
        tag: 'overdue',
      };
    },
  },

  {
    id:        'idle_7d',
    slot:      '21:45',
    priority:  2,
    enabled:   true,
    exclusive: true,
    label:     '7日間アクセスなし',
    // ちょうど7日目のみ（毎日送ると即ミュートされるため）
    match: (ctx) => ctx.preEventIds.size > 0
      && daysSince(ctx.user?.lastSeenAt ?? ctx.user?.createdAt, ctx.now) === IDLE_DAYS_1,
    build: (ctx) => ({
      title: 'イベントの準備、進んでいますか？',
      body:  'コツコツイベントを進めよう！！',
      url:   `/?e=${[...ctx.preEventIds][0] || ''}`,
      tag:   'idle',
    }),
  },

  {
    id:        'idle_14d',
    slot:      '21:45',
    priority:  3,
    enabled:   true,
    exclusive: true,
    label:     '14日間アクセスなし',
    match: (ctx) => ctx.preEventIds.size > 0
      && daysSince(ctx.user?.lastSeenAt ?? ctx.user?.createdAt, ctx.now) === IDLE_DAYS_2,
    build: (ctx) => ({
      title: 'お久しぶりです',
      body:  '最近ログインしてないね？イベントの進捗をチェックしよう！',
      url:   `/?e=${[...ctx.preEventIds][0] || ''}`,
      tag:   'idle',
    }),
  },
];

/** 有効なルールが使う slot の一覧（重複なし・昇順） */
function activeSlots() {
  return [...new Set(SCHEDULED_RULES.filter(r => r.enabled).map(r => r.slot))].sort();
}

/** 指定 slot のルールを優先順に返す */
function rulesForSlot(slot) {
  return SCHEDULED_RULES
    .filter(r => r.enabled && r.slot === slot)
    .sort((a, b) => a.priority - b.priority);
}

module.exports = {
  SCHEDULED_RULES,
  activeSlots,
  rulesForSlot,
  // ヘルパも公開（スケジューラとテストで使う）
  daysOverdue,
  missionDeadline,
  daysSince,
  isPreEvent,
  OVERDUE_MIN_DAYS,
  IDLE_DAYS_1,
  IDLE_DAYS_2,
};
