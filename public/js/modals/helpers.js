// ===== ヘルパーモーダル =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { MISSION_DESCRIPTIONS } from '../constants.js';
import { logEvent } from '../logger.js';
import { openCalendarModal } from './calendar.js';
import { showConfirmDialog } from '../dialog.js';

// ===== アーカイブ直接編集 =====

/**
 * アーカイブアイテムを編集する
 * @param {'title'|'summary'|'url'|'venue'|'period'|'image'} type
 */
export function editArchiveItem(type) {
  if (!state.canManageCurrentEvent()) return; // 管理者権限なし
  const p = state.events.find(x => x.id === state.selectedEventId);
  let missionId = '', currentVal = '', format = 'text', titleLabel = '';

  if (type === 'title') {
    missionId   = 'def-2';
    currentVal  = p.clearedData['def-2']?.content || p.name;
    titleLabel  = 'タイトル';
  } else if (type === 'summary') {
    missionId   = 'def-3';
    currentVal  = p.clearedData['def-3']?.content || p.description;
    titleLabel  = '概要';
  } else if (type === 'url') {
    const m     = p.missions.find(x => x.title === '広報リンクを挿入');
    missionId   = m?.id || 'url-temp';
    currentVal  = p.clearedData[missionId]?.content || '';
    format      = 'link';
    titleLabel  = 'URL';
  } else if (type === 'venue') {
    const m     = p.missions.find(x => x.title === '開催場所を決める');
    missionId   = m?.id || 'venue-temp';
    currentVal  = p.clearedData[missionId]?.content || '';
    titleLabel  = '場所';
  } else if (type === 'period') {
    // テキスト入力ではなくカレンダー UI で開催日を編集
    openCalendarModal('projectEdit');
    return;
  } else if (type === 'image') {
    // ミッション経由ではなく専用ダイアログで画像を保存
    _openArchiveImageDialog(p);
    return;
  }

  openEditModal(titleLabel, currentVal, format, (newVal) => {
    let m = p.missions.find(x => x.id === missionId);
    if (!m) {
      m = {
        id: missionId,
        title: type === 'url' ? '広報リンクを挿入'
             : type === 'venue' ? '開催場所を決める'
             : type === 'period' ? '開催日時' : type,
        tag: type === 'url' ? '広報' : '企画',
        clearFormat: format,
        status: 'cleared',
        dates: [],
        daysLeft: 7,
        isDeletable: false,
        createdAt: Date.now(),
        priority: 5,
      };
      p.missions.push(m);
    } else {
      m.status = 'cleared';
    }
    p.clearedData[missionId] = { content: newVal, timestamp: Date.now(), title: m.title, format };
    state.save();
    state.render();
  });
}

/** アーカイブ用メインビジュアル画像アップロードダイアログ */
function _openArchiveImageDialog(p) {
  const overlay = document.createElement('div');
  overlay.id = 'archive-image-dialog';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-6';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const current = p.clearedData?.['archive-image']?.content;
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn">
      <h3 class="heading-m text-[#484545] mb-6 font-bold">メインビジュアルを設定</h3>
      <div id="arch-img-preview" class="${current ? '' : 'hidden'} mb-4">
        <img id="arch-img-src" src="${current || ''}" class="w-full h-40 object-cover rounded-2xl">
      </div>
      <label class="block w-full cursor-pointer">
        <div class="w-full py-4 rounded-2xl border-2 border-dashed border-[#D3D6D8] flex flex-col items-center gap-2 text-[#A7AAAC] hover:border-[#0CA1E3] hover:text-[#0CA1E3] transition-colors">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span class="text-[13px] font-bold">画像を選択</span>
        </div>
        <input type="file" id="arch-file-input" class="hidden" accept="image/*">
      </label>
      <div class="flex gap-3 mt-6">
        <button data-action="cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">キャンセル</button>
        <button data-action="save" class="flex-1 py-3 heading-rs font-bold text-white rounded-xl" style="background-color:#0CA1E3" disabled>保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedBase64 = null;

  overlay.querySelector('#arch-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      selectedBase64 = ev.target.result;
      overlay.querySelector('#arch-img-src').src = selectedBase64;
      overlay.querySelector('#arch-img-preview').classList.remove('hidden');
      overlay.querySelector('[data-action="save"]').disabled = false;
    };
    reader.readAsDataURL(file);
  };

  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove();
  overlay.querySelector('[data-action="save"]').onclick = () => {
    if (!selectedBase64) return;
    p.clearedData = p.clearedData || {};
    p.clearedData['archive-image'] = { content: selectedBase64, timestamp: Date.now(), format: 'image' };
    state.save();
    state.render();
    overlay.remove();
  };
}

/**
 * 汎用テキスト/リンク編集モーダルを開く
 * @param {string} title - モーダルのタイトル
 * @param {string} currentVal - 現在の値
 * @param {'text'|'link'} format
 * @param {function} onSave - 保存時コールバック
 */
