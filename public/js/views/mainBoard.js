// ===== メインボード画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { getSortedMissions, bindMissionInteractions } from '../modals/mission.js';
import { LABEL_CONFIG, PROPOSAL_CHARACTERS } from '../constants.js';
import { characterFigureHtml, sleepBubbleHtml } from '../character.js';
import { calculateDaysLeft, formatEventPeriodLines, getArchiveSummary, getArchiveVenue, todayStr } from '../utils.js';
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

  // ★ミッション完了の演出（1回きり）。submitMissionClear が status:'cleared' の
  //   ときだけ立てる。ここでは読むだけで、消費（フラグ倒し）は配線の最後に行う
  //   （HTML 構築で renderMountainBg に渡す必要があるため）。
  const celebrate = !!state.mountainCelebrate;
  // 演出中はパネルを通常位置へ戻す。70% まで上がったままだと山が見えず、
  // マスが色づくところを見せられない。
  if (celebrate) collapseMissionPanel();

  const isMain = state.mainBoardTab === 'MAIN';
  // MAIN タブはページ自体をスクロールさせない（上部＝山スクロール／下部＝提案・ミッションパネル）。
  // ARCHIVE / NOTIFICATIONS は従来どおり <main> のページスクロール。
  const mainLayout = isMain ? _renderMainTab(p) : null;

  // ★背景は <img> が 200 個近くある。innerHTML の差し替えで作り直すと毎回すべて
  //   再デコードされ、SSE のたびに一瞬白くなる。中身が同じなら DOM ごと使い回す。
  captureBgLayer();

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
        <!-- 下部パネル：提案＋ミッション一覧（独立スクロール・上ドラッグで拡大） -->
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
          class="l-fab l-fab--primary" aria-label="ミッションを作成">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>` : ''}
      ${state.mainBoardTab === 'MAIN' && !state.canManageCurrentEvent() && !state.isViewOnlyCurrentEvent() && state.currentUser ? `
        <button type="button" onclick="window._app.openMemberProposalSheet()"
          class="l-fab l-fab--member" aria-label="ミッションを提案">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
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
  }

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
    // ミッションカード：タップ＝完了モーダル（inline onclick）、管理者長押し＝編集/削除メニュー
    bindMissionInteractions(container, p, { useInlineTap: true });
  }
}

