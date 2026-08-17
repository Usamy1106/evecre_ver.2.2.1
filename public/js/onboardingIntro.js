// ===== 初期オンボーディング（イベント作成直後のチュートリアル）=====
// リーダーがイベントを作った直後に、①使い方 → ②FABコーチマーク →
// ③作成モーダルのツールチップ → ④メインボードのコーチマーク3連 を順に通す。
//
// ★4段階は厳密に順序があり、途中で中断・再開されうる。独立したフラグを並べず、
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
  NONE:  null,          // 未開始
  USAGE: 'usage_shown', // ①表示済み。★FAB をタップするまで②を出し続ける
  FAB:   'fab_coach',   // ★FAB を実際にタップした。③待ち
  FORM:  'form_tour',   // ③表示済み。④待ち
  DONE:  'done',        // 完了。以後表示しない
};

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

/** 現在の進行状態（未開始は null） */
export function getIntroState(userId, eventId) {
  try { return localStorage.getItem(_key(userId, eventId)); } catch (_) { return null; }
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
 * @returns {'usage'|'fab'|'board'|null} 次に出す段階
 */
export function nextIntroStep() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return null;
  if (!isIntroEligible(state.currentUser.id, p)) return null;

  const cur = getIntroState(state.currentUser.id, p.id);
  if (cur === INTRO.NONE || cur === null) return 'usage';   // ①
  // ★usage_shown の間は②を出し続ける。②の出口は FAB のタップだけなので、
  //   アプリを落として戻ってきたときにコーチマークが消えていると先へ進めなくなる。
  //   FAB を実際にタップしたとき（Phase C）に fab_coach へ進めること。
  if (cur === INTRO.USAGE) return 'fab';                    // ②
  // ③はミッション作成モーダルを開いた時に出すので、ここでは扱わない
  if (cur === INTRO.FORM)  return 'board';                  // ④
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
  if (step === 'usage') { showUsageModal(); return; }
  if (step === 'fab')   { showFabCoach();   return; }
  if (step === 'board') { showBoardCoach(); return; }
}

