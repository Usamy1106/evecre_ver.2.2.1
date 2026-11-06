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
// ■ 外部サイトが取りに来る経路は server.js の GET /api/public/events（一覧）と /api/public/events/:id（詳細）。
//   ★外部に出す経路は、必ずこの buildPublicEvent（一覧は publicListItem）を通すこと。
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

// ★画像・PDF の位置の印と、書式（太字・斜体）の印（{{b}} {{/b}} {{i}} {{/i}}）を外す
const _MARK_RE = /\{\{(image|file):\d+\}\}|\{\{\/?[bi]\}\}/g;

/** 提出物の本文（印を外したもの）。画像だけの旧形式は ''。★クライアントの utils.js の submissionText と同じ読み方 */
function _subText(sub) {
  if (!sub || sub.format === 'image') return '';
  return String(sub.content || '').replace(_MARK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 提出物の画像（images が空なら旧形式の content を1枚目に）。★utils.js の submissionImages と同じ */
function _subImages(sub) {
  if (!sub) return [];
  if (Array.isArray(sub.images) && sub.images.length > 0) return sub.images.filter(Boolean);
  return sub.format === 'image' && sub.content ? [sub.content] : [];
}

// ★外へ出す画像の URL は https のものだけ（dataURL などを一覧に載せない。保存時に R2 以外は捨てているが念のため）
const _isPublicUrl = (u) => typeof u === 'string' && /^https:\/\//.test(u);

/** 完了した提案由来のタスクの提出物（旧データの読み替え用。p1＝開催場所 / p3＝メインビジュアル） */
function _proposalSub(flat, submissions, proposalId) {
  const m = (flat?.missions || []).find(x => x.originProposalId === proposalId && x.status === 'cleared');
  return m ? submissions?.[m.id] : null;
}

/**
 * 概要・場所・ヘッダー画像。★アプリ側（utils.js の getArchiveSummary / getArchiveVenue / getEventMainVisual）と
 * 同じ読み替えをする。外すと「公開の確認では設定済みと出たのに、外部サイトでは空」になる。
 *   概要   … description。空なら初期タスク def-3 の本文
 *   場所   … venue。一度も書かれていない（undefined）ときだけ旧 archive-venue → p1 由来のタスク
 *   画像   … headerImage。一度も書かれていない（undefined）ときだけ旧 archive-image → p3 由来のタスクの1枚目
 *   ★空文字は「消した」なので旧データに戻さない（typeof で見る）
 */
function _summaryOf(flat, submissions) {
  const desc = String(flat?.description ?? '');
  return desc.trim() ? desc : _subText(submissions?.['def-3']);
}
function _venueOf(flat, submissions) {
  if (typeof flat?.venue === 'string') return flat.venue;
  const direct = submissions?.['archive-venue']?.content;
  if (typeof direct === 'string' && direct) return direct;
  return _subText(_proposalSub(flat, submissions, 'p1'));
}
function _headerImageOf(flat, submissions) {
  if (typeof flat?.headerImage === 'string') return _isPublicUrl(flat.headerImage) ? flat.headerImage : null;
  const direct = submissions?.['archive-image']?.content;
  if (_isPublicUrl(direct)) return direct;
  const first = _subImages(_proposalSub(flat, submissions, 'p3'))[0];
  return _isPublicUrl(first) ? first : null;
}

const _DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const _TIME_RE = /^\d{2}:\d{2}$/;

/**
 * 開催日ごとの時刻。★サーバーは保存時に dateTimes を検査していないので、外へ出す前にここで形を決める：
 *   { "YYYY-MM-DD": { start: "HH:MM" | "", end: "HH:MM" | "" } }
 *   キーは dates にある日付だけ。start も end も空の日は出さない
 */
function _publicDateTimes(dateTimes, dates) {
  const out = {};
  if (!dateTimes || typeof dateTimes !== 'object' || Array.isArray(dateTimes)) return out;
  const allowed = new Set(dates);
  for (const [d, v] of Object.entries(dateTimes)) {
    if (!_DATE_RE.test(d) || !allowed.has(d) || !v || typeof v !== 'object') continue;
    const start = typeof v.start === 'string' && _TIME_RE.test(v.start) ? v.start : '';
    const end   = typeof v.end   === 'string' && _TIME_RE.test(v.end)   ? v.end   : '';
    if (start || end) out[d] = { start, end };
  }
  return out;
}

/**
 * 公開してよいデータだけを組み立てる。
 * @param {object} flat          crdtToFlat 済みのイベント
 * @param {object} submissions   submissionStore.getSubmissionsForProject の戻り値
 * @returns {{ basic: object|null, knowledge: object[]|null }}
 */
function buildPublicEvent(flat, submissions, today = todayStr()) {
  let basic = null;
  if (flat?.publicBasicInfo === true) {
    const dates = Array.isArray(flat.dates) ? flat.dates.filter(d => typeof d === 'string' && _DATE_RE.test(d)).sort() : [];
    basic = {
      title:       String(flat.name || ''),
      headerImage: _headerImageOf(flat, submissions),
      summary:     _summaryOf(flat, submissions),
      venue:       _venueOf(flat, submissions),
      dates,
      dateTimes:   _publicDateTimes(flat.dateTimes, dates),
    };
  }

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
          text:     _subText(s),
          images:   _subImages(s).filter(_isPublicUrl),
          files:    (Array.isArray(s.files) ? s.files : []).filter(f => f && _isPublicUrl(f.url))
                      .map(f => ({ url: f.url, name: String(f.name || ''), size: Number(f.size) || 0, thumb: _isPublicUrl(f.thumb) ? f.thumb : null })),
          // ★submittedBy / timestamp の時刻 / objectId などは出さない
        });
      }
    }
  }
  return { basic, knowledge };
}

/** 'archive'（開催日を過ぎた）か 'upcoming'（それ以外。日程未設定を含む） */
function publicStatusOf(flat, today = todayStr()) {
  return isAfterEventDates(flat?.dates, today) ? 'archive' : 'upcoming';
}

/**
 * 一覧（GET /api/public/events）の1件。★buildPublicEvent の basic から作る（独自に項目を足さない）。
 * 基礎情報が非公開なら null。
 * hasKnowledge … publicKnowledge が true・開催後・公開してよい振り返りが1件以上（＝詳細の knowledge が空でない）
 */
function publicListItem(flat, submissions, today = todayStr()) {
  const pub = buildPublicEvent(flat, submissions, today);
  if (!pub.basic) return null;
  return {
    id: String(flat.id),
    ...pub.basic,
    status: publicStatusOf(flat, today),
    hasKnowledge: Array.isArray(pub.knowledge) && pub.knowledge.length > 0,
  };
}

module.exports = {
  todayStr, isAfterEventDates, isPublishableSubmission, countPublishable, canPublishKnowledge,
  buildPublicEvent, publicStatusOf, publicListItem,
};
