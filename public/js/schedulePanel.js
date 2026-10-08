// ===== スケジュール（カレンダー・ガント）の中身 =====
//
// ★描き込む先（root）と ctx を受け取る部品。どこに置かれているかは知らない。
//   スマホ … modals/eventCalendarSheet.js のボトムシートの中
//   広い画面 … メインボードの右列（views/mainBoard.js。layoutMode.js の isDashboard）
// ★root の中だけを querySelector で探す（document から探さない）。
//   ただし id（mb-cal-fixed / gantt-body など）を使っているので、シートと右列を同時に出さないこと
//   （ダッシュボード表示ではシートを開かない。eventCalendarSheet.js の入口で分岐している）。
//
// [カレンダービュー] 上：月次カレンダー／下：日付別のやること一覧
// [ガントビュー]     左列：タスク名（sticky）／横：日付軸（横スクロール）／バー：期間

import { state } from './state.js';
import { getSortedMissions } from './modals/mission.js';
import { LABEL_CONFIG } from './constants.js';

// ガントチャートの定数
const CELL_W     = 30;   // 1日あたりの列幅 (px)
const NAME_W     = 116;  // タスク名列の幅 (px)
const HEADER_H   = 46;   // ヘッダー行の高さ (px)
const ROW_H      = 38;   // タスク行の高さ (px)
const DAYS_BEFORE = 14;  // 今日より前に表示する日数
const DAYS_AFTER  = 75;  // 今日より後に表示する日数


// =====================================================
// 公開する関数
// =====================================================

/** 表示の状態。view は 'calendar' | 'gantt'。editDates は開催日の編集中の作業コピー（null＝閲覧中） */
export function newScheduleCtx(p, view = 'calendar') {
  const today = new Date();
  return {
    p,
    calDate: new Date(today.getFullYear(), today.getMonth(), 1),
    selectedDate: _ymd(today),
    view: view === 'gantt' ? 'gantt' : 'calendar',
    // ★開催日の編集モード。null＝閲覧中、配列＝編集中の作業コピー。
    //   確定するまで p.dates には触らない。誤タップで開催日が変わると
    //   全メンバーの予定が動くので、必ず「保存」を挟む。
    editDates: null,
  };
}

/** ガントの寸法（JS の定数が正。CSS には custom property で渡す）。中身を包む要素の style に入れる */
export function scheduleCssVars() {
  return `--gantt-cell-w:${CELL_W}px;--gantt-name-w:${NAME_W}px;`
    + `--gantt-header-h:${HEADER_H}px;--gantt-row-h:${ROW_H}px;`
    + `--gantt-content-w:${(DAYS_BEFORE + DAYS_AFTER + 1) * CELL_W}px;`;
}

/**
 * タスクの実施期間を選ぶためのガント（calendar.js の 'mission'）。いちばん上に「このタスク」の行が付く。
 * @param {object} p イベント
 * @param {{ title:string, dates:string[], color:string, excludeId:string|null }} draft
 */
export function ganttPickerHtml(p, draft) {
  const missions = getSortedMissions((p?.missions || []).filter(m => m.id !== draft.excludeId));
  return _renderGanttView({ p, missions, draftRow: draft });
}

/**
 * 「このタスク」の行をなぞって、連続した期間を選ぶ。
 * ★なぞり始めの日からなぞっている日まで（逆向きも可）。タップだけならその1日。
 * ★なぞっている間は行の見た目だけ差し替え、離したときに onCommit(dates) を1回呼ぶ。
 * ★行のセルは touch-action: none（CSS）。ほかの行・見出しは今どおり横にスクロールできる。
 */
