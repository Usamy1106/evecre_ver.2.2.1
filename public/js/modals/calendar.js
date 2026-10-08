// ===== カレンダーモーダル =====
import { state } from '../state.js';
import { ganttPickerHtml, bindGanttRangePicker, initGanttPicker, scheduleCssVars } from '../schedulePanel.js';
import { LABEL_CONFIG } from '../constants.js';

const _WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * projectEdit 用：選択中の日付ごとに開始/終了の時刻入力を並べたリストを返す（Googleカレンダー風）。
 * 時刻は project.dateTimes[dateStr] = { start, end } に保持する（任意入力）。
 * @param {object} project
 * @returns {string}
 */
function _renderDateTimeList(project) {
  const dates = [...(project?.dates || [])].filter(Boolean).sort();
  if (dates.length === 0) return '';
  const dt = project.dateTimes || {};
  const rows = dates.map(dateStr => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const wd = _WEEKDAYS_JA[new Date(y, m - 1, d).getDay()] || '';
    const t = dt[dateStr] || {};
    return `
      <div class="p-date-picker__time-row">
        <span class="p-date-picker__time-day">${m}/${d}（${wd}）</span>
        <input type="time" data-dt-date="${dateStr}" data-dt-kind="start" value="${t.start || ''}"
          class="p-date-picker__time-input">
        <span class="p-date-picker__time-sep">〜</span>
        <input type="time" data-dt-date="${dateStr}" data-dt-kind="end" value="${t.end || ''}"
          class="p-date-picker__time-input">
      </div>`;
  }).join('');
  return `
    <div class="p-date-picker__times">
      <p class="p-date-picker__times-label">時間（任意・日ごとに設定できます）</p>
      <div class="p-date-picker__times-scroll">${rows}</div>
    </div>`;
}

/**
 * 時刻入力の onchange を紐付ける（projectEdit のみ）。
 * @param {object} project
 */
function _bindDateTimeInputs(project) {
  const modal = document.getElementById('calendar-modal');
  if (!modal || !project) return;
  const inputs = [...modal.querySelectorAll('input[data-dt-date]')];

  /** dateTimes への1件反映（空になったらキーごと消す） */
  const apply = (dateStr, kind, value) => {
    if (!project.dateTimes) project.dateTimes = {};
    const cur = project.dateTimes[dateStr] || { start: '', end: '' };
    cur[kind] = value || '';
    if (!cur.start && !cur.end) delete project.dateTimes[dateStr];
    else project.dateTimes[dateStr] = cur;
  };

  inputs.forEach(input => {
    input.addEventListener('change', () => {
      const dateStr = input.dataset.dtDate;
      const kind    = input.dataset.dtKind; // 'start' | 'end'
      const value   = input.value || '';
      apply(dateStr, kind, value);

      // ★同じ種類（開始／終了）の**空欄だけ**を同じ時刻で埋める。
      //   複数日イベントは同じ時間帯であることが多く、毎日入力させると手間なため。
      //   ★すでに入力済みの欄は上書きしない（日ごとに違う時間を入れた人の指定を壊さない）。
      if (!value) return;
      inputs
        .filter(o => o !== input && o.dataset.dtKind === kind && !o.value)
        .forEach(o => {
          o.value = value;
          apply(o.dataset.dtDate, kind, value);
        });
    });
  });
}

// サポートする target:
// - 'project'       : イベント作成中のドラフトの開催日を編集（state.draftEvent.dates）
// - 'projectEdit'   : 確定済みイベントの開催日（実施日）を編集（project.dates）
// - 'mission'       : タスク期限（単日のみ）
// - 'claimDeadline' : 申告期限（単日のみ、選択日の23:59をタイムスタンプとして保存）
// - 'handover'      : 引き継ぎ（振り返り）を行う日を編集（project.handoverDates・複数日可）
// - 'view'          : 旧・閲覧専用。後方互換で projectEdit と同じ挙動にする

