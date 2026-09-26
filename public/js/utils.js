// ===== ユーティリティ関数 =====

import { LABEL_CONFIG } from './constants.js';

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

// ===== タグ別プレースホルダー =====
/**
 * タスクのタグに合わせて例文を選ぶ。
 * ★ビルトインタグ（LABEL_CONFIG のキー）がちょうど1つのときだけ、そのタグの例文を出す。
 *   0個（カスタムタグのみ・タグ未設定）と2個以上は DEFAULT。どちらに寄せても
 *   片方に対して嘘の例文になるので、粒度だけを伝える汎用文に倒す（落とし穴 0-10）。
 * ★完了の入力欄（missionDetail）と振り返りページ（missionReflect）で共用する。
 *   片方に書き写さないこと。
 * @param {object} table DEFAULT を必ず持つ例文テーブル（constants.js）
 * @param {object} mission
 */
/**
 * 提出物（clearedData の1件）の画像 URL を返す。
 * ★後方互換はここ1か所だけで吸収する。描画箇所ごとに format を見直さないこと。
 *   - images（新）があればそれを使う
 *   - 無ければ、旧形式（format:'image' の content）を1枚目として扱う
 * @returns {string[]}
 */
export function submissionImages(cd) {
  if (!cd) return [];
  if (Array.isArray(cd.images) && cd.images.length > 0) return cd.images.filter(Boolean);
  return cd.format === 'image' && cd.content ? [cd.content] : [];
}

// 本文の中の画像の位置（1始まり。images の N 番目）。★clearEditor.js の MARK と同じ形に保つこと
export const IMAGE_MARK_RE = /\{\{image:(\d+)\}\}/g;
// 本文の中の添付ファイル（PDF）の位置（1始まり。files の N 番目）
export const FILE_MARK_RE  = /\{\{file:(\d+)\}\}/g;
// 画像とファイルの印をまとめて拾う（並び順どおりに分けるため）
const _EMBED_MARK_RE = /\{\{(image|file):(\d+)\}\}/g;

/** 提出物の添付ファイル（PDF）。[{ url, name, size, thumb }] */
export function submissionFiles(cd) {
  return Array.isArray(cd?.files) ? cd.files.filter(f => f && f.url) : [];
}

/**
 * 提出物の本文（テキスト／リンク）を返す。**画像・ファイルの印は取り除く**（一覧のプレビュー用）。
 * format:'image' の content は画像なので本文に数えない。
 * @returns {string}
 */
