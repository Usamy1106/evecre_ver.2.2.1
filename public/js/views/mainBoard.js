// ===== メインボード画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { getSortedMissions, bindMissionInteractions } from '../modals/mission.js';
import { LABEL_CONFIG, PROPOSAL_CHARACTERS, REFLECT_LABELS, REFLECT_SKIP_MISSION_IDS } from '../constants.js';
import { characterFigureHtml, sleepBubbleHtml } from '../character.js';
import { calculateDaysLeft, formatEventPeriodLines, getArchiveSummary, getArchiveVenue, todayStr, submissionImages, submissionText, submissionSegments, getEventMainVisual, linkifyText } from '../utils.js';
import { bindArchiveInlineEditing, bindArchiveTapToEdit, captureInlineEdits, restoreInlineEdits } from '../archiveInlineEdit.js';
import { renderMountainBg, renderMountainScrollWindow, initMountainPathSync,
  syncMountainBackdrop, captureBgLayer, restoreBgLayer } from '../mountainPath.js';

// ── 通知スワイプ削除 ─────────────────────────────────────
// モジュールロード時に一度だけ登録。document 全体にデリゲート。
;(() => {
  let _sw = null; // { row, card, id, startX, startY, swiping }

  document.addEventListener('touchstart', e => {
    const row = e.target.closest('.notif-swipe-row');
    if (!row) { _sw = null; return; }
    _sw = {
      row,
      card:   row.querySelector('.p-notification__swipe-card'),
      id:     row.dataset.notifId,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      swiping: false,
    };
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!_sw) return;
    const dx = e.touches[0].clientX - _sw.startX;
    const dy = Math.abs(e.touches[0].clientY - _sw.startY);

    // 縦スクロールが主体ならスワイプキャンセル
    if (!_sw.swiping && dy > Math.abs(dx)) { _sw = null; return; }

    if (dx < 0) {
      _sw.swiping = true;
      _sw.card.style.transition = 'none';
      _sw.card.style.transform  = `translateX(${dx}px)`;
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!_sw) return;
    const dx = e.changedTouches[0].clientX - _sw.startX;
    const { row, card, id } = _sw;
    _sw = null;

    if (dx < -80) {
      // 閾値を超えたら削除アニメーション → API 呼び出し
      card.style.transition = 'transform 0.22s ease';
      card.style.transform  = 'translateX(-110%)';
      setTimeout(() => {
        row.style.transition  = 'max-height 0.22s ease, opacity 0.22s ease, margin-bottom 0.22s ease';
        row.style.maxHeight   = row.offsetHeight + 'px';
        row.style.overflow    = 'hidden';
        requestAnimationFrame(() => {
          row.style.maxHeight    = '0';
          row.style.opacity      = '0';
          row.style.marginBottom = '0';
        });
        setTimeout(() => window._app?.deleteNotification(id), 240);
      }, 220);
    } else {
      // スナップバック
      card.style.transition = 'transform 0.2s ease';
      card.style.transform  = 'translateX(0)';
    }
  }, { passive: true });
})();

/**
 * メインボード画面をレンダリングする
 * @param {HTMLElement} container
 */