/**
 * カレンダーモーダルを開く
 * @param {'project'|'projectEdit'|'handover'|'mission'|'view'} target
 */
export function openCalendarModal(target = 'project') {
  // 後方互換：'view' は 'projectEdit' にエイリアスする
  if (target === 'view') target = 'projectEdit';

  state.calendarDate = new Date();

  let modal = document.getElementById('calendar-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'calendar-modal';
  modal.dataset.target = target;
  // タスク・申告期限用はボトムシート（下から上にスライド）
  // スタイル: public/css/object/component/_overlay.css
  if (target === 'mission' || target === 'claimDeadline') {
    modal.className = 'c-overlay c-overlay--picker c-overlay--blur';
  } else {
    modal.className = 'c-overlay c-overlay--picker-center c-overlay--blur u-page-transition';
  }
  modal.onclick = (e) => { if (e.target === modal) _closeCalendar(target); };
  document.body.appendChild(modal);

  _renderCalendarInner(target);
  _bindDragSelection(target);

  // ボトムシートのスライドインアニメーション
  if (target === 'mission' || target === 'claimDeadline') {
    requestAnimationFrame(() => {
      const panel = document.getElementById('calendar-bottomsheet-panel');
      if (panel) panel.classList.add('is-open');
    });
  }
}

/**
 * カレンダーを閉じる時の共通処理（イベント編集後の保存・daysLeft再計算）
 */
function _closeCalendar(target) {
  if (target === 'projectEdit') {
    state.commitEventDatesEdit();
  }
  if (target === 'handover') {
    state.commitHandoverDatesEdit();
  }
  // タスク・申告期限用はボトムシートのスライドダウンアニメーション
  if (target === 'mission' || target === 'claimDeadline') {
    const panel = document.getElementById('calendar-bottomsheet-panel');
    if (panel) panel.classList.remove('is-open');
    setTimeout(() => {
      document.getElementById('calendar-modal')?.remove();
      state.render();
      // タスクモーダルが背後にあれば再描画して日付表示を更新
      if (document.getElementById('mission-modal-content')) {
        window._app?.renderMissionModalContent?.();
      }
    }, 280);
    return;
  }
  document.getElementById('calendar-modal')?.remove();
  state.render();
}

/**
 * 対象日付配列への参照を取得する
 * @param {string} target
 * @returns {string[]}
 */
function _getTargetDates(target) {
  if (target === 'project')     return state.draftEvent.dates;
  if (target === 'projectEdit') {
    const p = state.events.find(x => x.id === state.selectedEventId);
    return p ? p.dates : [];
  }
  if (target === 'handover') {
    // ★引き継ぎ日は開催日（dates）とは別の配列。混ぜないこと
    //   （daysLeft の計算・ガント・締切表示は dates だけを見ている）。
    const p = state.events.find(x => x.id === state.selectedEventId);
    if (!p) return [];
    if (!Array.isArray(p.handoverDates)) p.handoverDates = [];
    return p.handoverDates;
  }
  if (target === 'mission')     return state.draftMission.dates;
  if (target === 'claimDeadline') {
    // タイムスタンプ → 日付文字列配列に変換（カレンダーの選択状態表示用）
    if (!state.draftMission.claimDeadline) return [];
    const d = new Date(state.draftMission.claimDeadline);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return [ds];
  }
  return [];
}

/**
 * カレンダー内部をレンダリング
 * @param {'project'|'projectEdit'|'mission'} target
 */
function _renderCalendarInner(target) {
  const modal = document.getElementById('calendar-modal');
  if (!modal) return;

  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const project = state.events.find(p => p.id === state.selectedEventId);
  const currentTargetDates = _getTargetDates(target);

  // 背景色用：イベント実施日（編集中でない方）の参照
  let eventDates = [];
  if (target === 'project')          eventDates = state.draftEvent.dates;
  else if (target === 'projectEdit') eventDates = currentTargetDates; // 自身が対象
  else if (target === 'mission')     eventDates = project ? project.dates : [];
  // 引き継ぎ日を選ぶときは、開催日を背景色で見せて位置関係を分かるようにする
  else if (target === 'handover')    eventDates = project ? (project.dates || []) : [];

  const missionDeadlines = project ? project.missions.flatMap(m => m.dates || []) : [];

  let daysHtml = '';
  for (let i = 0; i < firstDay; i++) daysHtml += `<div class="p-date-picker__day-blank"></div>`;
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected  = currentTargetDates.includes(dateStr);
    const isEventDate = target !== 'projectEdit' && eventDates.includes(dateStr);
    const hasMission  = missionDeadlines.includes(dateStr);

    // ★状態は重ねて付く（開催日かつ選択中がありうる）。
    //   CSS 側で is-selected を後に書いて勝たせている。
    const cls = 'p-date-picker__day'
      + (isEventDate ? ' is-event' : '')
      + (isSelected ? ' is-selected' : '');

    daysHtml += `
      <div data-cal-day="${dateStr}" class="${cls}">
        ${d}
        ${hasMission ? '<div class="p-date-picker__mark"></div>' : ''}
      </div>`;
  }

  const helperText = target === 'claimDeadline'
    ? '日付をタップして選択'
    : 'タップまたはスライドで複数日選択';

  const sheetTitle = target === 'claimDeadline' ? '応募期限を設定'
                   : target === 'mission'        ? 'タスクの実施期間'
                   : `${year}年 ${month + 1}月`;

  // ★ボトムシート形式では見出しが「スケジュールを設定」なので、月がどこにも出ない。
  //   矢印で月を送っても今どこを見ているか分からなくなるため、矢印の間に必ず出す。
  const monthLabel = `${year}年 ${month + 1}月`;

  if (target === 'mission' || target === 'claimDeadline') {
    // ボトムシート形式（高さを 85vh まで）
    const clearBtnHtml = (target === 'claimDeadline' && state.draftMission.claimDeadline)
      ? `<button onclick="window._app.setMissionClaimDeadline(''); document.getElementById('calendar-modal')?.remove();"
           class="p-date-picker__clear">期限をクリア</button>`
      : '';
    // ★タスクの実施期間は「カレンダー｜ガント」を切り替えて選べる（2026-09-30）。ガントは他のタスクと開催日を
    //   並べ、いちばん上の「このタスク」の行をなぞって連続した期間を選ぶ（schedulePanel.js の ganttPickerHtml）
    const view = target === 'mission' && state.missionDateView === 'gantt' ? 'gantt' : 'calendar';
    const viewSwitch = target === 'mission' ? `
        <div class="p-date-picker__views" role="tablist" aria-label="表示の切り替え">
          ${[['calendar', 'カレンダー'], ['gantt', 'ガント']].map(([id, label]) => `
            <button type="button" role="tab" aria-selected="${view === id}" data-log="mission_date_view_${id}"
              onclick="window._app.setMissionDateView('${id}')"
              class="p-date-picker__view${view === id ? ' is-active' : ''}">${label}</button>`).join('')}
        </div>` : '';
    const labels = state.draftMission?.labels || state.draftMission?.tags || [];
    const firstLabel = Array.isArray(labels) ? labels[0] : labels;
    const draftColor = (firstLabel && LABEL_CONFIG[firstLabel]?.color)
      || (project?.customTags || []).find(t => t.name === firstLabel)?.color || '';
    const ganttHtml = view === 'gantt' ? `
        <p class="p-date-picker__lead">「このタスク」の行をなぞると、やる期間を設定できます。</p>
        <div class="p-schedule p-schedule--inline p-date-picker__gantt" style="${scheduleCssVars()}">
          <div class="p-schedule__body">${ganttPickerHtml(project, {
            title: state.draftMission.title?.trim() || 'このタスク',
            dates: state.draftMission.dates || [],
            color: draftColor,
            excludeId: state.editingMissionId || null,
          })}</div>
        </div>` : '';
    modal.innerHTML = `
      <div id="calendar-bottomsheet-panel" data-sheet
        class="c-sheet c-sheet--padded p-date-picker__sheet">
        <div data-sheet-handle class="c-sheet__handle"><div class="c-sheet__grip"></div></div>
        ${viewSwitch}
        <div class="p-date-picker__head">
          <h3 class="heading-r p-date-picker__title">${sheetTitle}</h3>
          <div class="p-date-picker__nav${view === 'gantt' ? ' u-hidden' : ''}">
            <button onclick="window._app.moveCalendarMonth(-1, '${target}')"
              class="p-date-picker__arrow" aria-label="前の月">
              <img src="/images/icon/icon-Chevron.svg" class="p-date-picker__arrow-icon">
            </button>
            <!-- ★見出しが「スケジュールを設定」なので、月はここに出す。
                 これが無いと、矢印で送ったあと今どの月を見ているか分からない。 -->
            <span class="p-date-picker__month" aria-live="polite">${monthLabel}</span>
            <button onclick="window._app.moveCalendarMonth(1, '${target}')"
              class="p-date-picker__arrow" aria-label="次の月">
              <img src="/images/icon/icon-Chevron.svg" class="p-date-picker__arrow-icon p-date-picker__arrow-icon--next">
            </button>
          </div>
        </div>
        ${view === 'gantt' ? ganttHtml : `
        ${target === 'mission' ? `
          <!-- ★タスクモーダルの基本設定と同じ説明を出す（同じことを2箇所で伝える）-->
          <p class="p-date-picker__lead">日付をなぞると、やる期間を設定できます。</p>
        ` : `
          <p class="p-date-picker__note">${helperText}</p>
        `}
        ${clearBtnHtml}
        <div class="p-date-picker__week p-date-picker__week--spaced">
          ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
        </div>
        <div id="calendar-grid" class="p-date-picker__grid">${daysHtml}</div>`}
        ${target === 'mission' ? `<button id="calendar-confirm-btn"
          class="c-button c-button--primary p-date-picker__confirm p-date-picker__confirm--spaced heading-rs">決定</button>` : ''}
      </div>`;
  } else {
    modal.innerHTML = `
      <div class="p-date-picker__dialog u-animate-fade">
        <div class="p-date-picker__head">
          <h3 class="heading-r p-date-picker__title">${year}年 ${month + 1}月</h3>
          <div class="p-date-picker__nav">
            <button onclick="window._app.moveCalendarMonth(-1, '${target}')"
              class="p-date-picker__arrow">
              <img src="/images/icon/icon-Chevron.svg" class="p-date-picker__arrow-icon">
            </button>
            <button onclick="window._app.moveCalendarMonth(1, '${target}')"
              class="p-date-picker__arrow">
              <img src="/images/icon/icon-Chevron.svg" class="p-date-picker__arrow-icon p-date-picker__arrow-icon--next">
            </button>
          </div>
        </div>
        <p class="p-date-picker__note p-date-picker__note--roomy">${helperText}</p>
        <div class="p-date-picker__week">
          ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
        </div>
        <div id="calendar-grid" class="p-date-picker__grid ${(target === 'projectEdit' || target === 'handover') ? 'p-date-picker__grid--tight' : 'p-date-picker__grid--loose'}">${daysHtml}</div>
        ${target === 'projectEdit' ? _renderDateTimeList(project) : ''}
        <button id="calendar-confirm-btn"
          class="c-button c-button--primary p-date-picker__confirm heading-rs">決定</button>
      </div>`;
  }

  // 決定ボタン（タスク用は存在しない）
  const confirmBtn = document.getElementById('calendar-confirm-btn');
  if (confirmBtn) confirmBtn.onclick = () => _closeCalendar(target);

  // 時刻入力（projectEdit のみ）
  if (target === 'projectEdit') _bindDateTimeInputs(project);

  // ガント（タスクの実施期間）：最初に見せる位置と、「このタスク」の行のなぞり
  if (target === 'mission' && state.missionDateView === 'gantt') {
    const dates = state.draftMission.dates || [];
    initGanttPicker(modal, [...dates].sort()[0] || null);
    bindGanttRangePicker(modal, (picked) => {
      // ★選んだ期間で置き換える（カレンダーと同じ配列を書き換える＝参照を保つ）
      const arr = state.draftMission.dates;
      arr.splice(0, arr.length, ...picked);
      // 描き直してもスクロール位置を保つ
      const body = modal.querySelector('#gantt-body');
      const keep = body ? { l: body.scrollLeft, t: body.scrollTop } : null;
      _renderCalendarInner(target);
      document.getElementById('calendar-bottomsheet-panel')?.classList.add('is-open');
      const nb = modal.querySelector('#gantt-body');
      if (nb && keep) {
        nb.scrollLeft = keep.l; nb.scrollTop = keep.t;
        const header = modal.querySelector('#gantt-header-inner');
        if (header) header.style.transform = `translateX(-${keep.l}px)`;
      }
      window._app?.renderMissionModalContent?.();
    });
  }
}

