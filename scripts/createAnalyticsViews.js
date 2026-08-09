// scripts/createAnalyticsViews.js
// MongoDB Charts(Visualization) 用の読み取り専用ビューをまとめて作成する。
//   1) event_logs_enriched … 行動ログ(event_logs)に username/eventName/day/hour/source/buttonName を付与
//   2) mission_analytics    … events.missions(CRDT) を1ミッション=1ドキュメントに平坦化し
//                              作成者/完了者/完了日数/詳細設定フラグを付与
//
// 使い方:
//   node scripts/createAnalyticsViews.js            # .env の MONGODB_DB を対象
//   node scripts/createAnalyticsViews.js evecre     # 本番DBを対象
//   node scripts/createAnalyticsViews.js evecre_dev # 開発DBを対象
//
// .env の MONGODB_URI（同一クラスタ）をそのまま使う。冪等: 既存ビューは作り直す。
// 取り消し: MONGODB_DB=evecre node -e "require('dotenv').config();const{connectDb,getDb,closeDb}=require('./lib/db');(async()=>{await connectDb();for(const n of ['event_logs_enriched','mission_analytics'])await getDb().collection(n).drop().catch(()=>{});await closeDb();})()"

'use strict';

try { require('dotenv').config(); } catch (_) {}

const argDb = process.argv[2];
if (argDb) process.env.MONGODB_DB = argDb;

const { connectDb, getDb, closeDb } = require('../lib/db');

// ── ビュー1: 行動ログを名前解決して充実させる ──────────────────
const ENRICHED_PIPELINE = [
  { $lookup: { from: 'users',  localField: 'userId',    foreignField: '_id', as: '_u' } },
  { $lookup: { from: 'events', localField: 'projectId', foreignField: '_id', as: '_e' } },
  { $set: {
      username:   { $ifNull: [ { $first: '$_u.username' }, '(匿名/未ログイン)' ] },
      eventName:  { $ifNull: [ { $first: '$_e.name' },     '(イベント未選択)' ] },
      source:     { $ifNull: [ '$ctx.source', 'client' ] },
      buttonName: '$props.name',   // event === 'button_tapped' のときボタン名
      day:  { $dateTrunc: { date: '$ts', unit: 'day', timezone: 'Asia/Tokyo' } },
      hour: { $hour:      { date: '$ts',            timezone: 'Asia/Tokyo' } },
  } },
  { $project: { _u: 0, _e: 0 } },
];

// ── ビュー2: ミッションを平坦化して分析しやすくする ────────────
const MISSION_PIPELINE = [
  { $project: { eventName: '$name', m: { $objectToArray: { $ifNull: ['$missions', {}] } } } },
  { $unwind: '$m' },
  { $match: { 'm.v.deletedAt': null } },   // 非削除のみ（欠損も null 扱いでマッチ）
  { $project: {
      _id:       { $concat: [ { $toString: '$_id' }, ':', '$m.k' ] },
      eventId:   '$_id',
      eventName: 1,
      missionId: '$m.k',
      createdAt: '$m.v.createdAt',
      f:         '$m.v.fields',
  } },
  { $set: {
      title:    '$f.title.v',
      status:   '$f.status.v',
      tag:      { $ifNull: [ '$f.tag.v', { $arrayElemAt: [ '$f.tags.v', 0 ] } ] },
      priority: '$f.priority.v',
      createdBy: '$f.createdBy.v',
      individualClearedBy: { $ifNull: [ '$f.individualClearedBy.v', [] ] },
      // 詳細設定の使用状況フラグ
      hasChecklist:    { $gt: [ { $size: { $ifNull: [ '$f.checklist.v', [] ] } }, 0 ] },
      leaderCheck:     { $eq: [ '$f.leaderCheck.v', true ] },
      selfClaim:       { $eq: [ '$f.selfClaim.v', true ] },
      claimMode:       '$f.claimMode.v',
      announce:        { $eq: [ '$f.announce.v', true ] },
      noInput:         { $eq: [ '$f.noInput.v', true ] },
      individualClear: { $eq: [ '$f.individualClear.v', true ] },
  } },
  { $set: { isCompleted: { $eq: [ '$status', 'cleared' ] } } },
  // 作成者名
  { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: '_cu' } },
  { $set: { createdByName: { $ifNull: [ { $first: '$_cu.username' }, '(不明)' ] } } },
  // 提出物（通常完了）の結合: eventId + missionId 一致
  { $lookup: {
      from: 'submissions',
      let: { eid: '$eventId', mid: '$missionId' },
      pipeline: [
        { $match: { $expr: { $and: [ { $eq: [ '$eventId', '$$eid' ] }, { $eq: [ '$missionId', '$$mid' ] } ] } } },
        { $project: { _id: 0, timestamp: 1, submittedBy: 1 } },
      ],
      as: '_sub',
  } },
  { $set: {
      completedAt: { $first: '$_sub.timestamp' },
      submittedBy: { $first: '$_sub.submittedBy' },
  } },
  { $lookup: { from: 'users', localField: 'submittedBy', foreignField: '_id', as: '_su' } },
  { $set: {
      submittedByName: { $first: '$_su.username' },
      // Charts の時系列用に Date 化（createdAt/completedAt は ms epoch）
      createdAtDate:   { $cond: [ { $ifNull: [ '$createdAt', false ] }, { $toDate: '$createdAt' }, null ] },
      completedAtDate: { $cond: [ { $ifNull: [ '$completedAt', false ] }, { $toDate: '$completedAt' }, null ] },
      daysToComplete: {
        $cond: [
          { $and: [ { $ifNull: [ '$completedAt', false ] }, { $ifNull: [ '$createdAt', false ] } ] },
          { $round: [ { $divide: [ { $subtract: [ '$completedAt', '$createdAt' ] }, 86400000 ] }, 1 ] },
          null,
        ],
      },
  } },
  { $project: { f: 0, _cu: 0, _sub: 0, _su: 0 } },
];