export function renderMainBoard(container) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) {
    // イベントが見つからない場合：データ再取得を試み、それでも無ければ HOME へ
    console.warn('renderMainBoard: event not found in state.events', {
      selectedEventId: state.selectedEventId,
      eventsCount: state.events.length,
      eventIds: state.events.map(x => x.id),
    });
    // 一度だけ再取得を試みる（既に試み済みでなければ）
    if (!state._mainBoardReloadAttempted) {
      state._mainBoardReloadAttempted = true;
      state.silentReloadEvents?.();
      // 再取得後 setTimeout で再レンダリング、それでも見つからなければ HOME
      setTimeout(() => {
        const found = state.events.find(x => x.id === state.selectedEventId);
        if (!found) {
          state._mainBoardReloadAttempted = false;
          state.setView('HOME');
        }
      }, 500);
      // ローディング表示
      container.innerHTML = `
        <div class="p-main-board p-main-board--loading">
          <p class="p-main-board__loading">読み込み中…</p>
        </div>`;
      return;
    }
    state._mainBoardReloadAttempted = false;
    return state.setView('HOME');
  }
  // イベントが見つかったらフラグをクリア
  state._mainBoardReloadAttempted = false;

  // 山登りパスのスクロール位置を再レンダリングをまたいで保持（SSE 再描画で飛ばさない。
  // 初回は null → 最上部＝道の先端のまま）
  const _mountainScrollTop = document.getElementById('mountain-path-scroll')?.scrollTop ?? null;

  // ★イベントが変わったら、パネルとアナウンスの開閉をリセットする。
  //   どちらもモジュール変数で保持しており、イベントを跨いで残ってしまう。
  if (_panelStateEventId !== state.selectedEventId) {
    _panelStateEventId = state.selectedEventId;
    _missionPanelExpanded = false;
    _announceExpanded = false;
    _panelReturnFrom = null;
  }

  // ★タスク完了の演出（1回きり）。submitMissionClear が status:'cleared' の
  //   ときだけ立てる。ここでは読むだけで、消費（フラグ倒し）は配線の最後に行う
  //   （HTML 構築で renderMountainBg に渡す必要があるため）。
  const celebrate = !!state.mountainCelebrate;
  // 演出中はパネルを通常位置へ戻す。70% まで上がったままだと山が見えず、
  // マスが色づくところを見せられない。
  if (celebrate) collapseMissionPanel();

  const isMain = state.mainBoardTab === 'MAIN';
  // MAIN タブはページ自体をスクロールさせない（上部＝山スクロール／下部＝提案・タスクパネル）。
  // ARCHIVE / NOTIFICATIONS は従来どおり <main> のページスクロール。
  const mainLayout = isMain ? _renderMainTab(p) : null;

  // ★背景は <img> が 200 個近くある。innerHTML の差し替えで作り直すと毎回すべて
  //   再デコードされ、SSE のたびに一瞬白くなる。中身が同じなら DOM ごと使い回す。
  captureBgLayer();
  // ★アーカイブの編集モードで書いている途中の欄を、描き直しで消さない（archiveInlineEdit.js）
  captureInlineEdits();

  container.innerHTML = `
    <div class="p-main-board ${isMain ? 'p-main-board--fixed' : 'p-main-board--scroll'}">
      <!-- standalone（ホーム画面から起動）ではステータスバー領域にコンテンツが潜るため、
           safe-area 分の余白を足す。ブラウザ表示では env() が 0 なので見た目は変わらない。 -->
      <!-- ヘッダー＋タブ。★js-mountain-sticky は mountainPath.js が山の上端を
           合わせるための目印（以前は Tailwind の .sticky を掴んでいた）。
           スタイル: public/css/layout/_header.css の .l-header-stack -->
      <div class="l-header-stack js-mountain-sticky">
        ${Components.Header(p)}
        ${Components.Tabs(state.mainBoardTab)}
      </div>
      <!-- 山ビジュアルの背景レイヤー（ヘッダー下〜画面全体。コンテンツ(z-10)の裏側）
           ★アーカイブ・通知タブでも山は出したままにする（タブを移っても同じ場所に
             居る感じを保つため）。ただし backdrop モードで、白いベールを重ねて
             マス（道）は出さない。 -->
      ${renderMountainBg(p, { celebrate, backdrop: !isMain })}
      ${Components.VerifyBanner() ? `<div class="p-main-board__layer">${Components.VerifyBanner()}</div>` : ''}
      ${isMain ? `
        <!-- 上部固定：日付チップ・お知らせ・各バナー（スクロールしない） -->
        <div class="p-main-board__layer">${mainLayout.pinnedAux}</div>
        <!-- 山スクロール窓（透明・上部領域を占める）。ここのスクロールで山を遡れる -->
        ${renderMountainScrollWindow(p)}
        <!-- 下部パネル：提案＋やること一覧（独立スクロール・上ドラッグで拡大） -->
        <!-- id は mission-panel と衝突させないこと（modals/mission.js の作成モーダル内部パネルが
             その id を使っており、被せるとモーダルのスライドインが壊れて白画面になる） -->
        <div id="mainboard-bottom-panel" class="l-bottom-panel" style="top:62vh">
          <!-- ★提案キャラクターはスクロール領域の外。上へはみ出して波に重なるため -->
          ${mainLayout.proposalsRow}
          <div data-mpanel-body class="l-bottom-panel__body u-pb-safe">
            ${mainLayout.bottomPanelInner}
          </div>
        </div>
      ` : `
        <main class="p-main-board__page u-no-scrollbar">
          ${state.mainBoardTab === 'ARCHIVE' ? _renderArchiveTab(p) : ''}
          ${state.mainBoardTab === 'NOTIFICATIONS' ? _renderNotificationsTab(p) : ''}
        </main>
      `}
      ${state.mainBoardTab === 'MAIN' && state.canManageCurrentEvent() ? `
        <button type="button" onclick="window._app.openMissionModal()" data-log="mission_add_open" data-coach="fab"
          class="l-fab l-fab--primary" aria-label="タスクを作成">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
    </div>`;

  // ★配線より先に戻す。実測する対象を入れ替えないため。
  //   タブをまたいでも、他のページから戻ってきても、背景の DOM は使い回す
  //   （署名が同じなら）。これが無いと戻るたびに背景が遅れて現れる。
  restoreBgLayer();
  // ★今 DOM に居る背景を改めて退避しておく。次にこの画面を離れたあとも
  //   参照が生き残り、戻ってきたときに読み込み済みの絵をそのまま出せる。
  captureBgLayer();

  if (state.mainBoardTab !== 'MAIN') {
    // 背景として見せるだけ。スクロール窓もマスも無いので軽い配線で足りる
    syncMountainBackdrop();
    // ★アーカイブ上部（.p-archive__head）を貼り付ける位置＝ヘッダー＋タブの高さ（safe-area 込み）
    const stack = container.querySelector('.js-mountain-sticky');
    if (stack) container.querySelector('.p-main-board')?.style.setProperty('--board-stack-h', `${stack.offsetHeight}px`);
  }

  if (state.mainBoardTab === 'ARCHIVE') {
    restoreInlineEdits();
    if (state.archiveEditing) bindArchiveInlineEditing(container);
    else bindArchiveTapToEdit(container);
    _focusArchiveMission();
  }
  // ★セグメンテッドコントロールのつまみを滑らせる（通知タブの絞り込み）
  Components.segmentedSettle();

  if (state.mainBoardTab === 'MAIN') {
    // ★パネルの配線を先に行う。パネルの top はこの中で確定するので、
    //   逆順にすると山側が「まだ初期値のままのパネル位置」で遠近の基準帯を
    //   測ってしまう（マスの大きさと初期スクロール位置がずれる）。
    _initMissionPanelGesture();
    // 背景レイヤーの位置合わせ・スクロール同期を配線。
    // ★演出中は復元位置を捨てて null（＝_initialScrollTop）にする。
    //   いちばん新しいマスを「見えている帯」に入れるロジックが既にあるので、
    //   これだけで「一番上のマスを映す」が満たせる。
    initMountainPathSync(celebrate ? null : _mountainScrollTop);
    // 演出は1回きり。ここで消費する（次の SSE 再描画で再生されないように）
    if (celebrate) state.mountainCelebrate = false;
    // ★キャラクターの一度きりの演出も同じ扱い。HTML を組む時点では立っている
    //   必要があるので、消費するのは描画が終わったこの位置。
    state.charactersIntro = false;
    state.proposalsRevealed = false;
    _checkMissionDeadlineNotifications(p.missions || []);
    // タスクカード：タップ＝完了モーダル（inline onclick）、管理者長押し＝編集/削除メニュー
    bindMissionInteractions(container, p, { useInlineTap: true });
  }
}

/**
 * アーカイブのそのタスクの記録までスクロールして、2秒だけ光らせる。
 * 目次のタップ（jumpToArchiveEntry）と、完了の通知からの遷移（_focusArchiveMission）で共用する。
 * ★見つからないときは何もしない（未完了に戻された／削除された／概要欄のタスクは並ばない）。
 * ★`document.querySelectorAll` から探す。タスクIDは数字で始まるものがあり、
 *   セレクタに直接埋めると escape の扱いが面倒になる（通知のまとめと同じ方式）。
 */
// 光らせている記録。★モジュールで持つ（SSE などで描き直されても、2秒のあいだは光ったまま）
let _archiveFocus = { id: null, until: 0 };
const ARCHIVE_FOCUS_MS = 2000;

function _scrollToArchiveEntry(id) {
  const el = [...document.querySelectorAll('.p-archive__entry')].find(x => x.dataset.missionId === id);
  if (!el) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  // どれの話か分かるように少しだけ光らせる（2秒で戻す）
  _archiveFocus = { id, until: Date.now() + ARCHIVE_FOCUS_MS };
  el.classList.add('is-focused');
  setTimeout(() => {
    if (_archiveFocus.id === id) _archiveFocus = { id: null, until: 0 };
    [...document.querySelectorAll('.p-archive__entry.is-focused')].forEach(x => x.classList.remove('is-focused'));
  }, ARCHIVE_FOCUS_MS);
  return true;
}

function _isArchiveFocused(id) {
  return _archiveFocus.id === id && Date.now() < _archiveFocus.until;
}

/** 目次のタップ */
export function jumpToArchiveEntry(id) {
  _scrollToArchiveEntry(id);
}

/**
 * 完了の通知から来たとき、アーカイブのそのタスクの記録まで送って光らせる。
 * ★一度きり。`state.archiveFocusMissionId` を**ここで消費する**。
 *   消さないと SSE の再描画のたびにスクロールが飛ぶ。
 */
function _focusArchiveMission() {
  const id = state.archiveFocusMissionId;
  if (!id) return;
  state.archiveFocusMissionId = null;
  _scrollToArchiveEntry(id);
}

// 下部パネル（提案＋やること一覧）の開閉状態。再レンダリングをまたいで保持する。
let _missionPanelExpanded = false;

// ★どのイベントの開閉状態かを覚えておく。
//   _missionPanelExpanded はモジュール変数なので、イベントを跨いでも残る。
//   前のイベントでパネルを上げたまま新しいイベントを作ると、初めて開いた
//   ボードがいきなり展開済みで出てくる（山が見えない）。イベントが変わったら
//   必ず閉じた状態から始める。
let _panelStateEventId = null;

// アナウンスが2件以上あるときの「他N件」を開いているか。
// ★モジュール変数で保つ（_missionPanelExpanded と同じ方式）。ローカル変数や
//   DOM の style だけで持つと、SSE の再描画のたびに勝手に畳まれてしまう。
let _announceExpanded = false;
export function toggleAnnounceList() {
  _announceExpanded = !_announceExpanded;
  state.render();
}

// 下部パネルのスワイプ配線（つまみは廃止。パネル本体が兼ねる）。
//
// ★スワイプとスクロールを1つの領域で両立させるのが肝。指を下ろした時点では
//   どちらの操作か決まらないので、最初の数 px の向きと scrollTop で決める：
//
//   | パネル | 指の向き | scrollTop | 動作                         |
//   |--------|----------|-----------|------------------------------|
//   | 通常   | ↑ 上     | —         | パネルを 70% まで上げる      |
//   | 70%    | ↑ 上     | —         | 通常スクロール（触らない）   |
//   | 70%    | ↓ 下     | 0         | パネルを通常位置へ戻す       |
//   | 70%    | ↓ 下     | >0        | 通常スクロール（触らない）   |
//
// ★一度 'scroll' と決めたらそのジェスチャの間は二度とパネルを動かさない
//   （途中で奪うと、スクロールしている最中に急にパネルが飛ぶ）。
// ★touchmove は { passive:false }。preventDefault しないと、パネルを
//   動かしながら裏の一覧もスクロールしてしまう。
function _initMissionPanelGesture() {
  const panel = document.getElementById('mainboard-bottom-panel');
  const body  = panel?.querySelector('[data-mpanel-body]');
  if (!panel || !body) return;

  const vh = window.innerHeight || 640;
  // 通常：画面の下から 38%。★山を広く見せるため、パネルはここまで。
  //   ここを下げる（値を大きくする）とプログレスマップの手前が広く見え、
  //   上げるとやること一覧が読みやすくなる。トレードオフ。
  const collapsedTop = Math.round(vh * 0.62);
  // 展開：下から 70%（＝上端が画面の 30%）。一覧を読むための位置。
  const expandedTop  = Math.round(vh * 0.30);
  const setTop = (v) => { panel.style.top = v + 'px'; };
  // ★transition はインラインで付け外しする（CSS に常時置かない）。
  //   常時付けておくと、SSE の再描画のたびにパネルが 62vh から今の位置へ
  //   毎回スライドして見える（innerHTML ごと作り直しているため）。
  const SNAP = 'top .28s cubic-bezier(.22,.61,.36,1)';

  // ★キャラクターの表示状態。「消えている状態」と「消える動き」は別クラス。
  //   状態にアニメーションを持たせると、SSE の再描画のたびに動きが再生されて
  //   上げっぱなしのパネルでチラつく（_character.css のコメント参照）。
  //   ★クラスを付けるのはパネルではなく提案コンテナ。project レイヤの CSS は
  //     .p- で始まるセレクタしか書けない規約のため（scripts/checkFlocss.mjs）。
  //   ★提案は管理者にしか描画されないので、要素が無いことは普通にありうる。
  const CHAR_ANIM_MS = 700;   // stagger + duration より十分長く取る
  let charAnimTimer = null;
  const setCharState = (expanded, animate) => {
    const box = panel.querySelector('.p-main-board__proposals');
    if (!box) return;
    box.classList.toggle('is-expanded', expanded);
    box.classList.remove('is-sinking', 'is-rising');
    clearTimeout(charAnimTimer);
    if (!animate) return;
    box.classList.add(expanded ? 'is-sinking' : 'is-rising');
    charAnimTimer = setTimeout(() => box.classList.remove('is-sinking', 'is-rising'), CHAR_ANIM_MS);
  };
  setCharState(_missionPanelExpanded, false);

  if (_panelReturnFrom !== null) {
    // タスク完了の演出：上がっていた位置から通常位置へ滑らせて戻す。
    // 再描画で DOM は作り直されているので、まず元の位置に置いてから animate する。
    setTop(_panelReturnFrom);
    void panel.offsetHeight;          // ここで一度レイアウトさせないと transition が走らない
    panel.style.transition = SNAP;
    setTop(collapsedTop);
    // タスク完了でパネルが戻る＝キャラも戻ってくる
    setCharState(false, true);
    _panelReturnFrom = null;
  } else {
    panel.style.transition = '';
    setTop(_missionPanelExpanded ? expandedTop : collapsedTop);
  }

  // 指の移動が閾値を超えたら「スワイプだった」とみなし、次の click を1回だけ
  // 握り潰す。★これが無いと、パネルを上げた指の真下にあったタスクカードが
  // そのまま開いてしまう（touchend の後に click が発火するため）。
  const TAP_SLOP = 10;
  let swallowClick = false;
  panel.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  let startY = 0, startTop = 0, mode = null, moved = 0;

  const down = (y) => {
    startY = y;
    startTop = parseFloat(panel.style.top) || collapsedTop;
    mode = null;
    moved = 0;
    panel.style.transition = 'none';   // 指に貼り付けて動かす（遅れて追従させない）
  };

  const move = (y) => {
    const dy = y - startY;
    moved = Math.max(moved, Math.abs(dy));

    if (mode === null) {
      // 向きが定まるまでは何もしない（1〜2px のブレで誤判定しないため）
      if (Math.abs(dy) < 4) return false;
      const up = dy < 0;
      if (!_missionPanelExpanded && up) mode = 'panel';           // 通常 → 上げる
      else if (_missionPanelExpanded && !up && body.scrollTop <= 0) mode = 'panel'; // 上端で下へ → 戻す
      else mode = 'scroll';
    }
    if (mode !== 'panel') return false;

    setTop(Math.max(expandedTop, Math.min(collapsedTop, startTop + dy)));
    return true;   // 呼び出し側が preventDefault する
  };

  const up = () => {
    if (mode === 'panel') {
      panel.style.transition = SNAP;
      const cur = parseFloat(panel.style.top) || collapsedTop;
      const wasExpanded = _missionPanelExpanded;
      _missionPanelExpanded = cur < (collapsedTop + expandedTop) / 2;
      setTop(_missionPanelExpanded ? expandedTop : collapsedTop);
      // ★状態が変わったときだけ動かす。同じ位置へスナップし直しただけなら
      //   キャラは動かさない（指を離すたびに出入りすると鬱陶しい）。
      setCharState(_missionPanelExpanded, _missionPanelExpanded !== wasExpanded);
      if (moved > TAP_SLOP) swallowClick = true;
    }
    mode = null;
  };

  body.addEventListener('touchstart', e => down(e.touches[0].clientY), { passive: true });
  body.addEventListener('touchmove', e => {
    if (move(e.touches[0].clientY)) e.preventDefault();
  }, { passive: false });
  body.addEventListener('touchend', up);
  body.addEventListener('touchcancel', up);

  // PC の確認用。ホイールは通常スクロールのままで、ドラッグだけ拾う。
  body.addEventListener('mousedown', e => {
    down(e.clientY);
    const mm = ev => { if (move(ev.clientY)) ev.preventDefault(); };
    const mu = () => { up(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
}

// 完了の演出で「どの位置から通常位置へ戻すか」。null なら戻す動きは無し。
// ★再描画で DOM ごと作り直されるため、元の位置を数値で持っておかないと
//   アニメーションの開始点が失われる（いきなり通常位置で描かれてしまう）。
let _panelReturnFrom = null;

/**
 * タスク完了の演出：パネルを通常位置へ戻す。
 * ★山側のスクロールとマスのアニメーションは mountainPath.js が持つ。
 *   ここはパネルの位置だけを戻し、山が見える状態を作る役。
 * ★上がっていなければ何もしない（動く必要がない）。
 */
export function collapseMissionPanel() {
  if (!_missionPanelExpanded) return;
  _panelReturnFrom = parseFloat(document.getElementById('mainboard-bottom-panel')?.style.top)
    || Math.round((window.innerHeight || 640) * 0.30);
  _missionPanelExpanded = false;
}

// ===== メインタブ =====
// ===== 提案キャラクター =====
/**
 * 提案ボックス1体ぶんの HTML。提案あり／生成中／更新待ち で共用する。
 *
 * ★見た目の状態は修飾クラス1つで切り替える（p-char--ready / --meeting / --sleeping）。
 *   目の動きも登場も、実体は CSS アニメーション（object/project/_character.css）。
 *   ★JS のタイマーで目を動かさないこと。0.5CPU 環境で3体ぶんの setInterval が
 *     回り続けることになり、山のスクロール（60fps 前提）を確実に削る。
 * ★「たまに瞬きする」「タイミングをずらす」は、3体の周期を互いに素な秒数
 *   （5.7s / 6.9s / 8.3s）にすることで実現している。乱数を使わずに永久にずれ続ける。
 *
 * @param {{id:string, body:string, iris:string}} ch  PROPOSAL_CHARACTERS の1体
 * @param {number} idx  左からの位置（登場アニメの遅延に使う）
 * @param {{state:string, badge:boolean, onClick?:string, inner:string, help?:string}} opt
 */
function _characterBoxHtml(ch, idx, opt) {
  // ★タップはキャラ全体で受ける。文字は体の内側の狭い範囲にしか無いので、
  //   そこだけを当たり判定にすると「キャラを押したのに反応しない」になる。
  //   ヘルプボタンは showProposalHelp が stopPropagation するので競合しない。
  const tap = opt.onClick ? ` onclick="${opt.onClick}"` : '';
  return `
    <div class="p-main-board__proposal p-char p-char--${ch.id} p-char--${opt.state}"
      style="--char-index:${idx}"${tap}>
      <!-- ★体と目のマークアップは character.js が組む（HOME のひとことと共用）。
           体は専用の要素に敷く。箱そのものに背景を置くと、箱が担う
           「パネル操作での出入り」と体の呼吸／弾みが同じ transform を奪い合う。 -->
      ${characterFigureHtml(ch, { closedEyes: opt.state === 'sleeping' })}
      ${opt.state === 'sleeping' ? sleepBubbleHtml() : ''}
      ${opt.badge ? `<img class="p-char__badge" src="/images/icon/icon-suggest.svg" alt="" aria-hidden="true">` : ''}
      <div class="p-main-board__proposal-body">${opt.inner}</div>
      ${opt.help ? `
        <button type="button" onclick="${opt.help}"
          class="p-main-board__proposal-help" aria-label="この提案について">
          <img src="/images/icon/icon-Help.svg" class="p-main-board__proposal-help-icon" alt="">
        </button>` : ''}
    </div>`;
}

function _renderMainTab(p) {
  const canMgr = state.canManageCurrentEvent();
  const meId   = state.currentUser?.id;

  // ヘルパ：タスクが「自分が担当している」と言えるか
  const _isMyMission = (m) => {
    if (Array.isArray(m.assignees) && m.assignees.length > 0) {
      return m.assignees.includes(meId);
    }
    return m.assignee?.type === 'user' && m.assignee.userId === meId;
  };
  // ヘルパ：このタスクの担当が「確定済み」か
  const _isAssigned = (m) => {
    if (Array.isArray(m.assignees) && m.assignees.length > 0) return true;
    if (!m.selfClaim && m.assignee?.type === 'user') return true;
    if (m.selfClaim && Array.isArray(m.assignees) && m.assignees.length === 0 && m.assignee?.type === 'user') return true;
    return false;
  };

  // ── タスク表示モードの定義 ──────────────────────────────────
  // 'mine' : 自分が担当 / 未割当 /応募受付中のタスクのみ（★既定）
  // 'all'  : cleared 以外を全件表示
  // ★既定値は state.js の missionViewMode と揃えること（片方だけ変えると、
  //   未設定のときだけ別のタブが開くという分かりにくいずれ方をする）
  const viewMode = state.missionViewMode || 'mine';
  // ★閲覧のみのロールは書き込み操作の UI を出さない（担保はサーバー側）
  const viewOnly = state.isViewOnlyCurrentEvent();

  const _isMyOrOpen = (m) => {
    if (m.selfClaim) {
      if (!_isAssigned(m)) return true;  // 応募受付中
      return _isMyMission(m);
    }
    const hasAssignee = (m.assignee?.type === 'user') ||
                        (Array.isArray(m.assignees) && m.assignees.length > 0);
    if (!hasAssignee) return true;       // 未割当
    return _isMyMission(m);
  };

  const ongoingMissions = getSortedMissions(
    p.missions
      .filter(m => m.status !== 'cleared')
      .filter(m => viewMode === 'all' ? true : _isMyOrOpen(m))
  );

  // ── タグフィルター ──────────────────────────────────────────
  const allTags = [...new Set(
    ongoingMissions.flatMap(m =>
      Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : [])
    )
  )];
  let displayMissions = ongoingMissions;
  if (state.missionFilterTag && allTags.includes(state.missionFilterTag)) {
    // タグで絞り込むだけ。並び順は getSortedMissions（ユーザー選択のソート）を維持する。
    // （以前は stale な mission.daysLeft で再ソートし、選択したソートを上書きしていた）
    displayMissions = ongoingMissions.filter(m => {
      const tags = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
      return tags.includes(state.missionFilterTag);
    });
  }
  // ★ラベルが2つ以上あるときだけ絞り込みチップを出す。
  //   ラベルが0〜1個なら「絞る意味が無い」のでチップは出さないが、並び替えボタンは残す。
  const tagChipsHtml = allTags.length > 1 ? `
    <div class="p-main-board__tag-filter">
      <button type="button" onclick="window._app.setMissionFilterTag(null)"
        class="p-main-board__tag p-main-board__tag--all${!state.missionFilterTag ? ' is-active' : ''}">
        全て
      </button>
      ${allTags.map(tag => {
        const active = state.missionFilterTag === tag;
        const cfg = LABEL_CONFIG[tag] || { color: '#A7AAAC' };
        // ★タグ色はユーザーが作れるので CSS 変数で渡す（--tag-color-faint は枠線用の薄い方）
        return `<button type="button" onclick="window._app.setMissionFilterTag('${_esc(tag)}')"
          class="p-main-board__tag p-main-board__tag--colored${active ? ' is-active' : ''}"
          style="--tag-color:${_esc(cfg.color)};--tag-color-faint:${_esc(cfg.color)}40">
          ${_esc(tag)}</button>`;
      }).join('')}
    </div>` : '';

  // ★行そのものは常に描画する（ラベルが無くても右端の並び替えは出す）。
  //   並び替えメニュー（toggleSortMenu）はボタンの親要素に absolute で差し込まれるので、
  //   この行に position:relative が要る（_main-board.css の .p-main-board__filter-row）。
  const tagFilterHtml = `
    <div class="p-main-board__filter-row">
      ${tagChipsHtml}
      <button type="button" onclick="window._app.toggleSortMenu(event)" class="p-main-board__sort" aria-label="並び替え">
        <img src="/images/icon/icon-Filter.svg" class="p-main-board__sort-icon" alt="">
      </button>
    </div>`;

  // ★提案は「担当領域の順」に並べ替えてから枠に流し込む。枠の位置は固定で、
  //   左から mizu（運営）→ mori（制作・広報）→ iwa（企画）が必ず1体ずつ並ぶ。
  //   AI には1件ずつ別領域で返すよう指示してあるが（lib/aiProposalClient.js）、
  //   外したときのために、ここでも領域順に寄せて体の色とタグを合わせにいく。
  //   ★同率のときは元の順を保つ（安定ソート）。並びが毎回入れ替わると落ち着かない。
  const _domainRank = (tag) => {
    const i = PROPOSAL_CHARACTERS.findIndex(c => c.domains.includes(tag));
    return i < 0 ? PROPOSAL_CHARACTERS.length : i;
  };
  // ★出すのは**キャラクターの数（3体）まで**。4件目以降は描かない。
  //   以前は p.proposals の件数ぶん描いており、溢れたぶんが最後のキャラ（岩・黄）の色で
  //   下の段に並んでいた（本番は3件以内だが、開発DBに6件のイベントが実在した）。
  //   データ側も state.js の _checkProposalCycle が3件に詰め直す。
  const orderedProposals = [...p.proposals]
    .map((pr, i) => ({ pr, i }))
    .sort((a, b) => (_domainRank(a.pr.tag) - _domainRank(b.pr.tag)) || (a.i - b.i))
    .map(x => x.pr)
    .slice(0, PROPOSAL_CHARACTERS.length);

  const proposalCards = orderedProposals.map((pr, i) => {
    const ch = PROPOSAL_CHARACTERS[i] || PROPOSAL_CHARACTERS[PROPOSAL_CHARACTERS.length - 1];
    return _characterBoxHtml(ch, i, {
      state: 'ready',
      badge: true,
      onClick: `window._app.addProposalToMission('${pr.id}')`,
      inner: `<h3 class="p-main-board__proposal-title">${_esc(pr.title)}</h3>`,
      help: `window._app.showProposalHelp(event, '${pr.id}')`,
    });
  }).join('');

  const missionCardList = displayMissions.length === 0
    ? (state.missionFilterTag
        ? `<p class="p-main-board__empty p-main-board__empty--tight">このタグのタスクがありません</p>`
        : viewMode === 'mine'
          ? `<p class="p-main-board__empty">あなたに割り当てられたタスクはありません</p>`
          : '<p class="p-main-board__empty">全てのタスクが完了されました！</p>')
    : displayMissions.map(m => {
        const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
        const applicants = Array.isArray(m.claimApplicants) ? m.claimApplicants : [];
        const assignees  = Array.isArray(m.assignees) ? m.assignees : [];
        const iApplied   = applicants.includes(meId);
        const assigned   = _isAssigned(m);
        const myMission  = _isMyMission(m);
        const overdue    = m.claimDeadline && Date.now() > m.claimDeadline;

        // 応募期間中／確定後の表示
        let claimLine = '';
        if (m.selfClaim) {
          const modeBadge = `<span class="p-main-board__badge">担当の応募型タスク</span>`;
          let actionsBlock = '';

          if (!assigned) {
            const deadlineTxt = m.claimDeadline ? `期限 ${_fmtDeadline(m.claimDeadline)}` : '期限なし';
            // ★閲覧のみは応募できない（サーバーも 403 で弾く）。募集中であることは見せる
            if (viewOnly) {
              actionsBlock = `<span class="p-main-board__claim-note">担当を募集中</span>`;
            } else if (iApplied) {
              actionsBlock = `
                <span class="p-main-board__chip p-main-board__chip--applied">応募中</span>
                <button type="button" onclick="event.stopPropagation(); window._app.unclaimMissionAsSelf('${m.id}')"
                  class="p-main-board__claim-link">取り消し</button>`;
            } else if (overdue) {
              actionsBlock = `<span class="p-main-board__claim-note p-main-board__claim-note--closed">応募期限終了</span>`;
            } else {
              actionsBlock = `<button type="button" onclick="event.stopPropagation(); window._app.claimMissionAsSelf('${m.id}')"
                class="p-main-board__claim-button">応募する</button>`;
            }
            actionsBlock += `<span class="p-main-board__claim-note">応募 ${applicants.length}名・${deadlineTxt}</span>`;
            if (canMgr && applicants.length > 0) {
              actionsBlock += `<button type="button" onclick="event.stopPropagation(); window._app.openSelectClaimModal('${m.id}')"
                class="p-main-board__claim-link p-main-board__claim-link--action">選定する</button>`;
            }
          } else {
            const names = _resolveUserChips(p, assignees);
            actionsBlock = `<span class="p-main-board__claim-note p-main-board__claim-note--done">担当：${names}</span>`;
          }

          claimLine = `<div class="p-main-board__claim">${actionsBlock}</div>`;
          m._modeBadge = modeBadge;
        }

        // 通常担当（担当応募型でない）の担当者表示
        let assigneeLine = '';
        if (!m.selfClaim) {
          if (assignees.length > 0) {
            const names = _resolveUserChips(p, assignees);
            assigneeLine = `<p class="p-main-board__mission-assignee">担当：${names}</p>`;
          } else if (m.assignee?.type === 'role') {
            const roleObj = (p.roles || []).find(r => r.id === m.assignee.roleId);
            if (roleObj) assigneeLine = `<p class="p-main-board__mission-assignee">担当：${_esc(roleObj.name)}</p>`;
          }
        }

        const modeBadgeHtml = m._modeBadge || '';

        // 個別完了モード
        const indivClearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [];
        const iIndivDone = m.individualClear && indivClearedBy.includes(meId);

        // 全カードタップ可：タスク詳細ページへ遷移（完了入力欄はページ側で出し分け）
        const cardOnClick = `onclick="window._app.openMissionDetail('${m.id}')"`;


        const _indivHasAssignees = (Array.isArray(m.assignees) && m.assignees.length > 0) || m.assignee?.type === 'user';
        const _indivTotal = Array.isArray(m.assignees) && m.assignees.length > 0
          ? m.assignees.length : (m.assignee?.type === 'user' ? 1 : 0);
        const indivProgressBadge = m.individualClear
          ? (iIndivDone
              ? `<span class="p-main-board__chip p-main-board__chip--done">自分済み ✓</span>`
              : (_indivHasAssignees
                  ? `<span class="p-main-board__chip">${indivClearedBy.length}/${_indivTotal}人完了</span>`
                  : ''))
          : '';

        return `
        <div ${cardOnClick} data-mission-id="${m.id}"
          class="p-main-board__mission u-animate-fade">
          <div class="p-main-board__mission-meta">
            ${tagNames.map(t => Components.Tag(t)).join('')}
            ${_missionDeadlineText(m)}
            ${modeBadgeHtml}
            ${indivProgressBadge}
          </div>
          <h3 class="p-main-board__mission-title">${_esc(m.title)}</h3>
          ${assigneeLine}
          ${claimLine}
          ${canMgr ? `
            <div onclick="event.stopPropagation(); window._app.toggleMissionMenu(event, '${m.id}')"
              class="p-main-board__mission-action">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
              </svg>
            </div>` : `
            <div onclick="event.stopPropagation(); window._app.copyMissionLink('${m.id}')"
              class="p-main-board__mission-action"
              aria-label="リンクをコピー">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </div>`}
        </div>`;});

  const missionCards = Array.isArray(missionCardList)
    ? _withMonthHeadings(displayMissions, missionCardList)
    : missionCardList;

  // 担当応募待ちタスク（selfClaim=true かつ applicants あり かつ未確定）
  const pendingClaimMissions = canMgr
    ? p.missions.filter(m =>
        m.selfClaim &&
        m.status !== 'cleared' &&
        Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
        !(Array.isArray(m.assignees) && m.assignees.length > 0)
      )
    : [];

  const pendingMembers    = canMgr ? (p.pendingMembers   || []) : [];

  const hasDates = Array.isArray(p.dates) && p.dates.length > 0;
  const _dateChip = (() => {
    if (!hasDates) return `<span class="p-main-board__date-text p-main-board__date-text--muted">開催日時が設定されていません</span>`;
    const today = todayStr();
    const sorted = [...p.dates].sort();
    const firstDate = sorted[0];
    const lastDate  = sorted[sorted.length - 1];
    const todayIdx  = sorted.indexOf(today);
    if (todayIdx !== -1) {
      const dayNum = todayIdx + 1;
      const isFirst = dayNum === 1;
      const isLast  = todayIdx === sorted.length - 1;
      if (isFirst) return `<span class="p-main-board__date-text">Day${dayNum} / いよいよ今日から！</span>`;
      if (isLast)  return `<span class="p-main-board__date-text">Day${dayNum} / ついに最終日！</span>`;
      return `<span class="p-main-board__date-text"><span class="p-main-board__date-count">Day${dayNum}</span></span>`;
    }
    if (today > lastDate) {
      const fmt = s => { const [, m, day] = s.split('-'); return `${parseInt(m)}月${parseInt(day)}日`; };
      const range = (firstDate === lastDate)
        ? `${fmt(firstDate)}開催`
        : `${fmt(firstDate)}〜${fmt(lastDate)}開催`;
      return `<span class="p-main-board__date-text p-main-board__date-text--muted">${range}</span>`;
    }
    // 開催前：保存値 p.daysLeft は stale になるので firstDate から当日基準で再計算する
    return `<span class="p-main-board__date-text">開催まで残り <span class="p-main-board__date-count">${calculateDaysLeft(firstDate)}</span> 日</span>`;
  })();
  // 上部固定領域：日付チップ・お知らせ・各バナー（スクロールしない）
  const pinnedAux = `
    <div class="p-main-board__pinned">
      <!-- ★日付チップの行。通知への入口（ベル）はこの行の右端に置く。
           下のタブバーからは外してあるので、**ここが唯一の入口**。消さないこと。
           ★チップは行の中で中央に置きたいので、左端にベルと同じ幅の空きを作る
           （justify-content: space-between だとチップが左へ寄る）。 -->
      <div class="p-main-board__date-row">
        <span class="p-main-board__date-spacer" aria-hidden="true"></span>
        <div onclick="window._app.openEventCalendarSheet()" data-log="event_calendar_open" data-coach="days-left"
          class="p-main-board__date-chip">
          <img src="/images/icon/icon-Calender.svg" class="p-main-board__date-icon" alt="">
          ${_dateChip}
        </div>
        <button type="button" onclick="window._app.setTab('NOTIFICATIONS')" data-notif-entry
          data-log="notif_open" class="p-main-board__notif" aria-label="通知">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          ${Components.unreadCountFor(p.id) > 0
            ? `<span class="p-main-board__notif-badge">${Components.badgeText(Components.unreadCountFor(p.id))}</span>`
            : ''}
        </button>
      </div>

      <!-- アナウンスカード -->
      ${_renderAnnounceCards(p, meId)}

      <!-- 承認待ちメンバーバナー（管理者のみ・該当がある場合のみ表示）-->
      ${pendingMembers.length > 0 ? _renderPendingMembersBanner(pendingMembers) : ''}

      <!-- 応募待ちアナウンスバナー（管理者のみ・該当がある場合のみ表示）-->
      ${pendingClaimMissions.length > 0 ? _renderClaimAnnouncementBanner(p, pendingClaimMissions) : ''}
    </div>`;

  // ★提案キャラクターの行は「スクロールする本文」から出して、パネルの直下に置く。
  //   キャラは波の装飾に重なるようパネルの上端より上へはみ出すので、
  //   overflow-y:auto の中に入れたままだと上側が切り取られる。
  // ★提案しないイベント（開催日を過ぎた・完了・フェーズが振り返り/完了）では、
  //   キャラクターごと出さない。やることを増やす提案は、片付ける段階のチームには邪魔で、
  //   「N時間後に新しい提案が届きます」と待たせるのも嘘になる（判定は state._proposalsAllowed）。
  const proposalsRow = !state._proposalsAllowed(p) ? '' : `
      <!-- 提案カード（管理者権限のあるユーザーのみ表示）-->
      ${canMgr ? `
        <div class="p-main-board__proposals${state.charactersIntro ? ' is-intro' : ''}${state.proposalsRevealed ? ' is-revealing' : ''}" data-coach="proposals">
          ${proposalCards}
          ${(() => {
            // ★空きスロットもキャラクターで埋める（枠は常に3つ・位置固定）。
            //   生成中＝会議している見た目、更新待ち＝寝ている見た目。
            const missing = PROPOSAL_CHARACTERS.length - orderedProposals.length;
            if (missing <= 0) return '';
            const generating = !p.lastProposalGeneratedAt || state._proposalFetching;
            const nextAt = (p.lastProposalGeneratedAt || 0) + 12 * 60 * 60 * 1000;
            const remHr  = Math.ceil(Math.max(0, nextAt - Date.now()) / (1000 * 60 * 60));
            const label  = generating
              ? 'AIが提案を<br>生成中'
              : (remHr <= 0 ? '準備中...' : `${remHr}時間後に<br>新しい提案が<br>届きます`);
            return PROPOSAL_CHARACTERS.slice(orderedProposals.length).map((ch, k) =>
              _characterBoxHtml(ch, orderedProposals.length + k, {
                state: generating ? 'meeting' : 'sleeping',
                badge: false,
                inner: `<p class="p-main-board__proposal-wait-text">${label}</p>`,
              })).join('');
          })()}
        </div>` : ''}`;

  // 下部パネルの中身：タスク一覧（背景レイヤーの山がカードの隙間から見える）
  const bottomPanelInner = `
      <!-- やること一覧（下部パネル内。山ビジュアルはこのパネルの裏側＝上部スクロール窓側で見える） -->
      <section data-coach="mission-list">
        <!-- 表示モード切替（私のみ / 全て）-->
        <div class="p-main-board__view-toggle">
          <button type="button" onclick="window._app.setMissionViewMode('mine')"
            class="p-main-board__view-button${viewMode === 'mine' ? ' is-active' : ''}">
            私のやること
          </button>
          <button type="button" onclick="window._app.setMissionViewMode('all')"
            class="p-main-board__view-button${viewMode === 'all' ? ' is-active' : ''}">
            みんなのやること
          </button>
        </div>
        ${tagFilterHtml}
        <div class="p-main-board__mission-list">${missionCards}</div>
      </section>`;

  return { pinnedAux, proposalsRow, bottomPanelInner };
}

// ===== 承認待ちメンバーバナー（管理者向け）=====
function _renderPendingMembersBanner(members) {
  return `
    <div onclick="window._app.openPendingMembersSheet()"
      class="p-main-board__banner p-main-board__banner--pending">
      <div class="p-main-board__banner-head">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>
        </svg>
        <p class="p-main-board__banner-text">参加申請が届いています（${members.length}件）</p>
      </div>
    </div>`;
}

// ===== 応募待ちアナウンスバナー（管理者向け）=====
function _renderClaimAnnouncementBanner(p, missions) {
  const rows = missions.map(m => {
    // ★チップ（アバター＋名前）。HTML なので下で _esc に通さないこと
    const names = _resolveUserChips(p, m.claimApplicants);

    return `
      <div class="p-main-board__claim-row">
        <div class="p-main-board__claim-body">
          <p class="p-main-board__claim-title">${_esc(m.title)}</p>
          <p class="p-main-board__claim-names">${names}</p>
        </div>
        <button type="button" onclick="event.stopPropagation(); window._app.openSelectClaimModal('${m.id}')"
          class="p-main-board__claim-select">
          選定する
        </button>
      </div>`;
  }).join('');

  return `
    <div class="p-main-board__banner p-main-board__banner--pending p-main-board__banner--static">
      <div class="p-main-board__banner-head p-main-board__banner-head--spaced">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <p class="p-main-board__banner-text">タスクへの応募があります（${missions.length}件）</p>
      </div>
      <div>${rows}</div>
    </div>`;
}

function _renderAnnounceCards(p, meId) {
  const active = [...(p.missions || [])].filter(m => {
    if (!m.announce || m.status === 'cleared') return false;
    const hasAssignee = m.assignee || (Array.isArray(m.assignees) && m.assignees.length > 0);
    if (!hasAssignee) return true;
    if (m.assignee?.type === 'user' && m.assignee.userId === meId) return true;
    if (Array.isArray(m.assignees) && m.assignees.includes(meId)) return true;
    if (m.assignee?.type === 'role') {
      const mem = (p.members || []).find(x => x.userId === meId);
      if (mem && Array.isArray(mem.roles) && mem.roles.includes(m.assignee.roleId)) return true;
    }
    return false;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // 新しい順

  if (active.length === 0) return '';

  const _deadlineLabel = (m) => {
    if (!Array.isArray(m.dates) || m.dates.length === 0) return '';
    const end = [...m.dates].sort().at(-1);
    const target = new Date(end); target.setHours(0,0,0,0);
    const now = new Date(); now.setHours(0,0,0,0);
    const diff = Math.ceil((target - now) / 86_400_000);
    // アナウンスカード内の締め切り。タスクカードより1段小さい
    const cls = 'p-main-board__deadline p-main-board__deadline--sm';
    if (diff < 0)   return `<span class="${cls} p-main-board__deadline--urgent">${-diff}日超過</span>`;
    if (diff === 0) return `<span class="${cls} p-main-board__deadline--urgent">今日まで</span>`;
    return `<span class="${cls}">残り${diff}日</span>`;
  };

  // タップでタスク詳細ページを開く（タスクカードと同挙動）
  const _cardClick = (m) => `onclick="window._app.openMissionDetail('${m.id}')"`;

  // ★説明を出すのは1件のときだけ。複数を畳んで並べるときは、どれが何かを
  //   拾えることが優先なのでタイトルだけにする（説明まで出すと一覧が縦に伸び、
  //   ボードが見えなくなる）。
  const cardHtml = (m, withDesc) => `
    <div ${_cardClick(m)} class="p-main-board__announce-card">
      <div class="p-main-board__announce-body">
        <svg class="p-main-board__announce-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <div class="p-main-board__announce-main">
          <p class="p-main-board__announce-title">${_esc(m.title)}</p>
          ${withDesc && m.description
            ? `<p class="p-main-board__announce-text">${_esc(m.description)}</p>` : ''}
          <div class="p-main-board__announce-meta">
            ${_deadlineLabel(m)}
          </div>
        </div>
      </div>
    </div>`;

  // 1件だけ：説明も出す（2行で打ち切る）
  if (active.length === 1) {
    return cardHtml(active[0], true);
  }

  // ★2件以上：いちばん新しい1件だけを常に見せ、残りはプルダウンの中に隠す。
  //   全部並べるとボードの上半分がアナウンスで埋まり、肝心のタスクが
  //   見えなくなる。並びは新しい順（active は createdAt の降順）。
  const [newest, ...rest] = active;
  return `
    <div class="p-main-board__announce">
      ${cardHtml(newest, false)}
      <button type="button" onclick="window._app.toggleAnnounceList()"
        class="p-main-board__announce-toggle">
        <span class="p-main-board__announce-toggle-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          ${_announceExpanded ? '他のアナウンスを隠す' : `他のアナウンス${rest.length}件を見る`}
        </span>
        <svg class="p-main-board__announce-chevron${_announceExpanded ? ' is-open' : ''}"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      ${_announceExpanded
        ? `<div class="p-main-board__announce-list">${rest.map(m => cardHtml(m, false)).join('')}</div>`
        : ''}
    </div>`;
}

// ── アーカイブ：概要カードスロット識別 ───────────────────────────
// Layer 1（概要カード）が読むスロット。ここに一致するものは Layer 2（記録）から外す。
//
// ★def-2（タイトル）/ def-3（概要）は**外さない**（2026-09-02 に変更）。
//   自動生成されるタスクとして本人が完了させるものなので、完了しても
//   記録に出てこないと「やったのに残らない」と受け取られる。概要カードにも
//   同じ内容が出るが、あちらは要約、こちらは作業の記録で役割が違う。
// ★p1 / p3 は提案から作られたタスク（会場・メインビジュアル）。旧データでは概要欄の
//   「場所」「ヘッダー画像」の読み替え元なので、記録には並べない。
// ★p2（広報リンク）は外さない（2026-09-26）。URL の欄を廃止したので、隠すとアーカイブの
//   どこにも出なくなる。ふつうのタスクとして記録に並べる。
const _OVERVIEW_IDS     = new Set();
const _OVERVIEW_ORIGINS = new Set(['p1', 'p3']);
const _ARCHIVE_TAG_ORDER = ['企画', '運営', '制作', '広報'];

function _isOverviewMission(m) {
  return _OVERVIEW_IDS.has(m.id) || _OVERVIEW_ORIGINS.has(m.originProposalId);
}

// ===== アーカイブタブ =====
//
// ★1本の文書として読ませる（2026-09-26。Phase 3）。並びは
//   ヘッダー画像 → タイトル → 概要 → 期間・場所 → 目次 → タスクごとの内容。
// ★閲覧（既定）は囲みを持たず、余白と見出しで区切る（カードにしない。通読のため）。
//   編集モード（管理者だけ。state.archiveEditing）では、各タスクに囲みを出し、
//   未完了のタスクも下にまとめて並べる。見た目の切り替えは .p-archive--editing だけ。
// ★目次の並びは 3つ（ラベル別・完了日順・優先度順）。本文も同じ順に並ぶ。
//   「完了者別」「作成者別」「やること一覧」は廃止した（目次と役割が重なる）。
// ★目次のタップはその記録までスクロールする（_scrollToArchiveEntry。通知からの遷移と共用）。

// 目次・本文の並び（state.archiveDisplayMode）。★この3つ以外が残っていたらラベル別に戻す
const _ARCHIVE_MODES = [
  { id: 'label',    label: 'ラベル別' },
  { id: 'date',     label: '完了日順' },
  { id: 'priority', label: '優先度順' },
];

function _archiveTagOf(m) {
  return (Array.isArray(m.tags) && m.tags.length > 0 ? m.tags[0] : null) || m.tag || '企画';
}

// 並べ替えた「節」の配列を返す。label のときは [{ heading, missions }]、ほかは見出し無しの1節
function _archiveSections(p, missions, mode) {
  if (mode === 'date') {
    const sorted = [...missions].sort((a, b) =>
      (p.clearedData?.[b.id]?.timestamp ?? 0) - (p.clearedData?.[a.id]?.timestamp ?? 0));
    return [{ heading: null, missions: sorted }];
  }
  if (mode === 'priority') {
    return [{ heading: null, missions: [...missions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)) }];
  }
  const groups = {};
  for (const m of missions) (groups[_archiveTagOf(m)] ||= []).push(m);
  // ビルトインの4つを先に、カスタムタグは後ろに
  const order = [..._ARCHIVE_TAG_ORDER.filter(t => groups[t]), ...Object.keys(groups).filter(t => !_ARCHIVE_TAG_ORDER.includes(t))];
  return order.map(tag => ({ heading: tag, missions: groups[tag] }));
}

function _renderArchiveTab(p) {
  const canMgr  = state.canManageCurrentEvent();
  // ★編集できるのは管理者だけ。権限が無いのに編集中のまま残っていたら閲覧に戻す
  const editing = canMgr && !!state.archiveEditing;
  // ★閲覧中でも、管理者は欄をタップすればそこから編集に入れる（archiveInlineEdit.js の bindArchiveTapToEdit）
  const tap = (target) => (canMgr && !editing ? ` data-archive-tap="${_esc(target)}"` : '');

  // ── 基礎情報（すべてイベント自身の項目。utils.js の getter が旧データも読み替える）──
  const title      = p.name || '未設定';
  const summary    = getArchiveSummary(p);
  const mainVisual = getEventMainVisual(p);
  const venue      = getArchiveVenue(p);
  const period     = p.dates?.length > 0
    ? formatEventPeriodLines(p.dates, p.dateTimes).join('<br>')
    : (p.clearedData?.['period-temp']?.content ? _esc(p.clearedData['period-temp'].content) : '');

  // ── 記録（完了したタスク。概要欄の読み替え元 p1 / p3 は除く）──
  const cleared = (p.missions || []).filter(m => m.status === 'cleared' && !_isOverviewMission(m));
  const mode    = _ARCHIVE_MODES.some(x => x.id === state.archiveDisplayMode) ? state.archiveDisplayMode : 'label';
  const sections = _archiveSections(p, cleared, mode);
  // ★未完了は編集モードでだけ出す（閲覧は読み物なので完了したものだけ）
  const pending = editing
    ? (p.missions || []).filter(m => m.status !== 'cleared' && !_isOverviewMission(m))
    : [];

  const tocHtml = cleared.length === 0 ? '' : `
    <nav class="p-archive__toc" aria-label="目次">
      <div class="p-archive__toc-head">
        <h2 class="p-archive__toc-title">目次</h2>
        <span class="p-archive__toc-count">${cleared.length}件</span>
      </div>
      <div class="p-archive__modes" role="tablist">
        ${_ARCHIVE_MODES.map(x => `
          <button type="button" role="tab" aria-selected="${mode === x.id}"
            onclick="window._app.setArchiveDisplayMode('${x.id}')"
            class="p-archive__mode${mode === x.id ? ' is-active' : ''}">${x.label}</button>`).join('')}
      </div>
      ${sections.map((sec, si) => `
        ${sec.heading ? `<p class="p-archive__toc-group">
          <span class="p-archive__category-dot" style="--tag-color:${_esc((LABEL_CONFIG[sec.heading] || {}).color || '#A7AAAC')}"></span>
          ${_esc(sec.heading)}</p>` : ''}
        <ol class="p-archive__toc-list" start="${1 + sections.slice(0, si).reduce((n, x) => n + x.missions.length, 0)}">
          ${sec.missions.map(m => `
            <li><button type="button" class="p-archive__toc-item" data-log="archive_toc_jump"
              data-toc-mission="${_esc(m.id)}" onclick="window._app.jumpToArchiveEntry('${m.id}')">${_esc(m.title)}</button></li>`).join('')}
        </ol>`).join('')}
    </nav>`;

  const bodyHtml = cleared.length === 0
    ? `<p class="p-archive__empty">完了したタスクがここに記録されます</p>`
    : sections.map(sec => `
        <section class="p-archive__section">
          ${sec.heading ? `<h2 class="p-archive__section-title">${_esc(sec.heading)}</h2>` : ''}
          ${sec.missions.map(m => _renderArchiveEntry(p, m, editing)).join('')}
        </section>`).join('');

  const pendingHtml = !editing || pending.length === 0 ? '' : `
    <details class="p-archive__pending">
      <summary class="p-archive__pending-summary">未完了のタスク（${pending.length}件）</summary>
      <p class="p-archive__pending-note">編集中だけ表示しています。完了すると記録に並びます</p>
      ${pending.map(m => _renderArchivePendingEntry(m, p)).join('')}
    </details>`;

  const hasDatesA = Array.isArray(p.dates) && p.dates.length > 0;
  return `
    <div class="p-archive${editing ? ' p-archive--editing' : ''}${canMgr && !editing ? ' p-archive--tap-edit' : ''} u-page-transition">
      <div class="p-archive__head">
        <div onclick="window._app.openEventCalendarSheet()" data-log="event_calendar_open"
          class="p-archive__days">
          <img src="/images/icon/icon-Calender.svg" class="p-archive__days-icon" alt="">
          ${hasDatesA
            ? `<span class="p-archive__days-text">残り <span class="p-archive__days-count">${calculateDaysLeft([...p.dates].sort()[0])}</span> 日</span>`
            : `<span class="p-archive__days-text p-archive__days-text--muted">未設定</span>`}
        </div>
        <div class="p-archive__head-actions">
          <!-- ★コピーされるのは「未完了・締め切りあり」全件（記録の中身ではない）。 -->
          <button type="button" onclick="window._app.copySchedule('archive')"
            data-log="schedule_copy" class="p-archive__copy" aria-label="予定をコピー">
            <img src="/images/icon/icon-Link.svg" alt="" class="p-archive__copy-icon">
            予定をコピー
          </button>
          ${canMgr && !editing ? `
            <button type="button" onclick="window._app.toggleArchiveEditing()" data-log="archive_edit_toggle"
              class="p-archive__edit-toggle">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
              編集する
            </button>` : ''}
        </div>
      </div>

      <!-- ① ヘッダー画像（3:2。ホームのサムネイルと同じ比率）-->
      <div class="p-archive__visual"${tap('image')}>
        ${mainVisual
          ? `<img src="${_esc(mainVisual)}" class="p-archive__visual-image" alt="" data-fallback="archive-visual">`
          : Components.ThumbnailEmptyState()}
        ${editing ? `<button type="button" onclick="window._app.editArchiveItem('image')" class="p-archive__visual-edit">画像を変更</button>` : ''}
      </div>

      <article class="p-archive__doc">
        <!-- ② タイトル（＝イベント名）-->
        <div class="p-archive__title-row" data-inline-block>
          ${editing ? `
            <h1 class="p-archive__title p-archive__inline" contenteditable="true" role="textbox" aria-label="タイトル"
              data-inline="title" data-inline-key="title" data-placeholder="タイトル">${_esc(p.name || '')}</h1>
            <span class="p-archive__save-status" data-save-status></span>`
          : `<h1 class="p-archive__title"${tap('title')}>${_esc(title)}</h1>`}
        </div>

        <!-- ③ 概要と基礎情報 -->
        <section class="p-archive__intro">
          <div data-inline-block>
            <div class="p-archive__label-row">
              <h2 class="p-archive__label">概要</h2>
              ${editing ? `<span class="p-archive__save-status" data-save-status></span>` : ''}
            </div>
            ${editing ? `
              <p class="p-archive__summary p-archive__inline${summary ? '' : ' is-empty'}" contenteditable="true" role="textbox"
                aria-multiline="true" aria-label="概要" data-inline="summary" data-inline-key="summary"
                data-placeholder="どんなイベントか、数行で">${_esc(summary)}</p>`
              : `<p class="p-archive__summary${summary ? '' : ' is-empty'}"${tap('summary')}>${summary ? linkifyText(summary) : '未設定'}</p>`}
          </div>
          <dl class="p-archive__facts">
            <dt class="p-archive__fact-label">期間</dt>
            <dd class="p-archive__fact-value"${tap('period')}>${period || '未設定'}
              ${editing ? `<button type="button" onclick="window._app.editArchiveItem('period')" class="p-archive__inline-button">変更</button>` : ''}</dd>
            <dt class="p-archive__fact-label">場所</dt>
            <dd class="p-archive__fact-value" data-inline-block${tap('venue')}>
              ${editing ? `
                <span class="p-archive__inline p-archive__inline--line${venue ? '' : ' is-empty'}" contenteditable="true" role="textbox"
                  aria-label="場所" data-inline="venue" data-inline-key="venue" data-placeholder="例：大学ギャラリー">${_esc(venue)}</span>
                <span class="p-archive__save-status" data-save-status></span>`
              : (venue ? _esc(venue) : '未設定')}
            </dd>
          </dl>
        </section>

        <!-- ④ 目次 -->
        ${tocHtml}

        <!-- ⑤ タスクごとの内容 -->
        <div class="p-archive__body">${bodyHtml}</div>
        ${pendingHtml}
      </article>

      ${editing ? `
        <!-- 編集中の帯（画面の下に常に出す）。★保存は欄ごとに自動。完了で保存待ちを流してから閲覧に戻る -->
        <div class="p-archive__editbar" role="status">
          <span class="p-archive__editbar-text">編集中・変更は自動で保存されます</span>
          <button type="button" onclick="window._app.toggleArchiveEditing()" data-log="archive_edit_done"
            class="c-button c-button--primary p-archive__editbar-done">完了</button>
        </div>` : ''}

      <!-- 振り返り用のサブページ。★メンバー全員が見られる（アーカイブと同じ）。 -->
      <div class="p-archive__links">
        <button type="button" onclick="window._app.openArchiveAnswers()" data-log="archive_answers_open"
          class="p-archive__link">
          <div>
            <p class="p-archive__link-title">メンバーの回答を見る</p>
            <p class="p-archive__link-sub">参加するときに答えてもらった内容</p>
          </div>
          <svg class="p-archive__link-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <button type="button" onclick="window._app.openArchiveStats()" data-log="archive_stats_open"
          class="p-archive__link">
          <div>
            <p class="p-archive__link-title">みんなの活躍を見る</p>
            <p class="p-archive__link-sub">完了数・作成数・ラベル別のグラフ</p>
          </div>
          <svg class="p-archive__link-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// 個別完了の提出者ごとの行：開いている行（`${missionId}:${userId}`）と「他N人」を開いたタスク。
