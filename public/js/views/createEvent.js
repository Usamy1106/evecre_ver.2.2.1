// ===== イベント作成画面（3ステップ）=====
// ステップ1: イベント名・説明
// ステップ2: 開催日時
// ステップ3: 招待リンク発行（画面到達時に自動でイベント作成＋招待リンク発行）
//
// 種は addEvent 内でランダム自動選択（ユーザー選択は廃止）。

import { state } from '../state.js';
import { api } from '../api.js';
import { Components } from '../components.js';
import { getConsecutiveGroups } from '../utils.js';

// =====================================================
// ステップ1: イベント名・説明
// =====================================================
export function renderCreateEventInfo(container) {
  const canNext = !!state.draftEvent.name;

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      <header class="px-6 pt-10 pb-8 text-center">
        <h1 class="heading-l text-[#0CA1E3]">新規イベントの作成</h1>
      </header>
      <main class="flex-1 px-8 pt-2 pb-12 flex flex-col page-transition items-center">
        <div class="w-full space-y-6 mb-12">
          <div>
            <label class="heading-rs block mb-2 text-[#484545]">イベント名</label>
            <input type="text" placeholder="イベント名を入力"
              value="${_esc(state.draftEvent.name)}"
              oninput="window._app.updateDraftInfo('name', this.value)"
              class="input-field w-full px-5 py-4 focus:outline-none">
          </div>
          <div>
            <label class="heading-rs block mb-2 text-[#484545]">イベントの説明 <span class="text-[#A7AAAC] text-[11px]">（任意）</span></label>
            <textarea placeholder="イベントの説明を入力" rows="4"
              oninput="window._app.updateDraftInfo('description', this.value)"
              class="input-field w-full px-5 py-4 focus:outline-none resize-none">${_esc(state.draftEvent.description)}</textarea>
          </div>
        </div>
        <div class="mt-auto w-full max-w-sm space-y-3">
          ${Components.StepIndicator(1)}
          <button id="cp-info-next" onclick="window._app.tryProceedFromInfo()"
            class="btn-primary w-full py-5 heading-m font-bold shadow-lg" ${canNext ? '' : 'disabled style="opacity:.5"'}>次へ</button>
          <button onclick="window._app.setView('HOME')"
            class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]">戻る</button>
        </div>
      </main>
    </div>`;
}

// =====================================================
// ステップ2: 開催日時（インラインカレンダー）
// =====================================================

// カレンダー表示用の状態（このステップ画面でのみ使う）
const _cpCal = {
  date: new Date(),
};

// ドラッグ選択用の状態
const _drag = {
  active: false,
  mode: null,    // 'add' | 'remove'  ドラッグ開始時の最初のセルの状態で決まる
  visited: null, // Set
};

export function renderCreateEventDates(container) {
  const groups   = getConsecutiveGroups(state.draftEvent.dates);
  const canNext  = true; // 開催日時は任意

  const year      = _cpCal.date.getFullYear();
  const month     = _cpCal.date.getMonth();
  const firstDay  = new Date(year, month, 1).getDay();
  const lastDate  = new Date(year, month + 1, 0).getDate();
  const selected  = state.draftEvent.dates;

  // 日付セル: 選択時は --create-red 色
  let cellsHtml = '';
  for (let i = 0; i < firstDay; i++) cellsHtml += `<div class="h-10"></div>`;
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSel   = selected.includes(dateStr);
    cellsHtml += `
      <div data-cp-day="${dateStr}"
        class="h-10 w-full flex items-center justify-center rounded-lg cursor-pointer transition-colors text-[13px] font-bold select-none
        ${isSel ? 'text-white shadow-md' : 'bg-white text-[#484545] active:bg-[#FDFBF8]'}"
        style="${isSel ? 'background-color: var(--create-red);' : ''} touch-action: none; -webkit-user-select: none; user-select: none;">${d}</div>`;
  }

  // 選択済み日付（個別削除付き）
  const selectedListHtml = groups.length === 0
    ? `<p class="text-[11px] text-[#A7AAAC] text-center py-2">日付が選択されていません</p>`
    : groups.map((g, i) => {
        const label = g[0] === g[g.length - 1] ? g[0] : `${g[0]}〜${g[g.length - 1]}`;
        const groupJson = encodeURIComponent(JSON.stringify(g));
        return `
          <div class="inline-flex items-center gap-1 bg-white border border-[#D3D6D8] pl-3 pr-1 py-1 rounded-full shadow-sm animate-fadeIn">
            <span class="text-[11px] text-[#484545] font-bold">${label}</span>
            <button data-cp-remove-group="${groupJson}" class="p-1 opacity-50 active:opacity-100">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>`;
      }).join('');

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      <header class="px-6 pt-10 pb-8 text-center">
        <h1 class="heading-l text-[#0CA1E3]">新規イベントの作成</h1>
      </header>
      <main class="flex-1 px-6 pt-2 pb-12 flex flex-col page-transition items-center">
        <h2 class="heading-m mb-2 text-[#484545] font-bold">開催日時 <span class="text-[#A7AAAC] text-[11px]">（任意）</span></h2>
        <p class="text-[11px] text-[#A7AAAC] font-bold text-center mb-4">
          タップまたはスライドで複数日選択<br>
          後から設定することもできます
        </p>

        <!-- カレンダー -->
        <div class="bg-white rounded-2xl shadow-sm border border-[#E1DFDC] p-4 w-full max-w-sm mb-4">
          <div class="flex items-center justify-between mb-2">
            <button id="cp-cal-prev" class="p-2 bg-[#FDFBF8] rounded-full active:scale-95">
              <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 brightness-0 opacity-50">
            </button>
            <h3 class="heading-r text-[#484545] font-bold">${year}年 ${month + 1}月</h3>
            <button id="cp-cal-next" class="p-2 bg-[#FDFBF8] rounded-full active:scale-95">
              <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 rotate-180 brightness-0 opacity-50">
            </button>
          </div>
          <div class="grid grid-cols-7 gap-1 mb-2 text-center text-[10px] text-[#A7AAAC] font-bold">
            ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
          </div>
          <div id="cp-cal-grid" class="grid grid-cols-7 gap-1">${cellsHtml}</div>
        </div>

        <!-- 選択済みの日付（タグ表示・×で削除） -->
        <div class="w-full max-w-sm mb-2">
          <p class="text-[10px] text-[#A7AAAC] font-bold mb-2">選択中の日付</p>
          <div class="flex flex-wrap gap-2">${selectedListHtml}</div>
        </div>

        <div class="mt-auto w-full max-w-sm space-y-3 pt-6">
          ${Components.StepIndicator(2)}
          <button id="cp-dates-next" onclick="window._app.tryProceedFromDates()"
            class="btn-primary w-full py-5 heading-m font-bold shadow-lg" ${canNext ? '' : 'disabled style="opacity:.5"'}>次へ</button>
          <button onclick="window._app.setView('CREATE_EVENT_INFO')"
            class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]">戻る</button>
        </div>
      </main>
    </div>`;

  // 月切替
  document.getElementById('cp-cal-prev')?.addEventListener('click', () => {
    _cpCal.date = new Date(year, month - 1, 1);
    state.render();
  });
  document.getElementById('cp-cal-next')?.addEventListener('click', () => {
    _cpCal.date = new Date(year, month + 1, 1);
    state.render();
  });

  // タグの×で連続グループを削除
  container.querySelectorAll('[data-cp-remove-group]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const group = JSON.parse(decodeURIComponent(el.dataset.cpRemoveGroup));
        state.draftEvent.dates = state.draftEvent.dates.filter(d => !group.includes(d));
        state.render();
      } catch (_) {}
    });
  });

  // タップ＋ドラッグ選択
  _bindCalendarDrag(container);
}