// ── ビュー3: セッションの時系列フロー ─────────────────────────
// 1ドキュメント=1セッション。誰が・いつ・何を順番にしたかを steps/flowText に持つ。
// サーバー監査ログ(sessionId=null)は除外され、UI操作のフローのみが残る。
const SESSION_FLOW_PIPELINE = [
  { $match: { sessionId: { $ne: null } } },
  { $sort: { ts: 1 } },
  { $group: {
      _id:        '$sessionId',
      userId:     { $first: '$userId' },
      startTs:    { $min: '$ts' },
      endTs:      { $max: '$ts' },
      eventCount: { $sum: 1 },
      steps:      { $push: { event: '$event', ts: '$ts', projectId: '$projectId', name: '$props.name' } },
      eventNames: { $push: '$event' },
  } },
  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: '_u' } },
  { $set: {
      username:    { $ifNull: [ { $first: '$_u.username' }, '(匿名/未ログイン)' ] },
      durationSec: { $round: [ { $divide: [ { $subtract: [ '$endTs', '$startTs' ] }, 1000 ] }, 0 ] },
      startJST:    { $dateToString: { date: '$startTs', format: '%Y-%m-%d %H:%M', timezone: 'Asia/Tokyo' } },
      day:         { $dateTrunc: { date: '$startTs', unit: 'day', timezone: 'Asia/Tokyo' } },
      // 操作の流れを1行のテキストで（Charts のテーブル表示用）
      flowText: { $reduce: {
          input: '$eventNames',
          initialValue: '',
          in: { $cond: [ { $eq: [ '$$value', '' ] }, '$$this', { $concat: [ '$$value', ' → ', '$$this' ] } ] },
      } },
  } },
  { $project: { _u: 0, eventNames: 0 } },
];

// ── ビュー4: イベント別 行動×成果 ────────────────────────────
// 1ドキュメント=1イベント。行動ログ指標とミッション成果を1行に合成。
const EVENT_SUMMARY_PIPELINE = [
  { $project: { eventName: '$name' } },
  { $lookup: {
      from: 'event_logs',
      let: { eid: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: [ '$projectId', '$$eid' ] } } },
        { $group: {
            _id: null,
            opens:            { $sum: { $cond: [ { $eq: [ '$event', 'session_started' ] }, 1, 0 ] } },
            buttonTaps:       { $sum: { $cond: [ { $eq: [ '$event', 'button_tapped' ] }, 1, 0 ] } },
            proposalAccepted: { $sum: { $cond: [ { $eq: [ '$event', 'proposal_accepted' ] }, 1, 0 ] } },
            users:            { $addToSet: '$userId' },
        } },
      ],
      as: '_b',
  } },
  { $lookup: {
      from: 'mission_analytics',
      let: { eid: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: [ '$eventId', '$$eid' ] } } },
        { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [ '$isCompleted', 1, 0 ] } } } },
      ],
      as: '_m',
  } },
  { $set: {
      opens:            { $ifNull: [ { $first: '$_b.opens' }, 0 ] },
      buttonTaps:       { $ifNull: [ { $first: '$_b.buttonTaps' }, 0 ] },
      proposalAccepted: { $ifNull: [ { $first: '$_b.proposalAccepted' }, 0 ] },
      activeUsers:      { $size: { $filter: { input: { $ifNull: [ { $first: '$_b.users' }, [] ] }, cond: { $ne: [ '$$this', null ] } } } },
      missionsTotal:     { $ifNull: [ { $first: '$_m.total' }, 0 ] },
      missionsCompleted: { $ifNull: [ { $first: '$_m.completed' }, 0 ] },
  } },
  { $set: { missionsIncomplete: { $subtract: [ '$missionsTotal', '$missionsCompleted' ] } } },
  { $project: { _b: 0, _m: 0 } },
];

