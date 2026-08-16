// ===== 担当者の「おすすめ」 =====
// ミッションのラベルと、メンバーが参加申請フォームで答えた「できること」「やってみたいこと」を
// 突き合わせて、担当者シートの上に候補を出す。
//
// ★出さない条件をはっきり持つこと（無理に出すと、根拠のない推薦になって信用されない）：
//   - ラベルが1つも選ばれていない → 判断材料が無いので出さない
//   - メンバーが誰も参加時フォームに答えていない → 出さない
//   - 答えているが、そのラベルに関係する回答が誰にも無い → 出さない
//
// ★「できること」だけで並べないこと。フォームの STEP 2（やってみたいこと）が死に、
//   経験者にばかり仕事が寄る。得意を上位に置きつつ、やってみたい人も拾う。

import { SKILL_TAGS, TAG_SKILL_HINTS } from './constants.js';

const _SKILL_LABEL = Object.fromEntries(SKILL_TAGS.map(s => [s.id, s.label]));

const GOOD_POINT = 2;   // できること（得意）の1一致あたり
const WANT_POINT = 1;   // やってみたいことの1一致あたり

/**
 * ラベル名から、関係するスキルタグの id を返す。
 * ビルトイン4種は TAG_SKILL_HINTS、カスタムタグは名前の一致で拾う
 * （「デザイン」というカスタムタグを作った人を取りこぼさないため）。
 * @param {string} tagName
 * @returns {string[]}
 */
function _skillIdsForTag(tagName) {
  const hit = TAG_SKILL_HINTS[tagName];
  if (hit) return hit;
  const n = String(tagName || '').trim();
  if (!n) return [];
  return SKILL_TAGS.filter(s => n.includes(s.label) || s.label.includes(n)).map(s => s.id);
}

/** 表示用の理由文（得意があれば得意を優先して名乗る） */
function _reasonOf(good, want) {
  const label = (ids) => ids.slice(0, 2).map(id => _SKILL_LABEL[id] || id).join('・');
  if (good.length > 0) return `${label(good)}が得意`;
  return `${label(want)}をやってみたい`;
}

/**
 * おすすめの担当者を返す（スコアの高い順）。
 *
 * @param {object} project        state.events の1件（members に参加時回答が入っている）
 * @param {string[]} tagNames     state.draftMission.labels
 * @param {object} [opts]
 * @param {number} [opts.limit=3] 最大件数
 * @param {string[]} [opts.onlyUserIds] この userId 群に絞る（脱退者を出さないため）
 * @returns {Array<{userId, username, score, good: string[], want: string[], reason: string}>}
 *          ★出す根拠が無いときは必ず空配列を返す
 */
export function suggestAssignees(project, tagNames, opts = {}) {
  const limit = opts.limit ?? 3;

  const tags = (tagNames || []).filter(Boolean);
  if (tags.length === 0) return [];               // ラベル未選択＝判断材料が無い

  const wanted = new Set();
  for (const t of tags) for (const id of _skillIdsForTag(t)) wanted.add(id);
  if (wanted.size === 0) return [];               // どのスキルにも結びつかないラベル

  let members = project?.members || [];
  if (Array.isArray(opts.onlyUserIds)) {
    const allow = new Set(opts.onlyUserIds);
    members = members.filter(m => allow.has(m.userId));
  }

  // ★誰も答えていなければ何も出さない
  const answered = members.filter(m =>
    (m.skillsGood || []).length > 0 || (m.skillsWant || []).length > 0);
  if (answered.length === 0) return [];

  const scored = answered.map(m => {
    const good = (m.skillsGood || []).filter(s => wanted.has(s));
    // 得意と重複したものは「やってみたい」側から外す（同じ一致を二重に数えない）
    const want = (m.skillsWant || []).filter(s => wanted.has(s) && !good.includes(s));
    return {
      userId:   m.userId,
      username: m.username || '',
      score:    good.length * GOOD_POINT + want.length * WANT_POINT,
      good, want,
    };
  }).filter(x => x.score > 0);

  scored.sort((a, b) =>
    b.score - a.score ||
    b.good.length - a.good.length ||
    String(a.username).localeCompare(String(b.username), 'ja'));

  return scored.slice(0, limit).map(x => ({ ...x, reason: _reasonOf(x.good, x.want) }));
}
