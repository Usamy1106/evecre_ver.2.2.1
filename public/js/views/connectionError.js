// ===== 接続エラー画面（起動時に通信できなかったとき）=====
//
// ★「未ログイン」と「通信失敗」は別物。以前は両方とも WELCOME（ようこそ画面）に
//   落としていたため、電波が悪いだけなのに「ログアウトさせられた」ように見えていた。
//   さらにホーム画面に追加した PWA（standalone）では、ブラウザのエラー画面すら
//   出ないので、起動に失敗すると**真っ暗な画面**になって原因が分からなかった。
//
// ★この画面に来る経路は state.showConnectionError() の1つだけ。
//   init() / loadAfterAuth() / main.js の起動保険がすべてそこを通る。
//
// ★専用の CSS を持たない。入口画面（p-welcome）のガワに c-notice--danger を置くだけ。

import { state } from '../state.js';
import { logEvent } from '../logger.js';

export function renderConnectionError(container) {
  // スタイル: public/css/object/project/_welcome.css（ガワ）
  //          public/css/object/component/_notice.css（囲み）
  const retrying = !!state.retryingConnection;

  container.innerHTML = `
    <div class="p-welcome u-page-transition">
      <main class="p-welcome__main">
        <div class="p-welcome__hero">
          <img src="/images/icon/evecre-icon-192.png" alt="" class="p-welcome__logo">
          <h1 class="p-welcome__title">接続できません</h1>
        </div>

        <div class="c-notice c-notice--danger">
          <div class="c-notice__symbol" aria-hidden="true">⚠️</div>
          <p class="c-notice__text">
            サーバーに接続できませんでした。<br>
            電波の良い場所でもう一度お試しください。
          </p>
          <p class="c-notice__note">
            Wi-Fi とモバイル通信を切り替えると直ることがあります
          </p>
        </div>

        <div class="p-welcome__actions">
          <button type="button" id="conn-retry" class="c-button c-button--primary p-welcome__button"
            ${retrying ? 'disabled' : ''}>
            ${retrying ? '接続中…' : '再試行'}
          </button>
        </div>
      </main>
    </div>`;

  document.getElementById('conn-retry').onclick = () => {
    logEvent('connection_retry_tapped');
    state.retryStartup();
  };
}
