// lib/exploreStore.js — 公開ページ（/explore）のいいね・コメント（2026-11-12。指示書05）
//
// public_likes    { _id, eventId, voterKey, createdAt }
//   voterKey：ログインしている人は 'u:<userId>'、していない人は 'a:<匿名ID>'（署名付き Cookie evecre_vid の値）
//   ★「1人1回」は一意インデックス { eventId, voterKey } が持つ。アプリ側の確認に頼らない（同時に押されても2件にならない）
//   ★IP アドレスは保存しない
// public_comments { _id, eventId, userId, body, createdAt }
//   ★応答では userId を外に出さない（server.js が users から名前とアイコンだけを引いて付ける）
//
// 後始末：イベント削除で deleteForEvent、退会で deleteForUser（コメントもいいねも消す。2026-11-12 ユーザー決定）

const crypto = require('crypto');
const { getDb } = require('./db');

const likes    = () => getDb().collection('public_likes');
const comments = () => getDb().collection('public_comments');

const COMMENT_MAX_CHARS = 1000;
const COMMENT_MAX_LINES = 10;
const COMMENT_PAGE      = 30;

// ── いいね ─────────────────────────────────────────

/** いいねする。すでにあれば何もしない（一意インデックスの重複は成功扱い） */
async function addLike(eventId, voterKey) {
  try {
    await likes().insertOne({ _id: 'l_' + crypto.randomBytes(8).toString('hex'), eventId, voterKey, createdAt: new Date() });
  } catch (e) {
    if (e?.code !== 11000) throw e;
  }
}

async function removeLike(eventId, voterKey) {
  await likes().deleteOne({ eventId, voterKey });
}

async function countLikes(eventId) {
  return likes().countDocuments({ eventId });
}

/** 複数イベントのいいね数（一覧用。1回の集計で取る） */
async function countLikesMany(eventIds) {
  const out = {};
  if (!eventIds.length) return out;
  const rows = await likes().aggregate([
    { $match: { eventId: { $in: eventIds } } },
    { $group: { _id: '$eventId', n: { $sum: 1 } } },
  ]).toArray();
  for (const r of rows) out[r._id] = r.n;
  return out;
}

/** この閲覧者がいいね済みか。voterKeys はログイン中なら [u:…, a:…] の両方を渡してよい */
async function hasLiked(eventId, voterKeys) {
  const keys = voterKeys.filter(Boolean);
  if (!keys.length) return false;
  return !!(await likes().findOne({ eventId, voterKey: { $in: keys } }, { projection: { _id: 1 } }));
}

/**
 * 匿名のいいねをログインした人のものに付け替える（ログインした直後に1回。2026-11-12 ユーザー決定）
 * ★同じイベントに u: のいいねが既にあれば、匿名の方を消して1件にまとめる（二重に数えない）
 */
async function claimAnonLikes(anonKey, userKey) {
  if (!anonKey || !userKey) return 0;
  const anon = await likes().find({ voterKey: anonKey }, { projection: { eventId: 1 } }).toArray();
  let moved = 0;
  for (const l of anon) {
    try {
      const r = await likes().updateOne({ _id: l._id, voterKey: anonKey }, { $set: { voterKey: userKey } });
      moved += r.modifiedCount;
    } catch (e) {
      if (e?.code !== 11000) throw e;
      await likes().deleteOne({ _id: l._id });   // 既に u: のいいねがある → 匿名の方を消す
    }
  }
  return moved;
}

// ── コメント ───────────────────────────────────────

/**
 * 本文を正規化する。前後の空白を削り、改行は10行まで（それ以上は後ろを1行に詰める）。
 * @returns {string|null} 不正（空・長すぎる・文字列でない）なら null
 */
function normalizeCommentBody(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const lines = s.split('\n');
  if (lines.length > COMMENT_MAX_LINES) {
    s = [...lines.slice(0, COMMENT_MAX_LINES - 1), lines.slice(COMMENT_MAX_LINES - 1).join(' ')].join('\n');
  }
  if (!s || [...s].length > COMMENT_MAX_CHARS) return null;
  return s;
}

async function addComment(eventId, userId, body) {
  const doc = { _id: 'pc_' + crypto.randomBytes(8).toString('hex'), eventId, userId, body, createdAt: new Date() };
  await comments().insertOne(doc);
  return doc;
}

/** 新しい順に COMMENT_PAGE 件。before（ミリ秒）より古いものだけ。hasMore 判定のため1件多く取る */
async function listComments(eventId, before = null) {
  const q = { eventId };
  if (Number.isFinite(before)) q.createdAt = { $lt: new Date(before) };
  const rows = await comments().find(q).sort({ createdAt: -1, _id: -1 }).limit(COMMENT_PAGE + 1).toArray();
  return { rows: rows.slice(0, COMMENT_PAGE), hasMore: rows.length > COMMENT_PAGE };
}

async function getComment(commentId) {
  if (typeof commentId !== 'string') return null;
  return comments().findOne({ _id: commentId });
}

async function deleteComment(commentId) {
  await comments().deleteOne({ _id: commentId });
}

// ── 後始末 ─────────────────────────────────────────

async function deleteForEvent(eventId) {
  await likes().deleteMany({ eventId });
  await comments().deleteMany({ eventId });
}

async function deleteForUser(userId) {
  await likes().deleteMany({ voterKey: `u:${userId}` });
  await comments().deleteMany({ userId });
}

module.exports = {
  COMMENT_MAX_CHARS, COMMENT_MAX_LINES, COMMENT_PAGE,
  addLike, removeLike, countLikes, countLikesMany, hasLiked, claimAnonLikes,
  normalizeCommentBody, addComment, listComments, getComment, deleteComment,
  deleteForEvent, deleteForUser,
};
