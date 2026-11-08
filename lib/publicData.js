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
//   - 非公開テキスト（本文の {{p}}…{{/p}}）は**中身ごと**消す。その中に置いた画像・PDF も images / files から外す
//     ★印を外すだけ（_MARK_RE）にしないこと。印だけ消えて本文が全部公開される（指示書B §6-4）
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

// ★非公開テキストの印（{{p}} … {{/p}}）。中身ごと消す（下の splitPrivate）。
//   ★閉じていない {{p}} は末尾まで非公開（クライアントの utils.js の inlineRuns と同じ。安全側）。
//   対応しない {{/p}} は無視する。入れ子は数える（深さが 0 のところだけ残す）
const _PRIVATE_RE = /\{\{(\/?)p\}\}/g;
// ★画像・PDF の位置の印と、書式の印（太字 b・斜体 i・見出し h・箇条書き l、取り残しの p）を外す。
//   ★必ず splitPrivate で非公開テキストを中身ごと消した**あと**に使うこと（先に使うと本文が全部出る）
const _MARK_RE = /\{\{(image|file):\d+\}\}|\{\{\/?[bihlp]\}\}/g;
const _EMBED_RE = /\{\{(image|file):(\d+)\}\}/g;

/**
 * 本文を「外に出してよい部分」と「非公開の部分」に分ける。
 * @returns {{ kept: string, hiddenImages: Set<number>, hiddenFiles: Set<number> }}
 *   kept … 非公開の部分を中身ごと消した本文（印はまだ残っている）
 *   hiddenImages / hiddenFiles … 非公開の部分に置かれた画像・PDF の番号（1始まり）
 */
function splitPrivate(text) {
  const src = String(text ?? '');
  let kept = '', depth = 0, last = 0;
  const removed = [];
  const take = (part) => { if (depth === 0) kept += part; else removed.push(part); };
  for (const m of src.matchAll(_PRIVATE_RE)) {
    take(src.slice(last, m.index));
    last = m.index + m[0].length;
    depth = m[1] ? Math.max(0, depth - 1) : depth + 1;
  }
  take(src.slice(last));
  const hiddenImages = new Set(), hiddenFiles = new Set();
  for (const part of removed) {
    for (const e of part.matchAll(_EMBED_RE)) (e[1] === 'image' ? hiddenImages : hiddenFiles).add(Number(e[2]));
  }
  return { kept, hiddenImages, hiddenFiles };
}