export function openEditModal(title, currentVal, format, onSave) {
  const overlay = document.createElement('div');
  overlay.id = 'edit-archive-modal';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-6 page-transition';

  let inputHtml;
  if (format === 'text' || title === '概要' || title === '期間') {
    inputHtml = `<textarea id="edit-input" class="w-full h-40 p-4 rounded-2xl bg-[#EBE8E5] focus:outline-none text-r"
      placeholder="内容を入力してください">${currentVal}</textarea>`;
  } else if (format === 'link') {
    inputHtml = `<input type="url" id="edit-input" class="w-full p-4 rounded-2xl bg-[#EBE8E5] focus:outline-none text-r"
      placeholder="https://..." value="${currentVal}">`;
  } else {
    inputHtml = `<input type="text" id="edit-input" class="w-full p-4 rounded-2xl bg-[#EBE8E5] focus:outline-none text-r"
      placeholder="内容を入力してください" value="${currentVal}">`;
  }

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-sm:w-[90%] max-w-sm p-8 shadow-2xl relative animate-fadeIn">
      <button onclick="document.getElementById('edit-archive-modal').remove()" class="absolute top-4 right-4 p-2 opacity-40">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h3 class="heading-m text-[#484545] mb-6 pr-6">${title}の編集</h3>
      ${inputHtml}
      <button id="save-edit-btn" class="btn-primary w-full py-4 mt-8 heading-r font-bold">保存する</button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('save-edit-btn').onclick = () => {
    const val = document.getElementById('edit-input').value;
    if (val !== null) onSave(val);
    overlay.remove();
  };
}

// ===== ミッション完了モーダル =====

/**
 * ミッション完了入力モーダルを開く（スマート統合入力）
 * テキスト・URL・画像を1つの入力欄で受け付け、完了時に自動判別する。
 * @param {string} missionId
 * @param {string|null} _overrideFormat  後方互換のため残すが使用しない
 */
