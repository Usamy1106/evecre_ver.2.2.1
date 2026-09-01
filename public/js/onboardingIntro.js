// ===== 初期オンボーディング（イベント作成直後のチュートリアル）=====
// リーダーがイベントを作った直後に、
//   ① 進め方（モーダル）
//   ② イベント主要機能の紹介（コーチマーク4連：残り日数／AI提案／ミッション一覧／作成ボタン）
//   ③ 「目的を定めよう」の促し（コーチマーク）
// を順に通す。
//
// ★ミッション作成フォームのツールチップは**この流れに含めない**。
//   作成フォームを初めて開いたときに独立して1回だけ出す（startMissionFormTour）。
//   単位はユーザー（全イベントを通じて生涯1回）。フォームの使い方はイベントごとに
//   変わらないので、イベントを作るたびに出すと鬱陶しいため。
//
// ★3段階は厳密に順序があり、途中で中断・再開されうる。独立したフラグを並べず、
//   **1つの進行状態（状態機械）**として持つ。
//
// ★判定は state.render() 駆動のみ。バックグラウンドタイマー禁止
//   （CLAUDE.md の既存方針・purposeReminderModal.js と同じ）。
//
// ★進行中は他の自動表示モーダルを抑止する（modalGuard.js の isIntroRunning）。
//   ②は FAB のタップ以外に出口が無いため、他モーダルが前面に出ると本当に操作不能になる。

import { state } from './state.js';
import { logEvent } from './logger.js';
import { setIntroRunningProbe } from './modalGuard.js';
import { showCoachMark, closeCoachMark } from './modals/coachMark.js';
import { startTooltipTour, closeTooltipTour } from './modals/tooltipTour.js';

// ── 進行状態 ────────────────────────────────────────────────
export const INTRO = {
  NONE:  null,           // 未開始
  USAGE: 'usage_shown',  // ①表示済み。②待ち
  TOUR:  'feature_tour', // ②表示済み。③待ち
  DONE:  'done',         // 完了。以後表示しない
};

// ★旧フローの途中で止まっている人の読み替え表。
//   旧: usage → fab_coach（FABタップ）→ form_tour（作成フォームのツアー）→ done
//   いずれも「①は見た」状態なので、②（機能紹介）から再開させる。
//   ★これを消すと、旧フローの途中だった人が①からやり直しになる。
const LEGACY_STATES = { fab_coach: 'usage_shown', form_tour: 'usage_shown' };

// ミッション作成フォームのツアーは**ユーザー単位**で1回だけ（イベント単位ではない）。
const FORM_TOUR_KEY = (userId) => `evecre:onboardingIntro:formTour:v1:${userId}`;

// ★この時刻より前に作られたイベントでは①〜④を一切出さない。
//   既存のテストユーザーが作ったイベントに、いまさらチュートリアルを出さないため。
//   ★ユーザー単位ではなくイベント単位（createdAt）で判定する。
//     既存ユーザーが新しく作ったイベントでは出るのが正しい。
//   ★デプロイ時に実際のリリース日時へ差し替えること（仮値のまま出さない）。
export const ONBOARDING_INTRO_START_AT = Date.parse('2026-08-16T00:00:00+09:00');

const USAGE_ID = 'intro-usage-overlay';

function _key(userId, eventId) {
  return `evecre:onboardingIntro:v1:${userId}:${eventId}`;
}

/** 現在の進行状態（未開始は null）。★旧フローの値はここで読み替える */
export function getIntroState(userId, eventId) {
  try {
    const v = localStorage.getItem(_key(userId, eventId));
    return (v && LEGACY_STATES[v]) || v;
  } catch (_) { return null; }
}

export function setIntroState(userId, eventId, value) {
  try { localStorage.setItem(_key(userId, eventId), value); } catch (_) {}
}

/**
 * このユーザーが**他のイベントで**イントロを完了しているか。
 * ★2つ目以降のイベントでは出さない（同じ説明を繰り返さない）。
 *   状態キーはイベント単位のまま、ここで横断的に判定する。
 */