// ★モジュールで持つ（SSE で描き直されても開いたまま。通知のまとめと同じ方式）
const _archiveOpenRows = new Set();
const _archiveShowAll  = new Set();
const ARCHIVE_ROWS_VISIBLE = 3;

export function rememberArchiveRow(rowKey, open) {
  if (open) _archiveOpenRows.add(rowKey); else _archiveOpenRows.delete(rowKey);
}

export function showAllArchiveSubmitters(missionId) {
  _archiveShowAll.add(missionId);
  state.render();
}

// 提出物1つぶんの中身（文章・画像・PDF・振り返り・編集ボタン）。
// userId … 個別完了のときだけ（その人の提出物）
function _archiveSubmissionHtml(p, m, cd, editing, userId = null) {
  if (!cd) return '';
  if (editing) return _archiveSubmissionEditHtml(p, m, cd, userId);
  const canMgr = state.canManageCurrentEvent();
  // ★管理者はタップでその欄から編集に入れる（bindArchiveTapToEdit）。値は「sub|ref:タスク:人」
  const tapKey = `${m.id}:${userId || ''}`;
  const tap = (kind) => (canMgr ? ` data-archive-tap="${kind}:${_esc(tapKey)}"` : '');
  // ★画像・PDF は本文の途中にも入る。読み分けは utils.js の submissionSegments
  const contentHtml = submissionSegments(cd).map(seg => {
    if (seg.type === 'image') {
      return `<img src="${_esc(seg.url)}" class="p-archive__content-image" alt="提出画像" loading="lazy" data-fallback="submission">`;
    }
    if (seg.type === 'file') return `<div class="p-archive__content-file">${Components.SubmissionFileCard(seg.file, p.id)}</div>`;
    return `<p class="p-archive__content-text">${linkifyText(seg.text)}</p>`;
  }).join('');

  // ── 振り返り（見出しは成否で変える。missionDetail.js の _reflectionHtml と同じ）──
  // ★初期タスク（目的・企画の整理）には振り返りを出さない（REFLECT_SKIP_MISSION_IDS）
  // ★編集できるのは提出した本人と管理者だけ（サーバーも同じ判定）
  const skipReflect = REFLECT_SKIP_MISSION_IDS.includes(m.id);
  const struggle = String(cd.struggle || '').trim();
  const solution = String(cd.solution || '').trim();
  const labels   = REFLECT_LABELS[cd.outcome] || REFLECT_LABELS.struggle;
  const isMine   = cd.submittedBy === state.currentUser?.id;
  const canEditReflection = !skipReflect && (canMgr || isMine);
  const reflectRow = (label, text) => text
    ? `<div class="p-archive__reflect-row">
         <p class="p-archive__reflect-label">${label}</p>
         <p class="p-archive__reflect-text">${linkifyText(text)}</p>
       </div>` : '';
  const hasReflect = struggle || solution;
  const uidArg = userId ? `, '${_esc(userId)}'` : '';
  const reflectHtml = skipReflect || (!hasReflect && !(editing && canEditReflection)) ? '' : `
    <div class="p-archive__reflect"${tap('ref')}>
      ${hasReflect ? reflectRow(labels.struggle, struggle) + reflectRow(labels.solution, solution)
        : `<p class="p-archive__reflect-empty">振り返りは未記入です</p>`}
      ${canEditReflection && (editing || isMine) ? `
        <button type="button" onclick="event.stopPropagation(); window._app.openReflectionEdit('${m.id}'${uidArg})"
          class="p-archive__reflect-edit">${hasReflect ? '編集' : '書く'}</button>` : ''}
    </div>`;

  return `<div class="p-archive__content"${tap('sub')}>${contentHtml}</div>` + reflectHtml;
}