export function bindGanttRangePicker(root, onCommit) {
  const row = root.querySelector('[data-gantt-draft]');
  if (!row) return;
  const slots = [...row.querySelectorAll('[data-gantt-day]')];
  let start = null, cur = null, pid = null;
  const dayAt = (x) => {
    for (const el of slots) { const r = el.getBoundingClientRect(); if (x >= r.left && x < r.right) return el.dataset.ganttDay; }
    return null;
  };
  const paint = () => {
    const [a, b] = start <= cur ? [start, cur] : [cur, start];
    slots.forEach(el => el.classList.toggle('is-picking', el.dataset.ganttDay >= a && el.dataset.ganttDay <= b));
  };
  row.addEventListener('pointerdown', (e) => {
    const d = e.target.closest('[data-gantt-day]')?.dataset.ganttDay;
    if (!d) return;
    e.preventDefault();
    start = cur = d; pid = e.pointerId;
    row.classList.add('is-picking');
    try { row.setPointerCapture(e.pointerId); } catch (_) {}
    paint();
  });
  row.addEventListener('pointermove', (e) => {
    if (start === null || e.pointerId !== pid) return;
    const d = dayAt(e.clientX);
    if (d && d !== cur) { cur = d; paint(); }
  });
  const end = (e) => {
    if (start === null || (e && e.pointerId !== pid)) return;
    const [a, b] = start <= cur ? [start, cur] : [cur, start];
    const dates = slots.map(el => el.dataset.ganttDay).filter(x => x >= a && x <= b);
    start = cur = pid = null;
    row.classList.remove('is-picking');
    onCommit(dates);
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
}

/** ガントのスクロール配線（見出しの追従）と、最初に見せる位置（startYmd があればその日、無ければ今日） */
export function initGanttPicker(root, startYmd) {
  _bindGanttScroll(root);
  const body = root.querySelector('#gantt-body');
  const header = root.querySelector('#gantt-header-inner');
  if (!body) return;
  let left = Math.max(0, DAYS_BEFORE * CELL_W - 90);
  if (startYmd) {
    const idx = Math.round((new Date(startYmd + 'T00:00:00') - _addDays(new Date(), -DAYS_BEFORE).setHours(0, 0, 0, 0)) / 86400000);
    if (idx >= 0) left = Math.max(0, idx * CELL_W - 90);
  }
  body.scrollLeft = left;
  if (header) header.style.transform = `translateX(-${left}px)`;
}

/** 中身の HTML（ctx.view に応じてカレンダーかガント） */
export function scheduleBodyHtml(ctx) {
  return ctx.view === 'gantt' ? _renderGanttView(ctx) : _renderCalendarView(ctx);
}

/** 月のカレンダーだけ（日付別の一覧を付けない）。広い画面の右列で、下にタスクのカードを並べるときに使う */
export function scheduleCalendarHtml(ctx) {
  return `<div id="mb-cal-fixed" class="p-schedule__cal">${_renderCalendar(ctx)}</div>`;
}

/** 中身の配線。scheduleBodyHtml を root に描いたあとに呼ぶ */
export function bindScheduleBody(root, ctx) {
  if (ctx.view === 'gantt') _bindGanttScroll(root);
  else _bindCalendarEvents(root, ctx);
}

/** 今日が見える位置へ送る（開いた直後・切り替えた直後） */
export function scrollScheduleToToday(root, ctx) {
  if (ctx.view === 'gantt') _scrollGanttToToday(root);
  else _scrollToSection(root, _ymd(new Date()), false);
}


// =====================================================
// カレンダービュー
// =====================================================
function _renderCalendarView(ctx) {
  return `
    <!-- カレンダー（固定）-->
    <div id="mb-cal-fixed" class="p-schedule__cal">
      ${_renderCalendar(ctx)}
    </div>
    <!-- やること一覧（スクロール）-->
    <div id="mb-cal-list" class="p-schedule__list">
      ${_renderSections(ctx)}
    </div>`;
}

function _renderCalendar(ctx) {
  const year     = ctx.calDate.getFullYear();
  const month    = ctx.calDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const todayYmd = _ymd(new Date());
  const editing = Array.isArray(ctx.editDates);
  // ★編集中は作業コピーを見る。確定するまで p.dates には触らない
  const projDates = new Set(editing ? ctx.editDates : (ctx.p.dates || []));
  // ★広い画面の右列（やること×カレンダー）：日付をタップすると一覧をその日に絞る（ctx.onPickDate）。
  //   ctx.missions（絞り込み・並べ替え済み）の実施日に、タグ色の点を最大3つ打つ
  const hybrid = typeof ctx.onPickDate === 'function';
  const dotsByDate = new Map();
  if (hybrid && !editing) {
    for (const m of (ctx.missions || [])) {
      const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
      const color = _resolveTagColor(tagNames, ctx.p.customTags);
      for (const d of (m.dates || [])) {
        const arr = dotsByDate.get(d) || [];
        if (arr.length < 3) arr.push(color);
        dotsByDate.set(d, arr);
      }
    }
  }

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<div class="p-schedule__day-blank"></div>';
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    // ★状態は1つだけ付ける（選択中 > 開催日 > 今日）。重ねると
    //   「開催日かつ今日」で塗りと枠が両方出て、元の見た目と変わる。
    let state = '';
    if (editing) {
      // ★編集中は「開催日かどうか」だけを見せる。閲覧用の選択日（水色）を
      //   混ぜると、どれが開催日なのか分からなくなる。
      if (projDates.has(dateStr))    state = ' is-project';
      else if (dateStr === todayYmd) state = ' is-today';
    } else if (dateStr === (hybrid ? ctx.filterDate : ctx.selectedDate)) state = ' is-selected';
    else if (projDates.has(dateStr))         state = ' is-project';
    else if (dateStr === todayYmd)           state = ' is-today';

    const dots = dotsByDate.get(dateStr);
    const dotsHtml = dots ? `<span class="p-schedule__day-dots">${dots.map(c => `<i style="--dot-color:${_esc(c)}"></i>`).join('')}</span>` : '';
    cells += `<div data-mb-day="${dateStr}" class="p-schedule__day${state}${dots ? ' has-dots' : ''}">${d}${dotsHtml}</div>`;
  }

  return `
    <div class="p-schedule__cal-nav">
      <button id="mb-cal-prev" class="p-schedule__cal-arrow">
        <img src="/images/icon/icon-Chevron.svg" class="p-schedule__cal-arrow-icon">
      </button>
      <h3 class="heading-r p-schedule__section-title">${year}年 ${month + 1}月</h3>
      <button id="mb-cal-next" class="p-schedule__cal-arrow">
        <img src="/images/icon/icon-Chevron.svg" class="p-schedule__cal-arrow-icon p-schedule__cal-arrow-icon--next">
      </button>
    </div>
    <div class="p-schedule__week">
      ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
    </div>
    <div id="mb-cal-days" class="p-schedule__days${editing ? ' is-editing' : ''}">${cells}</div>
    ${editing ? `
      <p class="p-schedule__cal-note is-set">
        タップまたはスワイプで開催日を選択（${projDates.size}件）
      </p>
      <div class="p-schedule__cal-actions">
        <button id="mb-dates-cancel" class="c-button c-button--secondary p-schedule__cal-action">キャンセル</button>
        <button id="mb-dates-save" class="c-button c-button--primary p-schedule__cal-action">保存</button>
      </div>
    ` : `
      <p class="p-schedule__cal-note${projDates.size > 0 ? ' is-set' : ''}">
        ${projDates.size > 0 ? `開催日 ${projDates.size}件` : '開催日未設定'}
      </p>
      ${state.canManageCurrentEvent() ? `
        <button id="mb-dates-edit" class="p-schedule__cal-edit" data-log="event_dates_edit_open">
          <img src="/images/icon/icon-edit.svg" alt="" class="p-schedule__cal-edit-icon">
          ${projDates.size > 0 ? '開催日を編集' : '開催日を設定'}
        </button>` : ''}
    `}`;
}

