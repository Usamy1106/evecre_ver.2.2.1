// ===== ミッション詳細ページ（MISSION_DETAIL）=====
// ミッションカード（メインボード / カレンダー / ガント / アナウンス等）のタップで開く。
// 旧・完了モーダル（helpers.js の openClearMissionModal /
// openIndividualClearListModal）の後継。旧モーダルは 2026-08-18 に削除済み。
//
// 構成（上から順）:
//   - ヘッダー：戻るボタン（遷移元へ復元） / 管理者のみミートボールメニュー（編集・削除）
//   - タイトル・タグ・締切・説明
//   - 完了入力欄（従来の完了モーダルと同じ条件で出し分け。DOM id も同じにして
//     submitMissionClear / handleImageSelect / initClearDraft をそのまま使う）
//   - チャット（Google チャット風。他人は左にアバター、自分は右寄せ。絵文字リアクション付き）
//
// チャットは mission_chats コレクション（サーバー）+ SSE（realtime.js）で同期する。

import { state } from '../state.js';
import { api } from '../api.js';
import { Components } from '../components.js';
import { MISSION_DESCRIPTIONS } from '../constants.js';
import { initClearDraft } from '../modals/helpers.js';
import { showConfirmDialog } from '../dialog.js';
import { logEvent } from '../logger.js';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// リアクション追加ピッカーのフォールバック用（CDN の emoji-picker-element が読めない場合）
const FALLBACK_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '🙏', '👏', '🔥', '✅', '💪', '🤔', '😢'];

// 送信直後に一度だけチャット欄を先頭（最新）へスクロールするためのフラグ
let _scrollChatToTop = false;

// 返信対象（長押しメニューの「返信」で設定。送信 or × で解除）
// { missionId, id, username, text }
let _replyTarget = null;