/** タスクの実施期間の表示を切り替える（カレンダー｜ガント）。★選んだ表示はこの画面を開いている間覚えておく */
export function setMissionDateView(view) {
  state.missionDateView = view === 'gantt' ? 'gantt' : 'calendar';
  _renderCalendarInner('mission');
  _bindDragSelection('mission');
  document.getElementById('calendar-bottomsheet-panel')?.classList.add('is-open');
}

/**
 * カレンダーの月を移動する
 * @param {number} offset
 * @param {string} target
 */
export function moveCalendarMonth(offset, target) {
  state.calendarDate.setMonth(state.calendarDate.getMonth() + offset);
  _renderCalendarInner(target);
  _bindDragSelection(target);
  // ボトムシートは HTML 再構築後も表示を維持する（is-open を付け直す）
  if (target === 'mission' || target === 'claimDeadline') {
    const panel = document.getElementById('calendar-bottomsheet-panel');
    if (panel) panel.classList.add('is-open');
  }
}

// ===== ドラッグ選択（なぞって複数日選択） =====

let _dragState = null; // { mode, lastDate, monthAdvancing, target }

/**
 * ドラッグ選択のイベントリスナーを紐付ける
 * @param {string} target
 */
function _bindDragSelection(target) {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  // 申告期限は単日選択のみ。選択日の23:59のタイムスタンプを設定
  if (target === 'claimDeadline') {
    grid.querySelectorAll('[data-cal-day]').forEach(cell => {
      cell.addEventListener('click', () => {
        const parts = cell.dataset.calDay.split('-');
        // 選択日の 23:59:59 をタイムスタンプとして設定
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59);
        state.draftMission.claimDeadline = d.getTime();
        _closeCalendar(target);
      });
    });
    return;
  }

  // 複数日選択 (project / projectEdit)
  const dates = _getTargetDates(target);

  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('[data-cal-day]');
    if (!cell) return;
    e.preventDefault();
    const dateStr = cell.dataset.calDay;
    const isOn = dates.includes(dateStr);
    _dragState = {
      mode: isOn ? 'remove' : 'add',
      lastDate: null,
      monthAdvancing: false,
      target,
    };
    _applyPaint(dateStr);
    try { grid.setPointerCapture(e.pointerId); } catch (_) {}
  });

  grid.addEventListener('pointermove', (e) => {
    if (!_dragState) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest('[data-cal-day]');
    if (cell && grid.contains(cell)) {
      _dragState.monthAdvancing = false;
      _applyPaint(cell.dataset.calDay);
    } else {
      // グリッド右端を超えたら次月に進む（1回のみ）
      if (!_dragState.monthAdvancing) {
        const rect = grid.getBoundingClientRect();
        if (e.clientX > rect.right + 10) {
          _dragState.monthAdvancing = true;
          const t = _dragState.target;
          _dragState = null; // ドラッグ終了してから月を進める
          moveCalendarMonth(1, t);
        }
      }
    }
  });

  const endDrag = () => {
    if (!_dragState) return;
    const t = _dragState.target;
    _dragState = null;
    // イベント作成中の場合、裏側の画面も追従させる
    if (t === 'project') state.render();
    // projectEdit は選択日が変わったので時刻リストを再構築（新規日に時刻入力を出す）
    if (t === 'projectEdit') {
      _renderCalendarInner(t);
      _bindDragSelection(t);
    }
  };
  grid.addEventListener('pointerup',     endDrag);
  grid.addEventListener('pointercancel', endDrag);
  grid.addEventListener('pointerleave',  endDrag);
}