function _bindCalendarEvents(root, ctx) {
  root.querySelector('#mb-cal-prev')?.addEventListener('click', () => {
    ctx.calDate = new Date(ctx.calDate.getFullYear(), ctx.calDate.getMonth() - 1, 1);
    _renderCalendarOnly(root, ctx);
  });
  root.querySelector('#mb-cal-next')?.addEventListener('click', () => {
    ctx.calDate = new Date(ctx.calDate.getFullYear(), ctx.calDate.getMonth() + 1, 1);
    _renderCalendarOnly(root, ctx);
  });
  // ── 開催日の編集モード ────────────────────────────────
  // ★誤タップで開催日が変わると全メンバーの予定が動くので、通常は閲覧専用。
  //   明示的に編集モードへ入り、「保存」を押したときだけ確定する。
  root.querySelector('#mb-dates-edit')?.addEventListener('click', () => {
    if (!state.canManageCurrentEvent()) return;
    ctx.editDates = [...(ctx.p.dates || [])].sort();   // ★作業コピー。p.dates は触らない
    _renderCalendarOnly(root, ctx);
  });
  root.querySelector('#mb-dates-cancel')?.addEventListener('click', () => {
    ctx.editDates = null;                              // 破棄するだけ
    _renderCalendarOnly(root, ctx);
  });
  root.querySelector('#mb-dates-save')?.addEventListener('click', () => {
    if (!state.canManageCurrentEvent()) { ctx.editDates = null; return; }
    ctx.p.dates = [...(ctx.editDates || [])];
    ctx.editDates = null;
    // ★確定処理は state 側に集約されている（ソート・daysLeft・dateTimes の後始末・保存）。
    //   イベント設定やアーカイブのペンからの変更と同じ経路を通すこと。
    //   ここに同じ処理を書き写すと、片方だけ直したときに挙動がずれる。
    state.commitEventDatesEdit();
    _renderCalendarContent(root, ctx);
    state.render();                                    // ヘッダーの「残り◯日」も更新する
  });

  if (Array.isArray(ctx.editDates)) {
    _bindDateEditDrag(root, ctx);
    return;                                            // ★編集中は閲覧用のタップを配線しない
  }

  root.querySelectorAll('[data-mb-day]').forEach(el => {
    el.addEventListener('click', () => {
      const dateStr = el.dataset.mbDay;
      // 広い画面の右列：一覧をその日に絞る（描き直しは呼び出し側）
      if (typeof ctx.onPickDate === 'function') { ctx.onPickDate(dateStr); return; }
      ctx.selectedDate = dateStr;
      // 閲覧中は日付を変えない。セクションへのスクロールだけ行う
      _renderCalendarOnly(root, ctx);
      _scrollToSection(root, dateStr, true);
    });
  });
}