// ===============================================
// レンダラー本体
// ===============================================
export function renderMissionDetail(appEl) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const m = p?.missions?.find(x => x.id === state.selectedMissionId);
  if (!p || !m) {
    // 削除された等で見つからない場合は元の画面へ戻す
    state.closeMissionDetail();
    return;
  }

  // チャット未取得なら取得を開始
  if (state.missionChat?.missionId === m.id && state.missionChat.loading && !state.missionChat._fetching) {
    _loadChat(p.id, m.id);
  }

  // 別ミッションの返信対象が残っていたらクリア
  if (_replyTarget && _replyTarget.missionId !== m.id) _replyTarget = null;

  // ===== 再レンダリングをまたいで入力値を保持 =====
  const prevChatInput  = document.getElementById('chat-input')?.value ?? null;
  const prevChatFocus  = document.activeElement?.id === 'chat-input';
  const prevClearInput = document.getElementById('clear-input')?.value ?? null;
  const prevImgData    = document.getElementById('preview-img')?.dataset?.base64 || '';
  const prevChecked    = Array.from(document.querySelectorAll('[data-clear-checklist]')).map(cb => !!cb.checked);
  const prevScrollY    = window.scrollY;
  const prevChatScroll = document.getElementById('chat-messages')?.scrollTop ?? 0;
  const hadPage        = !!document.getElementById('mission-detail-page');

  const canMgr = state.canManageCurrentEvent();

  appEl.innerHTML = `
    <div id="mission-detail-page" class="p-mission-detail">
      <header class="p-mission-detail__header">
        <button type="button" onclick="window._app.closeMissionDetail()" data-log="mission_detail_back"
          class="p-mission-detail__round-button" aria-label="戻る">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        ${canMgr ? `
        <button type="button" onclick="window._app.toggleMissionMenu(event, '${m.id}')" data-log="mission_detail_menu"
          class="p-mission-detail__round-button" aria-label="メニュー">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
          </svg>
        </button>` : `
        <button type="button" onclick="window._app.copyMissionLink('${m.id}')"
          class="p-mission-detail__round-button"
          aria-label="ミッションリンクをコピー">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </button>`}
      </header>

      <div class="p-mission-detail__body">
        ${_renderMissionInfo(p, m)}
        ${_renderClearSection(p, m, canMgr)}
        ${_renderChatSection(p, m, canMgr)}
      </div>

      <!-- チャット入力バー（下部固定） -->
      <div class="p-mission-detail__composer">
        ${_replyTarget ? `
        <div class="p-mission-detail__reply">
          <div class="p-mission-detail__reply-body">
            <p class="p-mission-detail__reply-name">${_esc(_replyTarget.username)} に返信</p>
            <p class="p-mission-detail__reply-text">${_esc(_replyTarget.text)}</p>
          </div>
          <button type="button" onclick="window._app.cancelChatReply()" class="p-mission-detail__reply-cancel" aria-label="返信をやめる">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>` : ''}
        <div class="p-mission-detail__composer-row">
          <textarea id="chat-input" rows="1" placeholder="メッセージを入力"
            class="p-mission-detail__composer-input"
            oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,112)+'px'"></textarea>
          <button type="button" onclick="window._app.sendChatMessage()"
            class="p-mission-detail__send" aria-label="送信">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>`;

  // ===== 入力値の復元 =====
  const chatInput = document.getElementById('chat-input');
  if (chatInput && prevChatInput) {
    chatInput.value = prevChatInput;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 112) + 'px';
  }
  if (prevChatFocus) chatInput?.focus();

  const clearInput = document.getElementById('clear-input');
  if (clearInput && prevClearInput) clearInput.value = prevClearInput;
  if (prevImgData) {
    const chip = document.getElementById('img-chip');
    const preview = document.getElementById('preview-img');
    if (chip && preview) {
      preview.src = prevImgData;
      preview.dataset.base64 = prevImgData;
      chip.classList.remove('hidden');
    }
  }
  document.querySelectorAll('[data-clear-checklist]').forEach(cb => {
    const idx = parseInt(cb.dataset.clearChecklist, 10);
    if (prevChecked[idx]) cb.checked = true;
  });

  // ローカルドラフト（完了入力欄がある場合のみ。復元は入力値保持より先に走らないよう最後に）
  const clearContainer = document.getElementById('clear-mission-modal');
  if (clearContainer) initClearDraft(m.id, clearContainer);

  // チャットの長押しメニュー（コピー / 返信 / 削除）を配線
  const chatBox = document.getElementById('chat-messages');
  if (chatBox) _bindChatMsgMenus(chatBox);

  // ===== スクロール位置 =====
  // チャット欄は独立スクロール。時系列（古い→新しい）で並べ、開いた時＆送信直後は
  // 最新メッセージをチャット欄の上端にピン留めする（それより古いものは上＝画面外にスクロールで遡る）。
  if (chatBox) {
    if (_scrollChatToTop || !hadPage) {
      _scrollChatToTop = false;
      _pinNewestToTop(chatBox);
    } else {
      chatBox.scrollTop = prevChatScroll;
    }
  }
  if (hadPage) window.scrollTo(0, prevScrollY);
  // 初回表示のスクロール先頭は openMissionDetail 側の window.scrollTo(0,0) が担う
}

// ===============================================
// ミッション情報（タイトル・タグ・締切・説明）
// ===============================================
function _renderMissionInfo(p, m) {
  const tags = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : (m.tag ? [m.tag] : []);
  const tagsHtml = tags.map(t => Components.Tag(t)).join('');

  const deadline = (() => {
    if (!Array.isArray(m.dates) || m.dates.length === 0) return '';
    const end = [...m.dates].sort().at(-1);
    const target = new Date(end); target.setHours(0, 0, 0, 0);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target - now) / 86_400_000);
    const cls = 'p-mission-detail__deadline';
    if (diff < 0)   return `<span class="${cls} ${cls}--urgent">${-diff}日超過</span>`;
    if (diff === 0) return `<span class="${cls} ${cls}--urgent">今日まで</span>`;
    return `<span class="${cls}">残り${diff}日</span>`;
  })();

  const desc = MISSION_DESCRIPTIONS[m.id]
            || (m.originProposalId ? MISSION_DESCRIPTIONS[m.originProposalId] : null)
            || m.description || '';

  return `
    <h1 class="p-mission-detail__title">${_esc(m.title)}</h1>
    ${(tagsHtml || deadline) ? `
      <div class="p-mission-detail__meta">${tagsHtml}${deadline}</div>` : ''}
    ${desc ? `<p class="p-mission-detail__description">${_esc(desc)}</p>` : '<div class="p-mission-detail__spacer"></div>'}`;
}