// 下部パネル（提案＋ミッション一覧）の開閉状態。再レンダリングをまたいで保持する。
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
  //   上げるとミッション一覧が読みやすくなる。トレードオフ。
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
    // ミッション完了の演出：上がっていた位置から通常位置へ滑らせて戻す。
    // 再描画で DOM は作り直されているので、まず元の位置に置いてから animate する。
    setTop(_panelReturnFrom);
    void panel.offsetHeight;          // ここで一度レイアウトさせないと transition が走らない
    panel.style.transition = SNAP;
    setTop(collapsedTop);
    // ミッション完了でパネルが戻る＝キャラも戻ってくる
    setCharState(false, true);
    _panelReturnFrom = null;
  } else {
    panel.style.transition = '';
    setTop(_missionPanelExpanded ? expandedTop : collapsedTop);
  }

  // 指の移動が閾値を超えたら「スワイプだった」とみなし、次の click を1回だけ
  // 握り潰す。★これが無いと、パネルを上げた指の真下にあったミッションカードが
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
 * ミッション完了の演出：パネルを通常位置へ戻す。
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

  // ヘルパ：ミッションが「自分が担当している」と言えるか
  const _isMyMission = (m) => {
    if (Array.isArray(m.assignees) && m.assignees.length > 0) {
      return m.assignees.includes(meId);
    }
    return m.assignee?.type === 'user' && m.assignee.userId === meId;
  };
  // ヘルパ：このミッションの担当が「確定済み」か
  const _isAssigned = (m) => {
    if (Array.isArray(m.assignees) && m.assignees.length > 0) return true;
    if (!m.selfClaim && m.assignee?.type === 'user') return true;
    if (m.selfClaim && Array.isArray(m.assignees) && m.assignees.length === 0 && m.assignee?.type === 'user') return true;
    return false;
  };

  // ── ミッション表示モードの定義 ──────────────────────────────────
  // 'all'  : cleared・pending_leader_check 以外を全件表示
  // 'mine' : 自分が担当 / 未割当 /応募受付中のミッションのみ
  const viewMode = state.missionViewMode || 'all';
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
      .filter(m => m.status !== 'cleared' && m.status !== 'pending_leader_check')
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
  const orderedProposals = [...p.proposals]
    .map((pr, i) => ({ pr, i }))
    .sort((a, b) => (_domainRank(a.pr.tag) - _domainRank(b.pr.tag)) || (a.i - b.i))
    .map(x => x.pr);

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

  const missionCards = displayMissions.length === 0
    ? (state.missionFilterTag
        ? `<p class="p-main-board__empty p-main-board__empty--tight">このタグのミッションはありません</p>`
        : viewMode === 'mine'
          ? `<p class="p-main-board__empty">あなたに割り当てられたミッションはありません</p>`
          : '<p class="p-main-board__empty">全てのミッションが完了されました！</p>')
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
          const modeBadge = `<span class="p-main-board__badge">担当の応募型ミッション</span>`;
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
            const names = _resolveUsernames(p, assignees);
            actionsBlock = `<span class="p-main-board__claim-note p-main-board__claim-note--done">担当：${names}</span>`;
          }

          claimLine = `<div class="p-main-board__claim">${actionsBlock}</div>`;
          m._modeBadge = modeBadge;
        }

        // 通常担当（担当応募型でない）の担当者表示
        let assigneeLine = '';
        if (!m.selfClaim) {
          if (assignees.length > 0) {
            const names = _resolveUsernames(p, assignees);
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

        // 全カードタップ可：ミッション詳細ページへ遷移（完了入力欄はページ側で出し分け）
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
              aria-label="ミッションリンクをコピー">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </div>`}
        </div>`;}).join('');

  // 担当応募待ちミッション（selfClaim=true かつ applicants あり かつ未確定）
  const pendingClaimMissions = canMgr
    ? p.missions.filter(m =>
        m.selfClaim &&
        m.status !== 'cleared' &&
        m.status !== 'pending_leader_check' &&
        m.selfClaim &&
        Array.isArray(m.claimApplicants) && m.claimApplicants.length > 0 &&
        !(Array.isArray(m.assignees) && m.assignees.length > 0)
      )
    : [];

  const memberProposals   = canMgr ? (p.memberProposals  || []) : [];
  const pendingMembers    = canMgr ? (p.pendingMembers   || []) : [];
  const leaderCheckMissions = canMgr
    ? (p.missions || []).filter(m => m.status === 'pending_leader_check')
    : [];

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
      <div onclick="window._app.openEventCalendarSheet()" data-log="event_calendar_open" data-coach="days-left"
        class="p-main-board__date-chip">
        <img src="/images/icon/icon-Calender.svg" class="p-main-board__date-icon" alt="">
        ${_dateChip}
      </div>

      <!-- アナウンスカード -->
      ${_renderAnnounceCards(p, meId)}

      <!-- 承認待ちメンバーバナー（管理者のみ・該当がある場合のみ表示）-->
      ${pendingMembers.length > 0 ? _renderPendingMembersBanner(pendingMembers) : ''}

      <!-- メンバー提案バナー（管理者のみ・該当がある場合のみ表示）-->
      ${memberProposals.length > 0 ? _renderMemberProposalsBanner(memberProposals) : ''}

      <!-- リーダーチェック待ちバナー（管理者のみ・該当がある場合のみ表示）-->
      ${leaderCheckMissions.length > 0 ? _renderLeaderCheckBanner(leaderCheckMissions) : ''}

      <!-- 応募待ちアナウンスバナー（管理者のみ・該当がある場合のみ表示）-->
      ${pendingClaimMissions.length > 0 ? _renderClaimAnnouncementBanner(p, pendingClaimMissions) : ''}
    </div>`;

  // ★提案キャラクターの行は「スクロールする本文」から出して、パネルの直下に置く。
  //   キャラは波の装飾に重なるようパネルの上端より上へはみ出すので、
  //   overflow-y:auto の中に入れたままだと上側が切り取られる。
  const proposalsRow = `
      <!-- 提案カード（管理者権限のあるユーザーのみ表示）-->
      ${canMgr ? `
        <div class="p-main-board__proposals${state.charactersIntro ? ' is-intro' : ''}${state.proposalsRevealed ? ' is-revealing' : ''}" data-coach="proposals">
          ${proposalCards}
          ${(() => {
            // ★空きスロットもキャラクターで埋める（枠は常に3つ・位置固定）。
            //   生成中＝会議している見た目、更新待ち＝寝ている見た目。
            const missing = 3 - p.proposals.length;
            if (missing <= 0) return '';
            const generating = !p.lastProposalGeneratedAt || state._proposalFetching;
            const nextAt = (p.lastProposalGeneratedAt || 0) + 12 * 60 * 60 * 1000;
            const remHr  = Math.ceil(Math.max(0, nextAt - Date.now()) / (1000 * 60 * 60));
            const label  = generating
              ? 'AIが提案を<br>生成中'
              : (remHr <= 0 ? '準備中...' : `${remHr}時間後に<br>新しい提案が<br>届きます`);
            return PROPOSAL_CHARACTERS.slice(p.proposals.length).map((ch, k) =>
              _characterBoxHtml(ch, p.proposals.length + k, {
                state: generating ? 'meeting' : 'sleeping',
                badge: false,
                inner: `<p class="p-main-board__proposal-wait-text">${label}</p>`,
              })).join('');
          })()}
        </div>` : ''}`;

  // 下部パネルの中身：ミッション一覧（背景レイヤーの山がカードの隙間から見える）
  const bottomPanelInner = `
      <!-- ミッション一覧（下部パネル内。山ビジュアルはこのパネルの裏側＝上部スクロール窓側で見える） -->
      <section data-coach="mission-list">
        <!-- 表示モード切替（私のみ / 全て）-->
        <div class="p-main-board__view-toggle">
          <button type="button" onclick="window._app.setMissionViewMode('mine')"
            class="p-main-board__view-button${viewMode === 'mine' ? ' is-active' : ''}">
            私のミッション
          </button>
          <button type="button" onclick="window._app.setMissionViewMode('all')"
            class="p-main-board__view-button${viewMode === 'all' ? ' is-active' : ''}">
            全てのミッション
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