// 編集モード：提出内容と振り返りをその場で直す（archiveInlineEdit.js が中身を入れて配線する）
// ★data-inline-key は描き直しをまたいで欄を守る目印（書いている途中なら DOM ごと差し戻す）
function _archiveSubmissionEditHtml(p, m, cd, userId) {
  const key = userId ? `${m.id}_u_${userId}` : m.id;
  const skipReflect = REFLECT_SKIP_MISSION_IDS.includes(m.id);
  const labels = REFLECT_LABELS[cd.outcome] || REFLECT_LABELS.struggle;
  const reflectAttrs = (field) => `data-reflect-mission="${_esc(m.id)}" data-reflect-user="${_esc(userId || '')}" data-reflect-field="${field}"`;
  return `
    <div class="p-archive__inline-editor" data-inline-block data-inline-key="sub:${_esc(key)}">
      <div class="c-editor-field">
        <div class="c-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true" aria-label="提出内容"
          data-mission-id="archive:${_esc(key)}" data-sub-mission="${_esc(m.id)}" data-sub-user="${_esc(userId || '')}"
          data-placeholder="提出内容"></div>
        <label class="c-editor-field__pick" aria-label="画像・PDF を追加">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          <input type="file" class="u-hidden" accept="image/*,application/pdf" multiple onchange="window._app.handleImageSelect(this)">
        </label>
      </div>
      <p class="p-archive__save-status" data-save-status></p>
    </div>
    ${skipReflect ? '' : `
      <div class="p-archive__reflect p-archive__reflect--editing" data-inline-block data-inline-key="ref:${_esc(key)}">
        <label class="p-archive__reflect-label">${labels.struggle}
          <textarea class="c-input c-input--block p-archive__reflect-input" rows="2" maxlength="200" ${reflectAttrs('struggle')}>${_esc(cd.struggle || '')}</textarea>
        </label>
        <label class="p-archive__reflect-label">${labels.solution}
          <textarea class="c-input c-input--block p-archive__reflect-input" rows="2" maxlength="200" ${reflectAttrs('solution')}>${_esc(cd.solution || '')}</textarea>
        </label>
        <div class="p-archive__reflect-share">${Components.ShareCheck({ checked: !!cd.shareable, attrs: reflectAttrs('shareable') })}</div>
        <p class="p-archive__save-status" data-save-status></p>
      </div>`}`;
}

