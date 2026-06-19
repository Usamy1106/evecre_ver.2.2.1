// lib/proposalEngine.js — ミッション提案ルールベース生成エンジン
//
// 外部 API を一切使わずに動作する完全オフライン実装。
// ステップ:
//   1. カテゴリ判定（キーワードスコアリング）
//   2. 企画フェーズ判定（イベント開催日 / daysLeft から early/mid/late/during/after を推定）
//   3. タグ別ギャップ検出（既存ミッションのタグ分布と完了状況から手薄な領域を割り出す）
//   4. テンプレートプールからの候補抽出（重複除外）
//   5. フェーズ適合 + ギャップ + カテゴリ固有のスコアで、タグ分散を保ちつつ3件選出
//   6. {name} プレースホルダー置換

'use strict';

const { TEMPLATES } = require('./proposalTemplates');
const crypto = require('crypto');

// ── カテゴリキーワード ────────────────────────────────────────
const CATEGORY_KEYWORDS = {
  music:    ['ライブ', 'コンサート', '音楽', 'フェス', 'バンド', 'DJ', '演奏', '歌', 'ミュージック', '音響', 'live', 'music'],
  exhibit:  ['展示', 'アート', 'ギャラリー', '展覧', '作品', 'インスタレーション', '美術', '展覧会', 'art', 'gallery'],
  sports:   ['スポーツ', '大会', '試合', 'マラソン', '競技', 'トーナメント', '選手権', '運動会', 'sport', 'game'],
  business: ['カンファレンス', 'セミナー', 'ビジネス', '勉強会', 'ハッカソン', 'LT', 'ミートアップ', 'サミット', 'conference', 'seminar'],
  party:    ['パーティー', 'パーティ', '祭り', 'お祝い', '記念', '懇親', '交流', '宴', '飲み会', '宴会', 'party', 'festival'],
};

// ── カテゴリ判定 ──────────────────────────────────────────────

/**
 * プロジェクト名と説明からカテゴリを判定する。
 * スコアが最も高いカテゴリを返す。マッチなしは 'general'。
 * @param {string} name
 * @param {string} description
 * @returns {string}
 */