// ===============================================
// 完了入力セクション（従来の完了モーダルと同じ出し分け）
// ===============================================
function _renderClearSection(p, m, canMgr) {
  const meId = state.currentUser?.id;

  // 個別完了は専用表示（完了状況リスト + 自分の入力欄）
  if (m.individualClear) return _renderIndividualSection(p, m, canMgr, meId);

  if (m.status === 'cleared') {
    const cd = p.clearedData?.[m.id];
    return `
      <div class="p-mission-detail__status">
        <p class="p-mission-detail__status-label">✓ 完了済み</p>
        ${_fmtClearedContent(cd)}
      </div>`;
  }
  if (m.status === 'pending_leader_check') {
    return `
      <div class="p-mission-detail__status p-mission-detail__status--pending">
        <p class="p-mission-detail__status-label p-mission-detail__status-label--waiting">リーダー確認待ちです</p>
      </div>`;
  }

  // 応募型で自分の担当でない → 入力欄は出さない（応募はメインボードのカードから）
  const assignees = Array.isArray(m.assignees) ? m.assignees : [];
  const myMission = (m.assignee?.type === 'user' && m.assignee.userId === meId) || assignees.includes(meId);
  if (m.selfClaim && !myMission) {
    return `
      <div class="p-mission-detail__status">
        <p class="p-mission-detail__status-label p-mission-detail__status-label--muted">応募型ミッションです（担当ではありません）</p>
      </div>`;
  }

  // 入力なしで完了
  if (m.noInput) {
    return `
      <div class="p-mission-detail__clear">
        <button type="button" onclick="window._app.submitMissionClear('${m.id}')"
          class="c-button c-button--primary p-mission-detail__submit">完了する</button>
      </div>`;
  }

  return _renderClearInput(m) ;
}

// 完了入力欄（テキスト + 画像 + チェックリスト + 完了ボタン）。
// DOM id は旧完了モーダルと同一（submitMissionClear / handleImageSelect / initClearDraft が参照）。
function _renderClearInput(m) {
  const checklist = Array.isArray(m.checklist) ? m.checklist : [];
  const checklistHtml = checklist.length === 0 ? '' : `
    <div class="p-mission-detail__checklist">
      <p class="p-mission-detail__checklist-title">チェック項目</p>
      <div class="p-mission-detail__checklist-box">
        ${checklist.map((item, i) => `
          <label class="p-mission-detail__check">
            <span class="p-mission-detail__check-mark">
              <input type="checkbox" data-clear-checklist="${i}" class="p-mission-detail__check-input">
              <span class="p-mission-detail__check-box"></span>
              <svg class="p-mission-detail__check-icon" viewBox="0 0 20 20" fill="none">
                <polyline points="4.5 10.5 8 14 15.5 6.5" stroke="white" stroke-width="2.2"
                  stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="p-mission-detail__check-label">${_esc(item)}</span>
          </label>`).join('')}
      </div>
      <!-- ★hidden は JS が付け外しする（Phase 5 で u-hidden へ）-->
      <p id="clear-checklist-error" class="p-mission-detail__checklist-error hidden">
        チェック項目にチェックしてください。
      </p>
    </div>`;

  return `
    <div id="clear-mission-modal" class="p-mission-detail__clear">
      <!-- 画像チップ（画像が選択されたら表示）。★hidden は JS が付け外しする -->
      <div id="img-chip" class="hidden p-mission-detail__image-chip">
        <img id="preview-img" src="" class="p-mission-detail__image-thumb" alt="">
        <span class="p-mission-detail__image-name">画像</span>
        <button type="button" onclick="window._app.clearImagePreview()" class="p-mission-detail__image-remove" aria-label="画像を外す">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- 統合テキスト入力 + 画像ボタン -->
      <div class="p-mission-detail__input-wrap">
        <textarea id="clear-input" class="p-mission-detail__textarea"
          placeholder="内容を入力"></textarea>
        <label for="file-input" class="p-mission-detail__image-pick">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </label>
        <!-- ★hidden は「見た目を消す」ためではなく、ファイル選択を自前のボタンで代替するため -->
        <input type="file" id="file-input" class="hidden" accept="image/*"
          onchange="window._app.handleImageSelect(this)">
      </div>

      ${checklistHtml}
      <button type="button" onclick="window._app.submitMissionClear('${m.id}')"
        class="c-button c-button--primary p-mission-detail__submit p-mission-detail__submit--spaced">完了する</button>
    </div>`;
}