// 個別完了：提出した人ごとに折りたためる行。最初は閉じていて、1行の要約で中身の見当がつく。
// ★3人まで出し、4人目以降は「他N人の提出を表示」で開く（文書を長くしない）
function _archiveIndividualHtml(p, m, editing) {
  const prefix = `${m.id}_u_`;
  const subs = Object.entries(p.clearedData || {})
    .filter(([k, cd]) => k.startsWith(prefix) && cd)
    .map(([k, cd]) => ({ uid: k.slice(prefix.length), cd }))
    .sort((a, b) => (a.cd.timestamp || 0) - (b.cd.timestamp || 0));
  // ★編集モードでは全員を出す（隠れている人の提出を直せなくなるため）
  const showAll = editing || _archiveShowAll.has(m.id);
  const visible = showAll ? subs : subs.slice(0, ARCHIVE_ROWS_VISIBLE);
  const hidden  = subs.length - visible.length;

  const rows = visible.map(({ uid, cd }) => {
    const mem = (p.members || []).find(x => x.userId === uid) || { userId: uid, username: '退会したメンバー' };
    const rowKey = `${m.id}:${uid}`;
    const text = submissionText(cd);
    const nImg = submissionImages(cd).length;
    const nPdf = (cd.files || []).length;
    const preview = [
      text ? _esc(text.length > 40 ? text.slice(0, 40) + '…' : text) : '',
      nImg ? `📷${nImg}` : '', nPdf ? `📄${nPdf}` : '',
    ].filter(Boolean).join(' ');
    return `
      <details class="p-archive__sub" ${_archiveOpenRows.has(rowKey) ? 'open' : ''}
        ontoggle="window._app.rememberArchiveRow('${_esc(rowKey)}', this.open)">
        <summary class="p-archive__sub-summary">
          ${Components.UserAvatar(mem, { size: 28 })}
          <span class="p-archive__sub-head">
            <span class="p-archive__sub-name">${_esc(mem.username || '')}
              ${cd.timestamp ? `<span class="p-archive__sub-date">${_fmtDate(cd.timestamp)} 提出</span>` : ''}</span>
            ${preview ? `<span class="p-archive__sub-preview">${preview}</span>` : ''}
          </span>
          <svg class="p-archive__sub-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="p-archive__sub-body">${_archiveSubmissionHtml(p, m, cd, editing, uid)}</div>
      </details>`;
  }).join('');

  // 編集モード：まだ提出していない担当者
  const assigneeIds = Array.isArray(m.assignees) && m.assignees.length > 0
    ? m.assignees : (m.assignee?.type === 'user' ? [m.assignee.userId] : []);
  const submitted = new Set(subs.map(x => x.uid));
  const notYet = editing
    ? assigneeIds.filter(id => !submitted.has(id)).map(id => (p.members || []).find(x => x.userId === id)?.username).filter(Boolean)
    : [];

  if (subs.length === 0 && notYet.length === 0) return '';
  return `
    <div class="p-archive__subs">
      ${rows}
      ${hidden > 0 ? `<button type="button" onclick="window._app.showAllArchiveSubmitters('${m.id}')"
        class="p-archive__subs-more">＋ 他${hidden}人の提出を表示</button>` : ''}
    </div>
    ${notYet.length ? `<p class="p-archive__subs-notyet">未提出：${notYet.map(_esc).join('、')}</p>` : ''}`;
}

