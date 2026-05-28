// ===== プロジェクトカレンダー・ガントチャート ボトムシート =====
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
import { getSortedMissions } from './mission.js';

const OVERLAY_ID = 'proj-cal-sheet';

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
export function openProjectCalendarSheet() {
  if (document.getElementById(OVERLAY_ID)) return;
  const p = state.projects.find(x => x.id === state.selectedProjectId);
  if (!p) return;

  const today = new Date();
  const ctx = {
    p,
    calDate: new Date(today.getFullYear(), today.getMonth(), 1),
    selectedDate: _ymd(today),
    view: 'calendar', // 'calendar' | 'gantt'
  };

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm';
  overlay.style.animation = 'fadeIn .2s ease-out';
  overlay.onclick = (e) => { if (e.target === overlay) _close(overlay); };
  document.body.appendChild(overlay);

  _render(overlay, ctx);

  // カレンダービューの初期スクロール
  requestAnimationFrame(() => {
    _scrollToSection(overlay, _ymd(today), false);
  });
}

function _close(overlay) {
  if (overlay && overlay.parentNode) overlay.remove();
}

// =====================================================
// メインレンダリング
// =====================================================
function _render(overlay, ctx) {
  const isCalendar = ctx.view === 'calendar';

  overlay.innerHTML = `
    <div class="absolute bottom-0 left-0 right-0 bg-[#FDFBF8] rounded-t-3xl shadow-2xl flex flex-col"
         style="max-height: 90vh; animation: slideUp .25s ease-out;">

      <!-- ドラッグハンドル -->
      <div class="flex justify-center pt-3 pb-2 flex-shrink-0">
        <div class="w-12 h-1.5 bg-[#D3D6D8] rounded-full"></div>
      </div>

      <!-- ビュー切り替えトグル -->
      <div class="flex items-center justify-between px-5 pb-3 flex-shrink-0">
        <h2 class="text-[14px] font-bold text-[#484545]">スケジュール</h2>
        <div class="flex bg-[#E1DFDC] rounded-full p-0.5 gap-0.5">
          <button id="btn-view-calendar"
            class="px-4 py-1.5 rounded-full text-[12px] font-bold transition-all
            ${isCalendar ? 'bg-white text-[#484545] shadow-sm' : 'text-[#A7AAAC]'}">
            カレンダー
          </button>
          <button id="btn-view-gantt"
            class="px-4 py-1.5 rounded-full text-[12px] font-bold transition-all
            ${!isCalendar ? 'bg-white text-[#484545] shadow-sm' : 'text-[#A7AAAC]'}">
            ガント
          </button>
        </div>
      </div>

      <!-- コンテンツ -->
      <div class="flex flex-col flex-1 overflow-hidden">
        ${isCalendar ? _renderCalendarView(ctx) : _renderGanttView(ctx)}
      </div>
    </div>
    <style>
      @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
    </style>`;

  _bindAllEvents(overlay, ctx);
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
    <div id="mb-cal-fixed" class="px-5 pb-4 border-b border-[#E1DFDC] flex-shrink-0">
      ${_renderCalendar(ctx)}
    </div>
    <!-- ミッション一覧（スクロール）-->
    <div id="mb-cal-list" class="flex-1 overflow-y-auto px-5 py-4 space-y-5"
         style="overscroll-behavior: contain;">
      ${_renderSections(ctx)}
    </div>`;
}

function _renderCalendar(ctx) {
  const year     = ctx.calDate.getFullYear();
  const month    = ctx.calDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const todayYmd = _ymd(new Date());
  const projDates = new Set(ctx.p.dates || []);

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<div class="h-9"></div>';
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isSel   = dateStr === ctx.selectedDate;
    const isToday = dateStr === todayYmd;
    const isProj  = projDates.has(dateStr);

    let cls   = 'h-9 w-full flex items-center justify-center rounded-lg cursor-pointer text-[12px] font-bold select-none transition-colors';
    let style = '';
    if (isSel)        { cls += ' text-white shadow-md'; style = 'background-color:#0CA1E3;'; }
    else if (isProj)  { cls += ' text-[#0CA1E3]'; style = 'background-color:#E1F4FC;'; }
    else if (isToday) { cls += ' text-[#0CA1E3] ring-1 ring-[#0CA1E3]'; }
    else              { cls += ' bg-white text-[#484545] active:bg-[#FDFBF8]'; }

    cells += `<div data-mb-day="${dateStr}" class="${cls}" style="${style}">${d}</div>`;
  }

  return `
    <div class="flex items-center justify-between mb-2">
      <button id="mb-cal-prev" class="p-1.5 bg-white rounded-full active:scale-95 border border-[#E1DFDC]">
        <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 brightness-0 opacity-50">
      </button>
      <h3 class="heading-r text-[#484545] font-bold">${year}年 ${month + 1}月</h3>
      <button id="mb-cal-next" class="p-1.5 bg-white rounded-full active:scale-95 border border-[#E1DFDC]">
        <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 rotate-180 brightness-0 opacity-50">
      </button>
    </div>
    <div class="grid grid-cols-7 gap-1 mb-1 text-center text-[9px] text-[#A7AAAC] font-bold">
      ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
    </div>
    <div class="grid grid-cols-7 gap-1">${cells}</div>`;
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
  overlay.querySelectorAll('[data-mb-day]').forEach(el => {
    el.addEventListener('click', () => {
      ctx.selectedDate = el.dataset.mbDay;
      _renderCalendarOnly(overlay, ctx);
      _scrollToSection(overlay, ctx.selectedDate, true);
    });
  });
}

function _renderCalendarOnly(overlay, ctx) {
  const cont = overlay.querySelector('#mb-cal-fixed');
  if (!cont) return;
  cont.innerHTML = _renderCalendar(ctx);
  _bindCalendarEvents(overlay, ctx);
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
  const barColors  = { cleared: '#9EDF05', pending_leader_check: '#FFC300', yet: '#0CA1E3' };
  const contentW   = TOTAL * CELL_W;

  // ── ヘッダー日付セル ──────────────────────────────
  let prevMonth = -1;
  const headerCells = allDates.map(d => {
    const ymd    = _ymd(d);
    const isToday = ymd === todayYmd;
    const isProj  = projDates.has(ymd);
    const dow     = d.getDay(); // 0=日
    const month   = d.getMonth();
    const isFirst = d.getDate() === 1;

    let bg = '';
    if (isToday)     bg = 'background:rgba(12,161,227,0.14);';
    else if (isProj) bg = 'background:rgba(207,216,255,0.55);';
    else if (dow === 0) bg = 'background:rgba(255,180,180,0.18);';
    else if (dow === 6) bg = 'background:rgba(190,210,255,0.18);';

    const numCol = isToday ? '#0CA1E3' : dow === 0 ? '#EE3E12' : dow === 6 ? '#5C6BC0' : '#484545';
    const dayCol = dow === 0 ? '#EE3E12' : dow === 6 ? '#5C6BC0' : '#A7AAAC';
    const weekJa = ['日','月','火','水','木','金','土'][dow];
    const showM  = isFirst || prevMonth !== month;
    prevMonth = month;

    return `<div style="width:${CELL_W}px;flex-shrink:0;height:${HEADER_H}px;
      display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
      padding-bottom:4px;border-left:1px solid #E1DFDC;${bg}">
      <span style="font-size:7px;line-height:1;color:#A7AAAC;font-weight:700;height:10px;display:flex;align-items:center;">
        ${showM ? (month+1)+'月' : ''}
      </span>
      <span style="font-size:10px;font-weight:700;line-height:1.2;color:${numCol};">${d.getDate()}</span>
      <span style="font-size:7px;line-height:1;color:${dayCol};font-weight:700;">${weekJa}</span>
    </div>`;
  }).join('');

  // ── ミッション行 ────────────────────────────────
  const missionsHtml = missions.length === 0
    ? `<div style="padding:28px 16px;text-align:center;font-size:12px;color:#A7AAAC;">ミッションがありません</div>`
    : missions.map(m => {
        const barColor = barColors[m.status] || '#0CA1E3';
        const isCleared = m.status === 'cleared';
        const opacity   = isCleared ? 0.4 : 1;
        const mDates    = (m.dates || []).slice().sort();
        const mStart    = mDates[0] || null;
        const mEnd      = mDates[mDates.length - 1] || null;
        const isSingle  = mStart && mStart === mEnd;

        // 日付セル
        const cells = allDates.map(d => {
          const ymd    = _ymd(d);
          const isToday = ymd === todayYmd;
          const isProj  = projDates.has(ymd);
          const dow     = d.getDay();

          let bg = '';
          if (isToday)     bg = 'background:rgba(12,161,227,0.06);';
          else if (isProj) bg = 'background:rgba(207,216,255,0.22);';
          else if (dow === 0) bg = 'background:rgba(255,180,180,0.06);';
          else if (dow === 6) bg = 'background:rgba(190,210,255,0.06);';

          let bar = '';
          if (mStart) {
            const inRange = mEnd ? (ymd >= mStart && ymd <= mEnd) : ymd === mStart;
            if (inRange) {
              const isS = ymd === mStart;
              const isE = ymd === mEnd;
              const rL  = (isSingle || isS) ? '5px' : '0';
              const rR  = (isSingle || isE) ? '5px' : '0';
              const ml  = (isSingle || isS) ? '5px' : '0';
              const mr  = (isSingle || isE) ? '5px' : '0';
              bar = `<div style="height:10px;background:${barColor};opacity:${opacity};
                border-radius:${rL} ${rR} ${rR} ${rL};
                margin-left:${ml};margin-right:${mr};flex:1;"></div>`;
            }
          }

          return `<div style="width:${CELL_W}px;flex-shrink:0;height:${ROW_H}px;
            border-left:1px solid #E1DFDC;display:flex;align-items:center;${bg}">
            ${bar}
          </div>`;
        }).join('');

        const titleStyle = isCleared
          ? 'opacity:0.45;text-decoration:line-through;'
          : '';

        return `<div style="display:flex;align-items:stretch;border-bottom:1px solid #E1DFDC;">
          <!-- ミッション名（sticky left）-->
          <div style="width:${NAME_W}px;flex-shrink:0;position:sticky;left:0;z-index:10;
            background:#FDFBF8;border-right:1px solid #E1DFDC;
            display:flex;align-items:center;padding:0 8px;min-height:${ROW_H}px;">
            <div style="display:flex;align-items:center;gap:5px;width:100%;overflow:hidden;">
              <div style="width:7px;height:7px;border-radius:3.5px;flex-shrink:0;
                background:${barColor};opacity:${opacity};"></div>
              <span style="font-size:10px;font-weight:700;color:#484545;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                max-width:${NAME_W - 26}px;${titleStyle}">${_esc(m.title)}</span>
            </div>
          </div>
          <!-- 日付バー列 -->
          <div style="display:flex;">${cells}</div>
        </div>`;
      }).join('');

  return `
    <!-- ヘッダー行（横スクロール同期、overflow:hidden）-->
    <div style="display:flex;flex-shrink:0;border-bottom:2px solid #D3D6D8;background:#FDFBF8;">
      <!-- コーナーセル -->
      <div style="width:${NAME_W}px;flex-shrink:0;height:${HEADER_H}px;
        border-right:1px solid #E1DFDC;
        display:flex;align-items:flex-end;padding:0 8px 6px;">
        <span style="font-size:10px;color:#A7AAAC;font-weight:700;">ミッション</span>
      </div>
      <!-- 日付ヘッダー（スクロール非表示・JS同期）-->
      <div style="overflow:hidden;flex:1;">
        <div id="gantt-header-inner" style="display:flex;width:${contentW}px;">
          ${headerCells}
        </div>
      </div>
    </div>

    <!-- ボディ（両軸スクロール可）-->
    <div id="gantt-body" style="flex:1;overflow:auto;overscroll-behavior:contain;">
      <div style="min-width:${NAME_W + contentW}px;">
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
    <section data-mb-section="${s.matchDate || ''}" class="scroll-mt-2">
      <div class="flex items-baseline gap-2 mb-2 pb-1 border-b border-[#E1DFDC]">
        <h4 class="heading-rs text-[#484545] font-bold">${_esc(s.label)}</h4>
        ${s.sub ? `<span class="text-[10px] text-[#A7AAAC] font-bold">${_esc(s.sub)}</span>` : ''}
      </div>
      ${s.missions.length === 0
        ? `<p class="text-[11px] text-[#A7AAAC] py-1">予定なし</p>`
        : s.missions.map(m => _renderMissionRow(m)).join('')}
    </section>`).join('');
}

function _renderMissionRow(m) {
  return `
    <div onclick="window._app.openClearMissionModal('${m.id}')"
      class="bg-white border border-[#D3D6D8] rounded-xl px-3 py-2.5 mb-2 flex items-center gap-2.5 active:bg-[#FDFBF8] cursor-pointer transition-colors">
      <span class="inline-block w-1.5 h-1.5 rounded-full ${m.status === 'cleared' ? 'bg-[#9EDF05]' : 'bg-[#FFC300]'}"></span>
      <span class="text-[13px] text-[#484545] font-bold flex-1 truncate ${m.status === 'cleared' ? 'line-through opacity-60' : ''}">${_esc(m.title)}</span>
      ${m.tag ? `<span class="text-[9px] text-[#A7AAAC] font-bold">${_esc(m.tag)}</span>` : ''}
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
