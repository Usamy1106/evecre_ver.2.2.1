// ===== クライアント識別子 =====
// 他のモジュールに依存しない単独モジュール。
// state.js / realtime.js / api.js から共通参照される。
//
// ページがリロードされるまで同じ値を使う。
// SSE のエコーバック抑止（自分の保存後に自分宛に eventUpdated を送らない）に使われる。

export const clientId = `c_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
