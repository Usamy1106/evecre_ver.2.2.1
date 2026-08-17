// ===== イベント設定ページ =====
// メインボード歯車アイコンから遷移する設定ページ。
// - 上部：メンバーアイコン一覧（重ね表示、最大5つ）
// - イベント管理：イベント名 / 概要 / 開催日時 / 開催場所 / キャッチコピー / 意気込み / 種別 / 規模 / フェーズ
//   ★概要と開催場所はアーカイブ側の表示と連動する（utils.js の getter/setter に集約）
// - ユーザー管理：メンバーの招待 / メンバーのロール設定

import { state } from '../state.js';
import { api }   from '../api.js';
import { Components } from '../components.js';
import { openInviteIssueModal } from '../modals/inviteIssueModal.js';
import { showConfirmDialog } from '../dialog.js';
import {
  formatEventPeriodLines,
  getArchiveSummary, setArchiveSummary, getArchiveVenue, setArchiveVenue,
} from '../utils.js';
import { EVENT_TYPES, EXPECTED_SCALES, MOTIVATION_CARDS } from '../constants.js';

export function renderEventSettings(container) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) {
    state.setView('HOME');
    return;
  }
  const sec = state.eventSettingsScreen || (state.eventSettingsScreen = { members: null, loadingMembers: true });

  // メンバー未取得なら取得
  if (sec.members === null && !sec._fetched) {
    sec._fetched = true;
    api.listMembers(p.id).then(r => {
      sec.members = r?.ok ? r.members : [];
      sec.ownerId = r?.ok ? r.ownerId : null;
      sec.roles   = r?.ok ? (r.roles || []) : [];
      sec.loadingMembers = false;
      state.render();
    }).catch(() => {
      sec.members = [];
      sec.roles = [];
      sec.loadingMembers = false;
      state.render();
    });
  }

  container.innerHTML = `
    <div class="p-event-settings u-page-transition">
      <header class="l-header l-header--sub">
        <button type="button" onclick="window._app.setView('MAIN_BOARD', '${p.id}')"
          class="l-header__back" aria-label="メインボードへ戻る">
          <img src="/images/icon/iocn-Chevron.svg" class="l-header__back-icon" alt="">
        </button>
        <h1 class="l-header__heading">イベント設定</h1>
      </header>

      <main class="p-event-settings__main">
        ${_membersAvatarsSection(sec)}
        ${_eventManagementSection(p, sec)}
        ${_userManagementSection(p, sec)}
        ${_leaveSection(p)}
      </main>
    </div>`;

  _bindEvents(p, sec);
}

// =====================================================
// セクション: メンバーアイコン一覧（重ね表示・最大5つ）
// =====================================================
function _membersAvatarsSection(sec) {
  if (sec.loadingMembers) {
    return `<p class="p-event-settings__loading">読み込み中…</p>`;
  }
  const members = sec.members || [];
  const MAX = 5;
  const visible = members.slice(0, MAX);
  const extra = members.length - MAX;

  return `
    <section>
      <div class="p-event-settings__avatars">
        ${visible.map(m => `
          <div title="${_esc(m.username)}">
            ${Components.UserAvatar({ username: m.username, avatarUrl: m.avatarUrl }, { size: 44, ring: true })}
          </div>`).join('')}
        ${extra > 0 ? `
          <div class="p-event-settings__avatars-more">+${extra}</div>` : ''}
        ${members.length === 0 ? '<p class="p-event-settings__loading">メンバーがいません</p>' : ''}
      </div>
      <p class="p-event-settings__avatars-caption">参加メンバー（${members.length}人）</p>
    </section>`;
}

