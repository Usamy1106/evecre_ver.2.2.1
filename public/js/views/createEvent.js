// ===== イベント作成画面（7ステップ）=====
// STEP 1  イベント名                      CREATE_EVENT_INFO
// STEP 2  どんなイベントを計画中？        CREATE_EVENT_TYPE
// STEP 3  どのくらいの人に来てほしい？    CREATE_EVENT_SCALE
// STEP 4  開催日はいつ？                  CREATE_EVENT_DATES
// STEP 5  キャッチコピー                  CREATE_EVENT_CATCHPHRASE
// STEP 6  なんでやりたい？（意気込み）    CREATE_EVENT_MOTIVATION
// STEP 7  招待リンク                      CREATE_EVENT_INVITE
//
// 進捗の分母は 6（STEP 7 の招待リンクは「完了」扱いで分母から外す）。
// STEP 4〜6 はすべてスキップ可能。STEP 2・3 は選んだ瞬間に次へ自動遷移する。
// イベントの説明（description）の入力欄は作成フローから外した。フィールド自体は
// 残っており、イベント設定から編集できる（proposalEngine の detectCategory と
// AI プロンプトが参照するため消してはいけない）。
//
// 種は addEvent 内でランダム自動選択（ユーザー選択は廃止）。

import { state } from '../state.js';
import { api } from '../api.js';
import { Components } from '../components.js';
import { getConsecutiveGroups } from '../utils.js';
import { EVENT_TYPES, EXPECTED_SCALES, MOTIVATION_CARDS, CATCHPHRASE_EXAMPLES } from '../constants.js';
import { logEvent } from '../logger.js';

const TOTAL_STEPS = 6;   // 招待リンク（STEP 7）は分母に含めない

/** 進捗インジケーター。STEP 7 では step > total にして全ドットを「完了」表示にする */
function _steps(step, label) {
  return Components.StepIndicator(step, TOTAL_STEPS, { compact: true, label });
}

/** 選択式・入力式ステップの共通の外枠（STEP 2/3/5/6 で使う） */
function _stepShell({ step, stepLabel, heading, sub = '', body, footer }) {
  return `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      <header class="px-6 pt-10 pb-6 text-center">
        <h1 class="heading-l text-[#0CA1E3]">新規イベントの作成</h1>
      </header>
      <main class="flex-1 px-6 pt-2 pb-12 flex flex-col page-transition items-center">
        <h2 class="heading-m mb-2 text-[#484545] font-bold text-center">${heading}</h2>
        ${sub ? `<p class="text-[11px] text-[#A7AAAC] font-bold text-center mb-5 leading-relaxed">${sub}</p>` : '<div class="mb-5"></div>'}
        <div class="w-full max-w-sm">${body}</div>
        <div class="mt-auto w-full max-w-sm space-y-3 pt-8">
          ${_steps(step, stepLabel)}
          ${footer}
        </div>
      </main>
    </div>`;
}

// =====================================================
// STEP 1: イベント名
// =====================================================
export function renderCreateEventInfo(container) {
  const canNext = !!state.draftEvent.name;

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      <header class="px-6 pt-10 pb-8 text-center">
        <h1 class="heading-l text-[#0CA1E3]">新規イベントの作成</h1>
      </header>
      <main class="flex-1 px-8 pt-2 pb-12 flex flex-col page-transition items-center">
        <div class="w-full space-y-3 mb-12">
          <div>
            <label class="heading-rs block mb-2 text-[#484545]">イベント名</label>
            <input type="text" placeholder="イベント名を入力"
              value="${_esc(state.draftEvent.name)}"
              oninput="window._app.updateDraftInfo('name', this.value)"
              class="input-field w-full px-5 py-4 focus:outline-none">
            <p class="text-[11px] text-[#A7AAAC] font-bold mt-2">あとで変更できます</p>
          </div>
        </div>
        <div class="mt-auto w-full max-w-sm space-y-3">
          ${_steps(1, 'イベント作成（1/6）')}
          <button id="cp-info-next" onclick="window._app.tryProceedFromInfo()"
            class="btn-primary w-full py-5 heading-m font-bold shadow-lg" ${canNext ? '' : 'disabled style="opacity:.5"'}>次へ</button>
          <button onclick="window._app.setView('HOME')"
            class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]">戻る</button>
        </div>
      </main>
    </div>`;
}

// =====================================================
// STEP 2: どんなイベントを計画中？
// この回答が提案エンジンのカテゴリ判定を置き換える（最重要ステップ）。
// 従来はイベント名と説明文のキーワード一致で当てていた。
// =====================================================
export function renderCreateEventType(container) {
  const cur = state.draftEvent.eventType;
  const body = EVENT_TYPES.map(t => `
    <button data-cp-type="${t.id}"
      class="w-full text-left px-5 py-4 mb-2.5 rounded-2xl border-2 transition-all active:scale-[.99]
        ${cur === t.id
          ? 'border-[#0CA1E3] bg-[#0CA1E3]/5 shadow-sm'
          : 'border-[#E1DFDC] bg-white'}">
      <span class="block text-[14px] font-bold ${cur === t.id ? 'text-[#0CA1E3]' : 'text-[#484545]'}">${_esc(t.label)}</span>
      <span class="block text-[11px] text-[#A7AAAC] font-bold mt-0.5">${_esc(t.hint)}</span>
    </button>`).join('');

  container.innerHTML = _stepShell({
    step: 2, stepLabel: 'イベント作成（2/6）',
    heading: 'どんなイベントを計画中？',
    sub: 'ぴったりの提案を出すために使います<br>あとで変更できます',
    body,
    footer: `
      <button onclick="window._app.setView('CREATE_EVENT_INFO')"
        class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]">戻る</button>`,
  });

  container.querySelectorAll('[data-cp-type]').forEach(el =>
    el.addEventListener('click', () => window._app.selectEventType(el.dataset.cpType))
  );
}

