// lib/pushScheduler.js — 定期通知のスケジューラ
//
// Render の Instance Type は Starter（常時起動）なのでプロセス内で回す（外部 cron は使わない）。
// ただし「スリープしない ≠ 落ちない」。デプロイ・再起動・OOM で slot を取りこぼすため、
// 起動時のキャッチアップを必ず行う。
//
// 設計上の要点:
//  - 判定と送信は runSlot() に集約し、スケジューラ／手動実行の両方から同じ関数を呼ぶ
//  - 「前回処理した分」を記録して比較する（setInterval のズレで1分を取りこぼさないため）
//  - 冪等性は push_dispatch_log の「送信前 insert」で担保（多重起動もこれで吸収）
//  - 512MB / Atlas M0（maxPoolSize=10）を考慮し、対象を絞ってからチャンク処理する

'use strict';

const { getDb }   = require('./db');
const userStore   = require('./userStore');
const pushClient  = require('./pushClient');
const dispatchLog = require('./pushDispatchLog');
const rules       = require('./pushRules');

// 毎分のチェック間隔
const TICK_MS = 60 * 1000;
// 起動時キャッチアップの猶予。slot 時刻からこれを過ぎていたら送らない
// （翌朝の再起動で前夜の通知が今更飛ぶ事故を防ぐ）
const CATCHUP_GRACE_MS = 2 * 60 * 60 * 1000;
// DB / 送信のチャンクサイズ（Promise.all に大量投入しない）
const CHUNK = 20;

let _timer = null;
let _lastTickMinute = null;   // 'HH:MM'。同じ分を二重処理しない