// =====================================================
// セクション: イベント管理
// =====================================================
function _eventManagementSection(p, sec) {
  const canMgr = state.canManageCurrentEvent();
  const editingName  = sec.editing === 'name';
  const editingDesc  = sec.editing === 'description';
  const editingDates = sec.editing === 'dates';
  const editingCatch = sec.editing === 'catchphrase';
  const editingVenue = sec.editing === 'venue';
  const editingMotiv = sec.editing === 'motivationText';

  return `
    <section>
      <h2 class="p-event-settings__section-title">イベント管理</h2>
      <div class="c-settings-list">

        <!-- イベント名 -->
        <div class="c-settings-list__row">
          <p class="c-settings-list__label">イベント名</p>
          ${editingName ? `
            <input id="ps-name-input" type="text" value="${_esc(sec.draftValue || '')}"
              class="c-input c-input--block c-settings-list__input">
            <div class="c-settings-card__actions">
              <button id="ps-name-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
              <button id="ps-name-save"   class="c-settings-card__action c-settings-card__action--save">保存</button>
            </div>
          ` : `
            <div class="c-settings-list__view c-settings-list__view--center">
              <span class="c-settings-list__value c-settings-list__value--truncate">${_esc(p.name)}</span>
              ${canMgr ? `<button data-ps-edit="name" class="c-settings-list__edit">変更</button>` : ''}
            </div>
          `}
        </div>

        <!-- 概要（旧「イベントの説明」）-->
        <!-- ★アーカイブの「概要」と同じ場所を読み書きする（utils.js の getter/setter 経由）。
             description にも同じ値が入る（提案エンジンと AI プロンプトが参照するため）。 -->
        <div class="c-settings-list__row">
          <p class="c-settings-list__label">概要</p>
          ${editingDesc ? `
            <textarea id="ps-desc-input" rows="3" class="c-input c-input--block c-settings-list__input c-settings-list__input--multiline">${_esc(sec.draftValue || '')}</textarea>
            <div class="c-settings-card__actions">
              <button id="ps-desc-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
              <button id="ps-desc-save"   class="c-settings-card__action c-settings-card__action--save">保存</button>
            </div>
          ` : `
            <div class="c-settings-list__view">
              <span class="c-settings-list__value c-settings-list__value--body">${_esc(getArchiveSummary(p) || '(未設定)')}</span>
              ${canMgr ? `<button data-ps-edit="description" class="c-settings-list__edit">変更</button>` : ''}
            </div>
          `}
        </div>

        <!-- 開催日時 -->
        <div class="c-settings-list__row">
          <p class="c-settings-list__label">開催日時</p>
          <div class="c-settings-list__view c-settings-list__view--center">
            <span class="c-settings-list__value c-settings-list__value--pre">${_formatDates(p.dates, p.dateTimes)}</span>
            ${canMgr ? `<button onclick="window._app.openCalendarModal('projectEdit')" class="c-settings-list__edit">変更</button>` : ''}
          </div>
        </div>

        <!-- 開催場所 -->
        <!-- ★アーカイブの「場所」と同じ場所を読み書きする（utils.js の getter/setter 経由）-->
        <div class="c-settings-list__row">
          <p class="c-settings-list__label">開催場所</p>
          ${editingVenue ? `
            <input id="ps-venue-input" type="text" value="${_esc(sec.draftValue || '')}"
              placeholder="例：造形大 12号館 ホール"
              class="c-input c-input--block c-settings-list__input">
            <div class="c-settings-card__actions">
              <button id="ps-venue-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
              <button id="ps-venue-save"   class="c-settings-card__action c-settings-card__action--save">保存</button>
            </div>
          ` : `
            <div class="c-settings-list__view">
              <span class="c-settings-list__value">${_esc(getArchiveVenue(p) || '(未設定)')}</span>
              ${canMgr ? `<button data-ps-edit="venue" class="c-settings-list__edit">変更</button>` : ''}
            </div>
          `}
        </div>

        <!-- キャッチコピー -->
        <!-- 招待ページ（招待バナー・参加確認モーダル）の一番上に表示される -->
        <div class="c-settings-list__row">
          <p class="c-settings-list__label">キャッチコピー</p>
          ${editingCatch ? `
            <input id="ps-catch-input" type="text" maxlength="50" placeholder="例：つくる、をみせる。"
              value="${_esc(sec.draftValue || '')}"
              class="c-input c-input--block c-settings-list__input">
            <div class="c-settings-card__actions">
              <button id="ps-catch-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
              <button id="ps-catch-save"   class="c-settings-card__action c-settings-card__action--save">保存</button>
            </div>
          ` : `
            <div class="c-settings-list__view">
              <span class="c-settings-list__value ${p.catchphrase ? 'c-settings-list__value--accent' : 'c-settings-list__value--body'}">${_esc(p.catchphrase || '(未設定)')}</span>
              ${canMgr ? `<button data-ps-edit="catchphrase" class="c-settings-list__edit">変更</button>` : ''}
            </div>
          `}
        </div>

        <!-- 意気込み（カード複数選択＋ひとこと）-->
        <!-- ★招待相手に表示され、🔥で応援できる。意気込みが未入力だと🔥ボタン自体が
             出ない（＝空のイベントでは応援できない）ので、ここから後追いで入れられるようにする。 -->
        <div class="c-settings-list__row">
          <p class="c-settings-list__label">意気込み</p>
          <p class="p-event-settings__sub-title">招待した相手に表示され、🔥で応援してもらえます</p>
          ${canMgr ? `
            <div class="p-event-settings__motivation-tags p-event-settings__group">
              ${MOTIVATION_CARDS.map(c => {
                const on = (p.motivationTags || []).includes(c.id);
                return `
                  <button data-ps-motiv="${c.id}"
                    class="text-[11px] font-bold px-3 py-1.5 rounded-full border-2 transition-all active:scale-95
                      ${on ? 'border-[#EE3E12] bg-[#EE3E12]/10 text-[#EE3E12]' : 'border-[#E1DFDC] bg-white text-[#A7AAAC]'}">
                    ${_esc(c.label)}
                  </button>`;
              }).join('')}
            </div>
          ` : `
            <div class="p-event-settings__motivation-tags">
              ${(p.motivationTags || []).map(id => {
                const label = MOTIVATION_CARDS.find(c => c.id === id)?.label;
                return label ? `<span class="p-event-settings__motivation-tag">${_esc(label)}</span>` : '';
              }).join('') || '<span class="c-settings-list__value c-settings-list__value--body">(未設定)</span>'}
            </div>
          `}
          ${editingMotiv ? `
            <input id="ps-motiv-input" type="text" maxlength="50" placeholder="ひとことで言うと？"
              value="${_esc(sec.draftValue || '')}"
              class="c-input c-input--block c-settings-list__input">
            <div class="c-settings-card__actions">
              <button id="ps-motiv-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
              <button id="ps-motiv-save"   class="c-settings-card__action c-settings-card__action--save">保存</button>
            </div>
          ` : `
            <div class="c-settings-list__view">
              <span class="c-settings-list__value c-settings-list__value--body">${p.motivationText ? `「${_esc(p.motivationText)}」` : '(ひとこと未設定)'}</span>
              ${canMgr ? `<button data-ps-edit="motivationText" class="c-settings-list__edit">変更</button>` : ''}
            </div>
          `}
        </div>

        <!-- イベントの種別 -->
        <!-- ★ミッション提案のカテゴリ判定に直結する。作成フロー導入前のイベントは
             未設定のままなので、ここから後追いで入力できるようにしている。 -->
        <div class="c-settings-list__row">
          <p class="c-settings-list__label">イベントの種別</p>
          <p class="p-event-settings__sub-title">ミッション提案の内容がこれに合わせて変わります</p>
          ${canMgr ? `
            <select data-ps-select="eventType"
              class="c-input p-event-settings__select">
              <option value="" ${!p.eventType ? 'selected' : ''}>(未設定)</option>
              ${EVENT_TYPES.map(t => `
                <option value="${_esc(t.id)}" ${p.eventType === t.id ? 'selected' : ''}>${_esc(t.label)}</option>
              `).join('')}
            </select>
          ` : `
            <span class="c-settings-list__value">${_esc(EVENT_TYPES.find(t => t.id === p.eventType)?.label || '(未設定)')}</span>
          `}
        </div>

        <!-- 来てほしい人数 -->
        <div class="c-settings-list__row">
          <p class="p-event-settings__sub-title">来てほしい人数</p>
          ${canMgr ? `
            <select data-ps-select="expectedScale"
              class="c-input p-event-settings__select">
              <option value="" ${!p.expectedScale ? 'selected' : ''}>(未設定)</option>
              ${EXPECTED_SCALES.map(s => `
                <option value="${_esc(s.id)}" ${p.expectedScale === s.id ? 'selected' : ''}>${_esc(s.label)}（${_esc(s.hint)}）</option>
              `).join('')}
            </select>
          ` : `
            <span class="c-settings-list__value">${_esc(EXPECTED_SCALES.find(s => s.id === p.expectedScale)?.label || '(未設定)')}</span>
          `}
        </div>

        <!-- フェーズ -->
        <div class="c-settings-list__row">
          <p class="p-event-settings__sub-title">フェーズ</p>
          ${canMgr ? `
            <div class="c-settings-card__actions">
              ${[
                { phase: '企画準備', color: '#A7AAAC', activeColor: '#484545' },
                { phase: '告知',     color: '#0CA1E3', activeColor: '#0CA1E3' },
                { phase: '完了',     color: '#9EDF05', activeColor: '#9EDF05' },
              ].map(({ phase, color }) => {
                const current = p.eventPhase || '企画準備';
                const active  = current === phase;
                return `
                  <button type="button" data-ps-phase="${_esc(phase)}"
                    class="p-event-settings__phase${active ? ' is-active' : ''}"
                    ${active ? `style="--phase-color:${color}"` : ''}>
                    ${phase}
                  </button>`;
              }).join('')}
            </div>
          ` : `
            <span class="c-settings-list__value">${_esc(p.eventPhase || '企画準備')}</span>
          `}
        </div>

        <!-- 操作履歴（管理者のみ） -->
        ${canMgr ? `
        <button onclick="window._app.openEventLogSheet()"
          class="c-settings-list__link">
          <div>
            <p class="c-settings-list__label">操作履歴</p>
            <span class="c-settings-list__value">誰がいつ何をしたか</span>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A7AAAC" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>` : ''}

      </div>
    </section>`;
}

// =====================================================
// セクション: ユーザー管理
// =====================================================
function _userManagementSection(p, sec) {
  const members = sec.members || [];
  const roles   = sec.roles   || [];
  const isOwner = sec.ownerId === state.currentUser?.id;

  // 自分の管理者権限の判定（複数ロール対応）
  const meRow = members.find(m => m.userId === state.currentUser?.id);
  const myRoleIds = meRow ? (Array.isArray(meRow.roles) && meRow.roles.length > 0 ? meRow.roles : [meRow.role].filter(Boolean)) : [];
  const canMgr = myRoleIds.some(rid => roles.find(r => r.id === rid)?.canManage);

  // メンバー一覧（複数ロールチェックボックス編集）
  const memberList = members.map(m => {
    const myIds = (Array.isArray(m.roles) && m.roles.length > 0)
      ? m.roles
      : (m.role ? [m.role] : []);
    const isMe = m.userId === state.currentUser?.id;
    const isOwnerRow = myIds.includes('owner');
    const isEditing = sec.memberRolesEditing === m.userId;
    const editingSet = sec.memberRolesEditingSet || new Set();

    // 表示用ラベル
    const labels = myIds.map(rid => roles.find(r => r.id === rid)?.name || rid).join('、') || 'メンバー';

    if (isEditing && !isOwnerRow) {
      // チェックボックスリスト（owner は除外）
      const checks = roles.filter(r => r.id !== 'owner').map(r => `
        <label class="p-event-settings__check">
          <input type="checkbox" data-ps-mrole-check value="${_esc(r.id)}"
            ${editingSet.has(r.id) ? 'checked' : ''}>
          <span class="p-event-settings__member-name">${_esc(r.name)}</span>
          ${r.canManage ? '<span class="p-event-settings__member-sub p-event-settings__member-sub--accent">管理者権限</span>' : '<span class="p-event-settings__member-sub">一般ユーザー</span>'}
        </label>`).join('');
      return `
        <div class="p-event-settings__form p-event-settings__form--flush">
          <div class="p-event-settings__member-main p-event-settings__group">
            ${Components.UserAvatar({ username: m.username, avatarUrl: m.avatarUrl }, { size: 32 })}
            <p class="p-event-settings__member-name">${_esc(m.username)}${isMe ? ' <span class="p-event-settings__sub-title">(あなた)</span>' : ''}</p>
          </div>
          <p class="c-settings-list__label">ロール（複数選択可）</p>
          <div class="p-event-settings__check-box">${checks}</div>
          <div class="c-settings-card__actions">
            <button data-ps-mrole-cancel class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
            <button data-ps-mrole-save="${m.userId}" class="c-settings-card__action c-settings-card__action--save">保存</button>
          </div>
        </div>`;
    }

    return `
      <div class="p-event-settings__member">
        <div class="p-event-settings__member-main">
          ${Components.UserAvatar({ username: m.username, avatarUrl: m.avatarUrl }, { size: 32 })}
          <div class="p-event-settings__member-body">
            <p class="p-event-settings__member-name c-settings-list__value--truncate">${_esc(m.username)}${isMe ? ' <span class="p-event-settings__sub-title">(あなた)</span>' : ''}</p>
            <p class="p-event-settings__member-sub c-settings-list__value--truncate">${_esc(labels)}</p>
          </div>
        </div>
        ${(isOwner || canMgr) && !isOwnerRow ? `
          <button data-ps-mrole-edit="${m.userId}" class="c-settings-list__edit">変更</button>
        ` : ''}
      </div>`;
  }).join('') || '<p class="p-event-settings__empty">メンバーがいません</p>';

  // ロール一覧（編集UI付き）
  const rolesHtml = roles.map(r => {
    const isOwnerRole = r.id === 'owner';
    const isEditing = sec.roleEditing === r.id;
    const disableDel = isOwnerRole || r.builtIn;
    if (isEditing) {
      return `
        <div class="p-event-settings__form p-event-settings__form--flush">
          <input data-ps-role-name-input value="${_esc(sec.roleEditDraft?.name ?? r.name)}"
            class="c-input c-input--block c-settings-list__input" maxlength="20">
          <label class="p-event-settings__check p-event-settings__check--spaced">
            <input type="checkbox" data-ps-role-canmanage-input
              ${(sec.roleEditDraft?.canManage ?? r.canManage) ? 'checked' : ''}
              ${isOwnerRole ? 'disabled' : ''}>
            <span class="p-event-settings__member-name">管理者権限</span>
            <span class="p-event-settings__check-note">${isOwnerRole ? '(オーナーは常にON)' : 'イベント管理・ミッション編集ができる'}</span>
          </label>
          <div class="c-settings-card__actions">
            <button data-ps-role-cancel class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
            <button data-ps-role-save="${r.id}" class="c-settings-card__action c-settings-card__action--save">保存</button>
          </div>
        </div>`;
    }
    return `
      <div class="p-event-settings__member">
        <div class="p-event-settings__member-main">
          <span class="p-event-settings__member-name c-settings-list__value--truncate">${_esc(r.name)}</span>
          <span class="p-event-settings__role-chip${r.canManage ? ' p-event-settings__role-chip--manager' : ''}">
            ${r.canManage ? '管理者権限' : '一般ユーザー'}
          </span>
          ${r.builtIn ? '<span class="p-event-settings__member-sub">組込</span>' : ''}
        </div>
        ${canMgr ? `
          <div class="p-event-settings__member-actions">
            ${!isOwnerRole ? `<button data-ps-role-edit="${r.id}" class="c-settings-list__edit c-settings-list__edit--tight">編集</button>` : ''}
            ${!disableDel ? `<button data-ps-role-delete="${r.id}" class="c-settings-list__edit c-settings-list__edit--tight c-settings-list__edit--danger">削除</button>` : ''}
          </div>` : ''}
      </div>`;
  }).join('');

  return `
    <section>
      <h2 class="p-event-settings__section-title">ユーザー管理</h2>

      <!-- メンバーの招待 -->
      <div class="c-settings-list c-settings-list__row p-event-settings__group">
        <div class="c-settings-list__view c-settings-list__view--center">
          <div>
            <p class="p-event-settings__member-name">メンバーを招待</p>
            <p class="p-event-settings__member-sub">招待リンクを発行して共有</p>
          </div>
          <button id="ps-invite-open" class="p-event-settings__invite">招待する</button>
        </div>
      </div>

      <!-- ロール定義 -->
      <div class="c-settings-list p-event-settings__group">
        <div class="p-event-settings__sub-head">
          <div>
            <p class="p-event-settings__member-name">ロール</p>
            <p class="p-event-settings__member-sub">「管理者権限」がONのロールはイベント・ミッションを編集できます</p>
          </div>
          ${canMgr ? `
            <button id="ps-role-add" class="c-settings-list__edit">+ 追加</button>
          ` : ''}
        </div>
        ${sec.roleAdding ? _renderRoleAddForm(sec) : ''}
        <div class="c-settings-list">${rolesHtml}</div>
      </div>

      <!-- メンバーのロール設定 -->
      <div class="c-settings-list">
        <div class="p-event-settings__sub-head">
          <p class="p-event-settings__member-name">メンバーのロール</p>
          ${!isOwner && !canMgr ? '<p class="p-event-settings__member-sub">ロールの変更は管理者権限を持つメンバーのみ可能です</p>' : ''}
        </div>
        <div class="c-settings-list">${memberList}</div>
      </div>
    </section>`;
}

function _renderRoleAddForm(sec) {
  return `
    <div class="p-event-settings__form">
      <input id="ps-role-new-name" value="${_esc(sec.roleAdding.name || '')}"
        placeholder="例: サブリーダーデザイナーなど"
        class="c-input c-input--block c-settings-list__input" maxlength="20">
      <label class="p-event-settings__check p-event-settings__check--spaced">
        <input id="ps-role-new-canmanage" type="checkbox" ${sec.roleAdding.canManage ? 'checked' : ''}>
        <span class="p-event-settings__member-name">管理者権限</span>
        <span class="p-event-settings__check-note">イベント管理・ミッション編集</span>
      </label>
      <div class="c-settings-card__actions">
        <button id="ps-role-add-cancel" class="c-settings-card__action c-settings-card__action--cancel">キャンセル</button>
        <button id="ps-role-add-save" class="c-settings-card__action c-settings-card__action--save">追加</button>
      </div>
    </div>`;
}

// =====================================================
// セクション: 脱退
// =====================================================
function _leaveSection(p) {
  const isOwner = p.ownerId === state.currentUser?.id;
  if (isOwner) return ''; // オーナーは削除のみ（HOME長押しメニューから）
  return `
    <section>
      <div class="p-event-settings__leave-box">
        <p class="p-event-settings__member-name p-event-settings__group">このイベントから脱退する</p>
        <p class="p-event-settings__section-note">脱退後は再招待されないと参加できません</p>
        <button onclick="window._app.leaveEvent('${_esc(p.id)}')"
          class="p-event-settings__leave">
          脱退する
        </button>
      </div>
    </section>`;
}

// =====================================================
// イベント結線
// =====================================================
function _bindEvents(p, sec) {
  // 編集モード開始
  document.querySelectorAll('[data-ps-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const f = el.dataset.psEdit;
      sec.editing = f;
      // 編集開始時の初期値。フィールドを増やしたらここにも足すこと
      sec.draftValue =
        f === 'name'           ? p.name
      : f === 'catchphrase'    ? (p.catchphrase || '')
      : f === 'motivationText' ? (p.motivationText || '')
      : f === 'venue'          ? getArchiveVenue(p)
      :                          getArchiveSummary(p);
      state.render();
    });
  });

  // 名前 保存・キャンセル
  document.getElementById('ps-name-input')?.addEventListener('input', e => sec.draftValue = e.target.value);
  document.getElementById('ps-name-cancel')?.addEventListener('click', () => { sec.editing = null; sec.draftValue = null; state.render(); });
  document.getElementById('ps-name-save')?.addEventListener('click', async () => {
    const v = String(sec.draftValue || '').trim();
    if (!v) { window._app?.showToast('イベント名を入力してください', 'error'); return; }
    p.name = v;
    await state.saveNow();
    sec.editing = null;
    sec.draftValue = null;
    state.render();
  });

  // 説明 保存・キャンセル
  document.getElementById('ps-desc-input')?.addEventListener('input', e => sec.draftValue = e.target.value);
  document.getElementById('ps-desc-cancel')?.addEventListener('click', () => { sec.editing = null; sec.draftValue = null; state.render(); });
  document.getElementById('ps-desc-save')?.addEventListener('click', async () => {
    // アーカイブの「概要」と同じ場所に書く（description にも同じ値が入る）
    setArchiveSummary(p, sec.draftValue);
    await state.saveNow();
    sec.editing = null;
    sec.draftValue = null;
    state.render();
  });

  // 開催場所 保存・キャンセル（アーカイブの「場所」と同じ場所に書く）
  document.getElementById('ps-venue-input')?.addEventListener('input', e => sec.draftValue = e.target.value);
  document.getElementById('ps-venue-cancel')?.addEventListener('click', () => { sec.editing = null; sec.draftValue = null; state.render(); });
  document.getElementById('ps-venue-save')?.addEventListener('click', async () => {
    setArchiveVenue(p, sec.draftValue);
    await state.saveNow();
    sec.editing = null; sec.draftValue = null;
    state.render();
  });

  // キャッチコピー 保存・キャンセル
  document.getElementById('ps-catch-input')?.addEventListener('input', e => sec.draftValue = e.target.value);
  document.getElementById('ps-catch-cancel')?.addEventListener('click', () => { sec.editing = null; sec.draftValue = null; state.render(); });
  document.getElementById('ps-catch-save')?.addEventListener('click', async () => {
    // 空にするときも空文字を入れる（delete だと LWW でサーバー側の古い値が残る）
    p.catchphrase = String(sec.draftValue || '').trim();
    await state.saveNow();
    sec.editing = null; sec.draftValue = null;
    state.render();
  });

  // 意気込みカードのトグル（押した時点で即保存）
  document.querySelectorAll('[data-ps-motiv]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ev = state.events.find(x => x.id === p.id);
      if (!ev) return;
      const id  = btn.dataset.psMotiv;
      const cur = Array.isArray(ev.motivationTags) ? ev.motivationTags : [];
      ev.motivationTags = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      await state.saveNow();
      state.render();
    });
  });

  // 意気込みのひとこと 保存・キャンセル
  document.getElementById('ps-motiv-input')?.addEventListener('input', e => sec.draftValue = e.target.value);
  document.getElementById('ps-motiv-cancel')?.addEventListener('click', () => { sec.editing = null; sec.draftValue = null; state.render(); });
  document.getElementById('ps-motiv-save')?.addEventListener('click', async () => {
    p.motivationText = String(sec.draftValue || '').trim();
    await state.saveNow();
    sec.editing = null; sec.draftValue = null;
    state.render();
  });

  // 種別 / 来てほしい人数（管理者権限が必要）。未設定に戻す場合は値を消す。
  // ★eventType は次回の提案生成からカテゴリ判定に使われる（即時再生成はしない。
  //   12時間サイクルの次回、または提案が空になったタイミングで反映される）。
  document.querySelectorAll('[data-ps-select]').forEach(sel => {
    sel.addEventListener('change', () => {
      const ev = state.events.find(x => x.id === p.id);
      if (!ev) return;
      const key = sel.dataset.psSelect;      // 'eventType' | 'expectedScale'
      // ★「(未設定)」に戻すときは delete ではなく空文字を入れること。
      //   flatToCrdt は undefined のキーをパッチに載せないため、delete だと
      //   サーバー側の古い値が LWW で残り続けて消えない。
      ev[key] = sel.value || '';
      state.save();
      state.render();
    });
  });

  // フェーズ変更（管理者権限が必要・確認ダイアログを表示）
  document.querySelectorAll('[data-ps-phase]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const phase = btn.dataset.psPhase;
      const ev = state.events.find(x => x.id === p.id);
      if (!ev) return;
      // 既に同じフェーズなら何もしない
      if ((ev.eventPhase || '企画準備') === phase) return;
      const ok = await showConfirmDialog({
        message: `フェーズを「${phase}」に変更しますか？`,
        confirmLabel: '変更する',
        cancelLabel: 'キャンセル',
      });
      if (!ok) return;
      ev.eventPhase  = phase;
      ev.isCompleted = (phase === '完了');
      state.save();
      state.render();
    });
  });

  // 招待
  document.getElementById('ps-invite-open')?.addEventListener('click', () => {
    openInviteIssueModal(p.id);
  });

  // ロール変更
  // メンバーのロール（複数）編集 開始
  document.querySelectorAll('[data-ps-mrole-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const uid = el.dataset.psMroleEdit;
      const m = (sec.members || []).find(x => x.userId === uid);
      const ids = m && Array.isArray(m.roles) && m.roles.length > 0
        ? m.roles
        : (m?.role ? [m.role] : []);
      sec.memberRolesEditing = uid;
      sec.memberRolesEditingSet = new Set(ids);
      state.render();
    });
  });

  document.querySelector('[data-ps-mrole-cancel]')?.addEventListener('click', () => {
    sec.memberRolesEditing = null;
    sec.memberRolesEditingSet = null;
    state.render();
  });

  document.querySelectorAll('[data-ps-mrole-check]').forEach(chk => {
    chk.addEventListener('change', () => {
      if (!sec.memberRolesEditingSet) return;
      const rid = chk.value;
      if (chk.checked) sec.memberRolesEditingSet.add(rid);
      else              sec.memberRolesEditingSet.delete(rid);
    });
  });

  document.querySelectorAll('[data-ps-mrole-save]').forEach(el => {
    el.addEventListener('click', async () => {
      const uid = el.dataset.psMroleSave;
      const newRoles = Array.from(sec.memberRolesEditingSet || []);
      const r = await api.updateMemberRoles(p.id, uid, newRoles);
      if (r.ok) {
        // ローカルメンバー情報を更新
        const target = (sec.members || []).find(m => m.userId === uid);
        if (target) {
          target.roles = newRoles.length > 0 ? newRoles : ['member'];
          target.role  = target.roles[0];
        }
        sec.memberRolesEditing = null;
        sec.memberRolesEditingSet = null;
        state.render();
      } else {
        window._app?.showToast(r.error || 'ロールの変更に失敗しました', 'error');
      }
    });
  });

  // 旧 data-ps-role-user は廃止

  // ロール 追加
  document.getElementById('ps-role-add')?.addEventListener('click', () => {
    sec.roleAdding = { name: '', canManage: false };
    state.render();
  });
  document.getElementById('ps-role-add-cancel')?.addEventListener('click', () => {
    sec.roleAdding = null;
    state.render();
  });
  document.getElementById('ps-role-new-name')?.addEventListener('input', e => {
    if (sec.roleAdding) sec.roleAdding.name = e.target.value;
  });
  document.getElementById('ps-role-new-canmanage')?.addEventListener('change', e => {
    if (sec.roleAdding) sec.roleAdding.canManage = e.target.checked;
  });
  document.getElementById('ps-role-add-save')?.addEventListener('click', async () => {
    const name = String(sec.roleAdding?.name || '').trim();
    if (!name) { window._app?.showToast('ロール名を入力してください', 'error'); return; }
    const eventId = p.id;
    const r = await api.createRole(eventId, name, !!sec.roleAdding?.canManage);
    if (r.ok) {
      sec.roles = sec.roles.concat([r.role]);
      sec.roleAdding = null;
      // state.events の roles も更新（承認モーダルのロール一覧に反映）
      const ev = state.events.find(x => x.id === p.id);
      if (ev) ev.roles = (ev.roles || []).concat([r.role]);
      state.render();
    } else {
      window._app?.showToast(r.error || 'ロールの追加に失敗しました', 'error');
    }
  });

  // ロール 編集（既存）
  document.querySelectorAll('[data-ps-role-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.psRoleEdit;
      const r  = sec.roles.find(x => x.id === id);
      if (!r) return;
      sec.roleEditing = id;
      sec.roleEditDraft = { name: r.name, canManage: r.canManage };
      state.render();
    });
  });
  document.querySelector('[data-ps-role-cancel]')?.addEventListener('click', () => {
    sec.roleEditing = null;
    sec.roleEditDraft = null;
    state.render();
  });
  document.querySelector('[data-ps-role-name-input]')?.addEventListener('input', e => {
    if (sec.roleEditDraft) sec.roleEditDraft.name = e.target.value;
  });
  document.querySelector('[data-ps-role-canmanage-input]')?.addEventListener('change', e => {
    if (sec.roleEditDraft) sec.roleEditDraft.canManage = e.target.checked;
  });
  document.querySelectorAll('[data-ps-role-save]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.psRoleSave;
      const draft = sec.roleEditDraft || {};
      const eventId = p.id;
      const r = await api.updateRole(eventId, id, { name: draft.name, canManage: draft.canManage });
      if (r.ok) {
        const target = sec.roles.find(x => x.id === id);
        if (target) Object.assign(target, r.role);
        sec.roleEditing = null;
        sec.roleEditDraft = null;
        state.render();
      } else {
        window._app?.showToast(r.error || 'ロールの編集に失敗しました', 'error');
      }
    });
  });

  // ロール 削除
  document.querySelectorAll('[data-ps-role-delete]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.psRoleDelete;
      const ok = await showConfirmDialog({
        message: 'このロールを削除しますか？該当メンバーは「メンバー」ロールに降格されます',
        confirmLabel: '削除する',
        cancelLabel: 'キャンセル',
        destructive: true,
      });
      if (!ok) return;
      const eventId = p.id;
      const r = await api.deleteRole(eventId, id);
      if (r.ok) {
        sec.roles = sec.roles.filter(x => x.id !== id);
        // メンバーの role も同期
        (sec.members || []).forEach(m => { if (m.role === id) m.role = 'member'; });
        state.render();
      } else {
        window._app?.showToast(r.error || 'ロールの削除に失敗しました', 'error');
      }
    });
  });
}

// =====================================================
// ヘルパ
// =====================================================
function _formatDates(dates, dateTimes) {
  const lines = formatEventPeriodLines(dates, dateTimes);
  return lines.length === 0 ? '未設定' : lines.join('\n');
}

function _roleLabel(role) {
  switch (role) {
    case 'owner':  return 'オーナー';
    case 'admin':  return '管理者';
    case 'member': return 'メンバー';
    default: return role;
  }
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
