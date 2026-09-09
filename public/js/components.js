// ===== UIコンポーネント =====
import { state } from './state.js';
import { LABEL_CONFIG } from './constants.js';

function _initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}
function _escText(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// イベントのメインビジュアル（アーカイブで設定する画像）のパスを返す。無ければ null。
// 保存先は clearedData['archive-image']。旧データは提案 p3 由来のミッション完了画像を見る
// （mainBoard.js の _getClearedByOrigin と同じ後方互換）。
export function getEventMainVisual(project) {
  const direct = project?.clearedData?.['archive-image']?.content;
  if (direct) return direct;
  const m = (project?.missions || []).find(x => x.originProposalId === 'p3' && x.status === 'cleared');
  return m ? (project?.clearedData?.[m.id]?.content ?? null) : null;
}

// サムネイルのエンプティーステート。avif → webp → png の順に並べ、
// ブラウザが対応する最も軽い形式を選ぶ（avif 2.7KB / webp 7KB / png 26KB）。
const THUMB_EMPTY_BASE = '/images/emptystate/thumbnail-image-emptystate';

export const Components = {
  /**
   * メール認証バナー（未認証ユーザーのみ表示。HOMEとイベント画面の両方で使う）
   */
  VerifyBanner() {
    const u = state.currentUser;
    if (!u || u.isVerified) return '';
    // スタイル: public/css/object/component/_banner.css
    return `
      <div class="c-banner">
        <span class="c-banner__icon" aria-hidden="true">⚠</span>
        <div class="c-banner__body">
          <p class="c-banner__title">メールアドレス未認証</p>
          <p class="c-banner__text">新規イベントの作成など、一部の機能はメール認証完了まで使えません。</p>
          <button type="button" onclick="window._app.openVerifyModal()" class="c-banner__action">
            認証コードを入力する
          </button>
        </div>
      </div>`;
  },

  /**
   * ヘッダー
   * @param {object|null} project - イベントオブジェクト（nullでホーム用ヘッダー）
   */
  Header(project) {
    if (!project) {
      const username = state.currentUser?.username || '';
      const verified = !!state.currentUser?.isVerified;
      return `
        <header class="l-header l-header--home">
          <div class="l-header__lead">
            ${username ? `
              <button type="button" id="user-menu-btn" onclick="window._app.toggleUserMenu(event)"
                class="l-header__user">
                ${this.UserAvatar(state.currentUser, { size: 28 })}
                <span class="l-header__username">${_escText(username)}</span>
                ${!verified ? '<span class="l-header__badge-unverified" title="メール未認証"></span>' : ''}
              </button>` : ''}
          </div>
          <!-- ★HOME の入口は2つ並べる。以前は「作成」しか無く、招待コードで参加する
               導線がユーザーメニューの奥にしか無かった。
               ★どちらも「丸い背景＋アイコンだけ」。ラベルを出していた時期があるが、
                 2つ並べると約240px を占めてユーザー名の居場所が無くなった。
               ★並びは「作成 → 参加」。作った人が繰り返し使うのは作成側なので左に置く。
               ★ラベルが無いので aria-label は必須。外すと読み上げで用が分からない。 -->
          <div class="l-header__actions">
            <button type="button" onclick="${verified ? `window._app.setView('CREATE_EVENT_INFO')` : `window._app.requireVerification()`}"
              data-log="home_create_event"
              class="l-header__action l-header__action--create${verified ? '' : ' l-header__action--locked'}"
              aria-label="イベントを作成">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button type="button" onclick="window._app.openJoinByCodeModal()"
              data-log="home_join_by_code" class="l-header__action"
              aria-label="イベントに参加">
              <img src="/images/icon/icon-join.svg" alt="" class="l-header__action-icon">
            </button>
          </div>
        </header>`;
    }

    return `
      <header class="l-header l-header--event">
        <div class="l-header__group">
          <button type="button" onclick="window._app.setView('HOME')" data-log="header_back_home"
            class="l-header__back">
            <img src="/images/icon/iocn-Chevron.svg" class="l-header__back-icon" alt="">
          </button>
          <!-- ★タイトル横の山イラストは削除した（MountainMini はホームのグリッド等では継続使用）-->
          <span class="l-header__title">${_escText(project.name)}</span>
        </div>
        <div class="l-header__actions">
          <a href="https://forms.gle/qh1nXQxXm3YNQfsk9" target="_blank" rel="noopener noreferrer"
            data-log="header_feedback" class="l-header__action" aria-label="フィードバックを送る">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="l-header__action-icon">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </a>
          <button type="button" onclick="window._app.toggleProjectMenu(event)" id="project-menu-btn"
            data-log="header_project_menu" class="l-header__action">
            <img src="/images/icon/icon-Setting.svg" class="l-header__action-image" alt="">
          </button>
        </div>
      </header>`;
  },

  /**
   * タブナビゲーション
   * @param {'MAIN'|'NOTIFICATIONS'|'ARCHIVE'} active
   */
  Tabs(active) {
    // 未読通知数（表示中のイベントに紐づくものだけ。他イベントの通知は数えない）
    const evId = window.state?.selectedEventId;
    const unread = Array.isArray(window.state?.notifications)
      ? window.state.notifications.filter(n => !n.read && n.eventId === evId).length
      : 0;
    // ★アクティブ表示は is-active に集約してある（色はタブごとのモディファイアが持つ）。
    //   スタイル: public/css/layout/_tabs.css
    const on = (id) => active === id ? ' is-active' : '';
    return `
      <nav class="l-tabs">
        <div onclick="window._app.setTab('MAIN')"
          class="l-tabs__item l-tabs__item--main${on('MAIN')}">
          <img src="/images/icon/icon-MainBoard${active === 'MAIN' ? '-pressed' : ''}.svg" class="l-tabs__icon" alt="">
          <span class="l-tabs__label">メインボード</span>
        </div>
        <div onclick="window._app.setTab('NOTIFICATIONS')"
          class="l-tabs__item l-tabs__item--notifications${on('NOTIFICATIONS')}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${active === 'NOTIFICATIONS' ? '#EE3E12' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span class="l-tabs__label">通知</span>
          <!-- ★上限は 99+。9+ で頭打ちにしていた頃は「10件も200件も同じ見た目」で、
               溜まり具合が伝わらなかった。桁が増えても丸バッジは横に伸びる
               （min-width + radius-full のピル）ので、そのまま入る。 -->
          ${unread > 0 ? `<span class="l-tabs__badge">${unread > 99 ? '99+' : unread}</span>` : ''}
        </div>
        <div onclick="window._app.setTab('ARCHIVE')"
          class="l-tabs__item l-tabs__item--archive${on('ARCHIVE')}">
          <img src="/images/icon/icon-Archive${active === 'ARCHIVE' ? '-pressed' : ''}.svg" class="l-tabs__icon" alt="">
          <span class="l-tabs__label">アーカイブ</span>
        </div>
      </nav>`;
  },

  /**
   * ラベルタグ
   * @param {string} text
   */
  /**
   * ラベルタグ（builtIn + イベントのカスタムタグ対応）
   * @param {string} text
   */
  Tag(text) {
    // スタイル: public/css/object/component/_tag.css
    // ★色はユーザーが選べるので、ビルトインもカスタムも同じ --tag-color で渡す
    //   （クラスで塗り分けると2系統になり、カスタムタグ側が表現できない）。
    // ★タグ名はユーザーが作れる（customTags）ので必ずエスケープする。
    //   色は customTags の値だが、こちらもユーザー由来なので属性を閉じられないよう escape する。
    const tag = (color) => `<span class="c-tag" style="--tag-color:${_escText(color)}">${_escText(text)}</span>`;

    const builtIn = LABEL_CONFIG[text];
    if (builtIn) return tag(builtIn.color);

    const p = state.events.find(x => x.id === state.selectedEventId);
    const custom = (p?.customTags || []).find(t => t.name === text);
    if (custom) return tag(custom.color);

    return tag('var(--color-text)');
  },

  /**
   * 編集ペンアイコン
   * @param {string} type
   */
  PenIcon(type) {
    // スタイル: public/css/object/component/_icon-button.css
    return `<button type="button" onclick="window._app.editArchiveItem('${type}')" class="c-icon-button" aria-label="編集">
      <img src="/images/icon/%20icon-Pen.svg" class="c-icon-button__image" alt="">
    </button>`;
  },

  /**
   * ステップインジケーター（イベント作成フロー）
   * @param {1|2|3} step
   */
  /**
   * ステップ進捗インジケータ。
   *
   * ★total を省略すると従来どおり3ステップ。イベント作成（createEvent.js）は
   *   StepIndicator(1..3) のまま動くので、呼び出しを変えなくてよい。
   *
   * @param {number} step   現在のステップ（1始まり）
   * @param {number} [total=3] 全ステップ数
   * @param {{label?:string, compact?:boolean}} [opts]
   *   label   … 上に出す見出し（例「プロフィール作成（2/5）」）。フェーズの
   *             切り替わりを伝えたいときに使う
   *   compact … 現在位置だけ横長にする細いバー表示にする（ステップ数が多いとき向け）
   */
  StepIndicator(step, total = 3, opts = {}) {
    const { label = '', compact = false } = opts;
    // スタイル: public/css/object/component/_step-indicator.css
    // ★compact は「通過済み」も色が付く（残りが見える）。既定は現在地だけ色が付く。
    const dots = Array.from({ length: total }, (_, i) => i + 1).map(s => {
      if (!compact) {
        return `<div class="c-step-indicator__dot${s === step ? ' is-active' : ''}"></div>`;
      }
      const state_ = s === step ? ' is-active' : s < step ? ' is-done' : '';
      return `<div class="c-step-indicator__bar${state_}"></div>`;
    }).join('');
    return `
      <div class="c-step-indicator${compact ? ' c-step-indicator--compact' : ''}">
        ${label ? `<p class="c-step-indicator__label">${
          String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
        <div class="c-step-indicator__dots">${dots}</div>
      </div>`;
  },

  /**
   * 簡易山ビジュアル（プラント画像の後継。ホームのイベントカード・ヘッダー・
   * プロジェクト詳細で使用）。完了ミッションの割合に応じて登山者ドットが山頂へ近づく。
   * 後日画像が支給されたら差し替え予定のプレースホルダー実装。
   * @param {object} project イベント（flat 形式）
   * @param {{size?:number}} opts
   */
  MountainMini(project, opts = {}) {
    const size = opts.size || 80;
    const missions = project?.missions || [];
    const total = missions.length;
    const done  = missions.filter(m => m.status === 'cleared').length;
    const ratio = total > 0 ? done / total : 0;
    // 登山者：山裾(16,84) → 山頂(50,26) を進捗で補間
    const cx = 16 + (50 - 16) * ratio;
    const cy = 84 - (84 - 26) * ratio;
    const summited = total > 0 && done === total;
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <path d="M8 88 L50 18 L92 88 Z" fill="#8A9BB8"/>
        <path d="M50 18 L59 33 L54 29 L50 34 L46 29 L41 33 Z" fill="#FDFBF8"/>
        <line x1="16" y1="84" x2="50" y2="26" stroke="#FDFBF8" stroke-width="2.5"
          stroke-dasharray="1 5" stroke-linecap="round" opacity="0.9"/>
        ${summited ? `
          <line x1="50" y1="18" x2="50" y2="4" stroke="#484545" stroke-width="2.5"/>
          <path d="M50 4 L62 8 L50 12 Z" fill="#EE3E12"/>` : `
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#EE3E12" stroke="#FDFBF8" stroke-width="2"/>`}
      </svg>`;
  },

  /**
   * サムネイルのエンプティーステート画像。avif → webp → png の順に並べ、
   * ブラウザが対応する最も軽い形式を選ぶ。親要素の大きさに合わせて object-cover で埋める。
   * ★画像パスをここ1箇所に集約している（ホーム・プロジェクト詳細・アーカイブで共用）。
   */
  ThumbnailEmptyState() {
    // スタイル: public/css/object/component/_thumbnail.css
    return `
      <picture class="c-thumbnail__picture">
        <source srcset="${THUMB_EMPTY_BASE}.avif" type="image/avif">
        <source srcset="${THUMB_EMPTY_BASE}.webp" type="image/webp">
        <img src="${THUMB_EMPTY_BASE}.png" alt="" class="c-thumbnail__image" loading="lazy">
      </picture>`;
  },

  /**
   * イベントのサムネイル（aspect-ratio 3/2）。
   * メインビジュアルが設定されていればそれを、無ければエンプティーステート画像を表示する。
   * @param {object} project
   * @param {{className?: string, rounded?: string}} opts
   */
  EventThumbnail(project, opts = {}) {
    const extra   = opts.className || '';
    // ★rounded は追加の角丸クラス（c-thumbnail--sm など）。既定の角丸は .c-thumbnail が持つ
    const rounded = opts.rounded ?? '';
    const visual  = getEventMainVisual(project);
    const inner = visual
      ? `<img src="${visual}" alt="" class="c-thumbnail__image" loading="lazy">`
      : this.ThumbnailEmptyState();
    // スタイル: public/css/object/component/_thumbnail.css
    // ★rounded は呼び出し側が Tailwind のクラスで渡してくる（Phase 3 で剥がす）。
    //   既定の角丸は .c-thumbnail が持つので、渡されなければそのままで良い。
    return `
      <div class="c-thumbnail ${rounded} ${extra}">
        ${inner}
      </div>`;
  },

  /**
   * ユーザーアバター（画像があれば画像、無ければ頭文字）
   * @param {{username?:string, avatarUrl?:string|null}} user
   * @param {{size?:number, ring?:boolean, className?:string}} opts
   */
  /**
   * アバター。
   * @param {object} user  { username, avatarUrl }
   * @param {object} opts
   *   size      … px（--avatar-size に渡す。文字サイズも比例する）
   *   ring      … 白フチを付ける
   *   className … 追加クラス
   *   userId    … ★渡すとタップでユーザー紹介モーダルが開く。
   *               自分自身や、イベントのメンバーでない相手（招待プレビューの
   *               表示など）には渡さないこと。開いても中身が引けない。
   */
  UserAvatar(user, opts = {}) {
    // スタイル: public/css/object/component/_avatar.css
    const size = opts.size || 28;
    const ring = opts.ring ? ' c-avatar--ring' : '';
    const extra = opts.className ? ` ${opts.className}` : '';
    const username = user?.username || '';
    const url = user?.avatarUrl || null;
    const sizeVar = `--avatar-size:${size}px`;

    const inner = url
      // ★Google の画像は referrerpolicy が要る。読めなければ頭文字の代替へ差し替える
      ? `<img src="${url}" alt="${_escText(username)}" referrerpolicy="no-referrer"
          class="c-avatar${ring}${extra}" style="${sizeVar}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="c-avatar c-avatar--fallback${ring}${extra}"
          style="${sizeVar};display:none">${_initial(username)}</div>`
      : `<div class="c-avatar c-avatar--fallback${ring}${extra}" style="${sizeVar}">${_initial(username)}</div>`;

    if (!opts.userId) return inner;
    // ★タップ領域はアバターと同じ大きさに保つ（button の既定余白を殺す）。
    //   stopPropagation しているのは、メンバー行やチャットの吹き出しなど
    //   親側にもタップ処理がある場所で二重に反応させないため。
    return `<button type="button" class="c-avatar-button"
      onclick="event.stopPropagation(); window._app.openUserProfileModal('${_escText(opts.userId)}')"
      aria-label="${_escText(username)} のプロフィール">${inner}</button>`;
  },
};
