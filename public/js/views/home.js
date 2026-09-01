// ===== ホーム画面 =====
import { state } from '../state.js';
import { Components } from '../components.js';
import { bindEventLongPress, bindFolderLongPress } from '../modals/eventActions.js';
import { pushBannerHtml, bindPushBanner } from '../modals/pushSetupModal.js';
import { pickCharacterTip, characterTipHtml } from '../character.js';

/**
 * ホーム画面をレンダリングする
 * @param {HTMLElement} container
 */
export function renderHome(container) {
  const tab = state.homeTab || 'EVENTS';

  // ★右下のひとこと。イベントが1件も無いとき（エンプティーステート）は出さない。
  //   「イベントを作成」へ進んでもらう場面なので、助言で気を散らさないため。
  // ★引くのは HOME を開いたときの1回だけ。state.homeTip は HOME を離れるときに
  //   setView が捨てるので、ここで null なら「今 HOME を開いた」ということ。
  //   render() のたびに引くと、タブ切り替えや SSE のたびに入れ替わってしまう。
  const showTip = state.events.length > 0;
  if (showTip && !state.homeTip) state.homeTip = pickCharacterTip();

  // スタイル: public/css/object/project/_home.css
  container.innerHTML = `
    <div class="p-home">
      ${Components.Header(null)}
      ${Components.VerifyBanner()}
      <!-- 通知が未設定の人へのバナー（閉じると7日間は出ない）。
           iOS は6割を占め、ホーム画面に追加しないと通知が届かないため、
           HOME から辿り直せる導線を常設している -->
      <div class="p-home__notice">${pushBannerHtml()}</div>
      ${state.pendingApprovalMessage ? _pendingApprovalCard() : ''}
      ${_incomingRequestsCard()}
      <nav class="p-home__tabs">
        <button type="button" onclick="window._app.setHomeTab('EVENTS')"
          class="p-home__tab${tab === 'EVENTS' ? ' is-active' : ''}">イベント</button>
        <button type="button" onclick="window._app.setHomeTab('PROJECTS')"
          class="p-home__tab${tab === 'PROJECTS' ? ' is-active' : ''}">プロジェクト</button>
      </nav>
      <main class="p-home__main u-page-transition">
        ${tab === 'EVENTS' ? _renderEventsTab() : _renderProjectsTab()}
      </main>
      <!-- ★右下の丸い＋ボタン（FAB）は3画面とも廃止した。
           イベント作成 → ヘッダーの「イベントを作成」
           プロジェクト作成 → プロジェクトタブ見出し横の「＋ 新規作成」 -->
      ${showTip ? characterTipHtml(state.homeTip) : ''}
    </div>`;

  bindPushBanner();

  bindEventLongPress();
  bindFolderLongPress();
}

/**
 * 「参加申請が届いています」のアナウンスカード（管理者向け）。
 *
 * ★イベントページを開かないと気づけなかったので HOME にも出す。申請は放置される
 *   ほど相手が離れるため、いちばん最初に目に入る場所に置いている。
 * ★複数のイベントに届いていることがあるので、イベント名を並べてそれぞれ開ける。
 */
function _incomingRequestsCard() {
  if (!state.currentUser) return '';
  const targets = (state.events || []).filter(p =>
    (p.pendingMembers || []).length > 0 && state.canManageCurrentEvent(p.id));
  if (targets.length === 0) return '';

  const total = targets.reduce((n, p) => n + (p.pendingMembers || []).length, 0);
  const rows = targets.map(p => `
    <button type="button" onclick="window._app.setView('MAIN_BOARD', '${_esc(p.id)}')"
      class="p-home__request-row">
      <span class="p-home__request-name">${_esc(p.name || 'イベント')}</span>
      <span class="p-home__request-count">${(p.pendingMembers || []).length}件</span>
      <svg class="p-home__request-arrow" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>`).join('');

  return `
    <div class="p-home__notice p-home__request">
      <div class="p-home__request-head">
        <svg class="p-home__request-icon" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>
        </svg>
        <p class="p-home__request-title">以下のイベントへの参加申請が届いています（${total}件）</p>
      </div>
      ${rows}
    </div>`;
}

/**
 * 承認待ちカード（M0）。
 * ★「送信しました。承認されるまでお待ちください。」の一文だけだと、待ち時間が
 *   まったくの空白になり、承認されても戻ってこない。イベントの顔（キャッチコピー）と
 *   リーダーの意気込みを見せておくことで、承認通知が来たときに開く確率を上げる。
 * 招待プレビューが取れていない場合（旧経路・取得失敗）は従来どおり一文だけ出す。
 */