// 1タスクぶんの記録（文書の1節）。★data-mission-id は目次・通知からのスクロール先の目印
// タスク名。★編集モードではその場で書き換えられる（archiveInlineEdit.js の _saveBasic。
//   空にはできない）。閲覧ではタップでタスク詳細へ（管理者も同じ。ここはタップで編集に入らない）
function _archiveEntryTitleHtml(m, editing) {
  if (!editing) {
    return `<button type="button" onclick="window._app.openMissionDetail('${m.id}')" class="p-archive__entry-title">${_esc(m.title)}</button>`;
  }
  return `
    <div class="p-archive__entry-title-row" data-inline-block>
      <h3 class="p-archive__entry-title p-archive__inline" contenteditable="true" role="textbox" aria-label="タスク名"
        data-inline="missionTitle" data-inline-mission="${_esc(m.id)}" data-inline-key="mtitle:${_esc(m.id)}"
        data-placeholder="タスク名">${_esc(m.title)}</h3>
      <span class="p-archive__save-status" data-save-status></span>
    </div>`;
}

function _renderArchiveEntry(p, m, editing) {
  const cd          = p.clearedData?.[m.id];
  const tagNames    = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
  // 個別完了は提出物が人数ぶんある（<mid>_u_<userId>）。完了日はいちばん新しい提出
  const indivSubs   = m.individualClear
    ? Object.entries(p.clearedData || {}).filter(([k]) => k.startsWith(`${m.id}_u_`)).map(([, x]) => x)
    : [];
  const lastTs      = m.individualClear ? Math.max(0, ...indivSubs.map(x => x?.timestamp || 0)) : cd?.timestamp;
  const completedAt = lastTs ? _fmtDate(lastTs) : '';

  const clearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [];
  const totalAssignees = Array.isArray(m.assignees) && m.assignees.length > 0
    ? m.assignees.length
    : (m.assignee?.type === 'user' ? 1 : clearedBy.length);
  const indivSummary = m.individualClear
    ? `<span class="p-archive__entry-indiv">${clearedBy.length}/${Math.max(1, totalAssignees)}人完了</span>` : '';

  // 右上：管理者はメニュー（リンクをコピー・編集する・未完了に戻す・削除する。閲覧でも編集中でも出す）／
  //        それ以外はリンクのコピー
  const actionBtn = state.canManageCurrentEvent() ? `
    <button type="button" onclick="event.stopPropagation(); window._app.openArchiveMissionMenu(event, '${m.id}')"
      class="p-archive__entry-action" aria-label="メニュー">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
      </svg>
    </button>` : `
    <button type="button" onclick="event.stopPropagation(); window._app.copyMissionLink('${m.id}')"
      class="p-archive__entry-action" aria-label="リンクをコピー">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    </button>`;

  return `
    <div data-mission-id="${_esc(m.id)}" class="p-archive__entry${_isArchiveFocused(m.id) ? ' is-focused' : ''}">
      <div class="p-archive__entry-head">
        ${_archiveEntryTitleHtml(m, editing)}
        ${actionBtn}
      </div>
      <div class="p-archive__entry-meta">
        ${tagNames.map(t => Components.Tag(t)).join('')}
        ${indivSummary}
        ${completedAt ? `<span class="p-archive__entry-date">${completedAt}完了</span>` : ''}
      </div>
      ${m.individualClear ? _archiveIndividualHtml(p, m, editing) : _archiveSubmissionHtml(p, m, cd, editing)}
    </div>`;
}