function detectCategory(name = '', description = '') {
  const text = (name + ' ' + description).toLowerCase();
  let best = 'general';
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter(kw => text.includes(kw.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return best;
}

// ── 企画フェーズ判定 ──────────────────────────────────────────
//
// mainBoard.js の開催日チップ5分岐（開催前/初日/中間/最終日/終了後）と整合する区分:
//   開催前を残り日数で early / mid / late に細分し、初日〜最終日は during、終了後は after。

const PHASES = ['early', 'mid', 'late', 'during', 'after'];

// イベント設定の明示フェーズ（eventSettings.js の eventPhase）→ 適合するカレンダーフェーズ集合。
// カレンダー判定（detectPhase）を主軸にしつつ、明示フェーズに合うテンプレへ補助加点するために使う。
const EVENT_PHASE_MAP = {
  '企画準備': ['early', 'mid'],
  '告知':     ['mid', 'late', 'during'],
  '完了':     ['after'],
};

/** 今日の日付を 'YYYY-MM-DD'（ローカル時刻）で返す */
function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 残り日数を計算する。public/js/utils.js の calculateDaysLeft と同じ挙動
 * （0時基準・切り上げ・負値は0）。lib は CommonJS のため移植（挙動を変えないこと）。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} todayStr 'YYYY-MM-DD'
 * @returns {number}
 */
function _daysUntil(dateStr, todayStr) {
  const target = new Date(dateStr);
  const now = new Date(todayStr);
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function _phaseFromDaysLeft(days) {
  if (days > 21) return 'early';
  if (days > 7)  return 'mid';
  return 'late';
}

/**
 * イベントの開催日（または daysLeft）から企画フェーズを推定する。
 * 日程未設定かつ daysLeft も無い場合は null（フェーズ不明 = スコア中立）。
 *
 * @param {object}   opts
 * @param {string[]} [opts.eventDates] 開催日（未ソートで来る前提。内部でソートする）
 * @param {number}   [opts.daysLeft]   開催日が無い場合のフォールバック
 * @param {string}   [todayStr]        テスト用に注入可能。省略時は今日
 * @returns {'early'|'mid'|'late'|'during'|'after'|null}
 */
function detectPhase({ eventDates = [], daysLeft = null } = {}, todayStr = _todayStr()) {
  const sorted = [...(eventDates || [])].filter(Boolean).sort();
  if (sorted.length > 0) {
    const first = sorted[0];
    const last  = sorted[sorted.length - 1];
    if (todayStr > last)   return 'after';
    if (todayStr >= first) return 'during';
    return _phaseFromDaysLeft(_daysUntil(first, todayStr));
  }
  if (typeof daysLeft === 'number' && Number.isFinite(daysLeft)) {
    return _phaseFromDaysLeft(daysLeft);
  }
  return null;
}

// ── タグ別ギャップ検出 ────────────────────────────────────────

const TAG_ORDER = ['企画', '運営', '制作', '広報'];

function _missionTags(m) {
  if (Array.isArray(m.tags) && m.tags.length > 0) return m.tags;
  return m.tag ? [m.tag] : [];
}

/**
 * 既存ミッションのタグ分布・完了状況から、タグごとのギャップスコア(0〜2)を返す。
 * - そのタグのミッションが少ないほど高い（未登場 = 2.0）
 * - 全件完了済みのタグはさらに半減（一巡済みの領域は優先度を下げる）
 * - 未完了のまま締め切り超過しているミッションがあるタグは加点（遅れている領域を支援）
 *
 * @param {object[]} missions [{ tag, tags, status, dates }]
 * @param {string}   todayStr
 * @returns {Object<string, number>}
 */
function _tagGapScores(missions = [], todayStr = _todayStr()) {
  const total   = {};
  const open    = {};
  const overdue = {};
  for (const tag of TAG_ORDER) { total[tag] = 0; open[tag] = 0; overdue[tag] = 0; }

  for (const m of missions) {
    const cleared = m.status === 'cleared';
    // m.dates は未ソート保存（CLAUDE.md 落とし穴12）。最終日はソートしてから取る
    const lastDate = Array.isArray(m.dates) && m.dates.length > 0
      ? [...m.dates].sort()[m.dates.length - 1]
      : null;
    for (const tag of _missionTags(m)) {
      if (!(tag in total)) continue;   // ビルトイン4タグ以外（カスタムタグ）は対象外
      total[tag] += 1;
      if (!cleared) {
        open[tag] += 1;
        if (lastDate && lastDate < todayStr) overdue[tag] += 1;
      }
    }
  }

  const scores = {};
  for (const tag of TAG_ORDER) {
    let s = 2 / (1 + total[tag]);                      // 少ないほど手薄
    if (total[tag] > 0 && open[tag] === 0) s *= 0.5;   // 全件完了済み → 下げる
    if (overdue[tag] > 0) s = Math.min(2, s + 0.5);    // 締め切り超過あり → 支援を上げる
    scores[tag] = s;
  }
  return scores;
}

// ── 候補構築 ──────────────────────────────────────────────────

/**
 * 提案ID（`<テンプレID>_<suffix>` または旧形式の素のID）からテンプレIDを取り出す。
 * 例: 'mu-p1_lx3f9abc' → 'mu-p1', 'p1' → 'p1'
 */
function _templateIdOf(proposalId) {
  return String(proposalId).split('_')[0];
}

/**
 * カテゴリ・除外条件を適用してテンプレート候補を返す。
 * @param {string}   category
 * @param {string[]} existingTitles    既存ミッションのタイトル一覧
 * @param {string[]} usedIds           使用済みテンプレートID一覧（候補不足時はリセットされる）
 * @param {Set<string>} lockedIds      既存ミッションの元になったテンプレID（リセットでも除外を維持）
 * @param {string}   shortName         {name} 置換後タイトルでの重複比較用
 * @returns {object[]}
 */
function _buildCandidates(category, existingTitles, usedIds, lockedIds = new Set(), shortName = '') {
  const usedSet = new Set(usedIds);
  const titleSet = new Set(existingTitles.map(t => t.trim().toLowerCase()));

  return TEMPLATES.filter(t => {
    // カテゴリフィルタ: 指定カテゴリ または general のみ
    if (!t.categories.includes(category) && !t.categories.includes('general')) return false;
    // 既存ミッションに変換済みのテンプレを除外（完了済みミッションも missions に残るため対象）
    if (lockedIds.has(t.id)) return false;
    // 使用済みテンプレートを除外
    if (usedSet.has(t.id)) return false;
    // 既存ミッションタイトルとの重複除外
    // （プレースホルダー除去版と {name} 置換版の両方で比較。置換版だけだと
    //   '{name}のセットリストを決める' → '文化祭ライブのセットリストを決める' を検出できない）
    const baseTitle = t.title.replace(/\{name\}/g, '').trim().toLowerCase();
    const fullTitle = t.title.replace(/\{name\}/g, shortName).trim().toLowerCase();
    if (titleSet.has(baseTitle) || titleSet.has(fullTitle)) return false;
    return true;
  });
}

// ── スコアリング選出 ──────────────────────────────────────────

/**
 * テンプレート1件のスコアを計算する。
 * - フェーズ適合: 適合 +2 / phases 未定義(全フェーズ対象) +1 / 不適合 0
 *   （phase が null = フェーズ不明のときは全テンプレ +1 で中立）
 * - ギャップ: そのテンプレのタグのギャップスコア（0〜2）
 * - カテゴリ固有: general 専用でないテンプレは +0.5（従来の general 後回しを踏襲）
 * - 明示フェーズ(eventPhase)適合: +0.5（カレンダー判定 ±2 より小さく、あくまで補助）
 *
 * @param {Set<string>|null} eventPhaseSet eventPhase が示すカレンダーフェーズ集合（null=未設定）
 */
function _scoreTemplate(t, phase, gapScores, eventPhaseSet = null) {
  let score = 0;

  if (!phase || !Array.isArray(t.phases)) score += 1;
  else if (t.phases.includes(phase))      score += 2;

  score += gapScores[t.tag] ?? 1;

  const genOnly = t.categories.length === 1 && t.categories[0] === 'general';
  if (!genOnly) score += 0.5;

  if (eventPhaseSet && Array.isArray(t.phases) && t.phases.some(ph => eventPhaseSet.has(ph))) {
    score += 0.5;
  }

  return score;
}

/**
 * スコア順を基本に、タグが偏らないよう count 件を選出する。
 * 0パス目（任意）: reserveSpark のとき先頭1枠を「気づき・調査」系(kind:'spark')に確保する。
 *   sparkは最大1件に制限し、残り枠は大粒の成果物提案を保証する（小粒に埋もれさせない）。
 * 1パス目: スコア降順で「まだ選んでいないタグ」のテンプレを優先して拾う（タグ分散の維持）
 * 2パス目: 件数が足りなければ残りからスコア順に補充
 *
 * @param {object[]} candidates
 * @param {string|null} phase
 * @param {Object<string, number>} gapScores
 * @param {number}   count
 * @param {object}   [opts]
 * @param {Set<string>|null} [opts.eventPhaseSet] 明示フェーズ適合の加点用
 * @param {boolean}  [opts.reserveSpark] true なら序盤フェーズとして spark を1枠確保
 * @returns {object[]}
 */
function _scoredSelect(candidates, phase, gapScores, count, { eventPhaseSet = null, reserveSpark = false } = {}) {
  const sorted = [...candidates]
    .map((t, i) => ({ t, i, score: _scoreTemplate(t, phase, gapScores, eventPhaseSet) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))   // 同点はテンプレ定義順で安定
    .map(x => x.t);

  const selected = [];
  const usedTags = new Set();

  // 序盤フェーズ: 最上位の spark を1枠だけ確保（無ければ通常選出のみ）
  if (reserveSpark) {
    const spark = sorted.find(t => t.kind === 'spark');
    if (spark) { selected.push(spark); usedTags.add(spark.tag); }
  }
  // spark は最大1件（reserveSpark 時は以降の枠から spark を除外＝大粒を必ず残す）
  const skipSpark = reserveSpark;

  for (const t of sorted) {
    if (selected.length >= count) break;
    if (selected.includes(t)) continue;
    if (skipSpark && t.kind === 'spark') continue;
    if (!usedTags.has(t.tag)) {
      selected.push(t);
      usedTags.add(t.tag);
    }
  }
  for (const t of sorted) {
    if (selected.length >= count) break;
    if (selected.includes(t)) continue;
    if (skipSpark && t.kind === 'spark') continue;
    selected.push(t);
  }
  return selected.slice(0, count);
}

// ── メイン: 提案生成 ──────────────────────────────────────────

/**
 * プロジェクト情報から提案を生成して返す。
 *
 * 旧シグネチャ（name / description / existingTitles / usedProposalIds のみ）でも動作する。
 * その場合フェーズは null（中立）、ギャップは全タグ一律になり、従来相当の選出になる。
 *
 * @param {object}   opts
 * @param {string}   opts.name              プロジェクト名
 * @param {string}   [opts.description]     プロジェクト説明
 * @param {string[]} [opts.existingTitles]  既存ミッションのタイトル一覧
 * @param {string[]} [opts.usedProposalIds] 使用済みテンプレートID一覧
 * @param {string[]} [opts.eventDates]      イベント開催日（フェーズ判定用）
 * @param {number}   [opts.daysLeft]        開催日が無い場合のフォールバック
 * @param {string}   [opts.eventPhase]      イベント設定の明示フェーズ（企画準備/告知/完了）。補助加点＋spark確保の判定に使う
 * @param {object[]} [opts.missions]        既存ミッション [{ tag, tags, status, dates, originProposalId }]
 *                                          （ギャップ検出 + 既存/完了済みミッションの再提案防止用）
 * @returns {{ proposals: object[], newUsedIds: string[], phase: string|null }}
 */
function generateProposals({
  name = '',
  description = '',
  existingTitles = [],
  usedProposalIds = [],
  eventDates = [],
  daysLeft = null,
  eventPhase = null,
  missions = [],
} = {}) {
  const category  = detectCategory(name, description);
  const todayStr  = _todayStr();
  const phase     = detectPhase({ eventDates, daysLeft }, todayStr);
  const gapScores = _tagGapScores(missions, todayStr);
  const shortName = name.slice(0, 8);

  // 明示フェーズ（カレンダー優先・補助加点用の集合）
  const eventPhaseSet = EVENT_PHASE_MAP[eventPhase] ? new Set(EVENT_PHASE_MAP[eventPhase]) : null;

  // 序盤フェーズなら「気づき・調査」枠(spark)を1件確保する。
  // カレンダーが序盤(early/mid)または不明(null) → 確保。明示フェーズで上書き（企画準備=確保 / 完了=しない）。
  let reserveSpark;
  if (eventPhase === '完了')          reserveSpark = false;
  else if (eventPhase === '企画準備') reserveSpark = true;
  else reserveSpark = (phase === 'early' || phase === 'mid' || phase === null);

  // 既存ミッション（完了済み含む）の元テンプレIDは、usedProposalIds リセット後も除外を維持する。
  // タイトルが編集されたミッションでも originProposalId で確実に弾ける。
  const lockedIds = new Set(
    missions.map(m => m.originProposalId).filter(Boolean).map(_templateIdOf)
  );

  let candidates = _buildCandidates(category, existingTitles, usedProposalIds, lockedIds, shortName);

  // 候補が3件未満 → usedProposalIds をリセットして再選出
  // （既存ミッション由来の lockedIds とタイトル重複の除外は維持される）
  if (candidates.length < 3) {
    candidates = _buildCandidates(category, existingTitles, [], lockedIds, shortName);
    usedProposalIds = [];
  }

  const selected = _scoredSelect(candidates, phase, gapScores, 3, { eventPhaseSet, reserveSpark });

  // プレースホルダー置換 + ユニークIDを付与
  const suffix = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const proposals = selected.map(t => ({
    id:          `${t.id}_${suffix}`,
    title:       t.title.replace(/\{name\}/g, shortName),
    tag:         t.tag,
    format:      t.format,
    priority:    5,
    description: t.description || '',
  }));

  const newUsedIds = [...new Set([...usedProposalIds, ...selected.map(t => t.id)])];

  return { proposals, newUsedIds, phase };
}

module.exports = { generateProposals, detectCategory, detectPhase, PHASES };
