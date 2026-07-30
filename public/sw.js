// ===== Service Worker：push 受信と通知タップのみ =====
// ★キャッシュ（fetch イベント）は一切実装しない。
// server.js の静的配信は「JS/HTML/CSS に Cache-Control: no-cache を付けて ETag で
// 必ず再検証させる」という意図的なキャッシュ戦略を採っている（iOS WebKit が古い JS を
// 抱え込む事故の対策）。SW でキャッシュを噛ませるとこの設計と衝突し、デプロイ後も
// 古い JS が配信され続ける不具合になるため、fetch には触らない。

// 新しい SW を即座に有効化する（古い SW を待たない）
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// 開いているページ全部にメッセージを送る（診断用）
async function _postToClients(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of list) {
    try { c.postMessage(msg); } catch (_) {}
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  const title = data.title || 'イベクリ';
  const options = {
    body:  data.body || '',
    icon:  '/images/icon/app-icon-192.png',
    badge: '/images/icon/app-badge-72.png',
    data:  { url: data.url || '/' },
  };
  // ★renotify は tag とセットでないと TypeError になる（仕様）。tag があるときだけ付ける。
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }

  event.waitUntil((async () => {
    // 「push は届いたか」をページ側で確認できるようにする（OS が表示しないだけなのか、
    //  そもそも push が届いていないのかを切り分けるため）。アプリを閉じていれば誰も受け取らない。
    await _postToClients({ type: 'PUSH_RECEIVED', title, body: options.body });
    try {
      await self.registration.showNotification(title, options);
    } catch (err) {
      // 表示に失敗した場合でも握りつぶさず、最小構成で再試行する
      // （icon/badge のパス不正やオプション不整合で落ちるケースがある）
      await _postToClients({ type: 'PUSH_SHOW_FAILED', error: String(err && err.message || err) });
      try {
        await self.registration.showNotification(title, { body: options.body });
      } catch (_) { /* これでも駄目なら OS 側の問題 */ }
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) {
        // このアプリは URL ルーティングを持たず state.setView() でメモリ内遷移するため、
        // 既に開いているタブには URL ではなくメッセージで遷移を指示する（push.js が受ける）。
        c.postMessage({ type: 'PUSH_NAVIGATE', url: targetUrl });
        return c.focus();
      }
    }
    // 開いているタブが無い場合は新規で開く。パスは既存のディープリンク
    // /m/<eventId>/<missionId> 形式なので、state.init() が拾って遷移してくれる。
    return clients.openWindow(targetUrl);
  })());
});
