// lib/webhookScheduler.js — 締切が近いタスクを毎朝 Discord / Slack へまとめて投稿する
//
// pushScheduler と同じ作り（毎分 tick・同じ分を二重処理しない・起動時キャッチアップ）。
//  - 判定と送信は runDeadline() に集約し、スケジューラと手動実行（/api/webhook/run-deadline）の両方から呼ぶ
//  - 冪等性は webhook_dispatch_log の「送信前 insert」（dedupeKey unique）。
//    ★push_dispatch_log は共用しない（pushScheduler の slotDone が push 送信済みと誤判定する）
//  - 対象は連携があるイベントだけ（全イベントを総なめしない）
//  - 今日・明日が締切のものだけ。★超過は入れない（毎朝鳴り続けてミュートされるのを防ぐ）
//  - TZ=Asia/Tokyo が前提（pushScheduler と同じ）

'use strict';

const { getDb }      = require('./db');
const eventStore     = require('./eventStore');
const userStore      = require('./userStore');
const webhookStore   = require('./webhookStore');
const webhookClient  = require('./webhookClient');
const rules          = require('./pushRules');

const SLOT             = '09:00';
const TICK_MS          = 60 * 1000;
const CATCHUP_GRACE_MS = 2 * 60 * 60 * 1000;

let _timer = null;
let _lastTickMinute = null;

function _hhmm(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function _dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 重複送信の防止（webhook_dispatch_log。TTL 30日）──────────────
function _log() { return getDb().collection('webhook_dispatch_log'); }
function _key(dateJst, eventId) { return `${dateJst}:deadline:${eventId}`; }

async function _claim(dedupeKey, eventId, dateJst) {
  try {
    await _log().insertOne({ dedupeKey, eventId, kind: 'deadline', dateJst, sentAt: new Date() });
    return true;
  } catch (e) {
    if (e && e.code === 11000) return false;
    throw e;
  }
}
async function _slotDone(dateJst) {
  return (await _log().countDocuments({ dateJst, kind: 'deadline' }, { limit: 1 })) > 0;
}

/** ミッションの担当者 userId（server.js の _resolveAssigneeIds と同じ考え方） */
function _assigneeIds(f) {
  const ids = [];
  if (Array.isArray(f.assignees?.v)) ids.push(...f.assignees.v);
  const a = f.assignee?.v;
  if (a?.type === 'user' && a.userId) ids.push(a.userId);
  return [...new Set(ids)].filter(Boolean);
}

/** 1イベントぶんの今日・明日締切のタスク */
function _dueMissions(ev, todayStr) {
  const today = [], tomorrow = [];
  for (const [mid, cm] of Object.entries(ev.missions || {})) {
    if (!cm || cm.deletedAt) continue;
    const f = cm.fields || {};
    if ((f.status?.v ?? 'yet') === 'cleared') continue;
    const dl = rules.missionDeadline({ dates: Array.isArray(f.dates?.v) ? f.dates.v : [] });
    if (!dl) continue;
    const d = rules.daysOverdue(dl, todayStr);
    const m = { id: mid, title: f.title?.v ?? '', assigneeIds: _assigneeIds(f), deadline: dl };
    if (d === 0) today.push(m);
    else if (d === -1) tomorrow.push(m);
  }
  return { today, tomorrow };
}

/**
 * 締切のまとめ投稿の判定と送信。
 * @param {{ dryRun?: boolean, dateJst?: string }} opts
 */
async function runDeadline(opts = {}) {
  const started  = Date.now();
  const dryRun   = !!opts.dryRun;
  const todayStr = opts.dateJst || _dateStr();
  const summary  = { slot: SLOT, dateJst: todayStr, dryRun, targets: 0, matched: 0, sent: 0, skipped: 0, failed: 0, plan: [] };

  const hooks = await webhookStore.listForDeadline();
  summary.targets = hooks.length;
  if (hooks.length === 0) return summary;
  const hookById = new Map(hooks.map(h => [h._id, h]));
  const events = await eventStore.loadEvents(hooks.map(h => h._id));

  for (const ev of events) {
    const f = ev.fields || {};
    if (f.isCompleted?.v === true || f.eventPhase?.v === '完了') continue;
    const { today, tomorrow } = _dueMissions(ev, todayStr);
    if (today.length === 0 && tomorrow.length === 0) continue;
    summary.matched++;

    const memberIds = new Set((ev.members || []).map(m => m.userId));
    const uids = [...new Set([...today, ...tomorrow].flatMap(m => m.assigneeIds))].filter(id => memberIds.has(id));
    const users = uids.length ? await userStore.findManyByIds(uids) : [];
    const nameOf = new Map(users.map(u => [u.id, u.username]));
    const origin = hookById.get(ev.id)?.origin || '';
    const item = (m, label) => ({
      title:     m.title,
      url:       `${origin}/m/${ev.id}/${m.id}`,
      assignees: m.assigneeIds.map(id => nameOf.get(id)).filter(Boolean),
      deadline:  m.deadline,
      deadlineLabel: label,
    });
    const items = [...today.map(m => item(m, '今日')), ...tomorrow.map(m => item(m, '明日'))];
    const msg = { title: '締切が近いタスク', items, footer: f.name?.v ?? '' };

    if (dryRun) {
      summary.plan.push({ eventId: ev.id, eventName: msg.footer, today: today.length, tomorrow: tomorrow.length });
      continue;
    }
    let claimed = false;
    try { claimed = await _claim(_key(todayStr, ev.id), ev.id, todayStr); }
    catch (e) { console.error('[webhook] dedupe に失敗:', e.message); }
    if (!claimed) { summary.skipped++; continue; }

    const r = await webhookClient.send(ev.id, msg);
    if (r.ok) summary.sent++; else summary.failed++;
  }

  summary.ms = Date.now() - started;
  console.log(`[webhook] deadline date=${todayStr}${dryRun ? ' (dryRun)' : ''} 連携=${summary.targets} 該当=${summary.matched} ` +
    `送信=${summary.sent} スキップ=${summary.skipped} 失敗=${summary.failed} ${summary.ms}ms`);
  return summary;
}

async function _tick() {
  const hhmm = _hhmm();
  if (_lastTickMinute === hhmm) return;   // ★同じ分を二重処理しない
  _lastTickMinute = hhmm;
  if (hhmm !== SLOT) return;
  try { await runDeadline(); } catch (e) { console.error('[webhook] deadline 実行に失敗:', e.message); }
}

/** 起動時キャッチアップ（猶予 2 時間。過ぎたら送らない） */
async function _catchUp() {
  const now = new Date();
  const [h, m] = SLOT.split(':').map(Number);
  const at = new Date(now); at.setHours(h, m, 0, 0);
  const elapsed = now.getTime() - at.getTime();
  if (elapsed < 0 || elapsed > CATCHUP_GRACE_MS) return;
  if (await _slotDone(_dateStr(now))) return;
  console.log(`[webhook] 起動時キャッチアップ: deadline（${Math.round(elapsed / 60000)}分経過）`);
  await runDeadline();
}

/** サーバー起動時に1度だけ呼ぶ */
function start() {
  if (_timer) return;
  console.log(`⏰ 外部連携の締切投稿: 起動（slot=${SLOT}）`);
  _catchUp().catch(e => console.error('[webhook] キャッチアップ例外:', e.message));
  _timer = setInterval(() => { _tick().catch(e => console.error('[webhook] tick 例外:', e.message)); }, TICK_MS);
  _timer.unref?.();
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, runDeadline, SLOT };
