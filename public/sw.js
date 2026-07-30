// ===== Service Worker：push 受信と通知タップのみ =====
// ★キャッシュ（fetch イベント）は一切実装しない。
// server.js の静的配信は「JS/HTML/CSS に Cache-Control: no-cache を付けて ETag で
// 必ず再検証させる」という意図的なキャッシュ戦略を採っている（iOS WebKit が古い JS を
// 抱え込む事故の対策）。SW でキャッシュを噛ませるとこの設計と衝突し、デプロイ後も
// 古い JS が配信され続ける不具合になるため、fetch には触らない。

// 新しい SW を即座に有効化する（古い SW を待たない）
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  const title = data.title || 'イベクリ';
  const options = {
    body:  data.body || '',
    icon:  '/images/icon/app-icon-192.png',
    badge: '/images/icon/app-badge-72.png',
    data:  { url: data.url || '/' },
    tag:   data.tag || undefined,
    renotify: Boolean(data.tag),
  };
  event.waitUntil(self.registration.showNotification(title, options));
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