// 個別完了ミッション：完了状況リスト + 自分の入力欄 + 管理者の公開終了
function _renderIndividualSection(p, m, canMgr, meId) {
  const assigneeIds = Array.isArray(m.assignees) && m.assignees.length > 0
    ? m.assignees
    : (m.assignee?.type === 'user' ? [m.assignee.userId] : []);
  const hasAssignees = assigneeIds.length > 0;
  const clearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [];

  const listIds = hasAssignees ? assigneeIds : clearedBy;
  const rows = listIds.map(uid => {
    const mem = (p.members || []).find(x => x.userId === uid);
    const name = mem?.username || '不明なユーザー';
    const done = clearedBy.includes(uid);
    const cd = p.clearedData?.[m.id + '_u_' + uid];
    return `
      <div class="p-mission-detail__member">
        <div class="p-mission-detail__member-row">
          <span class="p-mission-detail__member-mark${done ? ' is-done' : ''}">${done ? '✓' : '–'}</span>
          <span class="p-mission-detail__member-name">${_esc(name)}</span>
          <span class="p-mission-detail__member-state${done ? ' is-done' : ''}">${done ? '完了済み' : '未完了'}</span>
        </div>
        ${(done && !m.noInput) ? _fmtClearedContent(cd) : ''}
      </div>`;
  }).join('');

  const countLine = hasAssignees
    ? `<p class="p-mission-detail__count">完了状況：<span class="p-mission-detail__count-done">${clearedBy.length}</span> / ${assigneeIds.length} 人</p>`
    : '';

  const isMeAssigned = !hasAssignees || assigneeIds.includes(meId);
  const meNotDone = isMeAssigned && !clearedBy.includes(meId) && m.status !== 'cleared';
  const myInput = meNotDone
    ? (m.noInput
        ? `<button type="button" onclick="window._app.submitMissionClear('${m.id}')"
             class="c-button c-button--primary p-mission-detail__submit p-mission-detail__submit--below">完了する</button>`
        : _renderClearInput(m))
    : '';

  const adminBtn = canMgr && m.status !== 'cleared' ? `
    <button type="button" onclick="window._app.forceCloseMission('${m.id}')"
      class="p-mission-detail__force-close">
      公開終了する
    </button>` : '';

  return `
    <div class="p-mission-detail__clear">
      ${myInput}
      ${countLine}
      <div class="p-mission-detail__member-list">
        ${rows || '<p class="p-mission-detail__member-empty">まだ完了者はいません</p>'}
      </div>
      ${adminBtn}
    </div>`;
}

function _fmtClearedContent(cd) {
  if (!cd?.content) return '';
  // ★src / href もエスケープする（提出物はユーザーが入力した文字列で、
  //   属性を閉じられると任意の HTML を差し込める）
  if (cd.format === 'image') return `<img src="${_esc(cd.content)}" class="p-mission-detail__cleared-image" alt="提出画像" loading="lazy">`;
  if (cd.format === 'link' || cd.format === 'url') return `<a href="${_esc(cd.content)}" target="_blank" rel="noopener noreferrer" class="p-mission-detail__cleared-link">${_esc(cd.content)}</a>`;
  return `<p class="p-mission-detail__cleared-text">${_esc(cd.content)}</p>`;
}

