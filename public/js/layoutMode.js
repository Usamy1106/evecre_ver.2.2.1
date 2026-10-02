// ===== 画面の広さによる表示の切り替え（タブレット・PC）=====
//
// ★広い画面かどうかの判定は、ここ1か所に集約する（各画面で matchMedia を書かないこと）。
//   ダッシュボード表示 … (min-width: 768px) and (min-height: 560px)。iPad 縦〜PC。
//                        横向きのスマホ（高さが足りない）は含めない
//   それ未満          … 今までのスマホ表示（1列）
//
// <html> に付けるクラス（CSS は foundation/_variables.css の --layout-max-width を切り替える）：
//   is-wide             … 広い画面（ダッシュボード表示の対象）
//   is-screen-dashboard … 広い画面の「見渡す」画面（ホーム・フォルダ・メインボード）
//   is-screen-full      … そのうち画面いっぱいに使う画面（メインボード。左右に余白を取らない）
//   is-screen-reading   … 広い画面の「読む・書く」画面（タスク詳細・設定など）
//   （どちらでもない画面＝作成フロー・ログインなどは、広い画面でも 448px のまま）
//
// ★ダッシュボード表示は MAIN_BOARD の「表示の違い」であって、別のビューにはしない。
// ★スマホ表示の DOM・挙動は変えないこと（分岐は isDashboard() の中だけ）。

export const DASHBOARD_QUERY = '(min-width: 768px) and (min-height: 560px)';

const DASHBOARD_VIEWS = new Set(['HOME', 'PROJECT_DETAIL', 'MAIN_BOARD']);
const FULL_VIEWS = new Set(['MAIN_BOARD']);
const READING_VIEWS = new Set([
  'MISSION_DETAIL', 'MISSION_REFLECT', 'PILLAR_EDIT', 'EVENT_SETTINGS', 'ACCOUNT',
  'ARCHIVE_ANSWERS', 'ARCHIVE_STATS', 'LEGAL',
]);

let _mql = null;
function _query() {
  if (!_mql && typeof window !== 'undefined' && window.matchMedia) _mql = window.matchMedia(DASHBOARD_QUERY);
  return _mql;
}

/** 広い画面（ダッシュボード表示の対象）か */
export function isDashboard() {
  return !!_query()?.matches;
}

/** state.render() の最初に呼ぶ。今の画面に合わせて <html> のクラスを付け替える */
export function applyLayoutClasses(view) {
  const root = document.documentElement;
  const wide = isDashboard();
  root.classList.toggle('is-wide', wide);
  root.classList.toggle('is-screen-dashboard', wide && DASHBOARD_VIEWS.has(view));
  root.classList.toggle('is-screen-full', wide && FULL_VIEWS.has(view));
  root.classList.toggle('is-screen-reading', wide && READING_VIEWS.has(view));
}

/**
 * 画面の広さが境目をまたいだら描き直す（main.js の起動時に1回だけ呼ぶ）。
 * ★resize のたびには描き直さない（境目をまたいだときだけ）。
 */
export function watchLayoutMode(onChange) {
  const mql = _query();
  if (!mql) return;
  const handler = () => onChange(isDashboard());
  if (mql.addEventListener) mql.addEventListener('change', handler);
  else if (mql.addListener) mql.addListener(handler);   // 古い Safari
}
