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
    return `
      <div class="mx-6 mt-2 mb-2 bg-[#FFF7E6] border border-[#FFC300] rounded-2xl p-4">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 mt-0.5">⚠</div>
          <div class="flex-1 min-w-0">
            <p class="text-[12px] font-bold text-[#484545] leading-snug mb-0.5">メールアドレス未認証</p>
            <p class="text-[11px] text-[#484545] leading-snug">新規イベントの作成など、一部の機能はメール認証完了まで使えません。</p>
            <button onclick="window._app.openVerifyModal()" class="mt-2 text-[12px] font-bold text-white bg-[#FFC300] px-3 py-1.5 rounded-lg">
              認証コードを入力する
            </button>
          </div>
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
        <header class="flex justify-between items-center px-6 py-4 bg-[#FDFBF8] sticky top-0 z-20" style="padding-top:calc(1rem + env(safe-area-inset-top))">
          <div class="flex-1">
            ${username ? `
              <button id="user-menu-btn" onclick="window._app.toggleUserMenu(event)"
                class="flex items-center gap-1.5 px-2 py-1.5 -ml-2 rounded-lg active:bg-black/5 transition-colors">
                ${this.UserAvatar(state.currentUser, { size: 28 })}
                <span class="text-[12px] font-bold text-[#484545] truncate max-w-[120px]">${_escText(username)}</span>
                ${!verified ? '<span class="w-2 h-2 rounded-full bg-[#FFC300]" title="メール未認証"></span>' : ''}
              </button>` : ''}
          </div>
          <button onclick="${verified ? `window._app.setView('CREATE_EVENT_INFO')` : `window._app.requireVerification()`}"
            class="flex items-center gap-2 border ${verified ? 'border-[#0CA1E3] text-[#0CA1E3]' : 'border-[#A7AAAC] text-[#A7AAAC]'} px-5 py-2 rounded-xl bg-white shadow-sm active:scale-95 transition-transform">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span class="heading-rs font-bold">イベントを作成</span>
          </button>
        </header>`;
    }

    return `
      <header class="flex justify-between items-center px-6 py-4 bg-[#FDFBF8]">
        <div class="flex items-center gap-3">
          <button onclick="window._app.setView('HOME')" data-log="header_back_home"
            class="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center">
            <img src="/images/icon/iocn-Chevron.svg" class="w-4 h-4 brightness-0 opacity-50">
          </button>
          <div class="flex items-center gap-2">
            <!-- ★タイトル横の山イラストは削除した（MountainMini はホームのグリッド等では継続使用）-->
            <span class="text-[14px] font-bold truncate max-w-[180px]">${project.name}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <a href="https://forms.gle/qh1nXQxXm3YNQfsk9" target="_blank" rel="noopener noreferrer"
            data-log="header_feedback" class="p-1 active:opacity-50" aria-label="フィードバックを送る">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="opacity-40">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </a>
          <button onclick="window._app.toggleProjectMenu(event)" id="project-menu-btn" data-log="header_project_menu" class="p-1 active:opacity-50">
            <img src="/images/icon/icon-Setting.svg" class="w-6 h-6">
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
    return `
      <div class="px-6 flex border-b border-[#D3D6D8] bg-[#FDFBF8]">
        <div onclick="window._app.setTab('MAIN')"
          class="flex-1 flex flex-row items-center justify-center gap-2 py-3 cursor-pointer ${active === 'MAIN' ? 'border-b-2 border-[#0CA1E3]' : 'opacity-40'}">
          <img src="/images/icon/icon-MainBoard${active === 'MAIN' ? '-pressed' : ''}.svg" class="w-5 h-5">
          <span class="text-[11px] font-bold ${active === 'MAIN' ? 'text-[#0CA1E3]' : ''}">メインボード</span>
        </div>
        <div onclick="window._app.setTab('NOTIFICATIONS')"
          class="flex-1 flex flex-row items-center justify-center gap-2 py-3 cursor-pointer relative ${active === 'NOTIFICATIONS' ? 'border-b-2 border-[#EE3E12]' : 'opacity-40'}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${active === 'NOTIFICATIONS' ? '#EE3E12' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span class="text-[11px] font-bold ${active === 'NOTIFICATIONS' ? 'text-[#EE3E12]' : ''}">通知</span>
          ${unread > 0 ? `<span class="absolute top-2 right-1/4 min-w-[16px] h-4 px-1 bg-[#EE3E12] text-white text-[9px] font-bold rounded-full flex items-center justify-center">${unread > 9 ? '9+' : unread}</span>` : ''}
        </div>
        <div onclick="window._app.setTab('ARCHIVE')"
          class="flex-1 flex flex-row items-center justify-center gap-2 py-3 cursor-pointer ${active === 'ARCHIVE' ? 'border-b-2 border-[#FFC300]' : 'opacity-40'}">
          <img src="/images/icon/icon-Archive${active === 'ARCHIVE' ? '-pressed' : ''}.svg" class="w-5 h-5">
          <span class="text-[11px] font-bold ${active === 'ARCHIVE' ? 'text-[#FFC300]' : ''}">アーカイブ</span>
        </div>
      </div>`;
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
    // 組み込みタグ
    const builtIn = LABEL_CONFIG[text];
    if (builtIn) {
      return `<span class="px-1.5 py-0.5 rounded text-[8px] text-white font-bold" style="background-color: ${builtIn.color}">${text}</span>`;
    }
    // 現在のイベントのカスタムタグ
    const p = state.events.find(x => x.id === state.selectedEventId);
    const custom = (p?.customTags || []).find(t => t.name === text);
    if (custom) {
      return `<span class="px-1.5 py-0.5 rounded text-[8px] text-white font-bold" style="background-color: ${custom.color}">${text}</span>`;
    }
    // フォールバック
    return `<span class="px-1.5 py-0.5 rounded text-[8px] text-white font-bold" style="background-color: #484545">${text}</span>`;
  },

  /**
   * 編集ペンアイコン
   * @param {string} type
   */
  PenIcon(type) {
    return `<button onclick="window._app.editArchiveItem('${type}')" class="p-1 opacity-60 hover:opacity-100 transition-opacity">
      <img src="/images/icon/%20icon-Pen.svg" class="w-4 h-4">
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
    const dots = Array.from({ length: total }, (_, i) => i + 1).map(s => {
      if (!compact) {
        return `<div class="w-2.5 h-2.5 rounded-full transition-colors duration-300 ${
          s === step ? 'bg-[#0CA1E3]' : 'bg-[#D3D6D8]'}"></div>`;
      }
      return `<div class="h-1.5 rounded-full transition-all duration-300 ${
        s === step ? 'w-6 bg-[#0CA1E3]' : s < step ? 'w-1.5 bg-[#0CA1E3]' : 'w-1.5 bg-[#D3D6D8]'}"></div>`;
    }).join('');
    return `
      <div class="${compact ? 'mb-6' : 'mb-10'}">
        ${label ? `<p class="text-[11px] text-[#0CA1E3] font-bold text-center mb-2">${
          String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
        <div class="flex items-center justify-center gap-${compact ? '2' : '3'}">${dots}</div>
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
    // picture は inline 要素なので block + w/h を明示しないと img のサイズ指定が効かない
    return `
      <picture class="block w-full h-full">
        <source srcset="${THUMB_EMPTY_BASE}.avif" type="image/avif">
        <source srcset="${THUMB_EMPTY_BASE}.webp" type="image/webp">
        <img src="${THUMB_EMPTY_BASE}.png" alt="" class="w-full h-full object-cover" loading="lazy">
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
    const rounded = opts.rounded ?? 'rounded-xl';
    const visual  = getEventMainVisual(project);
    const inner = visual
      ? `<img src="${visual}" alt="" class="w-full h-full object-cover" loading="lazy">`
      : this.ThumbnailEmptyState();
    // 影はコンテナ側に付ける。画像の内容（白背景・透過など）に関わらず常に落ちる。
    // overflow-hidden は内側の画像を角丸で切るためで、影は外に出るので干渉しない。
    return `
      <div class="w-full overflow-hidden bg-[#EBE8E5] ${rounded} ${extra}"
        style="aspect-ratio:3/2;box-shadow:0 2px 8px rgba(72,69,69,0.12)">
        ${inner}
      </div>`;
  },

  /**
   * ユーザーアバター（画像があれば画像、無ければ頭文字）
   * @param {{username?:string, avatarUrl?:string|null}} user
   * @param {{size?:number, ring?:boolean, className?:string}} opts
   */
  UserAvatar(user, opts = {}) {
    const size = opts.size || 28;
    const ring = opts.ring ? 'ring-2 ring-white' : '';
    const extra = opts.className || '';
    const username = user?.username || '';
    const url = user?.avatarUrl || null;
    if (url) {
      return `<img src="${url}" alt="${_escText(username)}" referrerpolicy="no-referrer"
        class="rounded-full object-cover ${ring} ${extra}"
        style="width:${size}px;height:${size}px;"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="rounded-full bg-[#0CA1E3] items-center justify-center text-white font-bold ${ring} ${extra}"
          style="display:none;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;">${_initial(username)}</div>`;
    }
    return `<div class="rounded-full bg-[#0CA1E3] flex items-center justify-center text-white font-bold ${ring} ${extra}"
      style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;">${_initial(username)}</div>`;
  },
};