// 未完了のタスク（編集モードだけ）。提出内容は無いので、名前とラベルだけ。
// ★個別完了で途中まで提出があるものは、提出した人ごとの行も出す（直せるように）
function _renderArchivePendingEntry(m, p) {
  const tagNames = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
  const status = '未完了';
  return `
    <div data-mission-id="${_esc(m.id)}" class="p-archive__entry p-archive__entry--pending">
      <div class="p-archive__entry-head">
        ${_archiveEntryTitleHtml(m, true)}
      </div>
      <div class="p-archive__entry-meta">
        ${tagNames.map(t => Components.Tag(t)).join('')}
        <span class="p-archive__entry-date">${status}</span>
      </div>
      ${m.individualClear && p ? _archiveIndividualHtml(p, m, true) : ''}
    </div>`;
}

// ===== 通知タブ =====
function _renderNotificationsTab(p) {
  const canMgr = state.canManageCurrentEvent();

  // 応募待ちのタスク（管理者権限のあるユーザーのみ）
  const claimingMissions = canMgr
    ? p.missions.filter(m =>
        m.selfClaim &&
        m.status !== 'cleared' &&
        Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
        !(Array.isArray(m.assignees) && m.assignees.length > 0)
      )
    : [];

  // 応募待ちセクション
  const claimingHtml = claimingMissions.length === 0 ? '' : `
    <section class="p-notification__section">
      <h2 class="p-notification__title">応募待ち（${claimingMissions.length}件）</h2>
      <div class="p-notification__list">
        ${claimingMissions.map(m => {
          const applicants = m.claimApplicants || [];
          const applicantNames = applicants.map(uid => {
            const mem = (p.members || []).find(x => x.userId === uid);
            return mem ? `@${mem.username}` : '不明なユーザー';
          });
          return `
          <div class="p-notification__card p-notification__card--claim">
            <div class="p-notification__card-meta">
              <span class="p-notification__badge p-notification__badge--claim">応募あり</span>
              <span class="p-notification__card-sub">${applicants.length}名が応募中</span>
            </div>
            <h3 class="p-notification__card-title">${_esc(m.title)}</h3>
            <div class="p-notification__detail">
              <p class="p-notification__detail-label">応募者</p>
              <p class="p-notification__detail-text">${_esc(applicantNames.join('、'))}</p>
            </div>
            <button type="button" onclick="window._app.openSelectClaimModal('${m.id}')"
              class="p-notification__action p-notification__action--full p-notification__action--select">
              担当者を選定する
            </button>
          </div>`;
        }).join('')}
      </div>
    </section>`;

  // 通知一覧（このイベントに紐づく通知のみ。他イベントの通知は表示しない）
  const allNotifs = Array.isArray(state.notifications) ? state.notifications : [];
  const notifs = allNotifs.filter(n => n.eventId === p.id);
  const unreadCount = notifs.filter(n => !n.read).length;

  // 絞り込み。★既定は「未読があれば未読、無ければすべて」。
  //   本番では未読が 83%・9割が1か月より古いので、既定を「すべて」にすると
  //   開いた瞬間に読み終わった古い通知が画面を埋める。
  const filter = state.notifFilter || (unreadCount > 0 ? 'unread' : 'all');
  const shown = filter === 'unread' ? notifs.filter(n => !n.read) : notifs;

  const filterHtml = notifs.length === 0 ? '' : `
    <div class="p-notification__filter">
      ${Components.Segmented('notif-filter', [
        { id: 'unread', label: `未読${unreadCount > 0 ? ` ${Components.badgeText(unreadCount)}` : ''}`,
          onclick: "window._app.setNotifFilter('unread')", log: 'notif_filter_unread' },
        { id: 'all', label: 'すべて',
          onclick: "window._app.setNotifFilter('all')", log: 'notif_filter_all' },
      ], { active: filter, round: true, compact: true })}
    </div>`;

  const notifsHtml = shown.length === 0
    ? (filter === 'unread'
        ? `<p class="p-notification__empty">未読の通知はありません</p>`
        : `<p class="p-notification__empty">通知はありません</p>`)
    : _renderNotifGroups(shown, p);

  return `
    <div class="p-notification u-page-transition">
      ${claimingHtml}
      <section class="p-notification__section p-notification__section--grow">
        <div class="p-notification__head">
          <h2 class="p-notification__title">通知</h2>
          ${unreadCount > 0 ? `
            <button type="button" onclick="window._app.markAllNotificationsRead()"
              class="p-notification__read-all">すべて既読</button>` : ''}
        </div>
        ${filterHtml}
        ${notifsHtml}
      </section>
    </div>`;
}

/* ── 通知一覧の組み立て ──────────────────────────────────────────────
   ★本番実測（2026-09-21）：1画面に並ぶのは中央値8件・最大16件。**量は多くない**。
     読みづらさの正体は「全部が同じ見た目の一文」で、未読が 83%・9割が30日より古い、
     つまり**溜めっぱなしで誰も片づけていない**こと。そこで3つ入れてある：
       1. 未読／すべての絞り込み（既定は未読）
       2. 今日・昨日・今週・それ以前の見出し
       3. 同じタスクの通知をまとめる（作成→変更→完了が3行に散らない）
   ★件数が増えたら無限スクロールを、と考えないこと。1ユーザー100件
     （notificationStore の MAX_PER_USER）・TTL 90日で頭打ちになっている。 */

// 「同じタスクのまとめ」を開いている group のキー。
// ★モジュール変数に持つ（SSE の再描画をまたいで開いたままにするため）。
// ★開閉では state.render() を呼ばず、クラスの付け外しだけで済ませる
//   （描き直すとスクロール位置が飛ぶ。イベント設定のアコーディオンと同じ理由）。
const _openNotifGroups = new Set();

/** 通知を「今日 / 昨日 / 今週 / それ以前」に振り分けるときのキーと見出し */
function _notifDateBucket(ts) {
  const d = new Date(ts || 0);
  const today = new Date();
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(today) - dayStart(d)) / 86_400_000);
  if (days <= 0) return { key: 'today',  label: '今日' };
  if (days === 1) return { key: 'yday',   label: '昨日' };
  if (days < 7)   return { key: 'week',   label: '今週' };
  return { key: 'older', label: 'それ以前' };
}

/**
 * 1件ぶんの行（横スワイプで削除できるカード）。
 * ★`data-notif-id` はスワイプ削除が掴む目印。まとめても**行は1通ずつ**のままにして
 *   あるので、削除の単位は今までどおり1件（まとめて消えたりしない）。
 */
