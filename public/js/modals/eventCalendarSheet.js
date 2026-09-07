// ===== イベントカレンダー・ガントチャート ボトムシート =====
// メインボードの「開催まで残り◯日」をタップすると開く。
// 上部のトグルで「カレンダー」「ガント」を切り替える。
//
// [カレンダービュー]
//   - 上部：月次カレンダー（固定）
//   - 下部：日付別ミッション一覧（スクロール）
//
// [ガントチャービュー]
//   - 左列：ミッション名（sticky left）
//   - 横：日付軸（横スクロール）
//   - バー：ミッションの期限をバーで表示

import { state } from '../state.js';
import { getSortedMissions, bindMissionInteractions } from './mission.js';
import { LABEL_CONFIG } from '../constants.js';

const OVERLAY_ID = 'event-cal-sheet';

// ガントチャートの定数
const CELL_W     = 30;   // 1日あたりの列幅 (px)
const NAME_W     = 116;  // ミッション名列の幅 (px)
const HEADER_H   = 46;   // ヘッダー行の高さ (px)
const ROW_H      = 38;   // ミッション行の高さ (px)
const DAYS_BEFORE = 14;  // 今日より前に表示する日数
const DAYS_AFTER  = 75;  // 今日より後に表示する日数

/**
 * ボトムシートを開く
 */