// ── ビュー5: ユーザー別 活動量×成果 ──────────────────────────
// 1ドキュメント=1ユーザー。利用状況と作成/完了ミッション数を1行に合成。
const USER_SUMMARY_PIPELINE = [
  // ★$project で絞るので、users に列を足したらここにも足すこと。
  //   足し忘れるとビューに出てこない（アカウント作成のアンケート項目で実際にあった）。
  { $project: {
      username: 1,
      createdAt: 1,
      isVerified: 1,
      // 認証方法は googleSub の有無から導出する（authProvider は保存していない。
      // 「Google 登録後にパスワードも設定した人」でどちらを入れるか曖昧になるため）
      authProvider: { $cond: [ { $ifNull: [ '$googleSub', false ] }, 'google', 'password' ] },
      // アカウント作成時のアンケート
      acquisitionChannel:      1,
      acquisitionChannelOther: 1,
      acquisitionInviteEventId: 1,
      eventExperience:         1,
      workStylePlanning:       1,
      workStyleSocial:         1,
      notificationPreference:  1,
      consentVersion:          1,
      // オンボーディングの到達状況
      onboardingStep:      { $ifNull: [ '$onboarding.currentStep', null ] },
      onboardingCompleted: { $cond: [ { $ifNull: [ '$onboarding.completedAt', false ] }, true, false ] },
      onboardingAnswered:  { $size: { $ifNull: [ '$onboarding.completedSteps', [] ] } },
  } },
  { $lookup: {
      from: 'event_logs',
      let: { uid: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: [ '$userId', '$$uid' ] } } },
        { $group: {
            _id: null,
            opens:    { $sum: { $cond: [ { $eq: [ '$event', 'session_started' ] }, 1, 0 ] } },
            totalSec: { $sum: { $cond: [ { $eq: [ '$event', 'session_ended' ] }, { $ifNull: [ '$props.durationSec', 0 ] }, 0 ] } },
            days:     { $addToSet: { $dateTrunc: { date: '$ts', unit: 'day', timezone: 'Asia/Tokyo' } } },
            lastSeen: { $max: '$ts' },
        } },
      ],
      as: '_b',
  } },
  { $lookup: {
      from: 'mission_analytics',
      let: { uid: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: [ '$createdBy', '$$uid' ] } } },
        { $count: 'n' },
      ],
      as: '_created',
  } },
  { $lookup: {
      from: 'mission_analytics',
      let: { uid: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: [ '$submittedBy', '$$uid' ] } } },
        { $count: 'n' },
      ],
      as: '_completed',
  } },
  { $set: {
      opens:             { $ifNull: [ { $first: '$_b.opens' }, 0 ] },
      totalMin:          { $round: [ { $divide: [ { $ifNull: [ { $first: '$_b.totalSec' }, 0 ] }, 60 ] }, 0 ] },
      activeDays:        { $size: { $ifNull: [ { $first: '$_b.days' }, [] ] } },
      missionsCreated:   { $ifNull: [ { $first: '$_created.n' }, 0 ] },
      missionsCompleted: { $ifNull: [ { $first: '$_completed.n' }, 0 ] },
      lastSeen: { $let: {
          vars: { ls: { $first: '$_b.lastSeen' } },
          in: { $cond: [ { $ifNull: [ '$$ls', false ] }, { $dateToString: { date: '$$ls', format: '%Y-%m-%d %H:%M', timezone: 'Asia/Tokyo' } }, null ] },
      } },
  } },
  { $project: { _b: 0, _created: 0, _completed: 0 } },
];

