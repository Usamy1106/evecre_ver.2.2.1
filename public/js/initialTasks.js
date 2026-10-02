// ===== 初期タスク（目的 def-1・概要 def-3）を書く =====
//
// イベント作成時に入る2つの初期タスクは、アーカイブ・イベント設定・タスクの画面のどこから書いても
// 同じものが変わる（2026-10-02）。書いた時点でタスクは完了になる。
//
//   目的 def-1 … 文字だけ（画像・PDF・太字・斜体を持たない。完了の入力欄も data-text-only）
//   概要 def-3 … 「どのようなイベントを行うかまとめよう」。提出内容が概要の実体。
//                サーバーが description に同じ文章を写す（AI の提案・公開データが description を読むため）。
//                ★画像・PDF・書式を含むときは、設定とアーカイブでは編集させずタスクの画面へ送る（isRichSubmission）
//
// ★書く経路はここに集約する。各画面で completeMission / updateSubmission を直接呼ばないこと。
// ★まだ完了していなければ /complete（完了扱い）、完了済みなら PATCH …/submission（本文の書き換え・管理者だけ）。

import { state } from './state.js';
import { api } from './api.js';
import { getPillars } from './utils.js';

export const PURPOSE_ID = 'def-1';
export const SUMMARY_ID = 'def-3';

/** 画像・PDF・書式（太字・斜体）を含む提出物か。含むものは設定・アーカイブの1行の欄では直さない */
export function isRichSubmission(cd) {
  if (!cd) return false;
  if (cd.format === 'image') return true;
  if (Array.isArray(cd.images) && cd.images.length > 0) return true;
  if (Array.isArray(cd.files) && cd.files.length > 0) return true;
  return /\{\{(?:image|file):\d+\}\}|\{\{\/?[bi]\}\}/.test(String(cd.content || ''));
}

async function _writeText(p, missionId, text) {
  const m = (p.missions || []).find(x => x.id === missionId);
  if (!m) return { ok: false, missing: true };
  const cd = p.clearedData?.[missionId];
  const done = m.status === 'cleared' && !!cd;
  if (done && isRichSubmission(cd)) return { ok: false, rich: true };
  // まだ書かれていないものを空で完了させない
  if (!done && !text) return { ok: true, skipped: true };
  const r = done
    ? await api.updateSubmission(p.id, missionId, { content: text, format: 'text', images: [], files: [] })
    : await api.completeMission(p.id, missionId, { content: text, format: 'text' });
  if (!r?.ok) return { ok: false, error: r?.error || '保存できませんでした' };
  // ★手元のデータも直す（取り直さない画面＝アーカイブの編集中でも、次の描画で正しく見えるように）
  if (!p.clearedData) p.clearedData = {};
  p.clearedData[missionId] = r.submission || { ...(cd || {}), content: text, format: 'text', images: [], files: [] };
  if (r.mission?.status) m.status = r.mission.status;
  else if (!done) m.status = 'cleared';
  return { ok: true, completed: !done };
}

/**
 * 目的を書く（文字だけ）。
 * @param {object} [opts]  reload: false … 書いたあとに取り直さない（アーカイブの編集中。
 *   ★取り直すと描き直しが起き、次に書き始めた欄からフォーカスが外れて文字が消える。実際にそうなった）
 */
export async function savePurposeText(p, text, { reload = true } = {}) {
  const r = await _writeText(p, PURPOSE_ID, String(text ?? '').trim());
  if (r.ok && !r.skipped && reload) await state.silentReloadEvents();
  return r;
}

/**
 * 概要を書く。def-3 があればその提出内容として書き（サーバーが description に写す）、
 * def-3 が消されているイベントでは description だけを書く（以前の動き）。
 */
export async function saveSummaryText(p, text, { reload = true } = {}) {
  const t = String(text ?? '').trim();
  const hasTask = (p.missions || []).some(x => x.id === SUMMARY_ID);
  if (!hasTask) {
    p.description = t;
    await state.saveNow(p.id);
    return { ok: true };
  }
  const r = await _writeText(p, SUMMARY_ID, t);
  if (r.ok && r.skipped) {
    // まだ完了していない def-3 を空にする＝概要を消す（description だけ）
    p.description = '';
    await state.saveNow(p.id);
    return r;
  }
  if (r.ok) {
    p.description = t;   // ★取り直すまでの間も新しい概要を見せる（サーバーも同じ値を写している）
    if (reload) await state.silentReloadEvents();
  }
  return r;
}

/**
 * 目的を書いたあと、柱を決めるページへ進めるか。★管理者で、柱がまだ無いときだけ。
 * 柱は決めずに「あとで」で抜けられる（必須にしない）
 */
export function shouldAskPillarsAfterPurpose(p) {
  return !!p && state.canManageCurrentEvent() && getPillars(p).length === 0;
}
