// scripts/showDiagnostics.js — 診断ログの集計をターミナルに表示する（読み取り専用）
//
// 原因調査のために仕込んだ診断ログを、Atlas を開かずに1コマンドで読むためのもの。
// 数字が出たら、NEXT_SESSION.md の該当タスクを判断する（ログを消す／直す）。
//
//   ① 接続エラー画面        connection_error_shown / connection_retry_tapped
//   ② アカウント作成へ戻される  signup_profile_phase_entered / signup_resume_blocked
//   ③ 🔥が出ない             leader_motivation_skipped / leader_motivation_failed
//
// 使い方:
//   node scripts/showDiagnostics.js                 # .env の MONGODB_DB・直近14日
//   node scripts/showDiagnostics.js evecre 30       # 対象DB と日数を指定
//
// ★データは書き換えない（find / countDocuments だけ）。
//   ただし connectDb() が起動時にインデックスを確認する（冪等。showSurvey.js と同じ）。
// ★診断ログを消したら、ここの該当ブロックも消すこと。

'use strict';

require('dotenv').config();
if (process.argv[2]) process.env.MONGODB_DB = process.argv[2];
const DAYS = Math.max(1, parseInt(process.argv[3], 10) || 14);

const { getDb, connectDb, closeDb } = require('../lib/db');

const JST = 'Asia/Tokyo';
const fmtDay  = (d) => d.toLocaleDateString('ja-JP', { timeZone: JST, month: '2-digit', day: '2-digit' });
const fmtTime = (d) => d.toLocaleString('ja-JP', { timeZone: JST, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const pad = (s, n) => String(s).padEnd(n, ' ');
const hr = () => console.log('─'.repeat(64));

// session_started の ctx.ua から端末の種類をざっくり出す（ua はセッション先頭にしか載らない）
function osOf(ua) {
  if (!ua) return '(不明)';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';   // iPadOS のデスクトップ表示もここに入る
  if (/Windows/.test(ua)) return 'Windows';
  return 'その他';
}

async function uaBySession(logs, sessionIds) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await logs.find(
    { event: 'session_started', sessionId: { $in: ids } },
    { projection: { sessionId: 1, 'ctx.ua': 1, _id: 0 } },
  ).toArray();
  return new Map(rows.map(r => [r.sessionId, r.ctx?.ua]));
}

// 「誰が」を数える単位。未ログインのまま出る画面もあるので userId が無ければ clientId、それも無ければ sessionId
const whoOf = (r) => r.userId ? `u:${r.userId}` : r.ctx?.clientId ? `c:${r.ctx.clientId}` : `s:${r.sessionId}`;

function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, { n: 0, who: new Set() });
    const e = m.get(k); e.n++; e.who.add(whoOf(r));
  }
  return [...m].sort((a, b) => b[1].n - a[1].n);
}

function printCounts(title, entries) {
  console.log(`  ${title}`);
  if (entries.length === 0) { console.log('    (0件)'); return; }
  for (const [k, v] of entries) console.log(`    ${pad(k, 24)} ${String(v.n).padStart(4)}件  ${String(v.who.size).padStart(3)}人`);
}

(async () => {
  await connectDb();
  const db = getDb();
  const logs = db.collection('event_logs');
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const find = (event) => logs.find({ event, ts: { $gte: since } }).sort({ ts: 1 }).toArray();

  console.log(`\n対象データベース: ${db.databaseName}　期間: 直近${DAYS}日（${fmtTime(since)} 〜）\n`);

  // ── ① 接続エラー画面 ─────────────────────────────
  hr();
  console.log('① 接続エラー画面（CONNECTION_ERROR）');
  const shown = await find('connection_error_shown');
  const retry = await find('connection_retry_tapped');
  const shownWho = new Set(shown.map(whoOf));
  console.log(`  表示 ${shown.length}件 / ${shownWho.size}人　　再試行タップ ${retry.length}件 / ${new Set(retry.map(whoOf)).size}人`);
  console.log('  ★下限値：ログは送信に失敗すると捨てられる。同じセッション内で通信が戻ったぶんしか届かない');
  if (shown.length > 0) {
    printCounts('日別', countBy(shown, r => fmtDay(r.ts)));
    const ua = await uaBySession(logs, shown.map(r => r.sessionId));
    printCounts('端末', countBy(shown, r => osOf(ua.get(r.sessionId))));
    printCounts('ホーム画面から起動', countBy(shown, r => r.ctx?.standalone ? 'PWA（standalone）' : 'ブラウザ'));
    printCounts('ログイン状態', countBy(shown, r => r.userId ? 'ログイン済み' : '未ログイン／不明'));
  }
  {
    // 再試行で抜けられたか：再試行したセッションのうち、そのあと別の画面のログが届いたもの
    const retriedSessions = [...new Set(retry.map(r => r.sessionId).filter(Boolean))];
    if (retriedSessions.length > 0) {
      let recovered = 0;
      for (const sid of retriedSessions) {
        const lastRetry = retry.filter(r => r.sessionId === sid).at(-1).ts;
        const after = await logs.countDocuments({
          sessionId: sid, ts: { $gt: lastRetry },
          event: { $nin: ['connection_error_shown', 'connection_retry_tapped'] },
        });
        if (after > 0) recovered++;
      }
      console.log(`  再試行のあと別の操作ログが届いたセッション: ${recovered} / ${retriedSessions.length}`);
    }
  }

  // ── ② 完了済みなのにアカウント作成へ戻される ───────────────
  hr();
  console.log('② アカウント作成のプロフィール段階に入った経路（signup.js の _enterProfilePhase）');
  const entered = await find('signup_profile_phase_entered');
  const blocked = await find('signup_resume_blocked');
  console.log(`  入った ${entered.length}件　　うち完了済みで弾いた ${blocked.length}件`);
  printCounts('reason × 完了済みか', countBy(entered, r =>
    `${r.props?.reason ?? '?'} / ${r.props?.hasCompleted ? '完了済み' : '未完了'}`));
  if (blocked.length > 0) {
    console.log('  ★弾いた行（これが不具合の経路）');
    for (const r of blocked) {
      console.log(`    ${fmtTime(r.ts)}  reason=${r.props?.reason ?? '?'}  step=${r.props?.currentStep ?? '-'}  ${whoOf(r)}  standalone=${!!r.ctx?.standalone}`);
    }
  }

  // ── ③ 🔥が出ない ──────────────────────────────
  hr();
  console.log('③ 意気込み🔥モーダル（leaderMotivationModal.js）');
  const skipped = await find('leader_motivation_skipped');
  const failed  = await find('leader_motivation_failed');
  console.log(`  出さなかった ${skipped.length}件　　描画に失敗 ${failed.length}件 / ${new Set(failed.map(whoOf)).size}人`);
  console.log('  ★skipped は「1イベント×1理由につきセッション1回」だけ記録される');
  printCounts('理由', countBy(skipped, r => r.props?.reason ?? '?'));
  if (failed.length > 0) {
    console.log('  ★失敗した行');
    for (const r of failed) console.log(`    ${fmtTime(r.ts)}  event=${r.props?.eventId ?? '-'}  ${whoOf(r)}`);
  }

  hr();
  console.log('');
  await closeDb();
})().catch(async (e) => {
  console.error(e);
  try { await closeDb(); } catch (_) { /* noop */ }
  process.exit(1);
});
