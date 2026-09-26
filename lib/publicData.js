// lib/publicData.js — 一般公開の判定と、公開してよいデータだけを組み立てる（読み取り専用の純粋関数）
//
// ■ 公開は二層（指示書 §7-1）
//   基礎情報 … タイトル・ヘッダー画像・概要・場所・期間。events.publicBasicInfo が true のとき。開催前から可（広報用）
//   ナレッジ … 各タスクの内容と振り返り。events.publicKnowledge が true、かつ**開催日を過ぎている**とき
//
// ■ 公開に含めないもの（§7-4）。★ここで落とす。呼び出し側で足さないこと
//   - メンバーの個人名・ユーザー名・アバター・userId（submittedBy も出さない）
//   - チャット・差し戻しの理由・参加申請の回答（そもそも読まない）
//   - shareable が付いていない提出物
//   - solution（次にやるなら／なぜうまくいった？）が空の振り返り（学びが抽出されていない）
//
// ★公開ページ本体はまだ無い（外部サイトがデータを取りに来る形で、別タスク）。
//   外部に出す経路を作るときは、必ずこの buildPublicEvent を通すこと。
//   events / submissions をそのまま返すと、上の除外項目が全部漏れる。

'use strict';

/** 今日（サーバーのローカル時刻。TZ=Asia/Tokyo が前提）を 'YYYY-MM-DD' で */
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 開催日を過ぎているか（最終日の翌日以降）。★日程未設定は false（いつ終わるか分からない）。
 * クライアントの utils.js の isAfterEventDates と同じ判定に保つこと
 */
function isAfterEventDates(dates, today = todayStr()) {
  if (!Array.isArray(dates) || dates.length === 0) return false;
  const last = [...dates].filter(Boolean).sort().at(-1);
  return !!last && today > last;
}

/** 公開してよい振り返りか（shareable が付いていて、solution が空でない） */
function isPublishableSubmission(sub) {
  return !!sub && sub.shareable === true && String(sub.solution || '').trim() !== '';
}

/** 公開してよい振り返りの数（ナレッジを公開できるかの判定に使う） */
function countPublishable(submissions) {
  return Object.values(submissions || {}).filter(isPublishableSubmission).length;
}

/**
 * ナレッジを公開にしてよいか。
 * @returns {{ ok: true } | { ok: false, reason: 'not_after_event' | 'no_publishable' }}
 */
function canPublishKnowledge(dates, submissions, today = todayStr()) {
  if (!isAfterEventDates(dates, today)) return { ok: false, reason: 'not_after_event' };
  if (countPublishable(submissions) === 0) return { ok: false, reason: 'no_publishable' };
  return { ok: true };
}

const _MARK_RE = /\{\{(image|file):\d+\}\}/g;

/**
 * 公開してよいデータだけを組み立てる。
 * @param {object} flat          crdtToFlat 済みのイベント
 * @param {object} submissions   submissionStore.getSubmissionsForProject の戻り値
 * @returns {{ basic: object|null, knowledge: object[]|null }}
 */
function buildPublicEvent(flat, submissions, today = todayStr()) {
  const basic = flat?.publicBasicInfo === true ? {
    title:       String(flat.name || ''),
    headerImage: typeof flat.headerImage === 'string' && flat.headerImage ? flat.headerImage : null,
    summary:     String(flat.description || ''),
    venue:       typeof flat.venue === 'string' ? flat.venue : '',
    dates:       Array.isArray(flat.dates) ? [...flat.dates].sort() : [],
    dateTimes:   flat.dateTimes && typeof flat.dateTimes === 'object' ? flat.dateTimes : {},
  } : null;

  let knowledge = null;
  if (flat?.publicKnowledge === true && isAfterEventDates(flat.dates, today)) {
    const missions = Array.isArray(flat.missions) ? flat.missions : [];
    knowledge = [];
    for (const m of missions) {
      if (m.status !== 'cleared') continue;
      // 通常の提出物 ＋ 個別完了の提出物（<mid>_u_<userId>）。★userId は出さない
      const subs = Object.entries(submissions || {})
        .filter(([k]) => k === m.id || k.startsWith(`${m.id}_u_`))
        .map(([, s]) => s)
        .filter(isPublishableSubmission);
      for (const s of subs) {
        knowledge.push({
          title:    String(m.title || ''),
          tags:     Array.isArray(m.tags) && m.tags.length ? m.tags : (m.tag ? [m.tag] : []),
          outcome:  s.outcome || null,
          struggle: String(s.struggle || ''),
          solution: String(s.solution || ''),
          // 本文（画像・PDF の位置の印は外す）と、画像・PDF の URL
          text:     s.format === 'image' ? '' : String(s.content || '').replace(_MARK_RE, '').trim(),
          images:   Array.isArray(s.images) && s.images.length ? s.images : (s.format === 'image' && s.content ? [s.content] : []),
          files:    (Array.isArray(s.files) ? s.files : []).map(f => ({ url: f.url, name: f.name, size: f.size, thumb: f.thumb || null })),
          // ★submittedBy / timestamp の時刻 / objectId などは出さない
        });
      }
    }
  }
  return { basic, knowledge };
}

module.exports = { todayStr, isAfterEventDates, isPublishableSubmission, countPublishable, canPublishKnowledge, buildPublicEvent };
