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
  // スタイル: public/css/object/project/_create-event.css
  return `
    <div class="p-create-event">
      <header class="p-create-event__header">
        <h1 class="p-create-event__brand">新規イベントの作成</h1>
      </header>
      <main class="p-create-event__main u-page-transition">
        <h2 class="p-create-event__heading">${heading}</h2>
        ${sub ? `<p class="p-create-event__sub">${sub}</p>` : '<div class="p-create-event__sub-spacer"></div>'}
        <div class="p-create-event__body">${body}</div>
        <div class="p-create-event__footer">
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
    <div class="p-create-event">
      <header class="p-create-event__header p-create-event__header--roomy">
        <h1 class="p-create-event__brand">新規イベントの作成</h1>
      </header>
      <main class="p-create-event__main p-create-event__main--wide u-page-transition">
        <div class="p-create-event__field">
          <label class="p-create-event__label" for="cp-event-name">イベント名</label>
          <input id="cp-event-name" type="text" placeholder="イベント名を入力"
            value="${_esc(state.draftEvent.name)}"
            oninput="window._app.updateDraftInfo('name', this.value)"
            class="c-input c-input--block p-create-event__input">
          <p class="p-create-event__note">あとで変更できます</p>
        </div>
        <div class="p-create-event__footer p-create-event__footer--tight">
          ${_steps(1, 'イベント作成（1/6）')}
          <button type="button" id="cp-info-next" onclick="window._app.tryProceedFromInfo()"
            class="c-button c-button--primary p-create-event__next" ${canNext ? '' : 'disabled'}>次へ</button>
          <button type="button" onclick="window._app.setView('HOME')"
            class="c-button c-button--secondary p-create-event__back">戻る</button>
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
    <button type="button" data-cp-type="${t.id}"
      class="p-create-event__choice${cur === t.id ? ' is-selected' : ''}">
      <span class="p-create-event__choice-label">${_esc(t.label)}</span>
      <span class="p-create-event__choice-hint">${_esc(t.hint)}</span>
    </button>`).join('');

  container.innerHTML = _stepShell({
    step: 2, stepLabel: 'イベント作成（2/6）',
    heading: 'どんなイベントを計画中？',
    sub: 'ぴったりの提案を出すために使います<br>あとで変更できます',
    body,
    footer: `
      <button onclick="window._app.setView('CREATE_EVENT_INFO')"
        class="c-button c-button--secondary p-create-event__back">戻る</button>`,
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
      class="p-create-event__choice p-create-event__choice--roomy${cur === s.id ? ' is-selected' : ''}">
      <span class="p-create-event__choice-label">${_esc(s.label)}</span>
      <span class="p-create-event__choice-hint">${_esc(s.hint)}</span>
    </button>`).join('');

  container.innerHTML = _stepShell({
    step: 3, stepLabel: 'イベント作成（3/6）',
    heading: 'どのくらいの人に<br>来てほしい？',
    sub: '決まっていなければ、いまの気持ちで',
    body,
    footer: `
      <button onclick="window._app.setView('CREATE_EVENT_TYPE')"
        class="c-button c-button--secondary p-create-event__back">戻る</button>`,
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
  for (let i = 0; i < firstDay; i++) cellsHtml += `<div class="p-create-event__day--blank"></div>`;
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSel   = selected.includes(dateStr);
    cellsHtml += `
      <div data-cp-day="${dateStr}" class="p-create-event__day${isSel ? ' is-selected' : ''}">${d}</div>`;
  }

  // 選択済み日付（個別削除付き）
  const selectedListHtml = groups.length === 0
    ? `<p class="p-create-event__selected-empty">日付が選択されていません</p>`
    : groups.map((g, i) => {
        const label = g[0] === g[g.length - 1] ? g[0] : `${g[0]}〜${g[g.length - 1]}`;
        const groupJson = encodeURIComponent(JSON.stringify(g));
        return `
          <div class="p-create-event__date-tag u-animate-fade">
            <span class="p-create-event__date-tag-label">${label}</span>
            <button type="button" data-cp-remove-group="${groupJson}" class="p-create-event__date-tag-remove" aria-label="削除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>`;
      }).join('');

  container.innerHTML = `
    <div class="p-create-event">
      <header class="p-create-event__header p-create-event__header--roomy">
        <h1 class="p-create-event__brand">新規イベントの作成</h1>
      </header>
      <main class="p-create-event__main u-page-transition">
        <h2 class="p-create-event__heading">開催日はいつ？ <span class="p-create-event__optional">（任意）</span></h2>
        <p class="p-create-event__sub">
          タップまたはスライドで複数日選択<br>
          後から設定することもできます
        </p>

        <div class="p-create-event__calendar">
          <div class="p-create-event__calendar-head">
            <button type="button" id="cp-cal-prev" class="p-create-event__calendar-nav" aria-label="前の月">
              <img src="/images/icon/iocn-Chevron.svg" class="p-create-event__calendar-nav-icon" alt="">
            </button>
            <h3 class="p-create-event__calendar-month">${year}年 ${month + 1}月</h3>
            <button type="button" id="cp-cal-next" class="p-create-event__calendar-nav" aria-label="次の月">
              <img src="/images/icon/iocn-Chevron.svg" class="p-create-event__calendar-nav-icon p-create-event__calendar-nav-icon--next" alt="">
            </button>
          </div>
          <div class="p-create-event__weekdays">
            ${['日','月','火','水','木','金','土'].map(d => `<div>${d}</div>`).join('')}
          </div>
          <div id="cp-cal-grid" class="p-create-event__grid">${cellsHtml}</div>
        </div>

        <!-- 選択済みの日付（タグ表示・×で削除） -->
        <div class="p-create-event__selected">
          <p class="p-create-event__selected-label">選択中の日付</p>
          <div class="p-create-event__selected-list">${selectedListHtml}</div>
        </div>

        <div class="p-create-event__footer">
          ${_steps(4, 'イベント作成（4/6）')}
          <button type="button" id="cp-dates-next" onclick="window._app.tryProceedFromDates()"
            class="c-button c-button--primary p-create-event__next" ${canNext ? '' : 'disabled'}>次へ</button>
          <button type="button" onclick="window._app.skipStep('dates')"
            class="p-create-event__skip">あとで決める</button>
          <button type="button" onclick="window._app.setView('CREATE_EVENT_SCALE')"
            class="c-button c-button--secondary p-create-event__back">戻る</button>
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
      // ★状態だけ切り替える。以前はクラス文字列を組み立てて className ごと
      //   差し替えていたため、見た目を変えるのに JS を直す必要があった。
      cell.classList.toggle('is-selected', isSel);
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

  // ★Pointer Events だけで受ける（modals/calendar.js と同じ方式）。
  //
  //   以前は mouse 系と touch 系の2系統を張っていたため、1回のタップで
  //   onDown が2回走ることがあった（touchstart のあとブラウザが互換用の
  //   mousedown を続けて発火する）。1回目で選択 → 2回目は「選択済み」と
  //   判定して解除、で「タップしても何も起きない／すぐ戻る」ように見えていた。
  //   touchstart の preventDefault でも大半は防げるが、端末や入力方法
  //   （タッチ対応ノート PC・ペン）によっては取りこぼす。
  //
  //   ★document にリスナーを張らないこと。この関数は再描画のたびに走るので、
  //     document へ足すと消されないまま溜まり続ける（実際に溜まっていた）。
  //     setPointerCapture を使えば、grid の外へ指が出ても move/up は grid に届く。
  grid.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;                 // 2本目以降の指は無視する
    e.preventDefault();
    onDown(e.clientX, e.clientY);
    try { grid.setPointerCapture(e.pointerId); } catch (_) {}
  });
  grid.addEventListener('pointermove', (e) => {
    if (!_drag.active || !e.isPrimary) return;
    onMove(e.clientX, e.clientY);
  });
  grid.addEventListener('pointerup', onUp);
  grid.addEventListener('pointercancel', onUp);
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
      class="c-input c-input--block p-create-event__input p-create-event__input--spaced">

    <p class="p-create-event__examples-label">例文（タップで使う）</p>
    <div class="p-create-event__examples">
      ${examples.map(ex => `
        <button type="button" data-cp-example="${_esc(ex)}" class="p-create-event__example">
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
        class="c-button c-button--primary p-create-event__next">次へ</button>
      <button onclick="window._app.skipStep('catchphrase')"
        class="p-create-event__skip">スキップする</button>
      <button onclick="window._app.setView('CREATE_EVENT_DATES')"
        class="c-button c-button--secondary p-create-event__back">戻る</button>`,
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
    <div class="p-create-event__cards">
      ${MOTIVATION_CARDS.map(c => {
        const on = sel.has(c.id);
        return `
          <button type="button" data-cp-motiv="${c.id}"
            class="p-create-event__card${on ? ' is-selected' : ''}">
            <span class="p-create-event__card-check">
              ${on ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
            </span>
            <span class="p-create-event__card-label">${_esc(c.label)}</span>
          </button>`;
      }).join('')}
    </div>

    <label class="p-create-event__inline-label" for="cp-motiv-input">
      ひとことで言うと？ <span class="p-create-event__optional">（任意）</span>
    </label>
    <input type="text" id="cp-motiv-input" placeholder="例：全部出しきる"
      value="${_esc(d.motivationText || '')}" maxlength="50"
      oninput="window._app.updateDraftMotivationText(this.value)"
      class="c-input c-input--block p-create-event__input">`;

  container.innerHTML = _stepShell({
    step: 6, stepLabel: 'イベント作成（6/6）',
    heading: 'リーダーとしての<br>意気込みは？',
    sub: '当てはまるものを選んでね（複数可）<br>参加してくれた仲間に届きます',
    body,
    footer: `
      <button onclick="window._app.proceedFromMotivation()"
        class="c-button c-button--primary p-create-event__next">次へ</button>
      <button onclick="window._app.skipStep('motivation')"
        class="p-create-event__skip">スキップする</button>
      <button onclick="window._app.setView('CREATE_EVENT_CATCHPHRASE')"
        class="c-button c-button--secondary p-create-event__back">戻る</button>`,
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
    <div class="p-create-event">
      <header class="p-create-event__header p-create-event__header--roomy">
        <h1 class="p-create-event__brand">新規イベントの作成</h1>
      </header>
      <main class="p-create-event__main p-create-event__main--wide u-page-transition">
        <h2 class="p-create-event__heading p-create-event__heading--spaced">チームメンバーを招待しよう！</h2>

        ${sec.creating ? _renderCreating()
          : sec.error    ? _renderError(sec.error)
                         : _renderShare(sec.inviteUrl)}

        <div class="p-create-event__footer">
          ${_steps(TOTAL_STEPS + 1, '完了')}
          ${sec.inviteUrl ? `
            <button type="button" id="cpi-finish"
              class="c-button c-button--primary p-create-event__next">イベント画面へ</button>
          ` : sec.error ? `
            <button type="button" id="cpi-retry"
              class="c-button c-button--primary p-create-event__next">もう一度試す</button>
          ` : ''}
          <button type="button" onclick="window._app.setView('CREATE_EVENT_MOTIVATION')"
            class="c-button c-button--secondary p-create-event__back" ${sec.creating ? 'disabled' : ''}>戻る</button>
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
    <div class="p-create-event__state">
      <div class="c-spinner p-create-event__state-spinner"></div>
      <p class="p-create-event__state-text">イベントを作成中…</p>
    </div>`;
}

function _renderError(msg) {
  return `
    <div class="p-create-event__error">
      <p class="p-create-event__error-symbol">⚠️</p>
      <p class="p-create-event__error-title">作成に失敗しました</p>
      <p class="p-create-event__error-text">${_esc(msg)}</p>
    </div>`;
}

function _renderShare(url) {
  return `
    <p class="p-create-event__done">✓ イベントを作成しました</p>
    <p class="p-create-event__share-lead">
      下のリンクをメンバーに送って<br>
      参加してもらいましょう
    </p>
    <div class="p-create-event__link-box">
      <p class="p-create-event__link-label">招待リンク</p>
      <p class="p-create-event__link-url">${_esc(url)}</p>
    </div>
    <div class="p-create-event__share">
      <button type="button" data-copy="${_esc(url)}"
        class="p-create-event__share-button p-create-event__share-button--copy">コピー</button>
      <div class="p-create-event__share-row">
        <button type="button" data-native-share="${_esc(url)}"
          class="p-create-event__share-button p-create-event__share-button--native">他のアプリで共有</button>
        <button type="button" data-line-share="${_esc(url)}"
          class="p-create-event__share-button p-create-event__share-button--line">LINE で送る</button>
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
