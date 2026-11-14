// ===== ユーティリティ関数 =====

import { LABEL_CONFIG, PILLAR_CATEGORIES } from './constants.js';

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
// ===== 目的を支える「柱」（2026-10-02）=====
// ★柱の読み方はここに集約する。各画面で p.pillars / m.pillarId を直接解釈しないこと。

/** イベントの柱（無ければ空配列）。名前の空いたものは除く */
export function getPillars(p) {
  return Array.isArray(p?.pillars) ? p.pillars.filter(x => x && x.id && x.name) : [];
}

/**
 * 柱の区分（'ops' 運営・進行 / 'make' 制作 / 'plan' 企画。2026-11-14）。決められなければ null。
 * ★保存された cat → 無ければ名前が候補（PILLAR_CATEGORIES の items）と同じならその区分。
 *   どちらでもない古い自由記述の柱は null（キャラは順番で決める。pillarChars.js の pillarCharacterFor）
 */
export function pillarCategoryOf(pillar) {
  if (!pillar) return null;
  if (PILLAR_CATEGORIES.some(c => c.id === pillar.cat)) return pillar.cat;
  const name = String(pillar.name || '').trim();
  return PILLAR_CATEGORIES.find(c => c.items.includes(name))?.id || null;
}

/**
 * タスクの柱の id の配列（複数可。2026-10-02）。未分類なら []。
 * ★pillarIds が配列ならそれ（空配列＝未分類として選び直した）。無ければ旧形式の pillarId を1件目として読む。
 * ★存在しない id（柱が消された）は除く（タスクの値は書き換えない）
 */
export function pillarIdsOf(p, m) {
  const raw = Array.isArray(m?.pillarIds) ? m.pillarIds : (m?.pillarId ? [m.pillarId] : []);
  if (!raw.length) return [];
  const exist = new Set(getPillars(p).map(x => x.id));
  return raw.filter(id => exist.has(id));
}

