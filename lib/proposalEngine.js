// lib/proposalEngine.js — ミッション提案ルールベース生成エンジン
//
// 外部 API を一切使わずに動作する完全オフライン実装。
// ステップ:
//   1. カテゴリ判定（キーワードスコアリング）
//   2. テンプレートプールからの候補抽出（重複除外）
//   3. タグバランスを考慮した3件選出
//   4. {name} プレースホルダー置換

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

// ── 候補構築 ──────────────────────────────────────────────────

/**
 * カテゴリ・除外条件を適用してテンプレート候補を返す。
 * @param {string}   category
 * @param {string[]} existingTitles  既存ミッションのタイトル一覧
 * @param {string[]} usedIds         使用済みテンプレートID一覧
 * @returns {object[]}
 */
function _buildCandidates(category, existingTitles, usedIds) {
  const usedSet = new Set(usedIds);
  const titleSet = new Set(existingTitles.map(t => t.trim().toLowerCase()));

  return TEMPLATES.filter(t => {
    // カテゴリフィルタ: 指定カテゴリ または general のみ
    if (!t.categories.includes(category) && !t.categories.includes('general')) return false;
    // 使用済みテンプレートを除外
    if (usedSet.has(t.id)) return false;
    // 既存ミッションタイトルとの重複除外（プレースホルダー除去して比較）
    const baseTitle = t.title.replace(/\{name\}/g, '').trim().toLowerCase();
    if (titleSet.has(baseTitle)) return false;
    return true;
  });
}

// ── バランス選出 ──────────────────────────────────────────────

const TAG_ORDER = ['企画', '運営', '制作', '広報'];

/**
 * タグが偏らないよう count 件を選出する。
 * カテゴリ固有テンプレートを general より優先する。
 * @param {object[]} candidates
 * @param {string}   category     カテゴリ（general 以外を優先するため）
 * @param {number}   count
 * @returns {object[]}
 */
function _balancedSelect(candidates, category, count) {
  // カテゴリ固有を前に、general を後に並べる
  const sorted = [...candidates].sort((a, b) => {
    const aGenOnly = a.categories.length === 1 && a.categories[0] === 'general';
    const bGenOnly = b.categories.length === 1 && b.categories[0] === 'general';
    if (aGenOnly && !bGenOnly) return 1;
    if (!aGenOnly && bGenOnly) return -1;
    return 0;
  });

  const selected = [];
  const usedTags = new Set();

  // タグを分散させながら選出（各タグから1件ずつ）
  for (const tag of TAG_ORDER) {
    if (selected.length >= count) break;
    const found = sorted.find(t => t.tag === tag && !selected.includes(t));
    if (found) {
      selected.push(found);
      usedTags.add(tag);
    }
  }

  // 不足分を残り候補から補充
  for (const t of sorted) {
    if (selected.length >= count) break;
    if (!selected.includes(t)) selected.push(t);
  }

  return selected.slice(0, count);
}

// ── メイン: 提案生成 ──────────────────────────────────────────

/**
 * プロジェクト情報から提案を生成して返す。
 *
 * @param {object}   opts
 * @param {string}   opts.name              プロジェクト名
 * @param {string}   [opts.description]     プロジェクト説明
 * @param {string[]} [opts.existingTitles]  既存ミッションのタイトル一覧
 * @param {string[]} [opts.usedProposalIds] 使用済みテンプレートID一覧
 * @returns {{ proposals: object[], newUsedIds: string[] }}
 */
function generateProposals({
  name = '',
  description = '',
  existingTitles = [],
  usedProposalIds = [],
} = {}) {
  const category = detectCategory(name, description);
  const shortName = name.slice(0, 8);

  let candidates = _buildCandidates(category, existingTitles, usedProposalIds);

  // 候補が3件未満 → usedProposalIds をリセットして再選出
  if (candidates.length < 3) {
    candidates = _buildCandidates(category, existingTitles, []);
    usedProposalIds = [];
  }

  const selected = _balancedSelect(candidates, category, 3);

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

  return { proposals, newUsedIds };
}

module.exports = { generateProposals, detectCategory };
