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

const _WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 1日分の「開催日（＋時刻）」を人間可読な文字列にする。
 * 例: '2026-07-10' + {start:'10:00',end:'17:00'} → '7/10（金） 10:00〜17:00'
 *     時刻なし → '7/10（金）' / 開始のみ → '7/10（金） 10:00〜' / 終了のみ → '7/10（金） 〜17:00'
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {{start?:string,end?:string}} [time]
 * @returns {string}
 */
export function formatDateWithTime(dateStr, time) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = (!isNaN(y) && !isNaN(m) && !isNaN(d))
    ? _WEEKDAYS_JA[new Date(y, m - 1, d).getDay()] : '';
  const base = `${m}/${d}${wd ? `（${wd}）` : ''}`;
  const start = time?.start || '';
  const end   = time?.end   || '';
  if (!start && !end) return base;
  return `${base} ${start}〜${end}`;
}

/**
 * 開催日の配列＋時刻マップを、表示用の「行の配列」に整形する。
 * 各行 = formatDateWithTime()。呼び出し側で改行やカンマで結合する。
 * 時刻が1日も設定されていない場合は、従来どおり範囲表記（例 '7/10（金） 〜 7/12（日）'）1行に圧縮する。
 * @param {string[]} dates 'YYYY-MM-DD' の配列（未ソート可）
 * @param {{[date:string]:{start?:string,end?:string}}} [dateTimes]
 * @returns {string[]} 表示行（0件なら空配列）
 */
export function formatEventPeriodLines(dates, dateTimes) {
  const list = Array.isArray(dates) ? [...dates].filter(Boolean).sort() : [];
  if (list.length === 0) return [];
  const dt = dateTimes || {};
  const hasAnyTime = list.some(d => dt[d] && (dt[d].start || dt[d].end));

  // 時刻が一切なければ従来どおり範囲1行に圧縮
  if (!hasAnyTime) {
    if (list.length === 1) return [formatDateWithTime(list[0])];
    return [`${formatDateWithTime(list[0])} 〜 ${formatDateWithTime(list[list.length - 1])}`];
  }
  // 時刻ありは日ごとに1行（Googleカレンダー風）
  return list.map(d => formatDateWithTime(d, dt[d]));
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
