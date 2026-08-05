// lib/pushDispatchLog.js — 定期通知の重複送信を防ぐ記録
// MongoDB の `push_dispatch_log` コレクション（TTL 30日）。
//
// ★「送信前に insert を試み、重複エラーならスキップ」で冪等性を担保する。
//   送信後に記録する方式だと、送信成功・記録失敗の間に落ちたとき二重送信になる。
//
// dedupeKey の設計:
//   '<YYYY-MM-DD(JST)>:<slot>:<userId>'
//   ★ルールIDを含めない。これだけで「同じ枠は1日1通」の排他が自然に実現される
//     （優先順位の高いルールが先に鍵を取り、後続は insert に失敗してスキップされる）。
//
// スキーマ:
//   { _id, dedupeKey(unique), userId, ruleId, slot, dateJst, sentAt: Date }

'use strict';

const { getDb } = require('./db');

function col() { return getDb().collection('push_dispatch_log'); }

/** 「この日・この枠・この人」の鍵。ルールIDは含めない（枠単位の排他にするため） */
function slotKey(dateJst, slot, userId) {
  return `${dateJst}:${slot}:${userId}`;
}

/**
 * 送信の権利を取りに行く。取れたら true（＝送ってよい）。
 * 既に同じ鍵があれば false（＝他のルールで送信済み、または再実行）。
 * @returns {Promise<boolean>}
 */
async function claim(dedupeKey, { userId, ruleId, slot, dateJst }) {
  try {
    await col().insertOne({
      dedupeKey, userId, ruleId, slot, dateJst, sentAt: new Date(),
    });
    return true;
  } catch (e) {
    if (e && e.code === 11000) return false;   // unique 制約違反 = 既に送信済み
    throw e;
  }
}

/** 取った権利を戻す（送信自体を取りやめた場合。次回の判定で再挑戦できるようにする） */
async function release(dedupeKey) {
  await col().deleteOne({ dedupeKey }).catch(() => {});
}

/** その日・その枠が既に処理済みか（起動時キャッチアップの判定に使う） */
async function slotDone(dateJst, slot) {
  const n = await col().countDocuments({ dateJst, slot }, { limit: 1 });
  return n > 0;
}

/** 指定日・枠の送信件数（テスト・確認用） */
async function countForSlot(dateJst, slot) {
  return col().countDocuments({ dateJst, slot });
}

module.exports = { slotKey, claim, release, slotDone, countForSlot };