// ===== メンバー提案バナー（管理者向け）=====
function _renderMemberProposalsBanner(proposals) {
  return `
    <div onclick="window._app.openMemberProposalsSheet()"
      class="p-main-board__banner p-main-board__banner--proposal">
      <div class="p-main-board__banner-head">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <p class="p-main-board__banner-text">ミッションの提案があります（${proposals.length}件）</p>
      </div>
    </div>`;
}

// ===== リーダーチェック待ちバナー（管理者向け）=====
function _renderLeaderCheckBanner(missions) {
  return `
    <div onclick="window._app.openLeaderCheckSheet()"
      class="p-main-board__banner p-main-board__banner--check">
      <div class="p-main-board__banner-head">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <p class="p-main-board__banner-text">リーダーチェック待ちがあります（${missions.length}件）</p>
      </div>
    </div>`;
}

// ===== 応募待ちアナウンスバナー（管理者向け）=====
function _renderClaimAnnouncementBanner(p, missions) {
  const rows = missions.map(m => {
    const count = m.claimApplicants.length;
    const names = m.claimApplicants.slice(0, 3).map(uid => {
      const mem = (p.members || []).find(x => x.userId === uid);
      return mem ? `@${mem.username}` : '?';
    }).join('、') + (count > 3 ? ` 他${count - 3}名` : '');

    return `
      <div class="p-main-board__claim-row">
        <div class="p-main-board__claim-body">
          <p class="p-main-board__claim-title">${_esc(m.title)}</p>
          <p class="p-main-board__claim-names">${_esc(names)}</p>
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
        <p class="p-main-board__banner-text">ミッションへの応募があります（${missions.length}件）</p>
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
    // アナウンスカード内の締め切り。ミッションカードより1段小さい
    const cls = 'p-main-board__deadline p-main-board__deadline--sm';
    if (diff < 0)   return `<span class="${cls} p-main-board__deadline--urgent">${-diff}日超過</span>`;
    if (diff === 0) return `<span class="${cls} p-main-board__deadline--urgent">今日まで</span>`;
    return `<span class="${cls}">残り${diff}日</span>`;
  };

  // タップでミッション詳細ページを開く（ミッションカードと同挙動）
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
  //   全部並べるとボードの上半分がアナウンスで埋まり、肝心のミッションが
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
//   自動生成されるミッションとして本人が完了させるものなので、完了しても
//   記録に出てこないと「やったのに残らない」と受け取られる。概要カードにも
//   同じ内容が出るが、あちらは要約、こちらは作業の記録で役割が違う。
// ★p1 / p2 / p3 は提案から作られたミッション（会場・広報リンク・メインビジュアル）。
//   こちらは概要カードのスロットを埋めるためだけのものなので外したままにする。
const _OVERVIEW_IDS     = new Set();
const _OVERVIEW_ORIGINS = new Set(['p1', 'p2', 'p3']);
const _ARCHIVE_TAG_ORDER = ['企画', '運営', '制作', '広報'];

function _isOverviewMission(m) {
  return _OVERVIEW_IDS.has(m.id) || _OVERVIEW_ORIGINS.has(m.originProposalId);
}

// originProposalId で生成されたミッションの clearedData を返す
function _getClearedByOrigin(p, originId) {
  const m = (p.missions || []).find(x => x.originProposalId === originId && x.status === 'cleared');
  return m ? (p.clearedData?.[m.id] ?? null) : null;
}

// ===== アーカイブタブ =====
function _renderArchiveTab(p) {
  const canMgr = state.canManageCurrentEvent();
  const _pen   = (type) => canMgr ? Components.PenIcon(type) : '';
  // ── Layer 1 データ取得（固定IDで紐づけ）──────────────────────
  const title   = p.clearedData?.['def-2']?.content ?? '未設定';
  const summary = getArchiveSummary(p) || '未設定';
  const mainVisual = p.clearedData?.['archive-image']?.content
    ?? _getClearedByOrigin(p, 'p3')?.content
    ?? null;
  const url        = _getClearedByOrigin(p, 'p2')?.content ?? '未設定';
  // ★概要・開催場所は utils.js の getter を通す（イベント設定からも編集されるため）
  const venue      = getArchiveVenue(p) || '未設定';
  // p.dates を優先し、旧 period-temp は後方互換フォールバック。時刻ありは日ごとに改行表示
  const period     = p.dates?.length > 0
    ? formatEventPeriodLines(p.dates, p.dateTimes).join('<br>')
    : (p.clearedData?.['period-temp']?.content || '未設定');

  // ── Layer 2 データ取得（概要スロット以外の完了ミッション）──────
  const clearedMissions = (p.missions || []).filter(m =>
    m.status === 'cleared' && !_isOverviewMission(m)
  );

  const groups = {};
  for (const m of clearedMissions) {
    const tag = (Array.isArray(m.tags) && m.tags.length > 0 ? m.tags[0] : null) || m.tag || '企画';
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(m);
  }

  const mode = state.archiveDisplayMode || 'label';
  const archiveTabBtns = ['label','date','priority','assignee','creator'].map(m => {
    const label = { label:'ラベル別', date:'完了日順', priority:'優先度順', assignee:'完了者別', creator:'作成者別' }[m];
    const active = mode === m;
    return `<button type="button" onclick="window._app.setArchiveDisplayMode('${m}')"
      class="p-archive__mode${active ? ' is-active' : ''}">
      ${label}</button>`;
  }).join('');

  let missionsRecordHtml = '';
  if (mode === 'label') {
    missionsRecordHtml = _ARCHIVE_TAG_ORDER
      .filter(tag => groups[tag]?.length > 0)
      .map(tag => _renderArchiveCategorySection(p, tag, groups[tag]))
      .join('');
    // カスタムタグで _ARCHIVE_TAG_ORDER に含まれないものも追加
    const extraTags = Object.keys(groups).filter(t => !_ARCHIVE_TAG_ORDER.includes(t) && groups[t]?.length > 0);
    if (extraTags.length > 0) {
      missionsRecordHtml += extraTags.map(tag => _renderArchiveCategorySection(p, tag, groups[tag])).join('');
    }
  } else if (mode === 'date') {
    const sorted = [...clearedMissions].sort((a, b) =>
      (p.clearedData?.[b.id]?.timestamp ?? 0) - (p.clearedData?.[a.id]?.timestamp ?? 0)
    );
    missionsRecordHtml = `<div class="p-archive__blocks">${sorted.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>`;
  } else if (mode === 'priority') {
    const sorted = [...clearedMissions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    missionsRecordHtml = `<div class="p-archive__blocks">${sorted.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>`;
  } else if (mode === 'assignee') {
    const assigneeGroups = {};
    for (const m of clearedMissions) {
      // submittedBy（実際の完了者）を優先し、なければ assignee にフォールバック
      const uid = p.clearedData?.[m.id]?.submittedBy
        || (Array.isArray(m.assignees) && m.assignees.length > 0 ? m.assignees[0] : null)
        || (m.assignee?.type === 'user' ? m.assignee.userId : null);
      const mem = uid ? (p.members || []).find(x => x.userId === uid) : null;
      const key = mem?.username || uid || '不明';
      if (!assigneeGroups[key]) assigneeGroups[key] = [];
      assigneeGroups[key].push(m);
    }
    missionsRecordHtml = Object.entries(assigneeGroups).map(([name, missions]) => `
      <div class="p-archive__group">
        <p class="p-archive__group-label">@${_esc(name)}（${missions.length}件）</p>
        <div class="p-archive__blocks">${missions.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>
      </div>`).join('');
  } else if (mode === 'creator') {
    const creatorGroups = {};
    for (const m of clearedMissions) {
      const uid = m.createdBy || null;
      const mem = uid ? (p.members || []).find(x => x.userId === uid) : null;
      const key = mem?.username || (uid ? uid : '作成者不明');
      if (!creatorGroups[key]) creatorGroups[key] = [];
      creatorGroups[key].push(m);
    }
    missionsRecordHtml = Object.entries(creatorGroups).map(([name, missions]) => `
      <div class="p-archive__group">
        <p class="p-archive__group-label">@${_esc(name)}（${missions.length}件）</p>
        <div class="p-archive__blocks">${missions.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], null)).join('')}</div>
      </div>`).join('');
  }

  const hasDatesA = Array.isArray(p.dates) && p.dates.length > 0;
  return `
    <div class="p-archive u-page-transition">
      <div class="p-archive__head">
        <div onclick="window._app.openEventCalendarSheet()" data-log="event_calendar_open"
          class="p-archive__days">
          <img src="/images/icon/icon-Calender.svg" class="p-archive__days-icon" alt="">
          ${hasDatesA
            ? `<span class="p-archive__days-text">残り <span class="p-archive__days-count">${calculateDaysLeft([...p.dates].sort()[0])}</span> 日</span>`
            : `<span class="p-archive__days-text p-archive__days-text--muted">未設定</span>`}
        </div>
        <button type="button" onclick="window._app.handleGoodClick(event)"
          class="p-archive__like${p.hasLiked ? ' is-liked' : ''}">
          <img src="/images/icon/icon-Good${p.hasLiked ? '-pressed' : ''}.svg" class="p-archive__like-icon" alt="">
          <span class="p-archive__like-count">${p.likes || 0}</span>
        </button>
      </div>

      <!-- Layer 1: メインビジュアル（3:2。ホームのサムネイルと同じ比率に揃える）-->
      <div class="p-archive__visual">
        ${mainVisual
          ? `<img src="${_esc(mainVisual)}" class="p-archive__visual-image" alt="">`
          // 未設定時はホームのサムネイルと同じエンプティーステート画像
          : Components.ThumbnailEmptyState()}
        ${canMgr ? `<div class="p-archive__visual-edit">${_pen('image')}</div>` : ''}
      </div>

      <!-- Layer 1: イベント概要カード -->
      <div class="p-archive__overview">
        <div class="p-archive__title-row">
          <h2 class="p-archive__title">「${_esc(title)}」</h2>
          ${_pen('title')}
        </div>
        <div class="p-archive__sections">
          <section>
            <div class="p-archive__label-row">
              <h3 class="p-archive__label">概要</h3>
              ${_pen('summary')}
            </div>
            <p class="p-archive__summary">${_esc(summary)}</p>
          </section>
          <section class="p-archive__facts">
            <div class="p-archive__fact-label">期間</div>
            <div class="p-archive__fact-value p-archive__fact-value--multiline"><span>${period}</span> ${_pen('period')}</div>
            <div></div>
            <div class="p-archive__fact-label">URL</div>
            <div class="p-archive__fact-value p-archive__fact-value--link">${_esc(url)}</div>
            <div>${_pen('url')}</div>
            <div class="p-archive__fact-label">場所</div>
            <div class="p-archive__fact-value">${_esc(venue)}</div>
            <div>${_pen('venue')}</div>
          </section>
        </div>
        <button type="button" onclick="window._app.showMissionListModal()"
          class="c-button c-button--secondary p-archive__list-button">ミッション一覧</button>
      </div>

      <!-- Layer 2: ミッションの記録 -->
      <div class="p-archive__record">
        <div class="p-archive__record-head">
          <h2 class="p-archive__record-title">ミッションの記録</h2>
          ${clearedMissions.length > 0
            ? `<span class="p-archive__record-count">${clearedMissions.length}件</span>`
            : ''}
        </div>
        ${clearedMissions.length > 0 ? `
          <div class="p-archive__modes">${archiveTabBtns}</div>` : ''}
        ${missionsRecordHtml || `<p class="p-archive__empty">完了したミッションが記録されます</p>`}
      </div>

      <!-- 振り返り用のサブページ。★メンバー全員が見られる（アーカイブと同じ）。
           イベント設定の行（c-settings-list__link）と同じ見た目で揃えてある。 -->
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

// カテゴリセクション（折りたたみ付き）
function _renderArchiveCategorySection(p, tag, missions) {
  const cfg       = LABEL_CONFIG[tag] || { color: '#A7AAAC' };
  const collapsed = state.archiveCollapsed?.[tag] ?? false;
  const items     = missions.map(m => _renderArchiveMissionBlock(m, p.clearedData?.[m.id], tag)).join('');

  // ★p-archive__section-body / p-archive__section-arrow は main.js が掴む目印。
  //   クラス名を変えるなら main.js の開閉処理も直すこと。
  return `
    <div data-archive-section="${_esc(tag)}" class="p-archive__category${collapsed ? ' is-collapsed' : ''}">
      <button type="button" onclick="window._app.toggleArchiveSection('${_esc(tag)}')"
        class="p-archive__category-toggle">
        <span class="p-archive__category-label">
          <span class="p-archive__category-dot" style="--tag-color:${_esc(cfg.color)}"></span>
          <span class="p-archive__category-name">${_esc(tag)}</span>
          <span class="p-archive__category-count">${missions.length}件</span>
        </span>
        <svg class="p-archive__section-arrow"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="p-archive__section-body">
        ${items}
      </div>
    </div>`;
}

// ミッションブロック（text / image / link で表示切替）
function _renderArchiveMissionBlock(m, cd, sectionTag) {
  const canMgr      = state.canManageCurrentEvent();
  const tagNames    = (Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : [sectionTag]));
  const completedAt = cd?.timestamp ? _fmtDate(cd.timestamp) : '';

  let contentHtml = '';
  if (cd?.content) {
    if (cd.format === 'image') {
      contentHtml = `<img src="${_esc(cd.content)}" class="p-archive__content-image" alt="提出画像" loading="lazy">`;
    } else if (cd.format === 'link') {
      contentHtml = `
        <div class="p-archive__content-link">
          <svg class="p-archive__content-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <span class="p-archive__content-link-text">${_esc(cd.content)}</span>
        </div>`;
    } else {
      contentHtml = `<p class="p-archive__content-text">${_esc(cd.content)}</p>`;
    }
  }

  const clearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [];
  const totalAssignees = Array.isArray(m.assignees) && m.assignees.length > 0
    ? m.assignees.length
    : (m.assignee?.type === 'user' ? 1 : clearedBy.length);
  const indivSummary = m.individualClear
    ? `<span class="p-archive__block-indiv">${clearedBy.length}/${Math.max(1,totalAssignees)}人完了</span>`
    : '';
  const archiveClick = `onclick="window._app.openMissionDetail('${m.id}')"`;

  const meatballBtn = canMgr ? `
    <button type="button" onclick="event.stopPropagation(); window._app.openArchiveMissionMenu(event, '${m.id}')"
      class="p-archive__block-action" aria-label="メニュー">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
      </svg>
    </button>` : `
    <button type="button" onclick="event.stopPropagation(); window._app.copyMissionLink('${m.id}')"
      class="p-archive__block-action"
      aria-label="ミッションリンクをコピー">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    </button>`;

  // ── 振り返り（困ったこと／どう乗り越えたか）───────────────────
  // ★編集できるのは提出した本人と管理者だけ（サーバー側でも同じ判定をしている）。
  //   ここでボタンを出す／出さないは見た目の話で、権限の担保はサーバーが行う。
  // ★個別完了は提出物が人数ぶんあり、ここで見えているのは代表の1件。
  //   誰のぶんを直すかの選択は作らず、本人が自分のぶんを直す形にしてある。
  const struggle = String(cd?.struggle || '').trim();
  const solution = String(cd?.solution || '').trim();
  const canEditReflection = cd && (canMgr || cd.submittedBy === state.currentUser?.id);
  const reflectRow = (label, text) => text
    ? `<div class="p-archive__reflect-row">
         <p class="p-archive__reflect-label">${label}</p>
         <p class="p-archive__reflect-text">${_esc(text)}</p>
       </div>`
    : '';
  const reflectHtml = (!struggle && !solution && !canEditReflection) ? '' : `
    <div class="p-archive__reflect">
      ${(struggle || solution) ? `
        ${reflectRow('困ったこと', struggle)}
        ${reflectRow('どう乗り越えた？', solution)}
      ` : `<p class="p-archive__reflect-empty">振り返りは未記入です</p>`}
      ${canEditReflection ? `
        <button type="button" onclick="event.stopPropagation(); window._app.openReflectionEdit('${m.id}')"
          class="p-archive__reflect-edit">${(struggle || solution) ? '編集' : '書く'}</button>` : ''}
    </div>`;

  return `
    <div ${archiveClick} class="p-archive__block">
      <div class="p-archive__block-head">
        <div class="p-archive__block-tags">
          ${tagNames.map(t => Components.Tag(t)).join('')}
          ${indivSummary}
        </div>
        ${completedAt ? `<span class="p-archive__block-date">${completedAt}完了</span>` : ''}
      </div>
      <h3 class="p-archive__block-title">${_esc(m.title)}</h3>
      ${contentHtml}
      ${reflectHtml}
      ${meatballBtn}
    </div>`;
}

// ===== 通知タブ =====
function _renderNotificationsTab(p) {
  const canMgr = state.canManageCurrentEvent();

  // リーダー確認待ちのミッション（管理者権限のあるユーザーのみ）
  const pendingMissions = canMgr
    ? p.missions.filter(m => m.status === 'pending_leader_check')
    : [];

  // 応募待ちのミッション（管理者権限のあるユーザーのみ）
  const claimingMissions = canMgr
    ? p.missions.filter(m =>
        m.selfClaim &&
        m.status !== 'cleared' &&
        m.status !== 'pending_leader_check' &&
        m.selfClaim &&
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

  const pendingHtml = pendingMissions.length === 0 ? '' : `
    <section class="p-notification__section">
      <h2 class="p-notification__title">確認待ち（${pendingMissions.length}件）</h2>
      <div class="p-notification__list">
        ${pendingMissions.map(m => {
          const submitter = (p.members || []).find(x => x.userId === m.assignee?.userId);
          const cleared = p.clearedData?.[m.id];
          return `
          <div class="p-notification__card p-notification__card--check">
            <div class="p-notification__card-meta">
              <span class="p-notification__badge p-notification__badge--check">確認待ち</span>
              <span class="p-notification__card-sub">${submitter ? '@' + _esc(submitter.username) + ' が提出' : '提出済み'}</span>
            </div>
            <h3 class="p-notification__card-title">${_esc(m.title)}</h3>
            ${cleared ? `
              <div class="p-notification__detail">
                <p class="p-notification__detail-label">提出内容</p>
                ${cleared.format === 'image'
                  ? `<img src="${_esc(cleared.content)}" class="p-notification__detail-image" alt="提出画像">`
                  : `<p class="p-notification__detail-content">${_esc(cleared.content)}</p>`}
              </div>` : ''}
            <div class="p-notification__actions">
              <button type="button" onclick="window._app.rejectMission('${m.id}')"
                class="p-notification__action p-notification__action--reject">差し戻す</button>
              <button type="button" onclick="window._app.approveMission('${m.id}')"
                class="p-notification__action p-notification__action--approve">承認する</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>`;

  // 通知一覧（このイベントに紐づく通知のみ。他イベントの通知は表示しない）
  const allNotifs = Array.isArray(state.notifications) ? state.notifications : [];
  const notifs = allNotifs.filter(n => n.eventId === p.id);
  const unreadCount = notifs.filter(n => !n.read).length;

  const notifsHtml = notifs.length === 0 ? `
    <p class="p-notification__empty">通知はありません</p>` : `
    <div>
      ${notifs.map(n => `
        <div class="notif-swipe-row p-notification__row" data-notif-id="${n.id}">
          <div class="p-notification__row-delete">
            <svg class="p-notification__row-delete-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </div>
          <!-- ★p-notification__swipe-card は横スワイプの対象として JS が掴む目印 -->
          <div class="p-notification__swipe-card${n.read ? '' : ' is-unread'}"
            onclick="window._app.openNotification('${n.id}', '${n.missionId || ''}')">
            <div class="p-notification__icon" style="--notif-color:${_notifIconBg(n.type)}">
              ${_notifIcon(n.type)}
            </div>
            <div class="p-notification__body">
              <p class="p-notification__message">${_esc(n.message)}</p>
              <p class="p-notification__time">${_formatNotifTime(n.createdAt)}</p>
            </div>
            ${!n.read ? '<span class="p-notification__dot"></span>' : ''}
          </div>
        </div>`).join('')}
    </div>`;

  return `
    <div class="p-notification u-page-transition">
      ${claimingHtml}
      ${pendingHtml}
      <section class="p-notification__section p-notification__section--grow">
        <div class="p-notification__head">
          <h2 class="p-notification__title">通知</h2>
          ${unreadCount > 0 ? `
            <button type="button" onclick="window._app.markAllNotificationsRead()"
              class="p-notification__read-all">すべて既読</button>` : ''}
        </div>
        ${notifsHtml}
      </section>
    </div>`;
}

// 通知アイコンの背景色。CSS 変数 --notif-color として渡す
// （種類ごとに色が違うだけなので、クラスを14個作るより変数1つが読みやすい）
function _notifIconBg(type) {
  switch (type) {
    case 'mission_cleared':
    case 'assignment_decided':
    case 'leader_approved':
    case 'member_joined':         return 'var(--color-success-tint)';
    case 'assigned_to_me':
    case 'role_assigned':         return 'var(--color-primary-tint)';
    case 'someone_claimed':
    case 'mission_reverted':
    case 'self_claimed':          return 'var(--color-warning-tint)';
    case 'pending_leader_check':
    case 'leader_rejected':
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
    case 'pending_leader_check':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#EE3E12" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    case 'leader_approved':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#1A6B27" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'leader_rejected':
      return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="#EE3E12" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
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

// ミッションの残り日数テキスト（dates をソートし最終日から計算）
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
    if (m.status === 'cleared' || m.status === 'pending_leader_check') continue;
    if (!Array.isArray(m.dates) || m.dates.length === 0) continue;
    const sorted    = [...m.dates].sort();
    const startDate = sorted[0];
    const endDate   = sorted[sorted.length - 1];
    const target    = new Date(endDate);
    target.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    const title = m.title.length > 15 ? m.title.slice(0, 15) + '…' : m.title;

    if (startDate === endDate && today === startDate) {
      // 1日のみのミッション → 締め切り当日
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
      // 締め切り当日（複数日ミッションの最終日）
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

// userId 配列 → ユーザー名カンマ区切り
function _resolveUsernames(p, userIds, max = 3) {
  if (!Array.isArray(userIds) || userIds.length === 0) return '未確定';
  const names = userIds.map(uid => {
    const member = (p.members || []).find(m => m.userId === uid);
    return member ? `@${member.username}` : '不明なユーザー';
  });
  // ミッション欄では担当者は max（既定3）人まで表示し、超過分は「他N人」に集約
  if (names.length > max) {
    return names.slice(0, max).join('、') + ` 他${names.length - max}人`;
  }
  return names.join('、');
}
