// ===== ユーティリティ関数 =====

/**
 * 日付文字列の配列を、連続した日付グループに分割する
 * 例: ['2025-01-01', '2025-01-02', '2025-01-04'] → [['2025-01-01','2025-01-02'], ['2025-01-04']]
 * @param {string[]} dateStrings
 * @returns {string[][]}
 */
export function getConsecutiveGroups(dateStrings) {
  if (!dateStrings || dateStrings.length === 0) return [];
  const sorted = [...dateStrings].sort();
  const groups = [];
  let currentGroup = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffInDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
    if (diffInDays === 1) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);
  return groups;
}

/**
 * 今日から対象日までの残り日数を計算する
 * @param {string} dateStr - 'YYYY-MM-DD' 形式
 * @returns {number}
 */
export function calculateDaysLeft(dateStr) {
  if (!dateStr) return 99;
  const target = new Date(dateStr);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