export function openClearMissionModal(missionId, _overrideFormat = null) {
  const project   = state.events.find(p => p.id === state.selectedEventId);
  const m         = project?.missions.find(x => x.id === missionId);

  // 入力なしで完了モード：シンプルな確認モーダルを表示
  if (m?.noInput) {
    const noInputOverlay = document.createElement('div');
    noInputOverlay.id = 'clear-mission-modal';
    noInputOverlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-6 page-transition';
    noInputOverlay.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-sm:w-[90%] max-w-sm p-8 shadow-2xl relative animate-fadeIn">
        <button onclick="document.getElementById('clear-mission-modal').remove()" class="absolute top-4 right-4 p-2 opacity-40">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <h3 class="heading-m text-[#484545] mb-2 pr-6">${_esc(m.title)}</h3>
        ${m.description ? `<p class="text-rs text-[#A7AAAC] mb-6 font-bold whitespace-pre-wrap">${_esc(m.description)}</p>` : '<div class="mb-6"></div>'}
        <button onclick="window._app.submitMissionClear('${missionId}')"
          class="btn-primary w-full py-4 heading-r font-bold">完了する</button>
      </div>`;
    document.body.appendChild(noInputOverlay);
    return;
  }
  const title     = m ? m.title : 'ミッション';
  const desc      = MISSION_DESCRIPTIONS[missionId]
                    || (m?.originProposalId ? MISSION_DESCRIPTIONS[m.originProposalId] : null)
                    || (m?.description || null);
  const checklist = Array.isArray(m?.checklist) ? m.checklist : [];

  // チェック項目 UI
  const checklistHtml = checklist.length === 0 ? '' : `
    <div class="mt-5 mb-2">
      <p class="text-rs text-[#484545] font-bold mb-2">チェック項目</p>
      <div class="space-y-2 bg-[#FDFBF8] rounded-2xl border border-[#E1DFDC] p-3">
        ${checklist.map((item, i) => `
          <label class="flex items-start gap-3 cursor-pointer">
            <span class="relative flex-shrink-0 mt-0.5 w-5 h-5">
              <input type="checkbox" data-clear-checklist="${i}"
                class="peer absolute inset-0 opacity-0 w-full h-full cursor-pointer m-0">
              <span class="block w-5 h-5 rounded-full border-2 border-[#D3D6D8] bg-white
                           peer-checked:bg-[#0CA1E3] peer-checked:border-[#0CA1E3] transition-colors"></span>
              <svg class="absolute inset-0 w-5 h-5 pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity"
                viewBox="0 0 20 20" fill="none">
                <polyline points="4.5 10.5 8 14 15.5 6.5" stroke="white" stroke-width="2.2"
                  stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="text-[13px] text-[#484545] flex-1">${_esc(item)}</span>
          </label>`).join('')}
      </div>
      <p id="clear-checklist-error" class="text-[12px] text-[#EE3E12] font-bold mt-2 hidden">
        チェック項目にチェックしてください。
      </p>
    </div>`;

  const overlay = document.createElement('div');
  overlay.id = 'clear-mission-modal';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-center justify-center p-6 page-transition';
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-sm:w-[90%] max-w-sm p-8 shadow-2xl relative animate-fadeIn max-h-[90vh] overflow-y-auto">
      <button onclick="document.getElementById('clear-mission-modal').remove()" class="absolute top-4 right-4 p-2 opacity-40">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h3 class="heading-m text-[#484545] mb-2 pr-6">${title}</h3>
      ${desc ? `<p class="text-rs text-[#A7AAAC] mb-6 font-bold whitespace-pre-wrap">${_esc(desc)}</p>` : '<div class="mb-6"></div>'}

      <!-- 画像チップ（画像が選択されたら表示） -->
      <div id="img-chip" class="hidden mb-2 flex items-center gap-2 bg-[#EBE8E5] rounded-xl px-3 py-2">
        <img id="preview-img" src="" class="w-9 h-9 rounded-lg object-cover flex-shrink-0">
        <span class="text-[11px] text-[#484545] font-bold flex-1 truncate">画像</span>
        <button onclick="window._app.clearImagePreview()" class="p-1 text-[#A7AAAC] hover:text-[#484545] transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- 統合テキスト入力 + 画像ボタン -->
      <div class="relative">
        <textarea id="clear-input"
          class="w-full h-32 p-4 pb-10 rounded-2xl bg-[#EBE8E5] focus:outline-none text-r resize-none leading-relaxed"
          placeholder="内容を入力"></textarea>
        <label for="file-input"
          class="absolute bottom-3 right-3 cursor-pointer opacity-30 hover:opacity-70 transition-opacity">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </label>
        <input type="file" id="file-input" class="hidden" accept="image/*"
          onchange="window._app.handleImageSelect(this)">
      </div>

      ${checklistHtml}
      <button onclick="window._app.submitMissionClear('${missionId}')"
        class="btn-primary w-full py-4 mt-8 heading-r font-bold">完了する</button>
    </div>`;
  document.body.appendChild(overlay);

  // === ドラフト復元 ===
  const draft = _clearDraft.load(missionId);
  const inputEl = document.getElementById('clear-input');
  if (draft) {
    // テキスト復元
    if (inputEl && draft.content && !draft.content.startsWith('data:image')) {
      inputEl.value = draft.content;
    }
    // 画像復元（imageData フィールド優先、旧フォーマット content も対応）
    const imgData = draft.imageData || (draft.content?.startsWith('data:image') ? draft.content : null);
    if (imgData) {
      const chip    = document.getElementById('img-chip');
      const preview = document.getElementById('preview-img');
      if (chip && preview) {
        preview.src = imgData;
        preview.dataset.base64 = imgData;
        chip.classList.remove('hidden');
      }
    }
    // チェックボックス復元
    if (Array.isArray(draft.checked)) {
      document.querySelectorAll('[data-clear-checklist]').forEach(cb => {
        const idx = parseInt(cb.dataset.clearChecklist, 10);
        if (draft.checked[idx]) cb.checked = true;
      });
    }
  }

  // === ドラフト自動保存 ===
  const snapshot = () => {
    const content   = document.getElementById('clear-input')?.value || '';
    const imageData = document.getElementById('preview-img')?.dataset?.base64 || '';
    const checked   = Array.from(document.querySelectorAll('[data-clear-checklist]')).map(cb => !!cb.checked);
    _clearDraft.save(missionId, { content, imageData, checked });
  };
  inputEl?.addEventListener('input', snapshot);
  document.querySelectorAll('[data-clear-checklist]').forEach(cb => {
    cb.addEventListener('change', snapshot);
  });
  overlay._snapshot = snapshot;
}

/**
 * 画像チップをクリアする（×ボタンから呼ばれる）
 */
export function clearImagePreview() {
  document.getElementById('img-chip')?.classList.add('hidden');
  const preview = document.getElementById('preview-img');
  if (preview) { preview.src = ''; preview.dataset.base64 = ''; }
  const fi = document.getElementById('file-input');
  if (fi) fi.value = '';
  // スナップショット更新
  const overlay = document.getElementById('clear-mission-modal');
  overlay?._snapshot?.();
}

/**
 * ミッション完了を確定する
 * @param {string} missionId
 */
export function submitMissionClear(missionId) {
  const project = state.events.find(p => p.id === state.selectedEventId);
  let m = project?.missions.find(x => x.id === missionId);

  if (!m) {
    m = { id: missionId, title: 'ミッション', tag: '企画', clearFormat: 'text', status: 'yet', dates: [], daysLeft: 7, createdAt: Date.now(), priority: 5, isDeletable: true };
    project.missions.push(m);
  }

  // チェック項目のバリデーション
  const checklist = Array.isArray(m.checklist) ? m.checklist : [];
  if (checklist.length > 0) {
    const checked = Array.from(document.querySelectorAll('[data-clear-checklist]'));
    const allChecked = checked.length === checklist.length && checked.every(c => c.checked);
    const errorEl = document.getElementById('clear-checklist-error');
    if (!allChecked) {
      if (errorEl) errorEl.classList.remove('hidden');
      return;
    }
    if (errorEl) errorEl.classList.add('hidden');
  }

  // ── フォーマット自動判別 ──────────────────────────────────
  // 優先順: 画像 > URL（https?://で始まる） > テキスト
  const previewEl  = document.getElementById('preview-img');
  const inputEl    = document.getElementById('clear-input');
  const imageData  = previewEl?.dataset?.base64 || '';
  const textValue  = (inputEl?.value || '').trim();

  let content = '';
  let detectedFormat = 'text';

  if (imageData) {
    content         = imageData;
    detectedFormat  = 'image';
  } else if (/^https?:\/\//i.test(textValue)) {
    content         = textValue;
    detectedFormat  = 'link';
  } else {
    content         = textValue;
    detectedFormat  = 'text';
  }

  if (!content && !m.noInput) { window._app?.showToast('入力を完了させてください', 'error'); return; }

  // clearFormat をアーカイブ表示用に自動判別結果で更新
  m.clearFormat = detectedFormat;

  const userId = state.currentUser?.id ?? null;

  // 個別完了モード
  if (m.individualClear) {
    // 個人の提出を composite key で保存
    project.clearedData[missionId + '_u_' + userId] = {
      content, format: detectedFormat, title: m.title,
      timestamp: Date.now(), submittedBy: userId,
    };
    // 完了済みリストに追加（重複なし）
    if (!Array.isArray(m.individualClearedBy)) m.individualClearedBy = [];
    if (!m.individualClearedBy.includes(userId)) m.individualClearedBy.push(userId);

    // 全担当者が完了したか判定
    const assigneeIds = Array.isArray(m.assignees) && m.assignees.length > 0
      ? m.assignees
      : (m.assignee?.type === 'user' ? [m.assignee.userId] : []);
    const allDone = assigneeIds.length > 0 && assigneeIds.every(id => m.individualClearedBy.includes(id));
    if (allDone) {
      m.status = m.leaderCheck ? 'pending_leader_check' : 'cleared';
      if (m.leaderCheck) state._infoModalShownForEvent = null;
    }
    // 全員完了でない場合は status を 'yet' のまま維持（メインボードに残す）
    logEvent('mission_completed', { tag: m.tag || (Array.isArray(m.tags) ? m.tags[0] : null), format: detectedFormat, priority: m.priority });
    state.save();
    document.getElementById('clear-mission-modal')?.remove();
    state.render();
    window._app?.showToast(allDone ? (m.leaderCheck ? 'リーダーチェック提出完了' : 'ミッション完了') : '完了を記録しました');
    return;
  }

  project.clearedData[missionId] = { content, timestamp: Date.now(), title: m.title, format: detectedFormat, submittedBy: userId };
  // リーダーチェックありの場合は確認待ち、無しの場合はそのまま完了
  m.status = m.leaderCheck ? 'pending_leader_check' : 'cleared';

  logEvent('mission_completed', {
    tag:      m.tag || (Array.isArray(m.tags) ? m.tags[0] : null),
    format:   detectedFormat,
    priority: m.priority,
  });

  // 送信成功 → ローカルドラフト破棄
  _clearDraft.discard(missionId);

  // leaderCheck 提出時はインフォモーダルを再表示できるようリセット
  if (m.leaderCheck) state._infoModalShownForEvent = null;

  state.save();
  document.getElementById('clear-mission-modal')?.remove();
  state.render();
  window._app?.showToast(m.leaderCheck ? 'リーダーチェック提出完了' : 'ミッション完了');
}

/**
 * 画像ファイル選択を処理する
 * @param {HTMLInputElement} input
 */
export function handleImageSelect(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const chip    = document.getElementById('img-chip');
    const preview = document.getElementById('preview-img');
    if (chip && preview) {
      preview.src = e.target.result;
      preview.dataset.base64 = e.target.result;
      chip.classList.remove('hidden');
    }
    // ドラフト保存
    const overlay = document.getElementById('clear-mission-modal');
    overlay?._snapshot?.();
  };
  reader.readAsDataURL(file);
}