export function submissionText(cd) {
  if (!cd || cd.format === 'image') return '';
  return String(cd.content || '').replace(_EMBED_MARK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 一覧のプレビュー用に、添付ファイルを1行で言う（例「📄 企画書.pdf ほか1件」）。無ければ '' */
export function submissionFilesLabel(cd) {
  const files = submissionFiles(cd);
  if (files.length === 0) return '';
  return `📄 ${files[0].name}${files.length > 1 ? ` ほか${files.length - 1}件` : ''}`;
}

/** バイト数を「2.3MB」のように */
export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

/**
 * 提出物を「文章」「画像」「ファイル」の並びに分ける（本文の途中の画像・PDF を、その位置に出すため）。
 * ★印の番号が images / files に無いものは捨てる。印で使われなかったものは末尾に足す
 *   （旧形式・印の無い提出物もこれで全部出る）。
 * @returns {Array<{type:'text', text:string} | {type:'image', url:string} | {type:'file', file:object}>}
 */
export function submissionSegments(cd) {
  if (!cd) return [];
  const imgs  = submissionImages(cd);
  const files = submissionFiles(cd);
  const raw   = cd.format === 'image' ? '' : String(cd.content || '');
  const out   = [];
  const usedI = new Set(), usedF = new Set();
  const pushText = (t) => {
    // 画像・ファイルの前後の改行は、それ自体が区切りになるので落とす
    const s = t.replace(/^\n+|\n+$/g, '');
    if (s.trim()) out.push({ type: 'text', text: s });
  };
  let last = 0;
  for (const mm of raw.matchAll(_EMBED_MARK_RE)) {
    pushText(raw.slice(last, mm.index));
    last = mm.index + mm[0].length;
    const n = parseInt(mm[2], 10);
    if (mm[1] === 'image') {
      const url = imgs[n - 1];
      if (url && !usedI.has(n)) { out.push({ type: 'image', url }); usedI.add(n); }
    } else {
      const file = files[n - 1];
      if (file && !usedF.has(n)) { out.push({ type: 'file', file }); usedF.add(n); }
    }
  }
  pushText(raw.slice(last));
  imgs.forEach((url, i)  => { if (!usedI.has(i + 1)) out.push({ type: 'image', url }); });
  files.forEach((file, i) => { if (!usedF.has(i + 1)) out.push({ type: 'file', file }); });
  return out;
}

export function placeholderFor(table, mission) {
  const tags = new Set([
    ...(Array.isArray(mission?.tags) ? mission.tags : []),
    ...(mission?.tag ? [mission.tag] : []),
  ].filter(Boolean));
  const builtin = [...tags].filter(t => Object.prototype.hasOwnProperty.call(LABEL_CONFIG, t));
  return builtin.length === 1 ? (table[builtin[0]] || table.DEFAULT) : table.DEFAULT;
}

// ===== 設定画面：項目をタップして編集 =====
// 行に data-tap-edit="<名前>"、その項目の「変更」ボタンに data-tap-edit-btn="<名前>" を付けると、
// 行のどこをタップしても「変更」を押したのと同じになる（アカウント設定・プロフィール設定）。
// ★編集の処理は「変更」ボタンのハンドラ1つだけ。行側に同じ処理を書き写さないこと。
//   ボタンの click() を呼ぶので、data-log の計測もそのまま効く。
// ★行の中のボタン・入力欄・リンクのタップは素通しする（二重に反応させない）。
// ★編集中は行に data-tap-edit を付けないこと（付けたままだと入力欄の周りのタップで開き直す）。
//   ボタンが見つからなければ何もしない。
// ★行は <div> のまま。キーボード操作は中の「変更」ボタンが担うので role="button" にしない
//   （ボタンを含む要素を role="button" にすると操作可能な要素が入れ子になる）。
export function bindTapToEdit(root = document) {
  root.querySelectorAll('[data-tap-edit]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, textarea, select, label')) return;
      root.querySelector(`[data-tap-edit-btn="${CSS.escape(row.dataset.tapEdit)}"]`)?.click();
    });
  });
}

// ===== アーカイブの「概要」「開催場所」=====
// ★イベント設定（eventSettings.js）とアーカイブのペン（modals/helpers.js）の
//   両方から編集される。どちらから直しても同じ場所を読み書きするよう、
//   入出力をこの4関数に集約する。**個別に clearedData を触らないこと。**

/**
 * 概要。実体は **イベントの description だけ**（2026-09-26）。
 * ★初期タスク def-3（どのようなイベントを行うか整理しよう）の提出物とは切り離した。
 *   以前は clearedData['def-3'] を優先して読み、書くときも両方に書いていたため、
 *   アーカイブで概要を直すとタスクの提出内容まで書き換わっていた。
 *   ★def-3 を読みに行かないこと（AI の提案は server.js が def-3 を別の行で読む）。
 * イベント設定とアーカイブのペンの両方から、この2関数を通して読み書きする。
 */
export function getArchiveSummary(project) {
  return String(project?.description ?? '');
}

/** 概要を書き込む（description だけ） */
export function setArchiveSummary(project, value) {
  project.description = String(value ?? '').trim();
}