/**
 * ドラッグ中の塗り塗り処理：lastDate → dateStr の範囲を全て選択
 * @param {string} dateStr
 */
function _applyPaint(dateStr) {
  if (!_dragState) return;

  const dates    = _getTargetDates(_dragState.target);
  const lastDate = _dragState.lastDate;
  _dragState.lastDate = dateStr;

  // lastDate → dateStr の間にある全グリッドセルを塗る（範囲補完）
  const grid = document.getElementById('calendar-grid');
  if (lastDate && lastDate !== dateStr && grid) {
    const [from, to] = lastDate < dateStr ? [lastDate, dateStr] : [dateStr, lastDate];
    grid.querySelectorAll('[data-cal-day]').forEach(cell => {
      const d = cell.dataset.calDay;
      if (d < from || d > to) return;
      const idx = dates.indexOf(d);
      if (_dragState.mode === 'add' && idx === -1)    dates.push(d);
      if (_dragState.mode === 'remove' && idx !== -1) dates.splice(idx, 1);
      _updateCellAppearance(d, _dragState.mode === 'add');
    });
  } else {
    // 単セル塗り（初回タッチ、または同セル）
    const idx = dates.indexOf(dateStr);
    if (_dragState.mode === 'add' && idx === -1)    dates.push(dateStr);
    if (_dragState.mode === 'remove' && idx !== -1) dates.splice(idx, 1);
    _updateCellAppearance(dateStr, _dragState.mode === 'add');
  }

  dates.sort();
}