// ── ① 「イベクリの使い方」モーダル ──────────────────────────
// ★出口は「わかった」だけ。閉じるボタンも背景タップも置かない
//   （置くと②へ進まないまま放置され、状態が宙ぶらりんになる）。
export function showUsageModal() {
  if (document.getElementById(USAGE_ID)) return;
  setIntroRunning(true);

  const overlay = document.createElement('div');
  overlay.id = USAGE_ID;
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[420] flex items-center justify-center p-6';
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
      <p class="text-[11px] text-[#0CA1E3] font-bold mb-2">イベクリの使い方</p>
      <h3 class="heading-m text-[#484545] mb-5 font-bold leading-snug">イベントづくりは<br>5つのステップで進みます</h3>
      <div class="space-y-3 mb-6">
        ${[
          ['決める', '何をやるかを決める'],
          ['積む',   'やることを洗い出して日付を入れる'],
          ['配る',   '誰がやるかを決める'],
          ['こなす', '実行して提出する'],
          ['残す',   '振り返って次に引き継ぐ'],
        ].map(([label, desc], i) => `
          <div class="flex items-start gap-3 text-left">
            <span class="w-6 h-6 rounded-full bg-[#0CA1E3] text-white text-[11px] font-bold
              flex items-center justify-center flex-shrink-0 mt-0.5">${i + 1}</span>
            <div class="min-w-0">
              <p class="text-[13px] font-bold text-[#484545]">${label}</p>
              <p class="text-[11px] text-[#A7AAAC] font-bold leading-relaxed">${desc}</p>
            </div>
          </div>`).join('')}
      </div>
      <button data-intro="ack" class="c-button c-button--primary w-full py-4 heading-rs font-bold shadow-lg">わかった</button>
    </div>`;
  document.body.appendChild(overlay);
  logEvent('intro_usage_shown');

  overlay.querySelector('[data-intro="ack"]').onclick = () => {
    logEvent('intro_usage_ack');
    overlay.remove();
    advanceIntro(INTRO.USAGE);
    // ★閉じるアニメーションと重ならないよう1フレーム置いてから②へ
    requestAnimationFrame(() => showFabCoach());
  };
}

// ── ② FAB コーチマーク ──────────────────────────────────────
/**
 * FAB をスポットライトで指し示す。出口は FAB のタップだけ。
 *
 * ★フェイルセーフ：FAB が取得できない場合はオーバーレイを出さず、状態を次へ進める。
 *   出口がひとつしか無いので、出せないまま止めると操作不能になる。
 * ★FAB は MAIN タブ・管理者のときだけ描画されるので、先に MAIN タブへ戻す。
 */
export function showFabCoach() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  if (isCoachOpen()) return;

  // FAB が無いタブにいると出せない。MAIN に戻して次の render に任せる
  if (state.mainBoardTab !== 'MAIN') {
    state.mainBoardTab = 'MAIN';
    state.render();
    return;
  }

  setIntroRunning(true);
  const shown = showCoachMark({
    selector: '[data-coach="fab"]',
    title:   'まずはここから。',
    body:    '最初のミッションをつくってみよう',
    hint:    'タップしてね',
    finger:  true,
    advanceOn: 'target',
    onAdvance: () => {
      // ★FAB を実際にタップしたときだけ次の状態へ進める
      logEvent('intro_fab_tapped');
      advanceIntro(INTRO.FAB);
      window._app?.openMissionModal?.();
    },
  });

  if (!shown) {
    // ★出せなかったら止めない。③から再開できるよう状態を進める
    setIntroRunning(false);
    advanceIntro(INTRO.FAB);
    return;
  }
  logEvent('intro_fab_coach_shown');
}

/** コーチマークが開いているか（多重表示の防止） */
function isCoachOpen() {
  return !!document.getElementById('coach-mark-overlay');
}

/** イントロを中断する（画面遷移などで呼ぶ） */
export function abortIntroVisuals() {
  closeCoachMark();
  setIntroRunning(false);
}

// ── ③ ミッション作成モーダルのツールチップ ──────────────────
/**
 * ミッション作成モーダルが開いた直後に呼ぶ（main.js の openMissionModal 経由）。
 * ★初回のみ。2回目以降は出さない。
 * ★中断（モーダルを閉じた）場合も「一度見た」として扱い、③完了として次へ進める。
 */
export function startMissionFormTour() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  if (!isIntroEligible(state.currentUser.id, p)) return;
  if (getIntroState(state.currentUser.id, p.id) !== INTRO.FAB) return;   // ②を済ませた直後だけ

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
  advanceIntro(INTRO.FORM);
}

/**
 * ミッション作成モーダルが閉じられたときに呼ぶ。
 * ★途中で閉じても「一度見た」として③を完了扱いにする（宙ぶらりんにしない）。
 */
export function onMissionFormClosed() {
  closeTooltipTour();
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  if (getIntroState(state.currentUser.id, p.id) === INTRO.FAB) _finishFormTour();
  else setIntroRunning(false);

  // ★④はボードの実座標を測るので、モーダルの閉じるアニメーション(300ms)が
  //   終わってから始める。createOrUpdateMission は closeMissionModal() の直後に
  //   render() を呼ぶが、その時点ではまだ mission-overlay が残っていて測れない。
  //   ここで一度だけ render() を促し、判定自体は checkIntro に任せる（render 駆動のまま）。
  if (getIntroState(state.currentUser.id, p.id) === INTRO.FORM) {
    setTimeout(() => state.render(), 350);
  }
}

// ── ④ メインボードのコーチマーク3連 ────────────────────────
// ★ここは②と違い操作を強制しない（どこをタップしても次へ）。
//   ミッションを1件作り終えた直後なので、以降は自由に触れるべきだから。
//
// ★対象が無いステップは出さず、番号は残った数で詰める
//   （2枚しか出ないのに 1/3 と表示されるのは不自然）。
const BOARD_STEPS = [
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
];

/**
 * ミッションを保存してボードに戻った直後に呼ばれる（checkIntro 経由＝render 駆動）。
 *
 * ★出せない状況では**状態を進めない**で戻る。次の render() でやり直せばよい。
 *   ②と違って出口が塞がるわけではないので、無理に出すより待つほうが安全。
 */
export function showBoardCoach() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p || !state.currentUser) return;
  if (isCoachOpen()) return;

  // ミッション作成モーダルの閉じるアニメーション中は座標が取れない。
  // 閉じ切ってから onMissionFormClosed() が render() を促すので、ここでは何もしない
  if (document.getElementById('mission-overlay')) return;

  // 対象は全て MAIN タブにある
  if (state.mainBoardTab !== 'MAIN') {
    state.mainBoardTab = 'MAIN';
    state.render();
    return;
  }

  const steps = BOARD_STEPS.filter(s => s.available(p) && document.querySelector(s.selector));
  if (steps.length === 0) {
    // 出すものが何も無い（＝ボードが未描画など）。完了にはせず次の render に任せる
    return;
  }

  setIntroRunning(true);
  logEvent('intro_board_coach_shown', { total: steps.length });

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
        logEvent('intro_board_coach_step', { step: i + 1 });
        if (isLast) _finishBoardCoach();
        else show(i + 1);
      },
    });
    // 途中で対象が消えた（再描画など）→ 止めずに次へ。最後だったら完了
    if (!ok) { if (isLast) _finishBoardCoach(); else show(i + 1); }
  };
  show(0);
}

function _finishBoardCoach() {
  logEvent('intro_board_coach_done');
  setIntroRunning(false);
  advanceIntro(INTRO.DONE);
}
