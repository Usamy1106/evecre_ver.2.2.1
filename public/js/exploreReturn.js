// ===== 公開ページ（/explore）から「ログインしてコメントする」→ ログインのあと同じページへ戻る（2026-11-12）=====
// ★state.js と views/explore.js の両方から使うので、ほかのモジュールを import しない（循環させない）
// ★戻り先は sessionStorage に1つだけ。1回で消費し、古いもの（30分超）・/explore 以外のパスは捨てる
//   （iOS の Google サインインはフォーム POST → / へのリダイレクトなので、同じタブの sessionStorage で引き継ぐ）

const RETURN_KEY    = 'evecre:exploreReturn';
const RETURN_TTL_MS = 30 * 60 * 1000;

export function rememberExploreReturn() {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path: location.pathname + location.search, at: Date.now() }));
  } catch (_) {}
}

/** ログインのあと（state.loadAfterAuth の最後）に呼ぶ。戻り先があればそのページを開き直して true */
export function consumeExploreReturn() {
  let raw = null;
  try { raw = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); } catch (_) { return false; }
  if (!raw) return false;
  try {
    const { path, at } = JSON.parse(raw);
    if (typeof path !== 'string' || !/^\/explore(\/|\?|$)/.test(path) || !(Date.now() - at <= RETURN_TTL_MS)) return false;
    location.replace(path);
    return true;
  } catch (_) { return false; }
}