export function openEventCalendarSheet(initialView = 'calendar') {
  if (document.getElementById(OVERLAY_ID)) return;
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) return;

  const today = new Date();
  const ctx = {
    p,
    calDate: new Date(today.getFullYear(), today.getMonth(), 1),
    selectedDate: _ymd(today),
    view: initialView === 'gantt' ? 'gantt' : 'calendar', // 'calendar' | 'gantt'
    // ★開催日の編集モード。null＝閲覧中、配列＝編集中の作業コピー。
    //   確定するまで p.dates には触らない。誤タップで開催日が変わると
    //   全メンバーの予定が動くので、必ず「保存」を挟む。
    editDates: null,
  };

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  // スタイル: public/css/object/component/_overlay.css（--schedule に z-index と
  // せり上がりのアニメーションをまとめてある）
  overlay.className = 'c-overlay c-overlay--schedule c-overlay--blur';
  overlay.onclick = (e) => { if (e.target === overlay) _close(overlay); };
  document.body.appendChild(overlay);

  _render(overlay, ctx);

  // カレンダービューの初期スクロール
  requestAnimationFrame(() => {
    _scrollToSection(overlay, _ymd(today), false);
  });
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
  // ミッション詳細ページへの遷移時に「どのビューから開いたか」を参照できるようにする
  overlay.dataset.calView = ctx.view;

  // ★ガントの寸法は JS の定数が正。CSS には custom property で渡す
  //   （スクロール位置の計算にも同じ値を使うため、二重に持たせない）。
  const ganttVars = `--gantt-cell-w:${CELL_W}px;--gantt-name-w:${NAME_W}px;`
    + `--gantt-header-h:${HEADER_H}px;--gantt-row-h:${ROW_H}px;`
    + `--gantt-content-w:${(DAYS_BEFORE + DAYS_AFTER + 1) * CELL_W}px;`;

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
        ${isCalendar ? _renderCalendarView(ctx) : _renderGanttView(ctx)}
      </div>
    </div>`;

  // 下スワイプで閉じる（sheet.js）→ _close 経由で state.render() を確実に呼ぶ
  const _sheetEl = overlay.querySelector('[data-sheet]');
  if (_sheetEl) _sheetEl.__sheetClose = () => _close(overlay);

  _bindAllEvents(overlay, ctx);

  // ミッション行：タップ＝完了モーダル（完了可の場合）、管理者長押し＝編集/削除メニュー
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
    requestAnimationFrame(() => _scrollToSection(overlay, _ymd(new Date()), false));
  });
  overlay.querySelector('#btn-view-gantt')?.addEventListener('click', () => {
    if (ctx.view === 'gantt') return;
    ctx.view = 'gantt';
    _render(overlay, ctx);
    requestAnimationFrame(() => _scrollGanttToToday(overlay));
  });

  if (ctx.view === 'calendar') {
    _bindCalendarEvents(overlay, ctx);
  } else {
    _bindGanttScroll(overlay);
    requestAnimationFrame(() => _scrollGanttToToday(overlay));
  }
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
    <!-- ミッション一覧（スクロール）-->
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
    } else if (dateStr === ctx.selectedDate) state = ' is-selected';
    else if (projDates.has(dateStr))         state = ' is-project';
    else if (dateStr === todayYmd)           state = ' is-today';

    cells += `<div data-mb-day="${dateStr}" class="p-schedule__day${state}">${d}</div>`;
  }

  return `
    <div class="p-schedule__cal-nav">
      <button id="mb-cal-prev" class="p-schedule__cal-arrow">
        <img src="/images/icon/iocn-Chevron.svg" class="p-schedule__cal-arrow-icon">
      </button>
      <h3 class="heading-r p-schedule__section-title">${year}年 ${month + 1}月</h3>
      <button id="mb-cal-next" class="p-schedule__cal-arrow">
        <img src="/images/icon/iocn-Chevron.svg" class="p-schedule__cal-arrow-icon p-schedule__cal-arrow-icon--next">
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
          <img src="/images/icon/icon-Calender.svg" alt="" class="p-schedule__cal-edit-icon">
          ${projDates.size > 0 ? '開催日を編集' : '開催日を設定'}
        </button>` : ''}
    `}`;
}

function _bindCalendarEvents(overlay, ctx) {
  overlay.querySelector('#mb-cal-prev')?.addEventListener('click', () => {
    ctx.calDate = new Date(ctx.calDate.getFullYear(), ctx.calDate.getMonth() - 1, 1);
    _renderCalendarOnly(overlay, ctx);
  });
  overlay.querySelector('#mb-cal-next')?.addEventListener('click', () => {
    ctx.calDate = new Date(ctx.calDate.getFullYear(), ctx.calDate.getMonth() + 1, 1);
    _renderCalendarOnly(overlay, ctx);
  });
  // ── 開催日の編集モード ────────────────────────────────
  // ★誤タップで開催日が変わると全メンバーの予定が動くので、通常は閲覧専用。
  //   明示的に編集モードへ入り、「保存」を押したときだけ確定する。
  overlay.querySelector('#mb-dates-edit')?.addEventListener('click', () => {
    if (!state.canManageCurrentEvent()) return;
    ctx.editDates = [...(ctx.p.dates || [])].sort();   // ★作業コピー。p.dates は触らない
    _renderCalendarOnly(overlay, ctx);
  });
  overlay.querySelector('#mb-dates-cancel')?.addEventListener('click', () => {
    ctx.editDates = null;                              // 破棄するだけ
    _renderCalendarOnly(overlay, ctx);
  });
  overlay.querySelector('#mb-dates-save')?.addEventListener('click', () => {
    if (!state.canManageCurrentEvent()) { ctx.editDates = null; return; }
    ctx.p.dates = [...(ctx.editDates || [])];
    ctx.editDates = null;
    // ★確定処理は state 側に集約されている（ソート・daysLeft・dateTimes の後始末・保存）。
    //   イベント設定やアーカイブのペンからの変更と同じ経路を通すこと。
    //   ここに同じ処理を書き写すと、片方だけ直したときに挙動がずれる。
    state.commitEventDatesEdit();
    _renderCalendarContent(overlay, ctx);
    state.render();                                    // ヘッダーの「残り◯日」も更新する
  });

  if (Array.isArray(ctx.editDates)) {
    _bindDateEditDrag(overlay, ctx);
    return;                                            // ★編集中は閲覧用のタップを配線しない
  }

  overlay.querySelectorAll('[data-mb-day]').forEach(el => {
    el.addEventListener('click', () => {
      const dateStr = el.dataset.mbDay;
      ctx.selectedDate = dateStr;
      // 閲覧中は日付を変えない。セクションへのスクロールだけ行う
      _renderCalendarOnly(overlay, ctx);
      _scrollToSection(overlay, dateStr, true);
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
function _bindDateEditDrag(overlay, ctx) {
  const grid = overlay.querySelector('#mb-cal-days');
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
    // ★カレンダー領域に限定して引く。overlay 全体から引くと、
    //   下のミッション一覧に同じクラスが出たときに別物を書き換えてしまう。
    const note = overlay.querySelector('#mb-cal-fixed .p-schedule__cal-note');
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

function _renderCalendarOnly(overlay, ctx) {
  const cont = overlay.querySelector('#mb-cal-fixed');
  if (!cont) return;
  cont.innerHTML = _renderCalendar(ctx);
  _bindCalendarEvents(overlay, ctx);
}

function _renderCalendarContent(overlay, ctx) {
  const cont = overlay.querySelector('#mb-cal-fixed');
  const list = overlay.querySelector('#mb-cal-list');
  if (cont) { cont.innerHTML = _renderCalendar(ctx); _bindCalendarEvents(overlay, ctx); }
  if (list) list.innerHTML = _renderSections(ctx);
}

// ミッションの最初のタグ名からカラーコードを解決する
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
  const missions   = getSortedMissions(ctx.p.missions || []);

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

  // ── ミッション行 ────────────────────────────────
  const missionsHtml = missions.length === 0
    ? `<div class="p-schedule__gantt-empty">ミッションがありません</div>`
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
          <!-- ミッション名（sticky left）-->
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

  return `
    <!-- ヘッダー行（横スクロール同期、overflow:hidden）-->
    <div class="p-schedule__gantt-head">
      <!-- コーナーセル -->
      <div class="p-schedule__gantt-corner">
        <span class="p-schedule__gantt-corner-label">ミッション</span>
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
        ${missionsHtml}
      </div>
    </div>`;
}

/**
 * ガントチャートのスクロール同期（ボディ横スクロール → ヘッダー追従）
 */
function _bindGanttScroll(overlay) {
  const body   = overlay.querySelector('#gantt-body');
  const header = overlay.querySelector('#gantt-header-inner');
  if (!body || !header) return;
  body.addEventListener('scroll', () => {
    header.style.transform = `translateX(-${body.scrollLeft}px)`;
  });
}

/**
 * ガントチャートを今日の列が見えるよう初期スクロール
 */
function _scrollGanttToToday(overlay) {
  const body   = overlay.querySelector('#gantt-body');
  const header = overlay.querySelector('#gantt-header-inner');
  if (!body) return;
  // DAYS_BEFORE 列目が今日。3列分（90px）左側を見せるようにオフセット
  const scrollLeft = Math.max(0, DAYS_BEFORE * CELL_W - 90);
  body.scrollLeft = scrollLeft;
  if (header) header.style.transform = `translateX(-${scrollLeft}px)`;
}

// =====================================================
// ミッション一覧セクション（カレンダービュー用）
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
function _scrollToSection(overlay, ymd, smooth) {
  const list = overlay.querySelector('#mb-cal-list');
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
