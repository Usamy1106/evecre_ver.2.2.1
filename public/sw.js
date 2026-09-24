// ===== Service Worker：push 受信 / 通知タップ / ページが読めないときの代替 =====
//
// ★**アプリの JS・CSS・HTML をキャッシュしないこと。**
//   server.js の静的配信は「no-cache ＋ ETag で必ず再検証させる」という意図的な戦略で
//   （iOS WebKit が古い JS を抱え込む事故の対策）、SW でキャッシュを噛ませると
//   デプロイ後も古い JS が配信され続ける不具合になる。
//
// ★fetch は**ページの遷移（navigate）だけ**を見る。しかも必ずネットワークを先に試し、
//   失敗したときだけ /offline.html を返す。それ以外の要求には respondWith せず、
//   ブラウザにそのまま任せる（＝配信の戦略に一切干渉しない）。
//   - なぜ要るか：ホーム画面に追加した PWA（standalone）は、通信に失敗しても
//     ブラウザのエラー画面を出さないので**真っ暗な画面**になる。本番で実際に起きた。
//   - ここを「JS も CSS もキャッシュする」形に広げないこと。上の禁止に戻る。
//
// 新しい SW を即座に有効化する（古い SW を待たない）

const OFFLINE_CACHE = 'evecre-offline-v1';
const OFFLINE_URL   = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // ★cache:'reload' を付けること。付けないと HTTP キャッシュの古い写しを取り込みうる
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 古い版の代替ページを捨てる（持つキャッシュは常に1つだけ）
    for (const key of await caches.keys()) {
      if (key !== OFFLINE_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  // ★ページの遷移以外には触らない。respondWith を呼ばなければブラウザが普通に処理する
  if (event.request.mode !== 'navigate') return;
  // ★GET 以外の遷移には絶対に触らないこと。iOS の Google サインインは
  //   トップレベルの**フォーム POST**（CLAUDE.md 落とし穴17）で、これも mode==='navigate' になる。
  //   ここを通すと、このアプリでいちばん壊れやすい経路を SW 越しに再送することになる。
  //   失敗した POST を代替ページに差し替えたいわけでもないので、素通しでよい。
  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    try {
      // ★必ずネットワーク優先。成功したものは**キャッシュしない**
      //   （アプリの HTML を持つと、古い版が出続ける事故に戻る）
      return await fetch(event.request);
    } catch (_) {
      const cached = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
      // 代替ページも無ければ、SW が無いときと同じ挙動に落とす
      return cached || Response.error();
    }
  })());
});

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
    icon:  '/images/icon/evecre-icon-192.png',
    // ★バッジは白抜き・透過のもの。Android は不透明度しか使わないので、
    //   通常のアイコン（不透明な正方形）を渡すとステータスバーに白い四角が出る
    badge: '/images/icon/evecre-badge-96.png',
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