/** 外に出してよい文字だけ（非公開テキストを中身ごと消し、そのあと印を外す）。★この順を崩さないこと */
function publicText(text) {
  return splitPrivate(text).kept.replace(_MARK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 本文の構造（2026-11-08。外部サイトが見出し・箇条書きを描けるように）。
 * ★印の解釈は本体で済ませ、外部サイトには印の仕様を持たせない（本体が印を変えても外部サイトが壊れないように）。
 * ★必ず splitPrivate で非公開を中身ごと消した**あと**の本文から作る（text と同じ確認を通す）。
 * @returns {{ type: 'heading'|'text'|'item', text: string }[]}
 *   heading … {{h}}…{{/h}} の行／item … {{l}}…{{/l}} の行（1行＝1項目）／text … それ以外
 *   - ふつうの行が続くときは1つの text にまとめ、行の区切りは '\n' で残す（段落）
 *   - 空の行（空白だけも）はブロックにせず、段落の区切りにする。中身の無い heading / item / text は出さない
 *   - 太字・斜体・画像・PDF の位置の印は外す（画像・PDF は images / files にある）
 *   - 1行の途中に見出し・箇条書きの印がある崩れた本文も、その行ごとそれとして扱う。閉じていない印は次の行へ続く
 */
const _LINE_MARK_RE = /\{\{(\/?)([hl])\}\}/g;
function publicBlocks(text) {
  const blocks = [];
  const open = { h: 0, l: 0 };
  let para = [];
  const flush = () => {
    const t = para.join('\n').trim();
    if (t) blocks.push({ type: 'text', text: t });
    para = [];
  };
  for (const line of splitPrivate(text).kept.split('\n')) {
    let isH = open.h > 0, isL = open.l > 0;
    for (const m of line.matchAll(_LINE_MARK_RE)) {
      const k = m[2];
      if (m[1]) open[k] = Math.max(0, open[k] - 1);
      else { open[k]++; if (k === 'h') isH = true; else isL = true; }
    }
    const t = line.replace(_MARK_RE, '').trim();
    if (isH || isL) {
      flush();
      if (t) blocks.push({ type: isH ? 'heading' : 'item', text: t });
      continue;
    }
    if (!t) { flush(); continue; }
    para.push(t);
  }
  flush();
  return blocks;
}

/** 提出物の本文（非公開を消し、印を外したもの）。画像だけの旧形式は ''。★クライアントの utils.js の submissionText と同じ読み方 */
function _subText(sub) {
  if (!sub || sub.format === 'image') return '';
  return publicText(sub.content);
}

/** 提出物の画像（images が空なら旧形式の content を1枚目に）。★utils.js の submissionImages と同じ。
 *  ★非公開テキストの中に置いた画像は外す */
function _subImages(sub) {
  if (!sub) return [];
  if (Array.isArray(sub.images) && sub.images.length > 0) {
    const { hiddenImages } = sub.format === 'image' ? { hiddenImages: new Set() } : splitPrivate(sub.content);
    return sub.images.map((u, i) => (hiddenImages.has(i + 1) ? null : u)).filter(Boolean);
  }
  return sub.format === 'image' && sub.content ? [sub.content] : [];
}

/** 提出物の添付 PDF。★非公開テキストの中に置いた PDF は外す */
function _subFiles(sub) {
  if (!sub || !Array.isArray(sub.files)) return [];
  const { hiddenFiles } = sub.format === 'image' ? { hiddenFiles: new Set() } : splitPrivate(sub.content);
  return sub.files.filter((f, i) => f && !hiddenFiles.has(i + 1));
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
  // ★description はサーバーが def-3 から写すときに非公開を消している（server.js の _summaryTextOf）が、
  //   古いデータや直接書かれた値もあるので、ここでも通す
  const desc = publicText(flat?.description);
  return desc ? desc : _subText(submissions?.['def-3']);
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

// 種別（作成フロー STEP 2）。★外へは id だけを出す（ラベルの文言は外部サイトに持たせる）。
//   public/js/constants.js の EVENT_TYPES の id と同じ並び・同じ値に保つこと
const EVENT_TYPE_IDS = ['exhibit', 'festival_market', 'live_performance', 'contest', 'social', 'other'];

/**
 * 最終更新（'YYYY-MM-DD'。無ければ null。2026-11-07。指示書B §4-3・§5-4）。
 * 基礎情報（名前・概要・場所・ヘッダー画像・期間・柱）のセルの更新時刻（crdtToFlat の basicUpdatedAt）と、
 * 提出物の時刻の大きいほう。★公開フラグの切り替えは含めない（basicUpdatedAt がそもそも数えない）。
 * ★クライアントの utils.js の archiveLastUpdated と同じ式に保つこと
 */
function lastUpdatedOf(flat, submissions) {
  const ts = [Number(flat?.basicUpdatedAt) || 0,
    ...Object.values(submissions || {}).map(s => Number(s?.timestamp) || 0)];
  const max = Math.max(0, ...ts);
  return max > 0 ? todayStr(new Date(max)) : null;
}
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
function buildPublicEvent(flat, submissions, today = todayStr(), opts = {}) {
  // ★opts.preview（公開の確認ページ。GET /api/events/:id/public-preview・管理者だけ）は、
  //   公開フラグ（publicBasicInfo / publicKnowledge）の判定**だけ**を飛ばす。
  //   それ以外の除外（名前・userId・チャット・shareable の無い提出物・solution が空の振り返り・非公開テキスト・開催日）は
  //   すべてそのまま通す＝「公開したら外に出る姿」そのもの
  const preview = opts.preview === true;
  let basic = null;
  if (preview || flat?.publicBasicInfo === true) {
    const dates = Array.isArray(flat.dates) ? flat.dates.filter(d => typeof d === 'string' && _DATE_RE.test(d)).sort() : [];
    basic = {
      title:       String(flat.name || ''),
      headerImage: _headerImageOf(flat, submissions),
      summary:     _summaryOf(flat, submissions),
      venue:       _venueOf(flat, submissions),
      dates,
      dateTimes:   _publicDateTimes(flat.dateTimes, dates),
      eventType:   EVENT_TYPE_IDS.includes(flat.eventType) ? flat.eventType : null,
      lastUpdated: lastUpdatedOf(flat, submissions),
    };
  }

  let knowledge = null;
  if ((preview || flat?.publicKnowledge === true) && isAfterEventDates(flat.dates, today)) {
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
          // ★振り返りの欄も念のため非公開テキストを消してから出す（いまは文字だけの欄で印は入らない）
          struggle: publicText(s.struggle),
          solution: publicText(s.solution),
          // 本文（画像・PDF の位置の印は外す）と、画像・PDF の URL
          text:     _subText(s),
          // ★本文の構造（見出し・本文・箇条書き）。text と同じく非公開を消してから作る。画像だけの旧形式は []
          blocks:   !s || s.format === 'image' ? [] : publicBlocks(s.content),
          images:   _subImages(s).filter(_isPublicUrl),
          files:    _subFiles(s).filter(f => _isPublicUrl(f.url))
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
  buildPublicEvent, publicStatusOf, publicListItem, splitPrivate, publicText, publicBlocks, lastUpdatedOf, EVENT_TYPE_IDS,
};