/**
 * カレンダーのタップ＋ドラッグ選択処理
 * - タップ：単発で選択トグル
 * - ドラッグ：開始セルの状態で「追加モード」or「削除モード」を決定し、通過したセルにそのモードを適用
 */
function _bindCalendarDrag(container) {
  const grid = document.getElementById('cp-cal-grid');
  if (!grid) return;

  const cellAt = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    return el.closest('[data-cp-day]');
  };

  const setCell = (dateStr, on) => {
    const arr = state.draftEvent.dates;
    const idx = arr.indexOf(dateStr);
    if (on && idx === -1) { arr.push(dateStr); arr.sort(); }
    else if (!on && idx !== -1) { arr.splice(idx, 1); }
  };

  const updateAppearance = () => {
    // 軽量に：レンダリングし直さず、各セルのスタイルだけ更新
    const selected = state.draftEvent.dates;
    grid.querySelectorAll('[data-cp-day]').forEach(cell => {
      const isSel = selected.includes(cell.dataset.cpDay);
      cell.className = `h-10 w-full flex items-center justify-center rounded-lg cursor-pointer transition-colors text-[13px] font-bold select-none ${isSel ? 'text-white shadow-md' : 'bg-white text-[#484545] active:bg-[#FDFBF8]'}`;
      cell.style.cssText = `${isSel ? 'background-color: var(--create-red);' : ''} touch-action: none; -webkit-user-select: none; user-select: none;`;
    });
  };

  const onDown = (clientX, clientY) => {
    const cell = cellAt(clientX, clientY);
    if (!cell) return;
    const dateStr = cell.dataset.cpDay;
    const wasSelected = state.draftEvent.dates.includes(dateStr);
    _drag.active = true;
    _drag.mode = wasSelected ? 'remove' : 'add';
    _drag.visited = new Set([dateStr]);
    setCell(dateStr, _drag.mode === 'add');
    updateAppearance();
  };

  const onMove = (clientX, clientY) => {
    if (!_drag.active) return;
    const cell = cellAt(clientX, clientY);
    if (!cell) return;
    const dateStr = cell.dataset.cpDay;
    if (_drag.visited.has(dateStr)) return;
    _drag.visited.add(dateStr);
    setCell(dateStr, _drag.mode === 'add');
    updateAppearance();
  };

  const onUp = () => {
    if (!_drag.active) return;
    _drag.active = false;
    _drag.mode = null;
    _drag.visited = null;
    // 全画面再描画して選択済みタグも更新
    state.render();
  };

  // マウス
  grid.addEventListener('mousedown', e => { e.preventDefault(); onDown(e.clientX, e.clientY); });
  document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  document.addEventListener('mouseup', onUp);

  // タッチ
  grid.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    onDown(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  grid.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  grid.addEventListener('touchend', onUp);
  grid.addEventListener('touchcancel', onUp);
}