// ── signup_funnel（1行 = 1サインアップ試行）───────────────────────────
// 「どのステップで落ちるか」「Google 経由とメール経由の完走率差」を測るためのビュー。
//
// ★userId ではなく sessionId で束ねる。signup_started はアカウント作成前に
//   発火するので userId が null になるため（登録後のログには userId が入る）。
const SIGNUP_FUNNEL_PIPELINE = [
  { $match: { event: { $in: [
    'signup_started', 'signup_step_viewed', 'signup_step_completed', 'signup_step_skipped',
    'signup_email_changed', 'otp_sent', 'otp_verified', 'otp_failed', 'otp_deferred',
    'signup_completed', 'onboarding_completed',
  ] } } },
  { $group: {
      _id: '$sessionId',
      startedAt: { $min: '$ts' },
      lastAt:    { $max: '$ts' },
      // 登録後のログには userId が入るので、非 null の最大値を採用する
      userId:    { $max: '$userId' },
      method:    { $max: { $cond: [ { $eq: [ '$event', 'signup_started' ] }, '$props.method', null ] } },
      stepsViewed:  { $addToSet: { $cond: [ { $eq: [ '$event', 'signup_step_viewed' ] },    '$props.step', '$$REMOVE' ] } },
      stepsDone:    { $addToSet: { $cond: [ { $eq: [ '$event', 'signup_step_completed' ] }, '$props.step', '$$REMOVE' ] } },
      stepsSkipped: { $addToSet: { $cond: [ { $eq: [ '$event', 'signup_step_skipped' ] },   '$props.step', '$$REMOVE' ] } },
      otpSent:      { $sum: { $cond: [ { $eq: [ '$event', 'otp_sent' ] }, 1, 0 ] } },
      otpFailed:    { $sum: { $cond: [ { $eq: [ '$event', 'otp_failed' ] }, 1, 0 ] } },
      otpVerified:  { $max: { $cond: [ { $eq: [ '$event', 'otp_verified' ] }, true, false ] } },
      otpDeferred:  { $max: { $cond: [ { $eq: [ '$event', 'otp_deferred' ] }, true, false ] } },
      emailChanged: { $max: { $cond: [ { $eq: [ '$event', 'signup_email_changed' ] }, true, false ] } },
      registered:   { $max: { $cond: [ { $eq: [ '$event', 'signup_completed' ] }, true, false ] } },
      completed:    { $max: { $cond: [ { $eq: [ '$event', 'onboarding_completed' ] }, true, false ] } },
  } },
  { $set: {
      sessionId: '$_id',
      // 到達した一番先のステップ（'step1'…'step9'）。落ちた場所の目安になる
      furthestStep: { $max: '$stepsViewed' },
      stepsViewedCount: { $size: '$stepsViewed' },
      durationSec: { $round: [ { $divide: [ { $subtract: [ '$lastAt', '$startedAt' ] }, 1000 ] }, 0 ] },
      day: { $dateToString: { date: '$startedAt', format: '%Y-%m-%d', timezone: 'Asia/Tokyo' } },
  } },
  { $sort: { startedAt: -1 } },
];

const VIEWS = [
  { name: 'event_logs_enriched', on: 'event_logs', pipeline: ENRICHED_PIPELINE },
  { name: 'mission_analytics',   on: 'events',     pipeline: MISSION_PIPELINE },
  { name: 'session_flow',        on: 'event_logs', pipeline: SESSION_FLOW_PIPELINE },
  { name: 'event_summary',       on: 'events',     pipeline: EVENT_SUMMARY_PIPELINE },
  { name: 'user_summary',        on: 'users',      pipeline: USER_SUMMARY_PIPELINE },
  { name: 'signup_funnel',       on: 'event_logs', pipeline: SIGNUP_FUNNEL_PIPELINE },
];

async function recreateView(db, { name, on, pipeline }) {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length > 0) {
    console.log(`[views] 既存の ${name} を削除して作り直します`);
    await db.collection(name).drop();
  }
  await db.createCollection(name, { viewOn: on, pipeline });
  const count = await db.collection(name).estimatedDocumentCount().catch(() => null);
  const sample = await db.collection(name).findOne({});
  console.log(`[views] ${name} 作成（source: ${on}）`);
  console.log(`        サンプル1件:`, sample || '(データなし)');
}

(async () => {
  await connectDb();
  const db = getDb();
  console.log(`[views] 対象データベース: ${db.databaseName}`);
  for (const v of VIEWS) await recreateView(db, v);
  await closeDb();
  console.log('[views] 完了');
})().catch(async (e) => {
  console.error('[views] エラー:', e.message);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
