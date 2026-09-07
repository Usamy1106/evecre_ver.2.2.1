// ===== 予定のコピー（締め切り別のテキスト書き出し）=====
// テストユーザーが「今月のタスク一覧をまとめてチャットに貼る」使い方をしていたので、
// アプリ側で同じ形を作れるようにしたもの。
//
// 出力の形（この形は利用者が既に手で作っていたもの。勝手に変えないこと）：
//
//   9/14〆切
//   キャラデザコンペ
//   ブランディングカラー
//
//   9/18〆切
//   イベントリスト絞り込み（装飾アイデア）
//
// ★対象は「未完了 かつ 締め切りがある」ミッション**全件**。
//   見えている範囲だけにすると、月をまたいだぶんが取れず用を成さない。
// ★締め切りは m.dates の**最終日**。dates は未ソートで保存されうるので、
//   必ずコピーしてから sort すること（落とし穴 12）。

import { state } from './state.js';
import { logEvent } from './logger.js';

/** 'YYYY-MM-DD' → 'M/D'。★年は出さない（チャットに貼る用途では冗長） */
function _md(ymd) {
  const [, m, d] = String(ymd).split('-');
  return `${Number(m)}/${Number(d)}`;
}

/**
 * 締め切り別にまとめたテキストを作る。対象が無ければ空文字。
 * @param {object} p イベント（flat 形式）
 */
export function buildScheduleText(p) {
  const byDate = new Map();
  for (const m of (p?.missions || [])) {
    if (m.status === 'cleared' || m.status === 'pending_leader_check') continue;
    const dates = Array.isArray(m.dates) ? [...m.dates].filter(Boolean).sort() : [];
    const due = dates.at(-1);
    if (!due) continue;                       // 締め切り未設定は出さない
    if (!byDate.has(due)) byDate.set(due, []);
    byDate.get(due).push(m.title || '(無題)');
  }
  if (byDate.size === 0) return '';

  return [...byDate.keys()].sort()
    .map(due => [`${_md(due)}〆切`, ...byDate.get(due)].join('\n'))
    .join('\n\n');
}

/** クリップボードへコピーする。★呼び出しはユーザー操作（click）から直接行うこと */
export function copySchedule(source) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const text = buildScheduleText(p);
  if (!text) {
    window._app?.showToast('締め切りが設定された未完了ミッションがありません', 'info');
    return;
  }
  logEvent('schedule_copied', { source, missions: text.split('\n').length });
  navigator.clipboard.writeText(text)
    .then(() => window._app?.showToast('予定をコピーしました'))
    .catch(() => window._app?.showToast('コピーに失敗しました', 'error'));
}