export function hasCompletedElsewhere(userId, currentEventId) {
  try {
    const prefix = `evecre:onboardingIntro:v1:${userId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (k === _key(userId, currentEventId)) continue;
      if (localStorage.getItem(k) === INTRO.DONE) return true;
    }
  } catch (_) {}
  return false;
}

/**
 * このイベントでイントロを動かしてよいか。
 * ★フラグより先に「既存イベントか」を評価する（localStorage を消しても復活させない）。
 */
export function isIntroEligible(userId, project) {
  if (!userId || !project) return false;
  if (!(project.createdAt >= ONBOARDING_INTRO_START_AT)) return false;   // 既存イベント
  if (!state.canManageCurrentEvent(project.id)) return false;            // リーダー向け
  if (getIntroState(userId, project.id) === INTRO.DONE) return false;
  if (hasCompletedElsewhere(userId, project.id)) return false;           // 2つ目以降
  return true;
}

// ── 進行中フラグ（他モーダルの抑止に使う）──────────────────
// ★DOM の有無ではなく明示フラグで持つ。②→③のようにモーダルが一瞬いなくなる
//   タイミングがあり、その隙に他モーダルが割り込むのを防ぐため。
let _running = false;
export function isIntroRunning() { return _running; }
export function setIntroRunning(v) { _running = !!v; }
// modalGuard へ注入（これで6種の自動表示モーダルが一括で抑止される）
setIntroRunningProbe(isIntroRunning);

/**
 * ★state.render() からのみ呼ぶこと。
 * 現在の進行状態を見て、次に出すべき段階を返す（表示自体は各 Phase で実装する）。
 * @returns {'usage'|'tour'|'purpose'|null} 次に出す段階
 */
export function nextIntroStep() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return null;
  if (!isIntroEligible(state.currentUser.id, p)) return null;

  const cur = getIntroState(state.currentUser.id, p.id);
  if (cur === INTRO.NONE || cur === null) return 'usage';    // ①進め方
  if (cur === INTRO.USAGE) return 'tour';                    // ②主要機能の紹介
  if (cur === INTRO.TOUR)  return 'purpose';                 // ③目的の促し
  return null;
}

/** 段階を進める（ログもここで出す） */
export function advanceIntro(to, extra = {}) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  setIntroState(state.currentUser.id, p.id, to);
  if (to === INTRO.DONE) {
    setIntroRunning(false);
    logEvent('intro_completed', extra);
  }
}

// ── 判定の入口 ──────────────────────────────────────────────
/**
 * ★state.render() からのみ呼ぶこと。
 * 進行状態に応じて①または②を出す。③はミッション作成モーダルを開いた時、
 * ④はミッション保存後に別経路で開始する。
 */
export function checkIntro() {
  const step = nextIntroStep();
  if (!step) {
    // 対象外／完了時は進行中フラグを落として、他モーダルを通す
    if (isIntroRunning() && !document.getElementById('coach-mark-overlay')) setIntroRunning(false);
    return;
  }
  if (step === 'usage')   { showUsageModal();   return; }
  if (step === 'tour')    { showFeatureTour();  return; }
  if (step === 'purpose') { showPurposeCoach(); return; }
}

// ── ① 「イベクリの使い方」モーダル ──────────────────────────
// ★出口は「わかった」だけ。閉じるボタンも背景タップも置かない
//   （置くと②へ進まないまま放置され、状態が宙ぶらりんになる）。
export function showUsageModal() {
  if (document.getElementById(USAGE_ID)) return;
  setIntroRunning(true);

  const overlay = document.createElement('div');
  overlay.id = USAGE_ID;
  overlay.className = 'c-overlay c-overlay--intro c-overlay--blur';
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade">
      <p class="c-modal__eyebrow">進め方</p>
      <!-- ★<br> を含むので esc しないこと（ユーザー入力は入らない） -->
      <h3 class="c-modal__title">イベントづくりは<br>5つのステップで進みます</h3>
      <div class="c-modal__steps c-modal__steps--roomy">
        ${[
          ['決める', '何をやるかを決める'],
          ['積む',   'やることを洗い出して日付を入れる'],
          ['配る',   '誰がやるかを決める'],
          ['こなす', '実行して提出する'],
          ['残す',   '振り返って次に引き継ぐ'],
        ].map(([label, desc], i) => `
          <div class="c-modal__step">
            <span class="c-modal__step-num">${i + 1}</span>
            <div class="c-modal__step-body">
              <p class="c-modal__step-title">${label}</p>
              <p class="c-modal__step-text">${desc}</p>
            </div>
          </div>`).join('')}
      </div>
      <button data-intro="ack" class="c-button c-button--primary c-modal__button c-modal__button--roomy">わかった</button>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('intro_usage_shown');

  // ★「わかった」ではなく**出した時点**で状態を進める。
  //   以前は ack でしか記録しておらず、読んでいる途中でアプリを閉じたり
  //   ホームへ移ったりすると、次に開いたときにまた①から出ていた。
  //   ①は一度読めば足りる案内なので、出したら二度目は出さない。
  //   （USAGE は「①済み・②待ち」の意味なので、次は②から再開する）
  advanceIntro(INTRO.USAGE);

  overlay.querySelector('[data-intro="ack"]').onclick = () => {
    logEvent('intro_usage_ack');
    overlay.remove();
    // ★閉じるアニメーションと重ならないよう1フレーム置いてから②へ
    requestAnimationFrame(() => showFeatureTour());
  };
}

/** コーチマークが開いているか（多重表示の防止） */
function isCoachOpen() {
  return !!document.getElementById('coach-mark-overlay');
}

/**
 * イントロの表示だけを畳む（画面遷移のときに state.setView から呼ぶ）。
 *
 * ★進行状態（localStorage）には触らない。ホームへ移動しても、戻ってきたら
 *   同じ段階から再開できる必要があるため。
 * ★これを呼ばないと、コーチマークのオーバーレイが body に残ったままホームに
 *   重なり、さらに次に戻ったとき isCoachOpen() が真になって②が出せなくなる
 *   （＝以後まったく進めなくなる）。
 */
export function abortIntroVisuals() {
  closeCoachMark();
  closeTooltipTour();
  document.getElementById(USAGE_ID)?.remove();
  setIntroRunning(false);
}

// ── ミッション作成フォームのツールチップ（初期オンボーディングとは独立）──
/**
 * ミッション作成モーダルが開いた直後に呼ぶ（modals/mission.js 経由）。
 *
 * ★①〜③の流れには含めない。作成フォームを**初めて開いたとき**に1回だけ出す。
 * ★単位はユーザー（イベント単位ではない）。フォームの使い方はイベントごとに
 *   変わらないので、イベントを作るたびに出すと鬱陶しい。
 * ★見たかどうかは開いた時点で記録する。途中で閉じても二度目は出さない
 *   （閉じた時に記録すると、アプリを落とされたときに毎回出てしまう）。
 */
function _formTourSeen(userId) {
  try { return localStorage.getItem(FORM_TOUR_KEY(userId)) === 'done'; } catch (_) { return false; }
}

export function startMissionFormTour() {
  const u = state.currentUser;
  if (!u) return;
  if (_formTourSeen(u.id)) return;
  try { localStorage.setItem(FORM_TOUR_KEY(u.id), 'done'); } catch (_) {}

  setIntroRunning(true);
  const ok = startTooltipTour({
    steps: [
      { selector: '[data-coach="mission-title"]',
        title: 'ミッションの名前',
        body:  '何をやるかを短く書こう。あとから変えられます' },
      { selector: '[data-coach="assignee"]',
        title: '担当者',
        body:  '誰がやるか決めよう。「やりたい人が手を挙げる」形にもできます' },
      // ★「期日」「締切」と読める語を使わないこと。ミッションのスケジュールは1日ではなく
      //   期間で、ガントチャート（modals/eventCalendarSheet.js）に反映される。
      //   締切だと誤解されると初日だけ／最終日だけを選んで確定されてしまう。
      { selector: '[data-coach="schedule"]',
        title: 'スケジュール',
        body:  '取りかかる期間をなぞって選ぼう。ガントチャートに反映されます' },
    ],
    lastLabel: 'はじめる',
    onStep:   (step) => logEvent('intro_form_tour_step', { step }),
    onSkip:   () => { logEvent('intro_form_tour_skipped'); _finishFormTour(); },
    onFinish: () => _finishFormTour(),
  });

  if (!ok) { _finishFormTour(); return; }   // 対象が1つも無ければ止めずに進める
  logEvent('intro_form_tour_shown');
}

function _finishFormTour() {
  setIntroRunning(false);
}

/**
 * ミッション作成モーダルが閉じられたときに呼ぶ。
 * ★このツアーは初期オンボーディングの進行状態には触らない（独立しているため）。
 *   表示を畳んで抑止フラグを落とすだけ。
 * ★モーダルの閉じるアニメーション（300ms）の間はボードの座標が測れないので、
 *   閉じ切ってから一度 render() を促す。判定自体は checkIntro に任せる
 *   （②や③がこのあと出る場合があるため）。
 */
export function onMissionFormClosed() {
  closeTooltipTour();
  setIntroRunning(false);
  setTimeout(() => state.render(), 350);
}

// ── ② イベント主要機能の紹介（コーチマーク4連）──────────────
// ★操作を強制しない（どこをタップしても次へ）。ここは「見せる」段階で、
//   実際に手を動かしてもらうのは次の③（目的を定めよう）。
//
// ★対象が無いステップは出さず、番号は残った数で詰める
//   （3枚しか出ないのに 1/4 と表示されるのは不自然）。
// ★並びは画面の上から下へ。最後に「作成ボタン」を置いて、次の行動へ繋げる。
const FEATURE_STEPS = [
  {
    selector: '[data-coach="days-left"]',
    title: 'ここで開催日までの残りを確認できるよ',
    // 開催日が未設定だとチップが「開催日時が設定されていません」になるので出さない
    available: (p) => Array.isArray(p.dates) && p.dates.length > 0,
  },
  {
    selector: '[data-coach="proposals"]',
    title: 'AIからの提案があるよ',
    body:  '使えそうならタップしてミッションにできる',
    // 生成前・0件のときは枠だけ（ローディング／待ち時間表示）なので出さない
    available: (p) => (p.proposals || []).length > 0,
  },
  {
    selector: '[data-coach="mission-list"]',
    title: '作成したミッションはここに並ぶよ',
    available: () => true,
  },
  {
    // ★FAB は MAIN タブ・管理者のときだけ描画される。
    //   isIntroEligible が管理者に限っているので、MAIN タブなら必ずある。
    selector: '[data-coach="fab"]',
    title: 'ミッションはここから作れるよ',
    body:  'やることを書き出して、担当と期間を決めよう',
    available: () => true,
  },
];

/**
 * ミッションを保存してボードに戻った直後に呼ばれる（checkIntro 経由＝render 駆動）。
 *
 * ★出せない状況では**状態を進めない**で戻る。次の render() でやり直せばよい。
 *   ②と違って出口が塞がるわけではないので、無理に出すより待つほうが安全。
 */
export function showFeatureTour() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  if (isCoachOpen()) return;
  // ★①がまだ開いている間は次へ進めない。①は「出した時点」で状態を進めるため
  //   （読んでいる途中でアプリを閉じても①を繰り返さないための仕様）、
  //   SSE などで render() が走ると、まだ「わかった」を押していないのに
  //   ここが動いてモーダルの上にコーチマークが重なってしまう。
  if (document.getElementById(USAGE_ID)) return;

  // ミッション作成モーダルの閉じるアニメーション中は座標が取れない。
  // 閉じ切ってから onMissionFormClosed() が render() を促すので、ここでは何もしない
  if (document.getElementById('mission-overlay')) return;

  // 対象は全て MAIN タブにある
  if (state.mainBoardTab !== 'MAIN') {
    state.mainBoardTab = 'MAIN';
    state.render();
    return;
  }

  const steps = FEATURE_STEPS.filter(s => s.available(p) && document.querySelector(s.selector));
  if (steps.length === 0) {
    // 出すものが何も無い（＝ボードが未描画など）。完了にはせず次の render に任せる
    return;
  }

  setIntroRunning(true);
  logEvent('intro_feature_tour_shown', { total: steps.length });

  const show = (i) => {
    const s = steps[i];
    const isLast = i === steps.length - 1;
    const ok = showCoachMark({
      selector: s.selector,
      title:    s.title,
      body:     s.body,
      counter:  `${i + 1}/${steps.length}`,
      hint:     isLast ? '' : 'タップで次へ',
      advanceOn: 'anywhere',
      cta:      isLast ? 'はじめる' : '',
      onAdvance: () => {
        logEvent('intro_feature_tour_step', { step: i + 1 });
        if (isLast) _finishFeatureTour();
        else show(i + 1);
      },
    });
    // 途中で対象が消えた（再描画など）→ 止めずに次へ。最後だったら完了
    if (!ok) { if (isLast) _finishFeatureTour(); else show(i + 1); }
  };
  show(0);
}

function _finishFeatureTour() {
  logEvent('intro_feature_tour_done');
  setIntroRunning(false);
  // ★ここでは完了にしない。③（目的の促し）が残っている。
  //   次の render() で checkIntro が 'purpose' を返す。
  advanceIntro(INTRO.TOUR);
  setTimeout(() => state.render(), 250);
}

// ── ③ 「目的を定めよう」の促し ──────────────────────────────
/**
 * イベント作成時に自動生成される「イベントの目的を定めよう」（def-1）を指し示す。
 *
 * ★②と違い、出口を穴のタップに絞る（advanceOn:'target'）。ここだけは実際に
 *   手を動かしてほしい段階なので、眺めて流せないようにしてある。
 *   ★ただし対象が無ければ**出さずに完了**させる。出せないまま止めると操作不能になる
 *     （②で同じ設計にして踏んだ落とし穴）。対象が無くなるのは、
 *     すでに目的を書き終えている（cleared なので一覧に出ない）ときなど。
 */
const PURPOSE_MISSION_ID = 'def-1';

// ★③を「やらずに閉じた」ことをこのセッションの間だけ覚える。
//   localStorage には書かないので、アプリを開き直せばまた出る（＝次回また促す）。
//   ★これが無いと、閉じた直後の render() で即座に出し直され、暗転が消えず
//     何も操作できなくなる。逆に localStorage に書くと二度と出なくなる。
let _purposeDismissedThisSession = false;

export function showPurposeCoach() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  if (isCoachOpen()) return;
  if (_purposeDismissedThisSession) return;
  // ★①がまだ開いている間は次へ進めない。①は「出した時点」で状態を進めるため
  //   （読んでいる途中でアプリを閉じても①を繰り返さないための仕様）、
  //   SSE などで render() が走ると、まだ「わかった」を押していないのに
  //   ここが動いてモーダルの上にコーチマークが重なってしまう。
  if (document.getElementById(USAGE_ID)) return;
  if (document.getElementById('mission-overlay')) return;

  if (state.mainBoardTab !== 'MAIN') {
    state.mainBoardTab = 'MAIN';
    state.render();
    return;
  }

  const shown = showCoachMark({
    selector: `[data-mission-id="${PURPOSE_MISSION_ID}"]`,
    title:   'まずは目的を定めよう',
    body:    'ここが決まると、迷ったときに立ち帰る軸になる',
    hint:    'タップして書いてみよう',
    finger:  true,
    advanceOn: 'target',
    onAdvance: () => {
      logEvent('intro_purpose_tapped');
      _finishIntro();
      state.openMissionDetail(PURPOSE_MISSION_ID);
    },
    // ★穴の外をタップしたら、目的ミッションを開かずに閉じる。
    //   出口が「目的ミッションのタップ」だけだと、他を触りたい人が閉じ込められる。
    // ★ここでは進行状態を進めない（＝次にアプリを開いたときにまた促す）。
    //   代わりにセッション内フラグで抑止する。localStorage に書いて完了扱いに
    //   すると、目的を書かないまま二度と促されなくなる。
    onDismiss: () => {
      logEvent('intro_purpose_dismissed');
      _purposeDismissedThisSession = true;
      setIntroRunning(false);   // 他の自動モーダルの抑止を解く
    },
  });

  if (!shown) {
    // 目的ミッションが一覧に無い（＝すでに完了している等）。止めずに完了させる
    _finishIntro();
    return;
  }
  setIntroRunning(true);
  logEvent('intro_purpose_shown');
}

function _finishIntro() {
  setIntroRunning(false);
  advanceIntro(INTRO.DONE);
}
