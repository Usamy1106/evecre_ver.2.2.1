// ===== 入口画面（未ログイン時に最初に出る画面）=====
//
// 「新規登録」と「ログイン」の2択だけを置く。
//
// ★以前はアカウント作成（signup の STEP 0）がいきなり出ていた。既存ユーザーが
//   アプリを開き直したときも作成画面から始まり、ログインは画面下の小さな文字
//   （「アカウントをお持ちですか？ ログイン」）を探さないと辿れなかった。
//   ここで2択に分けることで、どちらの人も1タップ目で迷わない。
//
// ★招待リンクから来た人にもこの画面が出るので、招待の内容（誰から・どのイベント）を
//   ここでも見せる。何に参加しようとしているのか分からないまま登録させない。

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { _inviteContextBanner } from './auth.js';

export function renderWelcome(container) {
  // スタイル: public/css/object/project/_welcome.css
  container.innerHTML = `
    <div class="p-welcome u-page-transition">
      <main class="p-welcome__main">
        <div class="p-welcome__hero">
          <img src="/images/icon/app-icon-192.png" alt="" class="p-welcome__logo">
          <h1 class="p-welcome__title">イベクリ</h1>
          <p class="p-welcome__lead">イベントづくりを、みんなで楽しく。</p>
        </div>

        ${_inviteContextBanner()}

        <div class="p-welcome__actions">
          <button type="button" id="wc-signup" class="c-button c-button--primary p-welcome__button">
            新規登録
          </button>
          <button type="button" id="wc-login" class="c-button c-button--secondary p-welcome__button">
            ログイン
          </button>
        </div>
      </main>
    </div>`;

  document.getElementById('wc-signup').onclick = () => {
    logEvent('welcome_signup_tapped');
    // ★作成フローの下書きは毎回まっさらにする。前回の途中入力（メールや同意）が
    //   残っていると、別の人が同じ端末で作るときに混ざる。
    state.signup = null;
    state.authErrors = {};
    state.setView('CREATE_ACCOUNT_INFO');
  };

  document.getElementById('wc-login').onclick = () => {
    logEvent('welcome_login_tapped');
    state.authErrors = {};
    state.setView('LOGIN');
  };
}
