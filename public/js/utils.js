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

/**
 * 今日の日付を 'YYYY-MM-DD'（ローカル時刻）で返す。
 *
 * ★new Date().toISOString() を使わないこと。UTC に変換されるため、日本時間の
 *   0〜9時に「昨日」を返す（サーバー側の TZ=Asia/Tokyo と同じ落とし穴）。
 * ★日付は文字列のまま辞書順で比較できる（'2026-09-01' < '2026-09-02'）。
 *   Date に戻して比較しないこと。
 */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 開催日をすべて過ぎているか（＝もう終わったイベントか）。
 *
 * ★自動表示モーダルの「もう出さない」判定はここ1本に集約する。各ファイルで
 *   日付を比べ直さないこと（`onboarding.js` の `_detectPhase` もこれを使う）。
 * ★基準は**開催日の超過**であって `isCompleted` ではない。イベントを「完了」に
 *   するのは任意の操作で、済ませない人が多い。日付なら必ず進む。
 * ★日程未設定は false（＝終わっていない扱い）。いつ終わるか分からないものを
 *   勝手に終わったことにすると、案内が丸ごと止まる。
 * ★文字列のまま辞書順で比較する（todayStr と同じ理由。Date に戻さないこと）。
 */
export function isAfterEventDates(p) {
  const sorted = [...(p?.dates || [])].filter(Boolean).sort();
  if (sorted.length === 0) return false;
  return todayStr() > sorted[sorted.length - 1];
}

// ===== アーカイブの「概要」「開催場所」=====
// ★イベント設定（eventSettings.js）とアーカイブのペン（modals/helpers.js）の
//   両方から編集される。どちらから直しても同じ場所を読み書きするよう、
//   入出力をこの4関数に集約する。**個別に clearedData を触らないこと。**

/** 概要。実体は clearedData['def-3']（初期ミッション「イベントの概要を定めよう」）。
 *  ★ミッションが無くても成立する（clearedData に直接書くため）。イベント設定と
 *    アーカイブのペンからも同じ場所を読み書きする。個別に clearedData を触らないこと。 */
export function getArchiveSummary(project) {
  return project?.clearedData?.['def-3']?.content ?? project?.description ?? '';
}

/**
 * 概要を書き込む。
 * ★description にも同じ値を入れる。提案エンジンの detectCategory と AI プロンプトが
 *   description を読むため、こちらを空のままにすると提案の精度が落ちる。
 */
export function setArchiveSummary(project, value) {
  const v = String(value ?? '').trim();
  if (!project.clearedData) project.clearedData = {};
  project.clearedData['def-3'] = {
    content: v, timestamp: Date.now(), title: 'イベントの概要を定めよう', format: 'text',
  };
  project.description = v;
}

/**
 * 開催場所。実体は clearedData['archive-venue']。
 * ★旧データは提案 p1「開催場所を決める」由来の完了ミッションに入っているので、
 *   そちらもフォールバックで読む（本番に3件ある）。この参照は消さないこと。
 */
export function getArchiveVenue(project) {
  const direct = project?.clearedData?.['archive-venue']?.content;
  if (direct) return direct;
  const m = (project?.missions || []).find(x => x.originProposalId === 'p1' && x.status === 'cleared');
  return (m ? project?.clearedData?.[m.id]?.content : '') || '';
}

/** 開催場所を書き込む（常に archive-venue へ。旧ミッション側は読むだけ） */
export function setArchiveVenue(project, value) {
  const v = String(value ?? '').trim();
  if (!project.clearedData) project.clearedData = {};
  project.clearedData['archive-venue'] = {
    content: v, timestamp: Date.now(), title: '開催場所', format: 'text',
  };
}