// ===== いいね =====

/**
 * いいねボタンを押す
 * @param {Event} e
 */
export function handleGoodClick(e) {
  if (e) e.stopPropagation();
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (p && !p.hasLiked) {
    logEvent('like_given');
    p.likes = (p.likes || 0) + 1;
    p.hasLiked = true;
    state.save();
    state.render();
  }
}

// ===== 招待機能 =====

/**
 * 招待コードをクリップボードにコピーする
 * @param {string} code
 */
export function copyInviteCode(code) {
  logEvent('invite_code_copied');
  navigator.clipboard.writeText(code)
    .then(() => window._app?.showToast('招待コードをコピーしました！'))
    .catch(() => window._app?.showToast('コピーに失敗しました。直接メモしてください: ' + code, 'error'));
}

/**
 * 招待リンクをシェアする
 * @param {string} code
 */
export function shareInvite(code) {
  const shareData = {
    title: 'イベントチームへの招待',
    text: `一緒にイベントを作りましょう！招待コード: ${code}`,
  };
  try {
    const currentUrl = window.location.href;
    if (currentUrl.startsWith('http')) shareData.url = currentUrl;
  } catch (e) { /* ignore */ }

  if (navigator.share && navigator.canShare?.(shareData)) {
    logEvent('invite_shared');
    navigator.share(shareData).catch(err => {
      if (err.name !== 'AbortError') copyInviteCode(code);
    });
  } else {
    copyInviteCode(code);
  }
}

/**
 * イベントの招待リンク管理モーダル
 * - オーナー：招待リンクの発行・コピー・取り消し、メンバー一覧の閲覧、除名
 * - メンバー：メンバー一覧の閲覧、自分の脱退
 * @param {string} _legacyCode  旧API互換のため受け取るが未使用（projectId経由で動作）
 */
