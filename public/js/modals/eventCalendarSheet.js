// ===== イベントカレンダー・ガントチャート ボトムシート（スマホ）=====
// メインボードの「開催まで残り◯日」をタップすると開く。
// 上部のトグルで「カレンダー」「ガント」を切り替える。
//
// ★中身（カレンダー・ガント・開催日の編集）は schedulePanel.js。ここはシートの殻だけ。
// ★広い画面（layoutMode.js の isDashboard）ではシートを開かない。メインボードの右列に
//   同じ中身が出ているので、そちらを切り替える（同じ id が2つ並ばないように）。

import { state } from '../state.js';
import { bindMissionInteractions } from './mission.js';
import { isDashboard } from '../layoutMode.js';
import {
  newScheduleCtx, scheduleCssVars, scheduleBodyHtml, bindScheduleBody, scrollScheduleToToday,
} from '../schedulePanel.js';

const OVERLAY_ID = 'event-cal-sheet';

/**
 * ボトムシートを開く
 */
export function openEventCalendarSheet(initialView = 'calendar') {
  if (isDashboard()) {
    // 広い画面：右列をカレンダー／ガントに切り替えるだけ（views/mainBoard.js）
    window._app?.setBoardPanelView?.(initialView === 'gantt' ? 'gantt' : 'calendar');
    return;
  }
  if (document.getElementById(OVERLAY_ID)) return;
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) return;

  const ctx = newScheduleCtx(p, initialView);

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // スタイル: public/css/object/component/_overlay.css（--schedule に z-index と
  // せり上がりのアニメーションをまとめてある）
  overlay.className = 'c-overlay c-overlay--schedule c-overlay--blur';
  overlay.onclick = (e) => { if (e.target === overlay) _close(overlay); };
  document.body.appendChild(overlay);

  _render(overlay, ctx);

  // カレンダービューの初期スクロール（ガントは _bindAllEvents が送る）
  if (ctx.view === 'calendar') requestAnimationFrame(() => scrollScheduleToToday(overlay, ctx));
}

function _close(overlay) {
  if (overlay && overlay.parentNode) {
    overlay.remove();
    state.render(); // 開催日変更後にメインボードの「残り○日」を即時反映
  }
}

// =====================================================
// メインレンダリング
// =====================================================
function _render(overlay, ctx) {
  const isCalendar = ctx.view === 'calendar';
  // タスク詳細ページへの遷移時に「どのビューから開いたか」を参照できるようにする
  overlay.dataset.calView = ctx.view;

  // ★ガントの寸法は JS の定数が正（schedulePanel.js）。CSS には custom property で渡す
  const ganttVars = scheduleCssVars();

  overlay.innerHTML = `
    <div data-sheet class="c-sheet c-sheet--rise c-sheet--page p-schedule${isCalendar ? '' : ' p-schedule--full'}" style="${ganttVars}">

      <!-- ドラッグハンドル -->
      <div data-sheet-handle class="c-sheet__handle c-sheet__handle--mid">
        <div class="c-sheet__grip"></div>
      </div>

      <!-- ビュー切り替えトグル -->
      <div class="p-schedule__bar">
        <h2 class="p-schedule__title">スケジュール</h2>
        <!-- ★予定をテキストで書き出す。チャットに貼る使い方が多いため。
             カレンダー／ガントのどちらでも同じものが取れる（見えている範囲ではなく
             未完了・締め切りあり全件）。 -->
        <button type="button" onclick="window._app.copySchedule('schedule')"
          data-log="schedule_copy" class="p-schedule__copy" aria-label="予定をコピー">
          <img src="/images/icon/icon-Link.svg" alt="" class="p-schedule__copy-icon">
          予定をコピー
        </button>
        <div class="p-schedule__switch">
          <button id="btn-view-calendar"
            class="p-schedule__switch-button${isCalendar ? ' is-active' : ''}">
            カレンダー
          </button>
          <button id="btn-view-gantt"
            class="p-schedule__switch-button${!isCalendar ? ' is-active' : ''}">
            ガント
          </button>
        </div>
      </div>

      <!-- コンテンツ -->
      <div class="p-schedule__body">
        ${scheduleBodyHtml(ctx)}
      </div>
    </div>`;

  // 下スワイプで閉じる（sheet.js）→ _close 経由で state.render() を確実に呼ぶ
  const _sheetEl = overlay.querySelector('[data-sheet]');
  if (_sheetEl) _sheetEl.__sheetClose = () => _close(overlay);

  _bindAllEvents(overlay, ctx);

  // タスク行：タップ＝完了モーダル（完了可の場合）、管理者長押し＝編集/削除メニュー
  bindMissionInteractions(overlay, ctx.p, { useInlineTap: false });
}

// =====================================================
// イベントバインド（一括）
// =====================================================
function _bindAllEvents(overlay, ctx) {
  // ビュー切り替えボタン
  overlay.querySelector('#btn-view-calendar')?.addEventListener('click', () => {
    if (ctx.view === 'calendar') return;
    ctx.view = 'calendar';
    _render(overlay, ctx);
    requestAnimationFrame(() => scrollScheduleToToday(overlay, ctx));
  });
  overlay.querySelector('#btn-view-gantt')?.addEventListener('click', () => {
    if (ctx.view === 'gantt') return;
    ctx.view = 'gantt';
    _render(overlay, ctx);
  });

  bindScheduleBody(overlay, ctx);
  if (ctx.view === 'gantt') requestAnimationFrame(() => scrollScheduleToToday(overlay, ctx));
}