function _pendingApprovalCard() {
  const inv = state.pendingApprovalInvite;
  const close = `
    <button type="button" onclick="window.state.pendingApprovalMessage=null; window.state.pendingApprovalInvite=null; window.state.render();"
      class="p-home__pending-close" aria-label="閉じる">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`;
  const clock = `
    <svg class="p-home__pending-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>`;

  // 招待プレビューが取れていない場合（旧経路・取得失敗）は一文だけ出す
  if (!inv) return `
    <div class="p-home__notice p-home__pending">
      <div class="p-home__pending-head">
        ${clock}
        <p class="p-home__pending-title p-home__pending-body">${_esc(state.pendingApprovalMessage)}</p>
        ${close}
      </div>
    </div>`;

  const labels = Array.isArray(inv.motivationLabels) ? inv.motivationLabels : [];
  const text   = (inv.motivationText || '').trim();

  return `
    <div class="p-home__notice p-home__pending">
      <div class="p-home__pending-head p-home__pending-head--divided">
        ${clock}
        <div class="p-home__pending-body">
          <p class="p-home__pending-title">リーダーに通知しました</p>
          <p class="p-home__pending-sub">承認されるとイベントに入れます</p>
        </div>
        ${close}
      </div>
      <div class="p-home__pending-detail">
        ${inv.catchphrase ? `
          <p class="p-home__pending-catchphrase">${_esc(inv.catchphrase)}</p>` : ''}
        <p class="p-home__pending-event">${_esc(inv.eventName || 'イベント')}</p>
        <p class="p-home__pending-members">
          ${_esc(inv.ownerName || 'リーダー')}さん${inv.memberCount > 1 ? ` ほか${inv.memberCount - 1}人が参加中` : 'が待っています'}
        </p>
        ${(labels.length || text) ? `
          <div class="p-home__pending-motivation">
            <p class="p-home__pending-motivation-label">${_esc(inv.ownerName || 'リーダー')}さんの意気込み</p>
            <div class="p-home__pending-tags">
              ${labels.map(l => `<span class="p-home__pending-tag">${_esc(l)}</span>`).join('')}
            </div>
            ${text ? `<p class="p-home__pending-text">「${_esc(text)}」</p>` : ''}
          </div>` : ''}
      </div>
    </div>`;
}

function _renderEventsTab() {
  const ongoing   = state.events.filter(p => !p.isCompleted).sort((a, b) => b.createdAt - a.createdAt);
  const completed = state.events.filter(p => p.isCompleted).sort((a, b)  => b.createdAt - a.createdAt);
  const isEmpty   = ongoing.length === 0 && completed.length === 0;
  const verified  = !!state.currentUser?.isVerified;
  const createAction = verified ? `window._app.setView('CREATE_EVENT_INFO')` : `window._app.requireVerification()`;

  if (isEmpty) return `
    <div class="p-home__empty">
      <!-- エンプティーステート画像は後日支給予定。それまではプレースホルダー正方形 -->
      <div class="p-home__empty-art">
        <div class="p-home__empty-art-inner"></div>
      </div>
      <div>
        <p class="p-home__empty-title">イベントを始めよう</p>
        <p class="p-home__empty-text">新しいイベントを作成するか<br>招待コードで参加しましょう</p>
      </div>
      <div class="p-home__empty-actions">
        <button type="button" onclick="${createAction}" class="p-home__cta">イベントを作成</button>
        <button type="button" onclick="window._app.openJoinByCodeModal()"
          class="p-home__cta p-home__cta--outline">イベントに参加</button>
      </div>
    </div>`;

  return `
    <section class="p-home__section">
      <h2 class="p-home__heading">作成したイベント</h2>
      ${_renderGrid(ongoing)}
    </section>
    <section>
      <h2 class="p-home__heading">完了したイベント</h2>
      ${_renderGrid(completed)}
    </section>`;
}

function _renderProjectsTab() {
  const folders = state.folders || [];

  // ★FAB を廃止したので、ここがプロジェクトを新規作成する導線になる。消さないこと
  //   （他の導線はイベント長押し →「プロジェクトに追加」→「新規プロジェクトを作成」だけで、
  //     それだと空のプロジェクトを作れない）。
  const createBtn = `
    <button type="button" onclick="window._app.openNewProjectModal()" class="p-home__add">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      新規作成
    </button>`;

  if (folders.length === 0) return `
    <div class="p-home__empty p-home__empty--folders">
      <div class="p-home__empty-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <p class="p-home__empty-title">プロジェクトを作ろう</p>
      <p class="p-home__empty-text p-home__empty-text--tight">複数のイベントを1つにまとめて<br>管理できます</p>
      <button type="button" onclick="window._app.openNewProjectModal()"
        class="p-home__cta p-home__cta--inline">プロジェクトを作成</button>
    </div>`;

  return `
    <div class="p-home__heading-row">
      <h2 class="p-home__heading">プロジェクト</h2>
      ${createBtn}
    </div>
  ` + folders.map(f => `
    <div data-folder-card data-folder-id="${f.id}"
      onclick="window._app.setView('PROJECT_DETAIL', '${f.id}')"
      class="p-home__folder">
      <div class="p-home__folder-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div class="p-home__folder-body">
        <p class="p-home__folder-name">${_esc(f.name)}</p>
        ${f.description ? `<p class="p-home__folder-description">${_esc(f.description)}</p>` : ''}
      </div>
      <p class="p-home__folder-count">${f.eventCount || 0}件</p>
    </div>`).join('');
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * イベントグリッドをレンダリングする
 */
function _renderGrid(list) {
  if (list.length === 0) {
    return `
      <div class="p-home__grid-empty">イベントがありません</div>
      <div class="p-home__divider"></div>`;
  }

  let html = '';
  for (let i = 0; i < list.length; i += 3) {
    const row = list.slice(i, i + 3);
    html += `
      <div class="p-home__grid">
        ${row.map(p => `
            <div data-event-card data-event-id="${p.id}" class="p-home__card"
              onclick="window._app.setView('MAIN_BOARD', '${p.id}')">
              <div class="p-home__card-thumb">
                ${Components.EventThumbnail(p)}
              </div>
              <span class="p-home__card-name">${_esc(p.name)}</span>
            </div>`).join('')}
      </div>
      <div class="p-home__divider"></div>`;
  }
  return html;
}