/**
 * 開催場所。実体は **イベントの venue**（2026-09-26。CRDT の項目）。
 * ★venue が一度も書かれていない（undefined）イベントだけ、旧データを読む：
 *   clearedData['archive-venue'] → 提案 p1「開催場所を決める」由来の完了タスク（本番に3件）。
 *   ★空文字は「消した」なので旧データに戻らない（`!== undefined` で見ること。`||` にしない）。
 *   移行はしない。この読み替えは消さないこと。
 */
export function getArchiveVenue(project) {
  if (typeof project?.venue === 'string') return project.venue;
  const direct = project?.clearedData?.['archive-venue']?.content;
  if (direct) return direct;
  const m = (project?.missions || []).find(x => x.originProposalId === 'p1' && x.status === 'cleared');
  return (m ? submissionText(project?.clearedData?.[m.id]) : '') || '';
}

/** 開催場所を書き込む（venue だけ。旧データ側は読むだけ） */
export function setArchiveVenue(project, value) {
  project.venue = String(value ?? '').trim();
}

/**
 * ヘッダー画像（アーカイブの一番上・ホームのサムネイル）の URL。無ければ null。
 * 実体は **イベントの headerImage**（2026-09-26。R2 の URL）。
 * ★headerImage が一度も書かれていないイベントだけ、旧データを読む：
 *   clearedData['archive-image'] → 提案 p3 由来の完了タスクの画像（本番に実在。消さないこと）。
 *   空文字は「消した」なので旧データに戻らない。
 */
export function getEventMainVisual(project) {
  if (typeof project?.headerImage === 'string') return project.headerImage || null;
  const direct = project?.clearedData?.['archive-image']?.content;
  if (direct) return direct;
  const m = (project?.missions || []).find(x => x.originProposalId === 'p3' && x.status === 'cleared');
  // ★本文と画像を同時に持つ提出物もあるので、画像は submissionImages で取る（1枚目）
  return m ? (submissionImages(project?.clearedData?.[m.id])[0] ?? null) : null;
}

/**
 * アーカイブの基礎情報（タイトル・ヘッダー画像・概要・場所・期間）がすべて入っているか。
 * ★「宣伝用に公開するか」の確認（publicBasicInfoModal.js）を出す条件
 */
export function hasAllBasicInfo(project) {
  return !!(String(project?.name || '').trim()
    && getEventMainVisual(project)
    && getArchiveSummary(project).trim()
    && getArchiveVenue(project).trim()
    && Array.isArray(project?.dates) && project.dates.length > 0);
}

/**
 * 公開してよい振り返りの数（shareable かつ「次にやるなら／なぜうまくいった？」が空でない）。
 * ★サーバーの lib/publicData.js の isPublishableSubmission と同じ条件に保つこと
 */
export function countPublishableReflections(project) {
  return Object.values(project?.clearedData || {})
    .filter(s => s && s.shareable === true && String(s.solution || '').trim() !== '').length;
}

/**
 * 文章の中の URL をタップで開けるリンクにした HTML を返す（アーカイブ用）。
 * ★エスケープはここでまとめて行う（戻り値をもう一度 esc に通さないこと）。
 * ★リンクのタップは stopPropagation（アーカイブの記録はタップでタスク詳細を開くため）。
 * ★http / https だけ（javascript: などは作らない）。末尾の句読点・閉じ括弧はリンクに含めない。
 */
export function linkifyText(text) {
  const esc = (x) => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const src = String(text ?? '');
  let out = '', last = 0;
  for (const m of src.matchAll(/https?:\/\/[^\s<>"'「」『』（）]+/g)) {
    let url = m[0];
    const trail = /[、。，．,.!！?？:：;；)\]}]+$/.exec(url);
    if (trail) url = url.slice(0, -trail[0].length);
    out += esc(src.slice(last, m.index));
    out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="c-text-link" onclick="event.stopPropagation()">${esc(url)}</a>`;
    last = m.index + url.length;
  }
  return out + esc(src.slice(last));
}
