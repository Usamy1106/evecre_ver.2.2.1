// ===== カレンダーモーダル =====
import { state } from '../state.js';

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
      <div class="flex items-center gap-2 py-1.5">
        <span class="text-[12px] font-bold text-[#484545] w-16 flex-shrink-0">${m}/${d}（${wd}）</span>
        <input type="time" data-dt-date="${dateStr}" data-dt-kind="start" value="${t.start || ''}"
          class="flex-1 min-w-0 text-[13px] bg-[#FDFBF8] border border-[#E1DFDC] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#0CA1E3]">
        <span class="text-[11px] text-[#A7AAAC]">〜</span>
        <input type="time" data-dt-date="${dateStr}" data-dt-kind="end" value="${t.end || ''}"
          class="flex-1 min-w-0 text-[13px] bg-[#FDFBF8] border border-[#E1DFDC] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#0CA1E3]">
      </div>`;
  }).join('');
  return `
    <div class="mt-4 mb-6">
      <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">時間（任意・日ごとに設定できます）</p>
      <div class="max-h-40 overflow-y-auto pr-1">${rows}</div>
    </div>`;
}

/**
 * 時刻入力の onchange を紐付ける（projectEdit のみ）。
 * @param {object} project
 */
function _bindDateTimeInputs(project) {
  const modal = document.getElementById('calendar-modal');
  if (!modal || !project) return;
  modal.querySelectorAll('input[data-dt-date]').forEach(input => {
    input.addEventListener('change', () => {
      const dateStr = input.dataset.dtDate;
      const kind    = input.dataset.dtKind; // 'start' | 'end'
      if (!project.dateTimes) project.dateTimes = {};
      const cur = project.dateTimes[dateStr] || { start: '', end: '' };
      cur[kind] = input.value || '';
      if (!cur.start && !cur.end) delete project.dateTimes[dateStr];
      else project.dateTimes[dateStr] = cur;
    });
  });
}

// サポートする target:
// - 'project'       : イベント作成中のドラフトの開催日を編集（state.draftEvent.dates）
// - 'projectEdit'   : 確定済みイベントの開催日（実施日）を編集（project.dates）
// - 'mission'       : ミッション期限（単日のみ）
// - 'claimDeadline' : 申告期限（単日のみ、選択日の23:59をタイムスタンプとして保存）
// - 'view'          : 旧・閲覧専用。後方互換で projectEdit と同じ挙動にする

/**
 * カレンダーモーダルを開く
 * @param {'project'|'projectEdit'|'mission'|'view'} target
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
  // ミッション・申告期限用はボトムシート（下から上にスライド）
  if (target === 'mission' || target === 'claimDeadline') {
    modal.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[200]';
  } else {
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 page-transition';
  }
  modal.onclick = (e) => { if (e.target === modal) _closeCalendar(target); };
  document.body.appendChild(modal);

  _renderCalendarInner(target);
  _bindDragSelection(target);

  // ボトムシートのスライドインアニメーション
  if (target === 'mission' || target === 'claimDeadline') {
    requestAnimationFrame(() => {
      const panel = document.getElementById('calendar-bottomsheet-panel');
      if (panel) panel.classList.remove('translate-y-full');
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
  // ミッション・申告期限用はボトムシートのスライドダウンアニメーション
  if (target === 'mission' || target === 'claimDeadline') {
    const panel = document.getElementById('calendar-bottomsheet-panel');
    if (panel) panel.classList.add('translate-y-full');
    setTimeout(() => {
      document.getElementById('calendar-modal')?.remove();
      state.render();
      // ミッションモーダルが背後にあれば再描画して日付表示を更新
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

  const missionDeadlines = project ? project.missions.flatMap(m => m.dates || []) : [];

  let daysHtml = '';
  for (let i = 0; i < firstDay; i++) daysHtml += `<div class="h-10"></div>`;
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected  = currentTargetDates.includes(dateStr);
    const isEventDate = target !== 'projectEdit' && eventDates.includes(dateStr);
    const hasMission  = missionDeadlines.includes(dateStr);

    daysHtml += `
      <div data-cal-day="${dateStr}"
        class="relative h-10 w-full flex flex-col items-center justify-center rounded-lg cursor-pointer transition-all text-rs font-bold select-none
        ${isSelected ? 'bg-[#0CA1E3] text-white shadow-md' : isEventDate ? 'bg-[#CFD8FF] text-[#484545]' : 'bg-white text-[#484545]'}"
        style="touch-action: none; -webkit-user-select: none; user-select: none;">
        ${d}
        ${hasMission ? '<div class="absolute bottom-1 w-1 h-1 bg-[#EE3E12] rounded-full pointer-events-none"></div>' : ''}
      </div>`;
  }

  const helperText = target === 'claimDeadline'
    ? '日付をタップして選択'
    : 'タップまたはスライドで複数日選択';

  const sheetTitle = target === 'claimDeadline' ? '応募期限を設定'
                   : target === 'mission'        ? 'スケジュールを設定'
                   : `${year}年 ${month + 1}月`;

  if (target === 'mission' || target === 'claimDeadline') {
    // ボトムシート形式（高さを 85vh まで）
    const clearBtnHtml = (target === 'claimDeadline' && state.draftMission.claimDeadline)
      ? `<button onclick="window._app.setMissionClaimDeadline(''); document.getElementById('calendar-modal')?.remove();"
           class="text-[10px] text-[#A7AAAC] underline font-bold mt-2 block">期限をクリア</button>`
      : '';
    modal.innerHTML = `
      <div id="calendar-bottomsheet-panel" data-sheet
        class="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl p-6 transition-transform transform translate-y-full"
        style="height: 85vh; overflow-y: auto;">
        <div data-sheet-handle class="flex justify-center pt-1 pb-3"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
        <div class="flex items-center justify-between mb-2">
          <h3 class="heading-r text-[#484545] font-bold">${sheetTitle}</h3>
          <div class="flex gap-2">
            <button onclick="window._app.moveCalendarMonth(-1, '${target}')"
              class="p-2 bg-[#FDFBF8] rounded-full">
              <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 brightness-0 opacity-50">
            </button>
            <button onclick="window._app.moveCalendarMonth(1, '${target}')"
              class="p-2 bg-[#FDFBF8] rounded-full">
              <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 rotate-180 brightness-0 opacity-50">
            </button>
          </div>
        </div>
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-1">${helperText}</p>
        ${clearBtnHtml}
        <div class="grid grid-cols-7 gap-1 mb-2 mt-4 text-center text-[10px] text-[#A7AAAC] font-bold">
          ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
        </div>
        <div id="calendar-grid" class="grid grid-cols-7 gap-1" style="touch-action:none;">${daysHtml}</div>
        ${target === 'mission' ? `<button id="calendar-confirm-btn"
          class="btn-primary w-full py-3 heading-rs font-bold mt-6">決定</button>` : ''}
      </div>`;
  } else {
    modal.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-fadeIn">
        <div class="flex items-center justify-between mb-2">
          <h3 class="heading-r text-[#484545] font-bold">${year}年 ${month + 1}月</h3>
          <div class="flex gap-2">
            <button onclick="window._app.moveCalendarMonth(-1, '${target}')"
              class="p-2 bg-[#FDFBF8] rounded-full">
              <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 brightness-0 opacity-50">
            </button>
            <button onclick="window._app.moveCalendarMonth(1, '${target}')"
              class="p-2 bg-[#FDFBF8] rounded-full">
              <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 rotate-180 brightness-0 opacity-50">
            </button>
          </div>
        </div>
        <p class="text-[10px] text-[#A7AAAC] font-bold mb-4">${helperText}</p>
        <div class="grid grid-cols-7 gap-1 mb-2 text-center text-[10px] text-[#A7AAAC] font-bold">
          ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
        </div>
        <div id="calendar-grid" class="grid grid-cols-7 gap-1 ${target === 'projectEdit' ? 'mb-2' : 'mb-8'}" style="touch-action:none;">${daysHtml}</div>
        ${target === 'projectEdit' ? _renderDateTimeList(project) : ''}
        <button id="calendar-confirm-btn"
          class="btn-primary w-full py-3 heading-rs font-bold">決定</button>
      </div>`;
  }

  // 決定ボタン（ミッション用は存在しない）
  const confirmBtn = document.getElementById('calendar-confirm-btn');
  if (confirmBtn) confirmBtn.onclick = () => _closeCalendar(target);

  // 時刻入力（projectEdit のみ）
  if (target === 'projectEdit') _bindDateTimeInputs(project);
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
  // ボトムシートは HTML 再構築後も表示を維持する（translate-y-full をリセット）
  if (target === 'mission' || target === 'claimDeadline') {
    const panel = document.getElementById('calendar-bottomsheet-panel');
    if (panel) panel.classList.remove('translate-y-full');
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
  // 既存クラスをリセット
  cell.classList.remove(
    'bg-[#0CA1E3]', 'text-white', 'shadow-md',
    'bg-[#CFD8FF]', 'bg-white'
  );
  if (on) {
    cell.classList.add('bg-[#0CA1E3]', 'text-white', 'shadow-md');
  } else {
    cell.classList.add('bg-white', 'text-[#484545]');
  }
}

/**
 * 日付の選択状態をトグルする（単日用：ミッション、および旧来のクリック互換）
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