/**
 * 特定セルだけ見た目を切り替える（ドラッグ中の再レンダリング抑制）
 * @param {string} dateStr
 * @param {boolean} on
 */
function _updateCellAppearance(dateStr, on) {
  const cell = document.querySelector(`[data-cal-day="${dateStr}"]`);
  if (!cell) return;
  // ★選択状態だけを切り替える。開催日の色（is-event）には触らない。
  //   以前は Tailwind のクラスを付け外ししており、開催日を一度選んでから
  //   外すと、その日だけ色が白に戻ってしまっていた。
  cell.classList.toggle('is-selected', !!on);
}

/**
 * 日付の選択状態をトグルする（単日用：タスク、および旧来のクリック互換）
 * @param {string} dateStr
 * @param {string} target
 */
export function toggleDate(dateStr, target) {
  if (target === 'view') target = 'projectEdit';

  if (target === 'mission') {
    const dates = state.draftMission.dates;
    const idx = dates.indexOf(dateStr);
    dates.splice(0, dates.length);
    if (idx === -1) dates.push(dateStr);
    dates.sort();
    _renderCalendarInner(target);
    _bindDragSelection(target);
    window._app.renderMissionModalContent?.();
    return;
  }

  // project / projectEdit の単発クリック相当
  const dates = _getTargetDates(target);
  const idx = dates.indexOf(dateStr);
  if (idx > -1) dates.splice(idx, 1);
  else dates.push(dateStr);
  dates.sort();
  _renderCalendarInner(target);
  _bindDragSelection(target);

  if (target === 'project') state.render();
}