/**
 * 編集モードの日付選択（タップ＋スワイプ）。
 *
 * ★Pointer Events だけで受ける（createEvent.js / modals/calendar.js と同じ方式）。
 *   mouse 系と touch 系を2系統張ると、1回のタップで onDown が2回走り
 *   「タップしても何も起きない／すぐ戻る」ように見える（過去に踏んだ不具合）。
 * ★document にリスナーを張らないこと。この関数は再描画のたびに走るので、
 *   document へ足すと消されないまま溜まり続ける。
 *   setPointerCapture を使えば、グリッドの外へ指が出ても move/up は届く。
 */
function _bindDateEditDrag(root, ctx) {
  const grid = root.querySelector('#mb-cal-days');
  if (!grid) return;

  let active = false, mode = null, visited = null;

  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-mb-day]') || null;

  const setCell = (dateStr, on) => {
    const i = ctx.editDates.indexOf(dateStr);
    if (on && i === -1) ctx.editDates.push(dateStr);
    else if (!on && i !== -1) ctx.editDates.splice(i, 1);
  };

  // ★塗りだけ切り替える。再描画するとドラッグ中に要素が入れ替わって追跡が切れる
  const paint = () => {
    grid.querySelectorAll('[data-mb-day]').forEach(cell => {
      cell.classList.toggle('is-project', ctx.editDates.includes(cell.dataset.mbDay));
    });
    // ★カレンダー領域に限定して引く。root 全体から引くと、
    //   下のやること一覧に同じクラスが出たときに別物を書き換えてしまう。
    const note = root.querySelector('#mb-cal-fixed .p-schedule__cal-note');
    if (note) note.textContent = `タップまたはスワイプで開催日を選択（${ctx.editDates.length}件）`;
  };

  grid.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;                 // 2本目以降の指は無視する
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    const dateStr = cell.dataset.mbDay;
    active = true;
    mode = ctx.editDates.includes(dateStr) ? 'remove' : 'add';
    visited = new Set([dateStr]);
    setCell(dateStr, mode === 'add');
    paint();
    try { grid.setPointerCapture(e.pointerId); } catch (_) {}
  });
  grid.addEventListener('pointermove', (e) => {
    if (!active || !e.isPrimary) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    const dateStr = cell.dataset.mbDay;
    if (visited.has(dateStr)) return;
    visited.add(dateStr);
    setCell(dateStr, mode === 'add');
    paint();
  });
  const onUp = () => { active = false; mode = null; visited = null; };
  grid.addEventListener('pointerup', onUp);
  grid.addEventListener('pointercancel', onUp);
}

function _renderCalendarOnly(root, ctx) {
  const cont = root.querySelector('#mb-cal-fixed');
  if (!cont) return;
  cont.innerHTML = _renderCalendar(ctx);
  _bindCalendarEvents(root, ctx);
}

function _renderCalendarContent(root, ctx) {
  const cont = root.querySelector('#mb-cal-fixed');
  const list = root.querySelector('#mb-cal-list');
  if (cont) { cont.innerHTML = _renderCalendar(ctx); _bindCalendarEvents(root, ctx); }
  if (list) list.innerHTML = _renderSections(ctx);
}