function _notifRowHtml(n, p, opts = {}) {
  const actor = n.actorId ? (p.members || []).find(m => m.userId === n.actorId) : null;
  // 本文は「〇〇 さんが…」で始まるものが多い。見出しに名前を出すので重複を削る
  //（role_assigned など名前で始まらない文面もあるため、消せたときだけ見出しを出す）
  let body = n.message || '';
  let head = '';
  if (n.actorName && body.startsWith(`${n.actorName} さんが`)) {
    body = body.slice(`${n.actorName} さんが`.length);
    head = n.actorName;
  }
  const avatar = actor
    ? Components.UserAvatar(actor, { size: 32 })
    : `<div class="p-notification__icon" style="--notif-color:${_notifIconBg(n.type)}">${_notifIcon(n.type)}</div>`;

  return `
    <div class="notif-swipe-row p-notification__row${opts.hidden ? ' is-collapsed' : ''}" data-notif-id="${n.id}">
      <div class="p-notification__row-delete">
        <svg class="p-notification__row-delete-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </div>
      <!-- ★p-notification__swipe-card は横スワイプの対象として JS が掴む目印 -->
      <div class="p-notification__swipe-card${n.read ? '' : ' is-unread'}"
        onclick="window._app.openNotification('${n.id}', '${n.missionId || ''}')">
        ${avatar}
        <div class="p-notification__body">
          <div class="p-notification__meta">
            <span class="p-notification__actor">${_esc(head)}</span>
            <span class="p-notification__time">${_formatNotifTime(n.createdAt)}</span>
          </div>
          <p class="p-notification__message">${_esc(body)}</p>
        </div>
        ${!n.read ? '<span class="p-notification__dot"></span>' : ''}
      </div>
    </div>`;
}

/** 日付の見出し＋同じタスクのまとめ、までを含んだ一覧 */
function _renderNotifGroups(list, p) {
  // 日付ごとに分ける（並びは元のまま＝新しい順）
  const buckets = [];
  for (const n of list) {
    const b = _notifDateBucket(n.createdAt);
    let cur = buckets.at(-1);
    if (!cur || cur.key !== b.key) { cur = { key: b.key, label: b.label, items: [] }; buckets.push(cur); }
    cur.items.push(n);
  }

  return buckets.map(b => {
    // 同じタスクの通知をまとめる。★まとめるのは同じ日付の見出しの中だけ
    //   （見出しをまたいでまとめると、まとめた側がどの日のものか言えなくなる）
    const groups = [];
    const byMission = new Map();
    for (const n of b.items) {
      if (!n.missionId) { groups.push([n]); continue; }
      const g = byMission.get(n.missionId);
      if (g) { g.push(n); continue; }
      const created = [n];
      byMission.set(n.missionId, created);
      groups.push(created);
    }

    const rows = groups.map(g => {
      if (g.length === 1) return _notifRowHtml(g[0], p);
      const key  = `${b.key}:${g[0].missionId}`;
      const open = _openNotifGroups.has(key);
      const unread = g.filter(n => !n.read).length;
      return `
        <div class="p-notification__group" data-notif-group="${key}">
          ${_notifRowHtml(g[0], p)}
          ${g.slice(1).map(n => _notifRowHtml(n, p, { hidden: !open })).join('')}
          <button type="button" onclick="window._app.toggleNotifGroup('${key}')"
            data-log="notif_group_toggled"
            class="p-notification__group-more" aria-expanded="${open}">
            <span>同じタスクの通知 他${g.length - 1}件${unread > 0 && !open ? `（未読${unread}）` : ''}</span>
            <svg class="p-notification__group-chevron" width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>`;
    }).join('');

    return `
      <h3 class="p-notification__date">${b.label}</h3>
      ${rows}`;
  }).join('');
}

/**
 * まとめの開閉。★描き直さずにクラスだけ付け外しする。
 * 開いたことは _openNotifGroups が覚えているので、SSE の再描画でも開いたまま。
 */
export function toggleNotifGroup(key) {
  const box = [...document.querySelectorAll('[data-notif-group]')]
    .find(el => el.dataset.notifGroup === key);
  if (!box) return;
  const open = !_openNotifGroups.has(key);
  if (open) _openNotifGroups.add(key); else _openNotifGroups.delete(key);
  box.querySelectorAll('.p-notification__row').forEach((row, i) => {
    if (i === 0) return;                      // 先頭（代表）は常に出す
    row.classList.toggle('is-collapsed', !open);
  });
  box.querySelector('.p-notification__group-more')?.setAttribute('aria-expanded', String(open));
}

// 通知アイコンの背景色。CSS 変数 --notif-color として渡す
// （種類ごとに色が違うだけなので、クラスを14個作るより変数1つが読みやすい）
function _notifIconBg(type) {
  switch (type) {
    case 'mission_cleared':
    case 'assignment_decided':
    case 'member_joined':         return 'var(--color-success-tint)';
    case 'assigned_to_me':
    case 'role_assigned':         return 'var(--color-primary-tint)';
    case 'someone_claimed':
    case 'mission_reverted':
    case 'self_claimed':          return 'var(--color-warning-tint)';
    case 'motivation_reaction':   return 'var(--color-danger-tint2)';
    case 'mission_created':
    case 'mission_updated':       return 'var(--color-violet-tint)';
    default: return 'var(--button-secondary)';
  }
}

function _notifIcon(type) {
  const cls = 'w-4 h-4';
  switch (type) {
    case 'mission_cleared':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#1A6B27" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'assigned_to_me':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#209DDB" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    case 'someone_claimed':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
    case 'assignment_decided':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#1A6B27" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>`;
    case 'member_joined':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#1A6B27" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>`;
    case 'role_assigned':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#209DDB" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7"/><polyline points="15 17 17 19 21 15"/></svg>`;
    case 'mission_created':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
    case 'mission_updated':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
    case 'mission_reverted':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
    case 'self_claimed':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#9b7700" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
    case 'motivation_reaction':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#EE3E12" stroke-width="2.5"><path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1.5.7-2.8 1.5-3.8"/><path d="M12 22a6 6 0 0 0 6-6c0-2-1-3.5-2-5 0 2-1.5 3-3 3s-3-1-3-3c-1 1.5-2 3-2 5a6 6 0 0 0 4 6z"/></svg>`;
    default:
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
  }
}

function _formatNotifTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000)    return 'たった今';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// タスクの残り日数テキスト（dates をソートし最終日から計算）
/**
 * 締切順のときだけ、タスクの間に月の見出しを差し込む。
 *
 * ★見出しを出すのは締切順のときだけ。優先度順・制作日順では並びが月と無関係なので、
 *   見出しを付けると嘘になる。
 * ★`missions` と `cards` は**同じ並び・同じ長さ**であること（添字で対応づける）。
 * ★超過したタスクも「その月」の見出しの下に置く（先頭に「超過」を作らない）。
 *   並びが日付順のままになり、規則が単純で予測しやすい。カードには赤字で
 *   「N日超過」と出るので、見落とすことはない。
 * ★締切が無いものは**末尾に「期限なし」**でまとめる。getSortedMissions が
 *   Infinity で最後尾に寄せているので、並べ替えはせず見出しだけ足す。
 *
 * @param {Array} missions 並び替え済みのタスク
 * @param {Array<string>} cards 同じ並びのカード HTML
 */
function _withMonthHeadings(missions, cards) {
  if (state.missionSortMode !== 'deadline') return cards.join('');

  const keys = missions.map(_deadlineMonthKey);
  // 年をまたぐときだけ見出しに年を出す（同じ年なら「9月」だけで足りる）
  const years = new Set(keys.filter(Boolean).map(k => k.slice(0, 4)));
  const withYear = years.size > 1;

  let prev;
  const out = [];
  for (let i = 0; i < cards.length; i++) {
    const k = keys[i];
    if (k !== prev) {
      out.push(`<h3 class="p-main-board__month">${_monthHeadingLabel(k, withYear)}</h3>`);
      prev = k;
    }
    out.push(cards[i]);
  }
  return out.join('');
}

/** 締切の月キー 'YYYY-MM'。締切が無ければ null
 *  ★m.dates は未ソートで保存される（落とし穴 12）。必ずソートしてから最終日を取る。 */
function _deadlineMonthKey(m) {
  const dates = Array.isArray(m?.dates) ? m.dates.filter(Boolean) : [];
  if (dates.length === 0) return null;
  return String([...dates].sort().at(-1)).slice(0, 7);
}

/** 見出しの文言。null は「期限なし」 */
function _monthHeadingLabel(key, withYear) {
  if (!key) return '期限なし';
  const [y, mo] = key.split('-');
  return withYear ? `${Number(y)}年 ${Number(mo)}月` : `${Number(mo)}月`;
}

function _missionDeadlineText(m) {
  if (!Array.isArray(m.dates) || m.dates.length === 0) {
    return '<span class="p-main-board__deadline">スケジュール未設定</span>';
  }
  const endDate = [...m.dates].sort().at(-1);
  const target = new Date(endDate);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diff = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  const cls = 'p-main-board__deadline';
  if (diff < 0)   return `<span class="${cls} ${cls}--urgent">${-diff}日超過</span>`;
  if (diff === 0) return `<span class="${cls} ${cls}--urgent">今日まで</span>`;
  return `<span class="${cls}">残り${diff}日</span>`;
}

// 締め切り系トースト（sessionStorage でセッション内重複抑制）
function _checkMissionDeadlineNotifications(missions) {
  if (!Array.isArray(missions)) return;
  const today = todayStr();
  // ★日数差（diff）の計算に要るので Date も持つ。時刻を 0 に落としてから引く
  //   （時刻が残っていると、同じ日でも切り上げで1日ずれる）。
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const toasts = [];
  for (const m of missions) {
    if (m.status === 'cleared') continue;
    if (!Array.isArray(m.dates) || m.dates.length === 0) continue;
    const sorted    = [...m.dates].sort();
    const startDate = sorted[0];
    const endDate   = sorted[sorted.length - 1];
    const target    = new Date(endDate);
    target.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    const title = m.title.length > 15 ? m.title.slice(0, 15) + '…' : m.title;

    if (startDate === endDate && today === startDate) {
      // 1日のみのタスク → 締め切り当日
      const key = `notif:${m.id}:single:${today}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」締め切り当日です`); }
    } else if (today === startDate) {
      // 期間スタート（複数日）
      const key = `notif:${m.id}:start:${today}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」の期間が始まりました・残り${diff}日`); }
    } else if (diff === 1) {
      // 締め切り前日
      const key = `notif:${m.id}:1day:${today}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」の締め切りまで残り1日`); }
    } else if (diff === 0) {
      // 締め切り当日（複数日タスクの最終日）
      const key = `notif:${m.id}:due:${today}`;
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); toasts.push(`「${title}」の締め切り当日です`); }
    }
  }

  toasts.forEach((msg, i) => {
    setTimeout(() => {
      const t = document.createElement('div');
      t.className = 'c-toast c-toast--wide';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => { t.style.transition = 'opacity 0.4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
    }, i * 600);
  });
}

// 応募期限の表示
function _fmtDeadline(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 完了日表示（M月D日）
function _fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * userId 配列 → アバター＋名前のチップ列（HTML）。
 *
 * ★アバターには userId を渡す。タップでプロフィールが開く（UserAvatar 側で
 *   stopPropagation しているので、タスクカードのタップとは干渉しない）。
 * ★max（既定3）人まで出し、超過分は「他N人」に集約する。カードの1行に収める
 *   ためで、ここを増やすとタスク一覧が縦に伸びる。
 * ★**戻り値は HTML**。埋め込む側で _esc に通さないこと（二重エスケープになる）。
 *   名前は中で _esc 済み。
 */
function _resolveUserChips(p, userIds, max = 3) {
  if (!Array.isArray(userIds) || userIds.length === 0) return '未確定';
  const shown = userIds.slice(0, max);
  const rest  = userIds.length - shown.length;
  const chips = shown.map(uid => {
    const member = (p.members || []).find(m => m.userId === uid);
    const name = member ? member.username : '不明なユーザー';
    return `<span class="p-main-board__user-chip">${
      Components.UserAvatar(member || { username: name }, { size: 20, userId: uid })
    }<span class="p-main-board__user-chip-name">${_esc(name)}</span></span>`;
  }).join('');
  return chips + (rest > 0 ? `<span class="p-main-board__user-more">他${rest}人</span>` : '');
}
