// public/js/browserBack.js — ブラウザ・端末の「戻る」をアプリの中の「戻る」につなぐ（2026-11-12）
//
// ★このアプリは URL で画面を持たない（state.currentView だけで描く）。何もしないと、ブラウザの戻る
//   （Android の戻るボタン・iOS のスワイプで戻るを含む）で、どの画面からでもアプリの外へ出てしまう。
//
// 仕組み：「見張りの履歴」を1つだけ積む。
//   - ホーム以外の画面（またはモーダル・シートが開いている）のとき、履歴に見張り（state に GUARD_KEY）を1つ積む
//   - 戻るで見張りから外れたら（popstate）、その画面の「戻る」を1回だけ実行し、まだ必要なら見張りを積み直す
//   - ホーム（何も開いていない）に着いたら見張りを外す ＝ 次の戻るでアプリの外へ出る
//   ★画面ごとの URL や履歴の積み上げは作らない（タブを行き来しても積まない。2026-10-25 の決定と同じ）
//
// 戻る先（ユーザーと合意した表。2026-11-12）：
//   開いているモーダル・シート・メニュー … まずそれを閉じる（閉じられないもの＝コーチマークなどは何もしない）
//   アーカイブ／通知のタブ               … メインボードのタブ
//   メインボード                         … 入ってきた画面（ヘッダーの戻ると同じ boardBack）
//   タスク詳細・設定・そこから開くページ … それぞれの画面の中の「戻る」と同じ処理
//   ホーム                               … アプリの外へ（止めない）
// ★各画面の処理は書き写さず、画面の中の戻るボタンが呼んでいる関数をそのまま呼ぶ（片方だけ直す事故を防ぐ）
// ★ログインしていない画面（ようこそ・ログイン・アカウント作成）は対象外（従来どおり）

const GUARD_KEY = 'evecreBackGuard';

let _state = null;
let _app = null;
let _ignorePops = 0;   // 自分で history.back() したぶんの popstate を読み飛ばす

// 画面ごとの「戻る」。★画面の中の戻るボタンと同じ関数を呼ぶこと
const BACK = {
  MAIN_BOARD:      () => (_state.mainBoardTab && _state.mainBoardTab !== 'MAIN') ? _app.setTab('MAIN') : _app.boardBack(),
  MISSION_DETAIL:  () => _app.closeMissionDetail(),     // ★初期クエストの途中は中で止まる（戻れない）
  MISSION_REFLECT: () => _app.closeMissionReflect(),
  PILLAR_EDIT:     () => _state.closePillarEdit(),
  PILLAR_ASSIGN:   () => _state.closePillarAssign(),
  EVENT_SETTINGS:  () => _state.setView('MAIN_BOARD', _state.selectedEventId),
  ARCHIVE_STATS:   () => _app.backFromSubPage(),
  ARCHIVE_ANSWERS: () => _app.backFromSubPage(),
  PROJECT_DETAIL:  () => _state.setView('HOME'),
  ACCOUNT:         () => _state.setView('HOME'),
  LEGAL:           () => _state.closeLegal(),
  // イベント作成フロー：各ステップの「戻る」ボタンと同じ行き先
  CREATE_EVENT_INFO:        () => _state.setView('HOME'),
  CREATE_EVENT_TYPE:        () => _state.setView('CREATE_EVENT_INFO'),
  CREATE_EVENT_SCALE:       () => _state.setView('CREATE_EVENT_TYPE'),
  CREATE_EVENT_DATES:       () => _state.setView('CREATE_EVENT_SCALE'),
  CREATE_EVENT_MOTIVATION:  () => _state.setView('CREATE_EVENT_DATES'),
  CREATE_EVENT_INTEGRATION: () => _state.setView('CREATE_EVENT_MOTIVATION'),
  CREATE_EVENT_HANDOVER:    () => _state.setView('CREATE_EVENT_INTEGRATION'),
  // ★作成中（ボタンが押せない間）は何もしない
  CREATE_EVENT_INVITE:      () => { if (!_state.createEventInviteScreen?.creating) _state.setView('CREATE_EVENT_HANDOVER'); },
};

// 閉じられない（戻るで飛ばしてはいけない）案内。出ている間は戻るで何もしない
const BLOCKING_IDS = ['coach-mark-overlay', 'tooltip-tour-overlay'];

/** いちばん上に開いているモーダル・シート・メニュー（無ければ null） */
function _topLayer() {
  const list = document.querySelectorAll('.c-overlay, #mission-overlay, .c-context-menu');
  return list.length ? list[list.length - 1] : null;
}

function _isBlocked() {
  return BLOCKING_IDS.some(id => document.getElementById(id));
}

/** いまの画面で見張りが要るか */
function _needsGuard() {
  if (!_state?.currentUser) return false;
  // ★公開ページ（/explore）は自分で URL と履歴を持つ（views/explore.js）。見張りを積まない
  if (_state.currentView === 'EXPLORE') return false;
  if (_isBlocked() || _topLayer()) return true;
  return !!BACK[_state.currentView];
}

function _onGuard() {
  return history.state?.[GUARD_KEY] === true;
}

/** いちばん上のモーダル類を閉じる。閉じられないもの（外側のタップで閉じないモーダル）はそのまま */
function _closeLayer(el) {
  if (el.id === 'mission-overlay') { _app.closeMissionModal?.(); return; }
  if (el.classList.contains('c-context-menu')) { el.remove(); return; }
  // ★外側（暗幕）のタップと同じ扱い。各モーダルは「e.target が自分なら閉じる」で受けているので、それに乗る
  el.click();
}

function _goBack() {
  if (_isBlocked()) return;
  const layer = _topLayer();
  if (layer) { _closeLayer(layer); return; }
  BACK[_state.currentView]?.();
}

/**
 * 見張りを、いまの画面に合わせる。state.render() の最後と、モーダルの開閉のたびに呼ぶ
 * ★history.pushState は URL を変えない（同じ URL のまま state だけ持つ）
 */
export function syncBackGuard() {
  if (!_state) return;
  const need = _needsGuard();
  const on = _onGuard();
  if (need && !on) {
    try { history.pushState({ [GUARD_KEY]: true }, '', location.href); } catch (_) {}
  } else if (!need && on) {
    // ホームに戻った（画面の中のボタンで）。見張りを外して、次の戻るでアプリの外へ出られるようにする
    _ignorePops++;
    history.back();
  }
}

/** 起動時に1回だけ呼ぶ（main.js） */
export function initBrowserBack(state, app) {
  if (_state) return;
  _state = state;
  _app = app;
  window.addEventListener('popstate', () => {
    if (_ignorePops > 0) { _ignorePops--; return; }
    if (_onGuard()) return;               // 進む（forward）で見張りに戻ってきた
    if (!_needsGuard()) return;           // ホーム：そのまま外へ（見張りは無い）
    _goBack();
    // ★すぐ見張りを積み直す（setView が保存待ちで遅れて動く場合も、そのあとの render() が合わせ直す）
    syncBackGuard();
  });
  // モーダル・シート・メニューの開閉（body の直下への出し入れ）にも見張りを合わせる
  let _queued = false;
  new MutationObserver(() => {
    if (_queued) return;
    _queued = true;
    queueMicrotask(() => { _queued = false; syncBackGuard(); });
  }).observe(document.body, { childList: true });
  syncBackGuard();
}