// タスクの最初のタグ名からカラーコードを解決する
function _resolveTagColor(tagNames, customTags) {
  const name = Array.isArray(tagNames) ? tagNames[0] : tagNames;
  if (!name) return '#D3D6D8';
  if (LABEL_CONFIG[name]) return LABEL_CONFIG[name].color;
  const custom = (customTags || []).find(t => t.name === name);
  return custom ? custom.color : '#D3D6D8';
}

// =====================================================
// ガントチャートビュー
// =====================================================
function _renderGanttView(ctx) {
  const today    = new Date();
  const todayYmd = _ymd(today);
  const TOTAL    = DAYS_BEFORE + DAYS_AFTER + 1;
  const startD   = _addDays(today, -DAYS_BEFORE);

  // 表示する全日付
  const allDates = [];
  for (let i = 0; i < TOTAL; i++) allDates.push(_addDays(startD, i));

  const projDates  = new Set(ctx.p.dates || []);
  // ★広い画面の右列では、やること一覧と同じ絞り込み・並びの行を出す（ctx.missions）。シートは従来どおり全件
  const missions   = Array.isArray(ctx.missions) ? ctx.missions : getSortedMissions(ctx.p.missions || []);

  // 列の塗り。★1つだけ付ける（今日 > 開催日 > 日曜 > 土曜）。
  // 濃さはヘッダー行と本文行で違うので、CSS 側に2組のトークンを持たせてある。
  const dayState = (ymd, dow) => {
    if (ymd === todayYmd)   return ' is-today';
    if (projDates.has(ymd)) return ' is-project';
    if (dow === 0)          return ' is-sunday';
    if (dow === 6)          return ' is-saturday';
    return '';
  };
  // 文字色は塗りと別。曜日は開催日でも赤／青のままにする
  const dowState = (dow) => dow === 0 ? ' is-sunday' : dow === 6 ? ' is-saturday' : '';

  // ── ヘッダー日付セル ──────────────────────────────
  let prevMonth = -1;
  const headerCells = allDates.map(d => {
    const ymd     = _ymd(d);
    const dow     = d.getDay(); // 0=日
    const month   = d.getMonth();
    const isFirst = d.getDate() === 1;
    const weekJa  = ['日','月','火','水','木','金','土'][dow];
    const showM   = isFirst || prevMonth !== month;
    prevMonth = month;
    // 日付の数字は「今日」を最優先、次に曜日の色
    const numState = ymd === todayYmd ? ' is-today' : dowState(dow);

    return `<div class="p-schedule__gantt-cell${dayState(ymd, dow)}">
      <span class="p-schedule__gantt-month">${showM ? (month+1)+'月' : ''}</span>
      <span class="p-schedule__gantt-date${numState}">${d.getDate()}</span>
      <span class="p-schedule__gantt-dow${dowState(dow)}">${weekJa}</span>
    </div>`;
  }).join('');

  // ── タスク行 ────────────────────────────────
  const missionsHtml = missions.length === 0
    ? `<div class="p-schedule__gantt-empty">タスクがありません</div>`
    : missions.map(m => {
        const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
        const barColor = _resolveTagColor(tagNames, ctx.p.customTags);
        const isCleared = m.status === 'cleared';
        // 行ごとに違う値だけインラインで渡す（色＝タグ色、薄さ＝完了しているか）
        const rowVars = `--tag-color:${barColor};--gantt-opacity:${isCleared ? '0.4' : '1'}`;
        const mDates    = (m.dates || []).slice().sort();
        const mStart    = mDates[0] || null;
        const mEnd      = mDates[mDates.length - 1] || null;
        const isSingle  = mStart && mStart === mEnd;

        // 日付セル
        const cells = allDates.map(d => {
          const ymd = _ymd(d);
          const dow = d.getDay();

          let bar = '';
          if (mStart) {
            const inRange = mEnd ? (ymd >= mStart && ymd <= mEnd) : ymd === mStart;
            if (inRange) {
              // 期間の両端だけ角を丸め、内側の日は隣と繋げる
              const isS = isSingle || ymd === mStart;
              const isE = isSingle || ymd === mEnd;
              bar = `<div class="p-schedule__gantt-bar" style="`
                + `--bar-radius-l:${isS ? '5px' : '0'};--bar-radius-r:${isE ? '5px' : '0'};`
                + `--bar-inset-l:${isS ? '5px' : '0'};--bar-inset-r:${isE ? '5px' : '0'}"></div>`;
            }
          }

          return `<div class="p-schedule__gantt-slot${dayState(ymd, dow)}">${bar}</div>`;
        }).join('');

        return `<div data-mission-id="${m.id}" class="p-schedule__gantt-row" style="${rowVars}">
          <!-- タスク名（sticky left）-->
          <div class="p-schedule__gantt-name">
            <div class="p-schedule__gantt-name-inner">
              <div class="p-schedule__gantt-tagdot"></div>
              <span class="p-schedule__gantt-title${isCleared ? ' is-done' : ''}">${_esc(m.title)}</span>
            </div>
          </div>
          <!-- 日付バー列 -->
          <div class="p-schedule__gantt-slots">${cells}</div>
        </div>`;
      }).join('');

  // ★タスクの実施期間をガントで選ぶとき（calendar.js の 'mission'）だけ、いちばん上に「このタスク」の行を出す。
  //   各日に data-gantt-day を持たせ、bindGanttRangePicker がなぞった範囲を受け取る
  let draftHtml = '';
  if (ctx.draftRow) {
    const dd = (ctx.draftRow.dates || []).slice().sort();
    const ds = dd[0] || null, de = dd[dd.length - 1] || null;
    const cells = allDates.map(d => {
      const ymd = _ymd(d);
      const on = ds && ymd >= ds && ymd <= de;
      const isS = ymd === ds, isE = ymd === de;
      const bar = on ? `<div class="p-schedule__gantt-bar" style="`
        + `--bar-radius-l:${isS ? '5px' : '0'};--bar-radius-r:${isE ? '5px' : '0'};`
        + `--bar-inset-l:${isS ? '5px' : '0'};--bar-inset-r:${isE ? '5px' : '0'}"></div>` : '';
      return `<div class="p-schedule__gantt-slot${dayState(ymd, d.getDay())}" data-gantt-day="${ymd}">${bar}</div>`;
    }).join('');
    draftHtml = `<div class="p-schedule__gantt-row p-schedule__gantt-row--draft" data-gantt-draft
        style="--tag-color:${ctx.draftRow.color || 'var(--color-primary)'};--gantt-opacity:1">
      <div class="p-schedule__gantt-name">
        <div class="p-schedule__gantt-name-inner">
          <div class="p-schedule__gantt-tagdot"></div>
          <span class="p-schedule__gantt-title">${_esc(ctx.draftRow.title || 'このタスク')}</span>
        </div>
      </div>
      <div class="p-schedule__gantt-slots">${cells}</div>
    </div>`;
  }

  return `
    <!-- ヘッダー行（横スクロール同期、overflow:hidden）-->
    <div class="p-schedule__gantt-head">
      <!-- コーナーセル -->
      <div class="p-schedule__gantt-corner">
        <span class="p-schedule__gantt-corner-label">タスク</span>
      </div>
      <!-- 日付ヘッダー（スクロール非表示・JS同期）-->
      <div class="p-schedule__gantt-head-scroll">
        <div id="gantt-header-inner" class="p-schedule__gantt-head-inner">
          ${headerCells}
        </div>
      </div>
    </div>

    <!-- ボディ（両軸スクロール可）-->
    <div id="gantt-body" class="p-schedule__gantt-body">
      <div class="p-schedule__gantt-inner">
        ${draftHtml}
        ${missionsHtml}
      </div>
    </div>`;
}

