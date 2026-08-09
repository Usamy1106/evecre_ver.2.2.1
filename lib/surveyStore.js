// lib/surveyStore.js — アカウント作成時アンケートの回答を保管する
//
// 目的：退会してもアンケートの集計値だけは残し、サービス改善に使えるようにする。
//
// ★必ず「個人を特定できない形」に加工してから保存すること。
//   プライバシーポリシー第7項で「アカウントを削除した場合、当該アカウントに紐づく
//   情報は削除されます」と約束しているため、userId・メールアドレス・表示名を
//   持ち越してはいけない。ここで保存するのは選択肢の回答だけの統計情報。
//
// 保存しないもの（意図的に落としている）：
//   - _id / userId / emailLower / username / avatarUrl … 本人に辿れるため
//   - acquisitionInviteEventId … どのイベントの招待かが分かると、そのイベントの
//     参加者名簿と突き合わせて個人が特定されうるため
//   - createdAt の時刻 … 登録時刻が分かると行動ログと突き合わせられるため、
//     月単位（YYYY-MM）に丸めて保持する

'use strict';

const crypto = require('crypto');
const { getDb } = require('./db');

function col() { return getDb().collection('survey_responses'); }

/** epoch ms → 'YYYY-MM'（時刻を落として月単位に丸める） */
function _month(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 退会するユーザーのアンケート回答を、匿名化して保存する。
 * 回答が1つも無ければ何もしない（空レコードを増やさない）。
 *
 * @param {object} user users コレクションのドキュメント（アプリ用オブジェクト）
 * @returns {Promise<boolean>} 保存したか
 */
async function saveAnonymized(user) {
  if (!user) return false;

  const answers = {
    acquisitionChannel:      user.acquisitionChannel      || null,
    acquisitionChannelOther: user.acquisitionChannelOther || null,
    eventExperience:         user.eventExperience         || null,
    workStylePlanning:       user.workStylePlanning       || null,
    workStyleSocial:         user.workStyleSocial         || null,
    notificationPreference:  user.notificationPreference  || null,
  };
  // 全部未回答なら残す意味がない
  if (Object.values(answers).every(v => v === null)) return false;

  await col().insertOne({
    _id: crypto.randomBytes(8).toString('hex'),   // 本人と無関係な新しいID
    ...answers,
    // 認証方法は googleSub の有無から導出（users には保存していない）
    authProvider:   user.googleSub ? 'google' : 'password',
    consentVersion: user.consentVersion || null,
    // オンボーディングを完走したかどうか（回答の信頼度の目安になる）
    onboardingCompleted: !!user.onboarding?.completedAt,
    signedUpMonth:  _month(user.createdAt),        // 時刻は落とす
    deletedMonth:   _month(Date.now()),
    source: 'deleted_account',                     // 現役ユーザー分と区別する
  });
  return true;
}

module.exports = { saveAnonymized };