// =====================================================
// STEP 3: どのくらいの人に来てほしい？
// =====================================================
export function renderCreateEventScale(container) {
  const cur = state.draftEvent.expectedScale;
  const body = EXPECTED_SCALES.map(s => `
    <button data-cp-scale="${s.id}"
      class="w-full text-left px-5 py-5 mb-3 rounded-2xl border-2 transition-all active:scale-[.99]
        ${cur === s.id
          ? 'border-[#0CA1E3] bg-[#0CA1E3]/5 shadow-sm'
          : 'border-[#E1DFDC] bg-white'}">
      <span class="block text-[14px] font-bold ${cur === s.id ? 'text-[#0CA1E3]' : 'text-[#484545]'}">${_esc(s.label)}</span>
      <span class="block text-[11px] text-[#A7AAAC] font-bold mt-1">${_esc(s.hint)}</span>
    </button>`).join('');

  container.innerHTML = _stepShell({
    step: 3, stepLabel: 'イベント作成（3/6）',
    heading: 'どのくらいの人に<br>来てほしい？',
    sub: '決まっていなければ、いまの気持ちで',
    body,
    footer: `
      <button onclick="window._app.setView('CREATE_EVENT_TYPE')"
        class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]">戻る</button>`,
  });

  container.querySelectorAll('[data-cp-scale]').forEach(el =>
    el.addEventListener('click', () => window._app.selectExpectedScale(el.dataset.cpScale))
  );
}

// =====================================================
// STEP 4: 開催日はいつ？（インラインカレンダー）
// ★カレンダー本体（複数日選択・ドラッグ選択・タグの×削除）は従来のまま。
//   変更したのは StepIndicator の番号と前後の遷移先、スキップボタンだけ。
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
        <h2 class="heading-m mb-2 text-[#484545] font-bold">開催日はいつ？ <span class="text-[#A7AAAC] text-[11px]">（任意）</span></h2>
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
          ${_steps(4, 'イベント作成（4/6）')}
          <button id="cp-dates-next" onclick="window._app.tryProceedFromDates()"
            class="btn-primary w-full py-5 heading-m font-bold shadow-lg" ${canNext ? '' : 'disabled style="opacity:.5"'}>次へ</button>
          <button onclick="window._app.skipStep('dates')"
            class="w-full py-2 text-[12px] font-bold text-[#A7AAAC] active:opacity-50">あとで決める</button>
          <button onclick="window._app.setView('CREATE_EVENT_SCALE')"
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
// STEP 5: キャッチコピー（スキップ可）
// ★入力中のプレビューは出さない（かつて「招待ページのプレビュー」を出していたが、
//   そもそも招待ページという画面が存在せず、実体と食い違っていたため撤去した）。
// =====================================================
export function renderCreateEventCatchphrase(container) {
  const d = state.draftEvent;
  const examples = CATCHPHRASE_EXAMPLES[d.eventType] || CATCHPHRASE_EXAMPLES.other;

  const body = `
    <input type="text" id="cp-catch-input" placeholder="キャッチコピーを入力"
      value="${_esc(d.catchphrase || '')}" maxlength="50"
      oninput="window._app.updateDraftCatchphrase(this.value)"
      class="input-field w-full px-5 py-4 focus:outline-none mb-3">

    <p class="text-[10px] text-[#A7AAAC] font-bold mb-2">例文（タップで使う）</p>
    <div class="space-y-2 mb-5">
      ${examples.map(ex => `
        <button data-cp-example="${_esc(ex)}"
          class="w-full text-left px-4 py-3 rounded-xl border border-[#E1DFDC] bg-white text-[13px] font-bold text-[#484545] active:bg-[#FDFBF8] active:scale-[.99] transition-all">
          ${_esc(ex)}
        </button>`).join('')}
    </div>`;

  container.innerHTML = _stepShell({
    step: 5, stepLabel: 'イベント作成（5/6）',
    heading: 'キャッチコピーを<br>つけよう',
    sub: '招待した相手に表示されます<br>あとで変更できます',
    body,
    footer: `
      <button onclick="window._app.proceedFromCatchphrase()"
        class="btn-primary w-full py-5 heading-m font-bold shadow-lg">次へ</button>
      <button onclick="window._app.skipStep('catchphrase')"
        class="w-full py-2 text-[12px] font-bold text-[#A7AAAC] active:opacity-50">スキップする</button>
      <button onclick="window._app.setView('CREATE_EVENT_DATES')"
        class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]">戻る</button>`,
  });

  container.querySelectorAll('[data-cp-example]').forEach(el =>
    el.addEventListener('click', () => window._app.useCatchphraseExample(el.dataset.cpExample))
  );
}