// ===============================================
// チャットセクション
// ===============================================
function _renderChatSection(p, m, canMgr) {
  const chat = state.missionChat;
  const meId = state.currentUser?.id;

  let body = '';
  if (!chat || chat.missionId !== m.id || chat.loading) {
    body = `
      <div class="p-mission-detail__chat-loading">
        <div class="c-spinner c-spinner--sm"></div>
      </div>`;
  } else if (chat.messages.length === 0) {
    body = `<p class="p-mission-detail__chat-empty">まだメッセージはありません。<br>最初のメッセージを送ってみましょう</p>`;
  } else {
    // 時系列（古い→新しい）。最新は末尾。開いた時に最新を上端へピン留めする（_pinNewestToTop）。
    const sorted = [...chat.messages].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    let lastDay = '';
    body = sorted.map((msg, i) => {
      const d = new Date(msg.createdAt);
      const day = `${d.getMonth() + 1}月${d.getDate()}日`;
      const sep = day !== lastDay
        ? `<div class="p-mission-detail__day"><span class="p-mission-detail__day-label">${day}</span></div>`
        : '';
      lastDay = day;
      // 最新メッセージの直前にアンカーを置き、上端ピン留めの基準にする
      const anchor = i === sorted.length - 1 ? '<div id="chat-newest"></div>' : '';
      return sep + anchor + _renderChatMessage(msg, meId, canMgr);
    }).join('');
    // 最新を上端まで引き上げられるよう、下に可変スペーサーを置く（高さは _pinNewestToTop で調整）
    body += '<div id="chat-spacer" style="height:0"></div>';
  }

  // チャット欄のみ独立スクロール（長くなっても上部の完了入力欄が押し出されない）
  return `
    <div class="p-mission-detail__chat">
      <p class="p-mission-detail__chat-title">チャット</p>
      <div id="chat-messages" class="p-mission-detail__chat-messages">${body}</div>
    </div>`;
}

// 最新メッセージ（#chat-newest アンカー）をチャット欄の上端にピン留めする。
// 末尾スペーサーの高さを「欄の高さ − 最新メッセージの高さ」に広げ、上端まで引き上げ可能にする。
function _pinNewestToTop(chatBox) {
  requestAnimationFrame(() => {
    const box = document.getElementById('chat-messages') || chatBox;
    const anchor = document.getElementById('chat-newest');
    const spacer = document.getElementById('chat-spacer');
    if (!box || !anchor) { if (box) box.scrollTop = box.scrollHeight; return; }
    // 先にスペーサーを広げ、最新を上端まで引き上げられる余地を作る
    if (spacer) {
      const msgEl = anchor.nextElementSibling;
      const msgH = msgEl ? msgEl.offsetHeight : 0;
      spacer.style.height = Math.max(0, box.clientHeight - msgH - 8) + 'px';
    }
    // アンカーの上端を欄の上端に合わせる（offsetParent 非依存）
    const delta = anchor.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop += delta;
  });
}

function _renderChatMessage(msg, meId, canMgr) {
  const mine = msg.userId === meId;
  const time = (() => {
    const d = new Date(msg.createdAt);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();

  // リアクションチップ
  const reactions = msg.reactions || {};
  const chips = Object.entries(reactions).map(([emoji, users]) => {
    const reacted = users.includes(meId);
    return `<button type="button" onclick="window._app.toggleChatReaction('${msg.id}', '${_esc(emoji)}')"
      class="p-mission-detail__reaction${reacted ? ' is-reacted' : ''}">
      <span>${_esc(emoji)}</span><span class="p-mission-detail__reaction-count">${users.length}</span>
    </button>`;
  }).join('');

  // アクション（リアクション追加。削除・返信・コピーはブロック長押しメニューから）
  const addBtn = `
    <button type="button" onclick="window._app.openChatEmojiPicker('${msg.id}')"
      class="p-mission-detail__reaction-add"
      aria-label="リアクションを追加">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/>
        <line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
      </svg>
    </button>`;
  const actionsRow = `<div class="p-mission-detail__reactions${mine ? ' p-mission-detail__reactions--mine' : ''}">${chips}${addBtn}</div>`;

  // 返信の引用ブロック（送信時にサーバーが確定したスナップショット）
  const quote = msg.replyTo ? `
    <div class="p-mission-detail__quote">
      <p class="p-mission-detail__quote-name">${_esc(msg.replyTo.username)}</p>
      <p class="p-mission-detail__quote-text">${_esc(msg.replyTo.text)}</p>
    </div>` : '';

  const bubbleText = `${quote}<span class="p-mission-detail__bubble-text">${_esc(msg.text)}</span>`;
  // 長押しメニューの対象。OS の選択 UI を抑止する指定は .p-mission-detail__bubble が持つ
  const pressAttrs = `data-chat-msg="${msg.id}"`;

  if (mine) {
    // 自分：右寄せ・アバターなし（Google チャット同様）
    return `
      <div class="p-mission-detail__msg p-mission-detail__msg--mine">
        <div class="p-mission-detail__msg-line">
          <span class="p-mission-detail__msg-time">${time}</span>
          <div ${pressAttrs} class="p-mission-detail__bubble p-mission-detail__bubble--mine">${bubbleText}</div>
        </div>
        ${actionsRow}
      </div>`;
  }

  // 他人：左にアバター + 名前
  return `
    <div class="p-mission-detail__msg p-mission-detail__msg--theirs">
      <div class="p-mission-detail__msg-avatar">
        ${Components.UserAvatar({ username: msg.username, avatarUrl: msg.avatarUrl }, { size: 28 })}
      </div>
      <div class="p-mission-detail__msg-main">
        <div class="p-mission-detail__msg-head">
          <span class="p-mission-detail__msg-name">${_esc(msg.username)}</span>
          <span class="p-mission-detail__msg-time">${time}</span>
        </div>
        <div ${pressAttrs} class="p-mission-detail__bubble p-mission-detail__bubble--theirs">${bubbleText}</div>
        ${actionsRow}
      </div>
    </div>`;
}

// ===============================================
// チャットの長押しメニュー（コピー / 返信 / 削除）
// ===============================================
const _LP_MS = 500, _LP_MOVE_TOL = 10;

function _bindChatMsgMenus(container) {
  container.querySelectorAll('[data-chat-msg]').forEach(el => {
    if (el.dataset.cmBound === '1') return; // 二重バインド防止
    el.dataset.cmBound = '1';
    const msgId = el.dataset.chatMsg;
    let timer = null, sx = 0, sy = 0;

    const start = (x, y) => {
      sx = x; sy = y;
      clearTimeout(timer);
      timer = setTimeout(() => _openChatMsgMenu(msgId, x, y), _LP_MS);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };

    el.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (t) start(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t && Math.hypot(t.clientX - sx, t.clientY - sy) > _LP_MOVE_TOL) cancel();
    }, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
    // PC は右クリック（コンテキストメニュー）で開く
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _openChatMsgMenu(msgId, e.clientX, e.clientY);
    });
  });
}