// ── 時刻ヘルパ（TZ は環境変数 TZ=Asia/Tokyo で JST に揃える前提）──
function _hhmm(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function _dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 'HH:MM' を今日の Date に変換 */
function _slotDateToday(slot, base = new Date()) {
  const [h, m] = slot.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

// ── 対象データの収集 ────────────────────────────────────────
// 全ユーザー・全ミッションを総なめしない。
// 「開催前イベントの所属者」と「未完了ミッションの担当者」だけを集める。

/** CRDT のミッションから、判定に必要なフィールドだけを取り出す（全文 flat 変換はしない） */
function _liteMission(mid, cm) {
  if (!cm || cm.deletedAt) return null;
  const f = cm.fields || {};
  return {
    id:        mid,
    title:     f.title?.v ?? '',
    status:    f.status?.v ?? 'yet',
    dates:     Array.isArray(f.dates?.v) ? f.dates.v : [],
    assignees: Array.isArray(f.assignees?.v) ? f.assignees.v : [],
    assignee:  f.assignee?.v ?? null,
  };
}

/** ミッションの担当者 userId（server.js の _resolveAssigneeIds と同じ考え方） */
function _assigneeIds(m) {
  const ids = [];
  if (Array.isArray(m.assignees)) ids.push(...m.assignees);
  if (m.assignee?.type === 'user' && m.assignee.userId) ids.push(m.assignee.userId);
  return [...new Set(ids)].filter(Boolean);
}

/**
 * 判定に必要な情報を集める。
 * @returns {{ userIds: string[], byUser: Map<string, {events: object[], myMissions: object[], preEventIds: Set}> }}
 */
async function _collectTargets() {
  const events = await getDb().collection('events')
    .find({}, { projection: { members: 1, fields: 1, missions: 1 } })
    .toArray();

  const byUser = new Map();
  const ensure = (uid) => {
    if (!byUser.has(uid)) byUser.set(uid, { events: [], myMissions: [], preEventIds: new Set() });
    return byUser.get(uid);
  };

  for (const ev of events) {
    const memberIds = (ev.members || []).map(x => x.userId).filter(Boolean);
    if (memberIds.length === 0) continue;   // メンバー0の残骸イベントは無視

    const eventLite = {
      id:       ev._id,
      name:     ev.fields?.name?.v ?? '',
      dates:    Array.isArray(ev.fields?.dates?.v) ? ev.fields.dates.v : [],
      daysLeft: ev.fields?.daysLeft?.v ?? null,
    };
    const pre = rules.isPreEvent(eventLite);

    // 未完了ミッションと担当者
    const openMissions = [];
    for (const [mid, cm] of Object.entries(ev.missions || {})) {
      const m = _liteMission(mid, cm);
      if (!m || m.status === 'cleared') continue;
      openMissions.push(m);
    }

    for (const uid of memberIds) {
      const slot = ensure(uid);
      slot.events.push(eventLite);
      if (pre) slot.preEventIds.add(eventLite.id);
    }
    for (const m of openMissions) {
      for (const uid of _assigneeIds(m)) {
        if (!memberIds.includes(uid)) continue;   // 退会者などは除外
        ensure(uid).myMissions.push({ mission: m, event: eventLite });
      }
    }
  }

  return { userIds: [...byUser.keys()], byUser };
}

// ── slot の実行本体 ────────────────────────────────────────

/**
 * 指定 slot のルールを評価して送信する。
 * ★スケジューラからも手動実行（/api/push/run-slot）からも、必ずこの関数を通す。
 *
 * @param {string} slot '13:00' など
 * @param {{dryRun?: boolean, dateJst?: string}} opts
 *   dryRun … 送信も記録もせず「誰に何を送るか」だけ返す
 *   dateJst … 判定の基準日（'YYYY-MM-DD'）。検証時に未来日を指定できる
 * @returns {Promise<object>} サマリ
 */
async function runSlot(slot, opts = {}) {
  const started = Date.now();
  const dryRun  = !!opts.dryRun;
  const now     = new Date();
  const todayStr = opts.dateJst || _dateStr(now);

  const slotRules = rules.rulesForSlot(slot);
  if (slotRules.length === 0) {
    return { slot, dryRun, error: 'no_rules', targets: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const { userIds, byUser } = await _collectTargets();
  const summary = {
    slot, dateJst: todayStr, dryRun,
    targets: userIds.length,
    matched: 0, sent: 0, skipped: 0, failed: 0,
    byRule: {},
    plan: [],   // dryRun 用（誰に何を送るか）
  };

  // ユーザー情報はチャンクでまとめて取る（1件ずつ引かない）
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunkIds = userIds.slice(i, i + CHUNK);
    const users = await userStore.findManyByIds(chunkIds);
    const userById = new Map(users.map(u => [u.id, u]));

    for (const uid of chunkIds) {
      const user = userById.get(uid);
      if (!user) continue;
      const data = byUser.get(uid);

      const ctx = {
        userId: uid, user,
        events:      data.events,
        myMissions:  data.myMissions,
        preEventIds: data.preEventIds,
        todayStr, now: now.getTime(),
      };

      // 優先順に評価し、最初にマッチしたルールだけ送る（exclusive）
      for (const rule of slotRules) {
        let hit = false;
        try { hit = !!rule.match(ctx); } catch (e) {
          console.error(`[push] ルール評価に失敗 ${rule.id}:`, e.message);
          continue;
        }
        if (!hit) continue;

        summary.matched++;
        summary.byRule[rule.id] = (summary.byRule[rule.id] || 0) + 1;

        let payload;
        try { payload = rule.build(ctx); } catch (e) {
          console.error(`[push] 本文生成に失敗 ${rule.id}:`, e.message);
          summary.failed++;
          break;
        }

        if (dryRun) {
          summary.plan.push({ userId: uid, username: user.username, ruleId: rule.id, ...payload });
          break;   // exclusive：この人はこれで打ち切り
        }

        // ★送信前に権利を取る（重複エラーならスキップ）。鍵にルールIDを含めないため、
        //   同じ枠で既に送っていれば後続ルールも自動的に止まる。
        const key = dispatchLog.slotKey(todayStr, slot, uid);
        let claimed = false;
        try {
          claimed = await dispatchLog.claim(key, { userId: uid, ruleId: rule.id, slot, dateJst: todayStr });
        } catch (e) {
          console.error('[push] dedupe に失敗:', e.message);
        }
        if (!claimed) { summary.skipped++; break; }

        try {
          const r = await pushClient.sendPushToUser(uid, payload);
          if (r.sent > 0) summary.sent++;
          else            summary.failed++;
        } catch (e) {
          summary.failed++;
          console.error('[push] 送信に失敗:', e.message);
        }
        break;   // exclusive
      }
    }
  }

  summary.ms = Date.now() - started;
  console.log(
    `[push] slot=${slot} date=${todayStr}${dryRun ? ' (dryRun)' : ''} ` +
    `対象=${summary.targets} 該当=${summary.matched} 送信=${summary.sent} ` +
    `スキップ=${summary.skipped} 失敗=${summary.failed} ${summary.ms}ms ` +
    `内訳=${JSON.stringify(summary.byRule)}`
  );
  return summary;
}

// ── スケジューラ本体 ────────────────────────────────────────

/** 毎分のチェック。現在時刻が slot と一致したら実行する */
async function _tick() {
  const now = new Date();
  const hhmm = _hhmm(now);
  // ★同じ分を二重処理しない（setInterval のズレで同一分に2回入ることがある）
  if (_lastTickMinute === hhmm) return;
  _lastTickMinute = hhmm;

  if (!rules.activeSlots().includes(hhmm)) return;
  try {
    await runSlot(hhmm);
  } catch (e) {
    console.error(`[push] slot 実行に失敗 ${hhmm}:`, e.message);
  }
}

/**
 * 起動時のキャッチアップ。
 * 今日の各 slot のうち「時刻を過ぎているのに未送信」のものを実行する。
 * デプロイや再起動が slot 時刻に重なって通知が丸ごと飛ぶのを防ぐ。
 * ただし猶予（CATCHUP_GRACE_MS）を過ぎたものは実行しない。
 */
async function _catchUp() {
  const now = new Date();
  for (const slot of rules.activeSlots()) {
    const slotAt = _slotDateToday(slot, now);
    const elapsed = now.getTime() - slotAt.getTime();
    if (elapsed < 0) continue;                    // まだ来ていない
    if (elapsed > CATCHUP_GRACE_MS) continue;     // 過ぎすぎ（翌朝の誤配信を防ぐ）

    try {
      if (await dispatchLog.slotDone(_dateStr(now), slot)) continue;  // 送信済み
      console.log(`[push] 起動時キャッチアップ: slot=${slot}（${Math.round(elapsed / 60000)}分経過）`);
      await runSlot(slot);
    } catch (e) {
      console.error(`[push] キャッチアップに失敗 ${slot}:`, e.message);
    }
  }
}

/** サーバー起動時に1度だけ呼ぶ */
function start() {
  if (_timer) return;
  const slots = rules.activeSlots();
  console.log(`⏰ 定期通知スケジューラ: 起動（slot=${slots.join(', ') || 'なし'}）`);

  // 起動直後のキャッチアップ（DB 接続後に呼ばれる前提）
  _catchUp().catch(e => console.error('[push] キャッチアップ例外:', e.message));

  _timer = setInterval(() => { _tick().catch(e => console.error('[push] tick 例外:', e.message)); }, TICK_MS);
  _timer.unref?.();   // このタイマーだけでプロセスを生かし続けない
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, runSlot };