/**
 * ガントチャートのスクロール同期（ボディ横スクロール → ヘッダー追従）
 */
function _bindGanttScroll(root) {
  const body   = root.querySelector('#gantt-body');
  const header = root.querySelector('#gantt-header-inner');
  if (!body || !header) return;
  body.addEventListener('scroll', () => {
    header.style.transform = `translateX(-${body.scrollLeft}px)`;
  });
}

/**
 * ガントチャートを今日の列が見えるよう初期スクロール
 */
function _scrollGanttToToday(root) {
  const body   = root.querySelector('#gantt-body');
  const header = root.querySelector('#gantt-header-inner');
  if (!body) return;
  // DAYS_BEFORE 列目が今日。3列分（90px）左側を見せるようにオフセット
  const scrollLeft = Math.max(0, DAYS_BEFORE * CELL_W - 90);
  body.scrollLeft = scrollLeft;
  if (header) header.style.transform = `translateX(-${scrollLeft}px)`;
}

// =====================================================
// タスク一覧セクション（カレンダービュー用）
// =====================================================
function _renderSections(ctx) {
  const sections = _buildSections(ctx.p);
  return sections.map(s => `
    <section data-mb-section="${s.matchDate || ''}" class="p-schedule__section">
      <div class="p-schedule__section-head">
        <h4 class="heading-rs p-schedule__section-title">${_esc(s.label)}</h4>
        ${s.sub ? `<span class="p-schedule__section-sub">${_esc(s.sub)}</span>` : ''}
      </div>
      ${s.missions.length === 0
        ? `<p class="p-schedule__empty">予定なし</p>`
        : s.missions.map(m => _renderMissionRow(m)).join('')}
    </section>`).join('');
}