// =====================================================
// ステップ3: 招待リンク発行（画面到達と同時に自動で作成＋発行）
// =====================================================
export function renderCreateEventInvite(container) {
  const sec = state.createEventInviteScreen || (state.createEventInviteScreen = {});

  // この画面に着いた瞬間にイベント作成＋招待リンク発行を開始
  // (まだ実行していなければ)
  if (!sec.inviteUrl && !sec.creating && !sec.error) {
    sec.creating = true;
    _createAndIssueInvite();
  }

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      <header class="px-6 pt-10 pb-8 text-center">
        <h1 class="heading-l text-[#0CA1E3]">新規イベントの作成</h1>
      </header>
      <main class="flex-1 px-8 pt-2 pb-12 flex flex-col items-center page-transition">
        <h2 class="heading-m mb-6 text-[#484545] font-bold">チームメンバーを招待</h2>

        ${sec.creating ? _renderCreating()
          : sec.error    ? _renderError(sec.error)
                         : _renderShare(sec.inviteUrl)}

        <div class="mt-auto w-full max-w-sm space-y-3 pt-8">
          ${Components.StepIndicator(3)}
          ${sec.inviteUrl ? `
            <button id="cpi-finish"
              class="btn-primary w-full py-5 heading-m font-bold shadow-lg">イベント画面へ</button>
          ` : sec.error ? `
            <button id="cpi-retry"
              class="btn-primary w-full py-5 heading-m font-bold shadow-lg">もう一度試す</button>
          ` : ''}
          <button onclick="window._app.setView('CREATE_EVENT_DATES')"
            class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]" ${sec.creating ? 'disabled style="opacity:.5"' : ''}>戻る</button>
        </div>
      </main>
    </div>`;

  document.getElementById('cpi-finish')?.addEventListener('click', _finishAndGoToEvent);
  document.getElementById('cpi-retry')?.addEventListener('click', () => {
    sec.error = null;
    sec.creating = true;
    state.render();
    _createAndIssueInvite();
  });
  document.querySelectorAll('[data-line-share]').forEach(el =>
    el.addEventListener('click', () => _shareToLine(el.dataset.lineShare))
  );
  document.querySelectorAll('[data-copy]').forEach(el =>
    el.addEventListener('click', () => _copyText(el.dataset.copy))
  );
  document.querySelectorAll('[data-native-share]').forEach(el =>
    el.addEventListener('click', () => _nativeShare(el.dataset.nativeShare))
  );
}

function _renderCreating() {
  return `
    <div class="w-full max-w-sm flex flex-col items-center py-12">
      <div class="w-12 h-12 border-4 border-[#0CA1E3] border-t-transparent rounded-full animate-spin mb-4"></div>
      <p class="text-[13px] text-[#484545] font-bold">イベントを作成中…</p>
    </div>`;
}

function _renderError(msg) {
  return `
    <div class="w-full max-w-sm py-8">
      <p class="text-[40px] text-center mb-3">⚠️</p>
      <p class="text-[14px] text-[#484545] font-bold text-center mb-2">作成に失敗しました</p>
      <p class="text-[12px] text-[#A7AAAC] font-bold text-center">${_esc(msg)}</p>
    </div>`;
}

function _renderShare(url) {
  return `
    <p class="text-[12px] text-[#0CA1E3] font-bold text-center mb-2">✓ イベントを作成しました</p>
    <p class="text-[12px] text-[#A7AAAC] font-bold text-center leading-relaxed mb-4">
      下のリンクをメンバーに送って<br>
      参加してもらいましょう
    </p>
    <div class="bg-white border border-[#D3D6D8] p-3 rounded-xl shadow-sm w-full max-w-sm mb-3">
      <p class="text-[10px] text-[#A7AAAC] font-bold mb-1.5 text-center">招待リンク</p>
      <p class="text-[10px] font-mono text-[#484545] text-center break-all">${_esc(url)}</p>
    </div>
    <div class="grid grid-cols-1 gap-2 w-full max-w-sm">
      <button data-line-share="${_esc(url)}"
        class="flex items-center justify-center gap-2 bg-[#06C755] text-white px-6 py-3 rounded-full font-bold shadow-lg active:scale-95 transition-transform">
        LINE で送る
      </button>
      <div class="grid grid-cols-2 gap-2">
        <button data-native-share="${_esc(url)}"
          class="bg-[#0CA1E3] text-white py-3 rounded-full font-bold text-[13px] active:scale-95 transition-transform">
          他のアプリで共有
        </button>
        <button data-copy="${_esc(url)}"
          class="bg-white border border-[#0CA1E3] text-[#0CA1E3] py-3 rounded-full font-bold text-[13px] active:scale-95 transition-transform">
          コピー
        </button>
      </div>
    </div>`;
}

async function _createAndIssueInvite() {
  const sec = state.createEventInviteScreen;
  try {
    const eventId = await state._createEventAndReturnId();
    if (!eventId) {
      sec.creating = false;
      sec.error = 'イベント名・説明・開催日時を確認してください';
      state.render();
      return;
    }

    const r = await api.createInvite(eventId);
    if (!r.ok) {
      sec.creating = false;
      sec.error = '招待リンクの発行に失敗しました';
      sec.eventId = eventId;
      state.render();
      return;
    }

    // 招待リンク発行成功 → 共有画面を表示してユーザーの操作を待つ
    sec.creating = false;
    sec.inviteUrl = `${window.location.origin}/invite/${r.invite.token}`;
    sec.eventId   = eventId;
    state.render();
  } catch (e) {
    console.error('イベント作成エラー:', e);
    sec.creating = false;
    sec.error = 'ネットワークエラーが発生しました';
    state.render();
  }
}

function _finishAndGoToEvent() {
  const sec = state.createEventInviteScreen || {};
  const id = sec.eventId;
  state.createEventInviteScreen = {};
  // draftEvent もリセット
  state.draftEvent = { name: '', description: '', dates: [], seedType: 'jack' };
  if (id) {
    state.setView('MAIN_BOARD', id);
  } else {
    state.setView('HOME');
  }
}

// ----- 共有ヘルパ -----

function _buildInviteText(url) {
  const draft = state.draftEvent || {};
  const eventName = draft.name || 'イベント';
  const userName = state.currentUser?.username || '';
  return userName
    ? `${userName}が「${eventName}」に招待しています。\n${url}`
    : `「${eventName}」に招待しています。\n${url}`;
}

function _shareToLine(url) {
  const text = _buildInviteText(url);
  const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  window.open(lineUrl, '_blank', 'noopener,noreferrer');
}

function _nativeShare(url) {
  const text = _buildInviteText(url);
  const data = { title: 'イベントへの招待', text, url };
  if (navigator.share && navigator.canShare?.(data)) {
    navigator.share(data).catch(err => { if (err.name !== 'AbortError') _copyText(text); });
  } else {
    _copyText(text);
  }
}

function _copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => _toast('コピーしました'),
      () => _fallbackCopy(text)
    );
  } else {
    _fallbackCopy(text);
  }
}

function _fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); _toast('コピーしました'); }
  catch (_) {}
  ta.remove();
}

function _toast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#484545] text-white px-5 py-3 rounded-full shadow-2xl text-[13px] font-bold z-[300]';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