// =====================================================
// STEP 6: リーダーの意気込み（スキップ可）
// ★「なぜこのイベントをやりたいか」ではなく「リーダーとしてどう臨むか」を聞く。
//   参加が承認された直後にメンバーへ見せ、🔥で応援してもらうための言葉なので、
//   イベントの動機ではなく“この人がどういう姿勢でやるか”が伝わるほうがよい。
// ★自由記述を2連続にしないため、カード選択（複数可）＋任意の一言の二段構えにする。
//   カード0件・一言なしでも次へ進める。
// =====================================================
export function renderCreateEventMotivation(container) {
  const d = state.draftEvent;
  const sel = new Set(d.motivationTags || []);

  const body = `
    <div class="space-y-2 mb-5">
      ${MOTIVATION_CARDS.map(c => {
        const on = sel.has(c.id);
        return `
          <button data-cp-motiv="${c.id}"
            class="w-full text-left px-4 py-3.5 rounded-2xl border-2 transition-all active:scale-[.99] flex items-center gap-3
              ${on ? 'border-[#EE3E12] bg-[#EE3E12]/5' : 'border-[#E1DFDC] bg-white'}">
            <span class="w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center border-2
              ${on ? 'bg-[#EE3E12] border-[#EE3E12]' : 'border-[#D3D6D8]'}">
              ${on ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
            </span>
            <span class="text-[13px] font-bold ${on ? 'text-[#EE3E12]' : 'text-[#484545]'}">${_esc(c.label)}</span>
          </button>`;
      }).join('')}
    </div>

    <label class="text-[11px] text-[#484545] font-bold block mb-2">
      ひとことで言うと？ <span class="text-[#A7AAAC]">（任意）</span>
    </label>
    <input type="text" id="cp-motiv-input" placeholder="例：全部出しきる"
      value="${_esc(d.motivationText || '')}" maxlength="50"
      oninput="window._app.updateDraftMotivationText(this.value)"
      class="input-field w-full px-5 py-4 focus:outline-none">`;

  container.innerHTML = _stepShell({
    step: 6, stepLabel: 'イベント作成（6/6）',
    heading: 'リーダーとしての<br>意気込みは？',
    sub: '当てはまるものを選んでね（複数可）<br>参加してくれた仲間に届きます',
    body,
    footer: `
      <button onclick="window._app.proceedFromMotivation()"
        class="btn-primary w-full py-5 heading-m font-bold shadow-lg">次へ</button>
      <button onclick="window._app.skipStep('motivation')"
        class="w-full py-2 text-[12px] font-bold text-[#A7AAAC] active:opacity-50">スキップする</button>
      <button onclick="window._app.setView('CREATE_EVENT_CATCHPHRASE')"
        class="btn-secondary w-full py-4 heading-m font-bold text-[#484545]">戻る</button>`,
  });

  container.querySelectorAll('[data-cp-motiv]').forEach(el =>
    el.addEventListener('click', () => window._app.toggleMotivationTag(el.dataset.cpMotiv))
  );
}

// =====================================================
// STEP 7: 招待リンク発行（画面到達と同時に自動で作成＋発行）
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
          ${_steps(TOTAL_STEPS + 1, '完了')}
          ${sec.inviteUrl ? `
            <button id="cpi-finish"
              class="btn-primary w-full py-5 heading-m font-bold shadow-lg">イベント画面へ</button>
          ` : sec.error ? `
            <button id="cpi-retry"
              class="btn-primary w-full py-5 heading-m font-bold shadow-lg">もう一度試す</button>
          ` : ''}
          <button onclick="window._app.setView('CREATE_EVENT_MOTIVATION')"
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
      sec.error = 'イベント名を確認してください';
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

    // フロー全体の完走を1件で記録する（各ステップの入力有無つき）。
    // ★draftEvent のリセットは _finishAndGoToEvent なので、ここではまだ回答が残っている。
    const d = state.draftEvent || {};
    logEvent('event_create_completed', {
      eventType:          d.eventType || null,
      expectedScale:      d.expectedScale || null,
      hasDates:           (d.dates?.length || 0) > 0,
      hasCatchphrase:     !!(d.catchphrase || '').trim(),
      motivationTagCount: d.motivationTags?.length || 0,
      hasMotivationText:  !!(d.motivationText || '').trim(),
    });

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
  state.resetDraftEvent();
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