function _renderMissionRow(m) {
  const done = m.status === 'cleared';
  return `
    <div data-mission-id="${m.id}" class="p-schedule__row">
      <span class="p-schedule__row-dot${done ? ' is-done' : ''}"></span>
      <span class="p-schedule__row-title${done ? ' is-done' : ''}">${_esc(m.title)}</span>
      ${m.tag ? `<span class="p-schedule__row-tag">${_esc(m.tag)}</span>` : ''}
    </div>`;
}

function _buildSections(p) {
  const today        = new Date();
  const todayYmd     = _ymd(today);
  const yesterdayYmd = _ymd(_addDays(today, -1));
  const tomorrowYmd  = _ymd(_addDays(today,  1));

  const next7 = [];
  for (let i = 2; i <= 7; i++) next7.push(_addDays(today, i));
  const next7YmdSet = new Set(next7.map(_ymd));

  const allProjDates = [...(p.dates || [])].sort();
  const pastDates    = allProjDates.filter(d => d < todayYmd);
  const eighthDayYmd = _ymd(_addDays(today, 8));
  const futureDates  = allProjDates.filter(d =>
    d > tomorrowYmd && !next7YmdSet.has(d) && d >= eighthDayYmd
  );

  const weekdayNames = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
  const sections = [];

  for (const d of pastDates) {
    sections.push({ label: _formatDateLabel(d), sub: '開催日', matchDate: d, missions: _missionsOnDate(p, d) });
  }
  sections.push({ label: '昨日',  sub: _formatDateLabel(yesterdayYmd), matchDate: yesterdayYmd, missions: _missionsOnDate(p, yesterdayYmd) });
  sections.push({ label: '今日',  sub: _formatDateLabel(todayYmd),     matchDate: todayYmd,     missions: _missionsOnDate(p, todayYmd) });
  sections.push({ label: '明日',  sub: _formatDateLabel(tomorrowYmd),  matchDate: tomorrowYmd,  missions: _missionsOnDate(p, tomorrowYmd) });
  for (const d of next7) {
    const ymd = _ymd(d);
    sections.push({ label: weekdayNames[d.getDay()], sub: _formatDateLabel(ymd), matchDate: ymd, missions: _missionsOnDate(p, ymd) });
  }
  for (const d of futureDates) {
    sections.push({ label: _formatDateLabel(d), sub: '開催日', matchDate: d, missions: _missionsOnDate(p, d) });
  }
  return sections;
}

function _missionsOnDate(p, ymd) {
  const filtered = (p.missions || []).filter(m => Array.isArray(m.dates) && m.dates.includes(ymd));
  return getSortedMissions(filtered);
}

// =====================================================
// スクロール（カレンダービュー用）
// =====================================================
function _scrollToSection(root, ymd, smooth) {
  const list = root.querySelector('#mb-cal-list');
  if (!list) return;
  let target = list.querySelector(`[data-mb-section="${ymd}"]`);
  if (!target) {
    const all   = Array.from(list.querySelectorAll('[data-mb-section]'));
    const after = all.find(el => el.dataset.mbSection >= ymd);
    target = after || all[all.length - 1] || null;
  }
  if (!target) return;
  const top = target.offsetTop - 8;
  if (smooth) list.scrollTo({ top, behavior: 'smooth' });
  else list.scrollTop = top;
}

// =====================================================
// ヘルパ
// =====================================================
function _ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function _formatDateLabel(ymd) {
  if (!ymd) return '';
  const [, m, d] = ymd.split('-');
  return `${parseInt(m,10)}月${parseInt(d,10)}日`;
}
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