/** 新しい柱の id。★作るときに1回だけ振る。名前を変えても振り直さないこと（紐づきが切れる） */
export function newPillarId() {
  return 'pil_' + Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

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

// ===== 提出物の本文の書式（2026-09-28 太字・斜体／2026-11-07 見出し・箇条書き・非公開）=====
// ★保存は文字＋印だけ（編集欄の HTML は保存しない＝XSS を出さない）。書式も印で持つ（画像の {{image:N}} と同じ形）：
//   {{b}}太字{{/b}} ／ {{i}}斜体{{/i}} ／ {{h}}見出し{{/h}} ／ {{l}}箇条書きの1項目{{/l}} ／ {{p}}非公開テキスト{{/p}}
//   ★Markdown の ** / * / # / - にしないこと。重なると読み取りが曖昧になり、既存の本文の記号とも取り違える。
//   ★見出し・箇条書きも段落の仕組みは持たない（本文は white-space: pre-wrap。印をブロック表示にするだけ。指示書B §6-1）
//   ★非公開テキストはアプリの中（メンバー）には見せる（半透明）。外へ出すときはサーバーの lib/publicData.js が**中身ごと**消す
// ★印を読むのはここの4つだけ：_INLINE_MARK_RE / inlineRuns（分解）/ stripInlineMarks（外す）/ richTextHtml（表示用 HTML）。
//   書くのは clearEditor.js の readEditor だけ。
const _INLINE_MARK_RE = /\{\{(\/?)([bihlp])\}\}/g;
const _INLINE_KEYS = ['b', 'i', 'h', 'l', 'p'];
// 表示で付けるタグ。★<h3> / <li> は使わない（<li> は <ul> の外だと不正。段落の仕組みも持ち込まない）
const _INLINE_TAGS = {
  b: ['<strong>', '</strong>'],
  i: ['<em>', '</em>'],
  h: ['<span class="c-rich-text__h">', '</span>'],
  l: ['<span class="c-rich-text__l">', '</span>'],
  p: ['<span class="u-private-text">', '</span>'],
};

/** 書式の印を外した文字（抜粋・目的のボックスなど）。★中身は消さない（非公開テキストもアプリの中では見せる） */
export function stripInlineMarks(text) {
  return String(text ?? '').replace(_INLINE_MARK_RE, '');
}

/**
 * 本文を「同じ書式が続くかたまり」に分ける。[{ text, b, i, h, l, p }]
 * ★閉じていない印は最後まで効かせる。対応しない閉じの印は無視する（壊れた本文でも落ちない）。
 *   サーバーの lib/publicData.js の splitPrivate も同じ数え方（非公開の閉じ忘れは末尾まで非公開＝安全側）
 */
export function inlineRuns(text) {
  const src = String(text ?? '');
  const runs = [];
  const n = { b: 0, i: 0, h: 0, l: 0, p: 0 };
  let last = 0;
  const push = (t) => {
    if (t) runs.push({ text: t, b: n.b > 0, i: n.i > 0, h: n.h > 0, l: n.l > 0, p: n.p > 0 });
  };
  for (const m of src.matchAll(_INLINE_MARK_RE)) {
    push(src.slice(last, m.index));
    last = m.index + m[0].length;
    n[m[2]] = Math.max(0, n[m[2]] + (m[1] ? -1 : 1));
  }
  push(src.slice(last));
  return runs;
}

/**
 * 表示用 HTML。文字は必ずエスケープし（URL はリンクにする）、付けるタグは上の _INLINE_TAGS だけ。
 * ★見出し・箇条書きは display:block / list-item で行になる。本文は pre-wrap なので、その前後の改行を1つずつ飲む
 *   （飲まないと上下に二重の隙間が出る。余白は CSS の margin が持つ）
 * ★入れ子は正しく閉じ直す（例：太字の途中で見出しが閉じても、タグが交差しない）
 */
export function richTextHtml(text) {
  const src = String(text ?? '')
    .replace(/\n(\{\{[hl]\}\})/g, '$1')
    .replace(/(\{\{\/[hl]\}\})\n/g, '$1');
  const count = { b: 0, i: 0, h: 0, l: 0, p: 0 };
  const stack = [];   // いま開いているタグ（開いた順）
  let html = '', last = 0;
  const text_ = (t) => { if (t) html += linkifyText(t); };
  for (const m of src.matchAll(_INLINE_MARK_RE)) {
    text_(src.slice(last, m.index));
    last = m.index + m[0].length;
    const k = m[2];
    if (!m[1]) {
      if (count[k]++ === 0) { stack.push(k); html += _INLINE_TAGS[k][0]; }
      continue;
    }
    if (count[k] === 0) continue;            // 対応しない閉じの印は無視
    if (--count[k] > 0) continue;            // 同じ印が重ねて開いている
    // ★中身の無いタグは出さない（非公開の線だけが残るなど）。いちばん内側で、開いた直後なら取り消す
    if (stack.at(-1) === k && html.endsWith(_INLINE_TAGS[k][0])) {
      html = html.slice(0, -_INLINE_TAGS[k][0].length);
      stack.pop();
      continue;
    }
    // k より後に開いたタグを一度閉じ、k を閉じてから開き直す（タグを交差させない）
    const at = stack.lastIndexOf(k);
    const above = stack.splice(at);
    for (let j = above.length - 1; j >= 0; j--) html += _INLINE_TAGS[above[j]][1];
    for (const x of above.slice(1)) { stack.push(x); html += _INLINE_TAGS[x][0]; }
  }
  text_(src.slice(last));
  for (let j = stack.length - 1; j >= 0; j--) html += _INLINE_TAGS[stack[j]][1];
  return html;
}

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
  return stripInlineMarks(String(cd.content || '').replace(_EMBED_MARK_RE, '')).replace(/\n{3,}/g, '\n\n').trim();
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
  // ★書式の印は画像・PDF をまたいで続くことがある（とくに非公開 {{p}} は画像ごと囲む）。
  //   文章のかたまりごとに描くので、かたまりの頭に「その時点で開いている印」を足して続きを正しく読ませる。
  //   画像・PDF は、非公開の中にあれば private: true（アプリでは半透明。外へは出さない＝ publicData.js）
  const open = { b: 0, i: 0, h: 0, l: 0, p: 0 };
  const pushText = (t) => {
    // 画像・ファイルの前後の改行は、それ自体が区切りになるので落とす（★印をはさんでいても落とす）
    const s = t.replace(/^((?:\{\{\/?[bihlp]\}\})*)\n+/, '$1').replace(/\n+((?:\{\{\/?[bihlp]\}\})*)$/, '$1');
    const prefix = _INLINE_KEYS.filter(k => open[k] > 0).map(k => `{{${k}}}`).join('');
    if (stripInlineMarks(s).trim()) out.push({ type: 'text', text: prefix + s });
    for (const m of t.matchAll(_INLINE_MARK_RE)) open[m[2]] = Math.max(0, open[m[2]] + (m[1] ? -1 : 1));
  };
  let last = 0;
  for (const mm of raw.matchAll(_EMBED_MARK_RE)) {
    pushText(raw.slice(last, mm.index));
    last = mm.index + mm[0].length;
    const n = parseInt(mm[2], 10);
    const priv = open.p > 0;
    if (mm[1] === 'image') {
      const url = imgs[n - 1];
      if (url && !usedI.has(n)) { out.push({ type: 'image', url, private: priv }); usedI.add(n); }
    } else {
      const file = files[n - 1];
      if (file && !usedF.has(n)) { out.push({ type: 'file', file, private: priv }); usedF.add(n); }
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
 * 概要。実体は **初期タスク def-3（どんなイベントか、概要を書いてみよう）の提出内容**（2026-10-02 にふたたびつないだ）。
 * サーバーが def-3 の本文（印を外したもの）を description に写すので、読むのは description。
 * ★description が空で def-3 だけ書かれているイベント（つなぐ前のデータ。本番1件）は def-3 の本文を読む。
 * ★書くときは initialTasks.js の saveSummaryText を通す（def-3 を完了・書き換え）。description を直接書かないこと。
 */
export function getArchiveSummary(project) {
  const desc = String(project?.description ?? '');
  if (desc.trim()) return desc;
  return submissionText(project?.clearedData?.['def-3']);
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
 * 宣伝用に公開できる基礎情報（ヘッダー画像・タイトル・概要・期間・場所）の入力状況。
 * ★アーカイブの帯と「宣伝用に公開するか」の確認（publicBasicInfoModal.js）で共用する。
 * ★全部そろっていなくても公開できる（2026-10-02）。公開の確認を出す条件は「概要がある」こと（canPromptPublicBasic）。
 *   空の項目は空のまま公開される（lib/publicData.js の buildPublicEvent）
 * @returns {{ key: string, label: string, ok: boolean }[]}
 */
export function basicInfoStatus(project) {
  return [
    { key: 'image',   label: 'ヘッダー画像（サムネイル）', ok: !!getEventMainVisual(project) },
    { key: 'title',   label: 'タイトル', ok: !!String(project?.name || '').trim() },
    { key: 'summary', label: '概要',     ok: !!getArchiveSummary(project).trim() },
    { key: 'period',  label: '期間',     ok: Array.isArray(project?.dates) && project.dates.length > 0 },
    { key: 'venue',   label: '場所',     ok: !!getArchiveVenue(project).trim() },
  ];
}

/** 宣伝用に公開できるか（＝概要が書かれているか）。★タイトル（イベント名）は常にある */
export function canPromptPublicBasic(project) {
  return !!getArchiveSummary(project).trim();
}

/**
 * 公開してよい記録の数（shareable が付いている。2026-11-14 から振り返りが空でもよい）。
 * ★サーバーの lib/publicData.js の isPublishableSubmission と同じ条件に保つこと
 */
export function countPublishableReflections(project) {
  return Object.values(project?.clearedData || {})
    .filter(s => s && s.shareable === true).length;
}

/**
 * そのタスクの提出物（通常は1つ、個別完了は人数ぶん <mid>_u_<userId>）。
 */
export function taskSubmissions(project, missionId) {
  const prefix = `${missionId}_u_`;
  return Object.entries(project?.clearedData || {})
    .filter(([k, cd]) => cd && (k === missionId || k.startsWith(prefix)))
    .map(([, cd]) => cd);
}

/**
 * タスク単位の公開の状態（アーカイブのタスクの左のチェック・メニュー。2026-11-07。指示書B §4-5）。
 *   keys     … そのタスクの提出物のキー（通常は missionId、個別完了は <mid>_u_<userId>）
 *   eligible … そのうち、振り返りの本文があるもの（サーバーは本文の無い振り返りの shareable を true にしない）
 *   shared   … eligible が1つ以上あり、**すべて** shareable が true
 * ★人によってバラバラ（混在）なら shared は false＝非公開の側に倒す（本人がオフにした記録を公開候補に入れない）
 */
export function taskShareState(project, missionId) {
  const prefix = `${missionId}_u_`;
  const keys = Object.keys(project?.clearedData || {})
    .filter(k => project.clearedData[k] && (k === missionId || k.startsWith(prefix)));
  // ★2026-11-14：振り返りが無くても公開の候補にできる（提出物があれば対象）
  const eligible = keys;
  const shared = eligible.length > 0 && eligible.every(k => project.clearedData[k].shareable === true);
  return { keys, eligible, shared };
}

/**
 * アーカイブのリードの数字3つ（2026-11-07。指示書B §4-3）。★すべてタスク単位で数える。
 *   done     … 渡したタスク（＝完了したタスク。除外は呼び出し側で済ませておく）の数
 *   records  … そのうち、提出物のどれか1つでも「2つ目の欄（solution）」が書いてあるタスクの数（共有かどうかは問わない）
 *   struggles … そのうち、提出物のどれか1つでも outcome が struggle のタスクの数
 * ★個別完了は人数ぶん提出物があるので、提出物単位で数えると「記録」が「やったこと」を超える。必ずタスク単位で。
 * ★countPublishableReflections（公開できる件数＝公開の可否の判定と対）とは別物。混ぜないこと。
 * ★未記入の数は数えない（「あと N 件」は説教になる）。
 */
export function taskReflectionCounts(project, doneMissions) {
  let records = 0, struggles = 0;
  for (const m of doneMissions || []) {
    const subs = taskSubmissions(project, m.id);
    if (subs.some(cd => String(cd.solution || '').trim() !== '')) records++;
    if (subs.some(cd => cd.outcome === 'struggle')) struggles++;
  }
  return { done: (doneMissions || []).length, records, struggles };
}

/**
 * アーカイブの最終更新（ミリ秒。無ければ null）。基礎情報の更新（サーバーの crdtToFlat が出す basicUpdatedAt）と
 * 提出物の時刻の大きいほう。★lib/publicData.js の lastUpdatedOf と同じ式に保つこと
 */
export function archiveLastUpdated(project) {
  const ts = [Number(project?.basicUpdatedAt) || 0,
    ...Object.values(project?.clearedData || {}).map(cd => Number(cd?.timestamp) || 0)];
  const max = Math.max(0, ...ts);
  return max > 0 ? max : null;
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

/**
 * ラベル別の完了数（2026-11-05。広い画面のカレンダーの下の円グラフと一覧）。
 * ★タグは新形式 tags を優先し、無ければ旧 tag（両方が実在する）。
 * ★1つのタスクに複数のラベルがあれば、それぞれに1件ずつ数える（合計は完了数より多くなりうる）。
 *   ラベルの無い完了は「ラベルなし」にまとめる（円グラフが完了の全体を表すように）。
 * ★色はビルトイン（LABEL_CONFIG）→ カスタムタグ → 灰色（ガントのバーと同じ順）。
 * @returns {{ cleared: number, rows: {name:string, count:number, color:string}[] }}  rows は多い順・同数は名前順
 */
export const UNLABELED_NAME = 'ラベルなし';
const _UNLABELED_COLOR = '#D3D6D8';
export function labelClearedStats(p) {
  const counts = new Map();
  let cleared = 0;
  for (const m of (p?.missions || [])) {
    if (m.status !== 'cleared') continue;
    cleared++;
    const tags = (Array.isArray(m.tags) && m.tags.length > 0) ? m.tags : (m.tag ? [m.tag] : []);
    const names = tags.length ? [...new Set(tags)] : [UNLABELED_NAME];
    for (const t of names) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const colorOf = (name) => {
    if (name === UNLABELED_NAME) return _UNLABELED_COLOR;
    if (LABEL_CONFIG[name]) return LABEL_CONFIG[name].color;
    return (p?.customTags || []).find(t => t.name === name)?.color || _UNLABELED_COLOR;
  };
  const rows = [...counts.entries()]
    .map(([name, count]) => ({ name, count, color: colorOf(name) }))
    // ★「ラベルなし」は最後。ほかは多い順、同数なら名前順（描き直しで並びが入れ替わらない）
    .sort((a, b) => (a.name === UNLABELED_NAME) - (b.name === UNLABELED_NAME)
      || b.count - a.count || a.name.localeCompare(b.name, 'ja'));
  return { cleared, rows };
}

/**
 * 振り返りの1つ目の欄（struggle）を出すか（2026-11-05）。
 * ★うまくいった（success）は欄を1つ（solution）にしたので出さない。ただし以前に書かれた文字があれば出す
 *   （消すと書いた内容が見えなくなる・直せなくなる）。つまずいた・未選択は2つとも出す。
 */
export function reflectShowsStruggle(outcome, struggleText) {
  return outcome !== 'success' || String(struggleText || '').trim() !== '';
}

/** タスクも含めた公開（publicKnowledge）が公開中か。★サーバー（buildPublicEvent）と同じく開催日を過ぎていることも見る */
export function isKnowledgePublished(p) {
  return p?.publicKnowledge === true && isAfterEventDates(p);
}

// ===== 初期クエスト（目的 → 柱 → 企画）。2026-11-05 =====
// ★目的（def-1）と企画（def-3）は**どのイベントでも必ず書いてもらう**。柱は任意（「あとで」でとばせる）。
// ★読むのはここだけ（mainBoard.js のカード・goalQuest.js のコーチマーク・missionDetail.js の戻るの封鎖・state.js）。
export const GOAL_PURPOSE_ID = 'def-1';
export const GOAL_SUMMARY_ID = 'def-3';

/** 3つの段階の済み／未（カードの点に使う）。柱は任意なので「いま」の判定には入れない */
export function goalQuestSteps(p) {
  const missions = p?.missions || [];
  const summary = missions.find(m => m.id === GOAL_SUMMARY_ID);
  return {
    purpose: !!submissionText(p?.clearedData?.[GOAL_PURPOSE_ID]),
    pillars: getPillars(p).length > 0,
    // ★企画のタスクが消されていれば済み扱い（促す先が無い）
    summary: !summary || summary.status === 'cleared',
  };
}

/**
 * いま書いてもらう初期タスク（'def-1' | 'def-3' | null）。★対象はイベントを作った人（オーナー）だけ。
 * ★開催日を過ぎた・完了にしたイベントでは求めない（いまさら目的を決めても使い道が無い）。
 */
export function goalQuestTask(p, userId) {
  if (!p || !userId || p.ownerId !== userId) return null;
  if (p.isCompleted || isAfterEventDates(p)) return null;
  const missions = p.missions || [];
  const purpose = missions.find(m => m.id === GOAL_PURPOSE_ID);
  const steps = goalQuestSteps(p);
  // ★順番は 概要（def-3）→ 目的（def-1）→（柱）（2026-11-09。具体から抽象へ。以前は目的が先）
  if (!steps.summary) return GOAL_SUMMARY_ID;
  if (!steps.purpose) {
    // ★目的のタスクが無い・入力欄の無い形で完了している、は促せない
    return purpose && purpose.status !== 'cleared' ? GOAL_PURPOSE_ID : null;
  }
  return null;
}

/** 初期タスク（目的 def-1・企画 def-3）か。★名前・設定の編集と削除・未完了に戻すをさせない（書いた内容は直せる）。2026-11-05 */
export function isInitialTask(m) {
  return !!m && (m.id === GOAL_PURPOSE_ID || m.id === GOAL_SUMMARY_ID || m.isDeletable === false);
}