export function showProjectInviteModal(_legacyCode) {
  const project = state.events.find(p => p.id === state.selectedEventId);
  if (!project) return;
  const projectId = project.id;

  // 状態保持用（モーダル単位）
  const ctx = {
    projectId,
    members: [],
    invites: [],
    ownerId: null,
    loading: true,
    error: '',
  };

  const overlay = document.createElement('div');
  overlay.id = 'project-invite-modal';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  const render = () => _renderInviteModal(overlay, ctx);

  // 初期描画
  render();

  // データ取得
  Promise.all([
    api.listMembers(projectId),
    api.listInvites(projectId).catch(() => ({ ok: false })), // メンバーには 403 が返るがエラーにしない
  ]).then(([m, i]) => {
    ctx.loading = false;
    if (m?.ok) { ctx.members = m.members; ctx.ownerId = m.ownerId; }
    else { ctx.error = m?.error || '読み込み失敗'; }
    if (i?.ok) ctx.invites = i.invites || [];
    render();
  });
}

function _renderInviteModal(overlay, ctx) {
  const me = state.currentUser;
  const isOwner = me && ctx.ownerId === me.id;
  const origin  = window.location.origin;

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl relative animate-fadeIn max-h-[90vh] overflow-y-auto">
      <button id="inv-close" class="absolute top-4 right-4 p-2 opacity-40">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="heading-m text-[#484545] mb-5 font-bold">メンバー管理</h2>

      ${ctx.loading ? `<p class="text-[12px] text-[#A7AAAC] font-bold py-8 text-center">読み込み中…</p>` : `

        <!-- メンバー一覧 -->
        <div class="mb-6">
          <p class="text-[11px] text-[#A7AAAC] font-bold mb-3">メンバー（${ctx.members.length}人）</p>
          <div class="space-y-2">
            ${ctx.members.map(m => _renderMemberRow(m, ctx.ownerId, isOwner)).join('')}
          </div>
        </div>

        ${isOwner ? `
          <!-- 招待リンク（オーナーのみ）-->
          <div class="border-t border-[#E1DFDC] pt-5">
            <div class="flex items-center justify-between mb-3">
              <p class="text-[11px] text-[#A7AAAC] font-bold">招待リンク（${ctx.invites.length}件有効）</p>
              <button id="inv-create" class="text-[12px] font-bold text-white bg-[#0CA1E3] px-3 py-1.5 rounded-lg shadow">
                + 新しいリンク
              </button>
            </div>
            ${ctx.invites.length === 0
              ? `<p class="text-[11px] text-[#A7AAAC] font-bold py-4 text-center bg-[#FDFBF8] rounded-xl">招待リンクはありません</p>`
              : `<div class="space-y-2">${ctx.invites.map(inv => _renderInviteRow(inv, origin)).join('')}</div>`
            }
          </div>
        ` : `
          <div class="border-t border-[#E1DFDC] pt-5">
            <p class="text-[11px] text-[#A7AAAC] font-bold mb-3">イベントを脱退</p>
            <button id="inv-leave" class="w-full py-2.5 text-[12px] font-bold text-[#EE3E12] bg-white border border-[#EE3E12] rounded-lg">
              イベントから脱退する
            </button>
          </div>
        `}

      `}
      ${ctx.error ? `<p class="text-[11px] text-[#EE3E12] mt-3 font-bold text-center">${_esc(ctx.error)}</p>` : ''}
    </div>`;

  // イベント結線
  document.getElementById('inv-close')?.addEventListener('click', () => overlay.remove());
  document.getElementById('inv-create')?.addEventListener('click', () => _createInvite(ctx, overlay));
  document.getElementById('inv-leave')?.addEventListener('click',  () => _leaveProject(ctx, overlay));
  overlay.querySelectorAll('[data-revoke]').forEach(el =>
    el.addEventListener('click', () => _revokeInvite(el.dataset.revoke, ctx, overlay))
  );
  overlay.querySelectorAll('[data-copy]').forEach(el =>
    el.addEventListener('click', () => _copyText(el.dataset.copy))
  );
  overlay.querySelectorAll('[data-share]').forEach(el =>
    el.addEventListener('click', () => _shareUrl(el.dataset.share))
  );
  overlay.querySelectorAll('[data-line]').forEach(el =>
    el.addEventListener('click', () => _shareToLine(el.dataset.line))
  );
  overlay.querySelectorAll('[data-remove]').forEach(el =>
    el.addEventListener('click', () => _removeMember(el.dataset.remove, ctx, overlay))
  );
}

function _renderMemberRow(m, ownerId, isOwnerSelf) {
  const isOwner = m.userId === ownerId;
  const isMe    = state.currentUser?.id === m.userId;
  return `
    <div class="flex items-center justify-between bg-[#FDFBF8] rounded-xl px-3 py-2.5">
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-8 h-8 rounded-full bg-[#0CA1E3] flex items-center justify-center text-white font-bold text-[13px]">
          ${_esc((m.username || '?').charAt(0).toUpperCase())}
        </div>
        <div class="min-w-0">
          <p class="text-[13px] font-bold text-[#484545] truncate">${_esc(m.username || '')} ${isMe ? '<span class="text-[10px] text-[#A7AAAC] ml-1">(あなた)</span>' : ''}</p>
          <p class="text-[10px] font-bold ${isOwner ? 'text-[#FFC300]' : 'text-[#A7AAAC]'}">${isOwner ? 'オーナー' : 'メンバー'}</p>
        </div>
      </div>
      ${isOwnerSelf && !isOwner && !isMe ? `
        <button data-remove="${_esc(m.userId)}" class="text-[11px] font-bold text-[#EE3E12] px-2 py-1">除名</button>
      ` : ''}
    </div>`;
}

function _renderInviteRow(inv, origin) {
  const url = `${origin}/invite/${inv.token}`;
  const usedCount = (inv.usedBy || []).length;
  const expDate   = new Date(inv.expiresAt);
  const expStr    = `${expDate.getMonth()+1}/${expDate.getDate()} まで有効`;
  return `
    <div class="bg-[#FDFBF8] rounded-xl p-3">
      <p class="text-[10px] text-[#A7AAAC] font-bold mb-1.5">${_esc(expStr)} ／ 使用済み: ${usedCount}${inv.maxUses ? ` / ${inv.maxUses}` : ''}人</p>
      <div class="bg-white border border-[#E1DFDC] rounded-lg px-2 py-1.5 mb-2 break-all text-[10px] text-[#484545] font-mono">${_esc(url)}</div>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <button data-line="${_esc(url)}"
          class="flex items-center justify-center gap-1 py-2 text-[11px] font-bold text-white bg-[#06C755] rounded-lg active:scale-95 transition-transform">
          <span>LINE で送る</span>
        </button>
        <button data-share="${_esc(url)}"
          class="py-2 text-[11px] font-bold text-white bg-[#0CA1E3] rounded-lg">
          他のアプリで共有
        </button>
      </div>
      <div class="flex gap-2">
        <button data-copy="${_esc(url)}"
          class="flex-1 py-1.5 text-[11px] font-bold text-[#0CA1E3] bg-white border border-[#0CA1E3] rounded-lg">
          コピー
        </button>
        <button data-revoke="${_esc(inv.token)}"
          class="py-1.5 px-3 text-[11px] font-bold text-[#EE3E12] bg-white border border-[#EE3E12] rounded-lg">
          取消
        </button>
      </div>
    </div>`;
}

async function _createInvite(ctx, overlay) {
  const r = await api.createInvite(ctx.projectId, {});
  if (r.ok) {
    logEvent('invite_issued');
    ctx.invites = [r.invite, ...ctx.invites];
    _renderInviteModal(overlay, ctx);
  } else {
    ctx.error = r.error || '招待の作成に失敗しました';
    _renderInviteModal(overlay, ctx);
  }
}

async function _revokeInvite(token, ctx, overlay) {
  const ok = await showConfirmDialog({
    message: 'この招待リンクを取り消しますか？\n（既に参加した人は影響を受けません）',
    confirmLabel: '取り消す',
    cancelLabel: 'キャンセル',
  });
  if (!ok) return;
  const r = await api.revokeInvite(ctx.projectId, token);
  if (r.ok) {
    ctx.invites = ctx.invites.filter(i => i.token !== token);
    _renderInviteModal(overlay, ctx);
  } else {
    ctx.error = r.error || '取り消しに失敗しました';
    _renderInviteModal(overlay, ctx);
  }
}

async function _removeMember(userId, ctx, overlay) {
  const target = ctx.members.find(m => m.userId === userId);
  if (!target) return;
  const ok = await showConfirmDialog({
    message: `${target.username} さんをイベントから除名しますか？`,
    confirmLabel: '除名する',
    cancelLabel: 'キャンセル',
    destructive: true,
  });
  if (!ok) return;
  const r = await api.leaveProject(ctx.projectId, userId);
  if (r.ok) {
    ctx.members = ctx.members.filter(m => m.userId !== userId);
    _renderInviteModal(overlay, ctx);
  } else {
    ctx.error = r.error || '除名に失敗しました';
    _renderInviteModal(overlay, ctx);
  }
}

async function _leaveProject(ctx, overlay) {
  const ok = await showConfirmDialog({
    message: 'このイベントから脱退しますか？\n（再度招待されないと参加できなくなります）',
    confirmLabel: '脱退する',
    cancelLabel: 'キャンセル',
    destructive: true,
  });
  if (!ok) return;
  const me = state.currentUser;
  const r = await api.leaveProject(ctx.projectId, me.id);
  if (r.ok) {
    overlay.remove();
    // HOMEに戻ってリロード
    state.selectedEventId = null;
    await state.loadAfterAuth(true);
    state.setView('HOME');
  } else {
    ctx.error = r.error || '脱退に失敗しました';
    _renderInviteModal(overlay, ctx);
  }
}

function _copyText(text) {
  navigator.clipboard.writeText(text)
    .then(() => _flashToast('コピーしました'))
    .catch(() => window._app?.showToast('コピーに失敗しました: ' + text, 'error'));
}

function _buildInviteText(url) {
  const project = state.events.find(p => p.id === state.selectedEventId);
  const projectName = project?.name || 'イベント';
  const userName = state.currentUser?.username || '';
  return userName
    ? `${userName}が「${projectName}」に招待しています。\n${url}`
    : `「${projectName}」に招待しています。\n${url}`;
}

function _shareToLine(url) {
  const text = _buildInviteText(url);
  // LINE 公式の「テキストとリンクを送る」スキーム
  // モバイル/デスクトップどちらでも開ける https://line.me/R/msg/text/ を使う
  const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  // 新しいタブ/アプリで開く
  window.open(lineUrl, '_blank', 'noopener,noreferrer');
}

function _shareUrl(url) {
  const text = _buildInviteText(url);
  const data = { title: 'イベントへの招待', text, url };
  if (navigator.share && navigator.canShare?.(data)) {
    navigator.share(data).catch(err => { if (err.name !== 'AbortError') _copyText(text); });
  } else {
    // Web Share API 非対応 → 招待文ごとコピー
    _copyText(text);
  }
}

function _flashToast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#484545] text-white px-5 py-3 rounded-full shadow-2xl text-[13px] font-bold z-[300]';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== イベント作成フォーム =====

/**
 * イベントドラフトの入力を更新する
 * @param {'name'|'description'} field
 * @param {string} value
 */
export function updateDraftInfo(field, value) {
  state.draftEvent[field] = value;
  // 各ステップの「次へ」ボタンを ID で個別に活性化判定する
  const step1Btn = document.getElementById('cp-info-next');
  if (step1Btn) {
    const ok = !!state.draftEvent.name;
    step1Btn.disabled = !ok;
    step1Btn.style.opacity = ok ? '1' : '0.5';
  }
  const step2Btn = document.getElementById('cp-dates-next');
  if (step2Btn) {
    const ok = state.draftEvent.dates.length > 0;
    step2Btn.disabled = !ok;
    step2Btn.style.opacity = ok ? '1' : '0.5';
  }
}

/**
 * ドラフトの日付グループを削除する
 * @param {string} jsonGroup - JSON文字列の日付配列
 */
export function removeDraftDateGroup(jsonGroup) {
  const group = JSON.parse(jsonGroup);
  state.draftEvent.dates = state.draftEvent.dates.filter(d => !group.includes(d));
  state.render();
}

// ===== ミッション完了入力のローカルドラフト =====
// 入力途中でモーダルを閉じても、同じユーザーが再度開けば内容が復元される。
// 他ユーザーには共有されない（localStorage はそのブラウザ・そのアカウントだけ）。
// 「完了する」で送信成功した時点で破棄。

const DRAFT_KEY_PREFIX = 'evecre:clearDraft:v1';

/** key 生成（ユーザー × イベント × ミッション）*/
function _draftKey(missionId) {
  const uid = state.currentUser?.id || '_anon';
  const pid = state.selectedEventId || '_';
  return `${DRAFT_KEY_PREFIX}:${uid}:${pid}:${missionId}`;
}

/** ドラフトを保存（debounce で頻繁な書き込みを避ける）*/
let _draftSaveTimer = null;
function _saveClearDraft(missionId, data) {
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(() => {
    try {
      const key = _draftKey(missionId);
      if (data && (data.content || data.checked?.some(Boolean))) {
        localStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() }));
      } else {
        localStorage.removeItem(key);
      }
    } catch (e) {
      // 容量オーバーなどは静かに失敗
      console.warn('[clearDraft] save failed:', e?.message);
    }
  }, 250);
}

/** ドラフトを読込 */
function _loadClearDraft(missionId) {
  try {
    const raw = localStorage.getItem(_draftKey(missionId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

/** ドラフトを破棄（完了時に呼ぶ）*/
function _discardClearDraft(missionId) {
  try { localStorage.removeItem(_draftKey(missionId)); } catch (_) {}
}

// 外部公開（モーダル内ハンドラから利用）
export const _clearDraft = {
  load:    _loadClearDraft,
  save:    _saveClearDraft,
  discard: _discardClearDraft,
};

/**
 * 個別完了ミッションの完了者リストモーダルを開く（全ユーザー閲覧可能）
 */
export function openIndividualClearListModal(missionId) {
  // 既存モーダルを必ず除去してから再生成（ID競合による非表示を防ぐ）
  document.getElementById('indiv-clear-list-modal')?.remove();

  const project = state.events.find(p => p.id === state.selectedEventId);
  const m = project?.missions?.find(x => x.id === missionId);
  if (!project || !m) return;

  const meId = state.currentUser?.id;

  const canMgr = (() => {
    if (!meId) return false;
    if (project.ownerId === meId) return true;
    const mem = (project.members || []).find(x => x.userId === meId);
    if (!mem) return false;
    const roles = Array.isArray(mem.roles) ? mem.roles : (mem.role ? [mem.role] : []);
    return roles.some(rid => {
      const r = (project.roles || []).find(x => x.id === rid);
      return r?.canManage;
    });
  })();

  const assigneeIds = Array.isArray(m.assignees) && m.assignees.length > 0
    ? m.assignees
    : (m.assignee?.type === 'user' ? [m.assignee.userId] : []);
  const hasAssignees = assigneeIds.length > 0;
  const clearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy : [];

  const _fmtContent = (cd) => {
    if (!cd?.content) return '';
    if (cd.format === 'image') return `<img src="${cd.content}" class="w-full max-h-32 object-cover rounded-lg mt-2" loading="lazy">`;
    if (cd.format === 'link') return `<a href="${_esc(cd.content)}" class="text-[11px] text-[#0CA1E3] underline break-all block mt-1">${_esc(cd.content)}</a>`;
    return `<p class="text-[11px] text-[#484545] bg-[#FDFBF8] p-2 rounded-lg whitespace-pre-wrap break-words mt-1">${_esc(cd.content)}</p>`;
  };

  const listIds = hasAssignees ? assigneeIds : clearedBy;
  const rows = listIds.map(uid => {
    const mem = (project.members || []).find(x => x.userId === uid);
    const name = mem?.username || '不明なユーザー';
    const done = clearedBy.includes(uid);
    const cd = project.clearedData?.[missionId + '_u_' + uid];
    return `
      <div class="py-3 border-b border-[#EBE8E5] last:border-0">
        <div class="flex items-center gap-2">
          <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0
            ${done ? 'bg-[#0CA1E3] text-white' : 'bg-[#EBE8E5] text-[#A7AAAC]'}">
            ${done ? '✓' : '–'}
          </span>
          <span class="text-[13px] font-bold text-[#484545] flex-1">${_esc(name)}</span>
          <span class="text-[10px] font-bold ${done ? 'text-[#5b8104]' : 'text-[#A7AAAC]'}">${done ? '完了済み' : '未完了'}</span>
        </div>
        ${(done && !m.noInput) ? _fmtContent(cd) : ''}
      </div>`;
  }).join('');

  const isMeAssigned = !hasAssignees || assigneeIds.includes(meId);
  const meNotDone = isMeAssigned && !clearedBy.includes(meId) && m.status !== 'cleared';
  const descHtml = m.description
    ? `<p class="text-rs text-[#A7AAAC] font-bold whitespace-pre-wrap mb-4">${_esc(m.description)}</p>`
    : '';
  const completeBtn = meNotDone ? `
    <button onclick="window._app.completeMissionFromListModal('${missionId}')"
      class="btn-primary w-full py-3 heading-r font-bold mb-5">完了する</button>` : '';

  const adminBtn = canMgr && m.status !== 'cleared' ? `
    <button onclick="window._app.forceCloseMission('${missionId}')"
      class="w-full py-3 text-[13px] font-bold text-[#A7AAAC] border border-[#D3D6D8] rounded-2xl mt-2 active:opacity-60">
      公開終了する
    </button>` : '';

  const countLine = hasAssignees
    ? `<p class="text-[12px] font-bold text-[#484545] mb-4">完了状況：<span class="text-[#0CA1E3]">${clearedBy.length}</span> / ${assigneeIds.length} 人</p>`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'indiv-clear-list-modal';
  // fixed inset-0 → 背景全体をカバー。上部タップで閉じられる。
  overlay.className = 'fixed inset-0 bg-black/50 z-[150] flex items-end justify-center';
  overlay.innerHTML = `
    <div data-indiv-sheet
      class="bg-white rounded-t-3xl w-full max-w-lg flex flex-col"
      style="max-height:82vh">
      <!-- ドラッグハンドル -->
      <div id="indiv-sheet-handle"
        class="flex-shrink-0 flex flex-col items-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
        <div class="w-10 h-1 bg-[#D3D6D8] rounded-full"></div>
      </div>
      <!-- スクロール領域 -->
      <div class="flex-1 overflow-y-auto px-6 pb-10 pt-2">
        <div class="flex items-center justify-between mb-3">
          <h3 class="heading-m text-[#484545] flex-1 mr-4">${_esc(m.title)}</h3>
          <button onclick="document.getElementById('indiv-clear-list-modal').remove()"
            class="p-2 opacity-40 flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        ${descHtml}
        ${completeBtn}
        ${countLine}
        <div>${rows || '<p class="text-[12px] text-[#A7AAAC] text-center py-4">まだ完了者はいません</p>'}</div>
        ${adminBtn}
      </div>
    </div>`;

  // 上部（オーバーレイ背景）タップで閉じる
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);

  // 下スワイプで閉じる（ドラッグハンドル + シート全体）
  const sheet = overlay.querySelector('[data-indiv-sheet]');
  const handle = overlay.querySelector('#indiv-sheet-handle');
  let _swStartY = 0;
  let _swActive = false;

  const onTouchStart = (e) => {
    _swStartY = e.touches[0].clientY;
    _swActive = true;
    sheet.style.transition = 'none';
  };
  const onTouchMove = (e) => {
    if (!_swActive) return;
    const dy = e.touches[0].clientY - _swStartY;
    if (dy > 0) {
      sheet.style.transform = `translateY(${dy}px)`;
    }
  };
  const onTouchEnd = (e) => {
    if (!_swActive) return;
    _swActive = false;
    const dy = e.changedTouches[0].clientY - _swStartY;
    sheet.style.transition = 'transform 0.25s ease';
    if (dy > 60) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(() => overlay.remove(), 240);
    } else {
      sheet.style.transform = 'translateY(0)';
    }
  };

  handle.addEventListener('touchstart', onTouchStart, { passive: true });
  handle.addEventListener('touchmove', onTouchMove, { passive: true });
  handle.addEventListener('touchend', onTouchEnd, { passive: true });
}