function _openChatMsgMenu(msgId, x, y) {
  document.getElementById('chat-msg-menu')?.remove();
  const chat = state.missionChat;
  const msg = chat?.messages.find(m => m.id === msgId);
  if (!msg) return;
  const mine = msg.userId === state.currentUser?.id;
  const canDelete = mine || state.canManageCurrentEvent();

  const menu = document.createElement('div');
  menu.id = 'chat-msg-menu';
  // スタイル: public/css/object/component/_context-menu.css
  menu.className = 'c-context-menu animate-fadeIn';
  menu.style.visibility = 'hidden';
  menu.innerHTML = `
    <button type="button" data-act="copy" class="c-context-menu__item">コピー</button>
    <button type="button" data-act="reply" class="c-context-menu__item">返信</button>
    ${canDelete ? `<button type="button" data-act="delete"
      class="c-context-menu__item c-context-menu__item--danger">削除</button>` : ''}`;
  document.body.appendChild(menu);

  // 画面内にクランプして配置（openMissionMenuAt と同じ方式）
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth  - mw - 8))}px`;
  menu.style.top  = `${Math.max(8, Math.min(y, window.innerHeight - mh - 8))}px`;
  menu.style.visibility = 'visible';

  menu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    ev.stopPropagation();
    menu.remove();
    if (btn.dataset.act === 'copy') {
      navigator.clipboard?.writeText(msg.text)
        .then(() => window._app?.showToast('コピーしました'))
        .catch(() => window._app?.showToast('コピーに失敗しました', 'error'));
    } else if (btn.dataset.act === 'reply') {
      _replyTarget = {
        missionId: state.selectedMissionId,
        id: msg.id,
        username: msg.username || '不明なユーザー',
        text: msg.text,
      };
      state.render();
      document.getElementById('chat-input')?.focus();
    } else if (btn.dataset.act === 'delete') {
      deleteChatMessage(msgId);
    }
  });

  // 外側タップで閉じる（長押し直後のクリックを拾わないよう遅延）
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 10);
}

// 返信をやめる（入力バーの × から呼ばれる）
export function cancelChatReply() {
  _replyTarget = null;
  state.render();
}

// ===============================================
// チャット操作（main.js の window._app に登録）
// ===============================================

async function _loadChat(eventId, missionId) {
  const chat = state.missionChat;
  if (!chat || chat.missionId !== missionId) return;
  chat._fetching = true;
  try {
    const r = await api.listMissionChat(eventId, missionId);
    // 取得中にページ遷移した場合は破棄
    if (state.missionChat?.missionId !== missionId) return;
    state.missionChat.messages = r.ok ? (r.messages || []) : [];
    state.missionChat.loading = false;
    state.render();
  } catch (_) {
    if (state.missionChat?.missionId === missionId) {
      state.missionChat.loading = false;
      state.render();
    }
  } finally {
    if (state.missionChat?.missionId === missionId) state.missionChat._fetching = false;
  }
}

export async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  const eventId = state.selectedEventId;
  const missionId = state.selectedMissionId;
  if (!eventId || !missionId) return;

  const replyToId = (_replyTarget && _replyTarget.missionId === missionId) ? _replyTarget.id : null;
  input.value = '';
  input.style.height = 'auto';
  const r = await api.postMissionChat(eventId, missionId, text, replyToId);
  if (!r.ok) {
    if (input) input.value = text; // 失敗したら入力を戻す
    window._app?.showToast(r.error || 'メッセージの送信に失敗しました', 'error');
    return;
  }
  logEvent('chat_message_sent', { missionId });
  _replyTarget = null;
  if (state.missionChat?.missionId === missionId) {
    state.missionChat.messages.push(r.message);
  }
  _scrollChatToTop = true; // 最新が上なので先頭へ
  state.render();
}

export async function deleteChatMessage(messageId) {
  const ok = await showConfirmDialog({
    message: 'このメッセージを削除しますか？',
    confirmLabel: '削除',
    cancelLabel: 'キャンセル',
    destructive: true,
  });
  if (!ok) return;
  const eventId = state.selectedEventId;
  const missionId = state.selectedMissionId;
  const r = await api.deleteMissionChat(eventId, missionId, messageId);
  if (!r.ok) {
    window._app?.showToast(r.error || '削除に失敗しました', 'error');
    return;
  }
  if (state.missionChat?.missionId === missionId) {
    state.missionChat.messages = state.missionChat.messages.filter(x => x.id !== messageId);
  }
  state.render();
}

export async function toggleChatReaction(messageId, emoji) {
  const eventId = state.selectedEventId;
  const missionId = state.selectedMissionId;
  const r = await api.toggleChatReaction(eventId, missionId, messageId, emoji);
  if (!r.ok) {
    window._app?.showToast(r.error || 'リアクションに失敗しました', 'error');
    return;
  }
  if (state.missionChat?.missionId === missionId) {
    const msg = state.missionChat.messages.find(x => x.id === messageId);
    if (msg) msg.reactions = r.reactions || {};
  }
  state.render();
}

// 絵文字ピッカー（emoji-picker-element。CDN が読めない場合は固定セットにフォールバック）
export function openChatEmojiPicker(messageId) {
  document.getElementById('chat-emoji-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'chat-emoji-overlay';
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--emoji';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const wrap = document.createElement('div');
  // スタイル: public/css/object/component/_emoji-picker.css
  wrap.className = 'c-emoji-picker';

  if (customElements.get('emoji-picker')) {
    const picker = document.createElement('emoji-picker');
    picker.style.width = '100%';
    picker.style.setProperty('--num-columns', '8');
    picker.addEventListener('emoji-click', (ev) => {
      overlay.remove();
      const unicode = ev.detail?.unicode;
      if (unicode) toggleChatReaction(messageId, unicode);
    });
    wrap.appendChild(picker);
  } else {
    // フォールバック：よく使う絵文字グリッド
    const grid = document.createElement('div');
    grid.className = 'c-emoji-picker__grid';
    grid.innerHTML = FALLBACK_EMOJIS.map(e =>
      `<button type="button" data-emoji="${e}" class="c-emoji-picker__item">${e}</button>`).join('');
    grid.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-emoji]');
      if (!btn) return;
      overlay.remove();
      toggleChatReaction(messageId, btn.dataset.emoji);
    });
    wrap.appendChild(grid);
  }

  overlay.appendChild(wrap);
  document.body.appendChild(overlay);
}
