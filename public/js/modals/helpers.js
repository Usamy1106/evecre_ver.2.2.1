// ===== ヘルパーモーダル =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { MISSION_DESCRIPTIONS } from '../constants.js';

// ===== アーカイブ直接編集 =====

/**
 * アーカイブアイテムを編集する
 * @param {'title'|'summary'|'url'|'venue'|'period'|'image'} type
 */
export function editArchiveItem(type) {
  const p = state.projects.find(x => x.id === state.selectedProjectId);
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
    missionId   = 'period-temp';
    currentVal  = p.clearedData['period-temp']?.content
                  || (p.dates.length > 0 ? `${p.dates[0]} 〜 ${p.dates[p.dates.length - 1]}` : '');
    titleLabel  = '期間';
  } else if (type === 'image') {
    const m     = p.missions.find(x => x.title === 'メインビジュアルを作成');
    openClearMissionModal(m?.id || 'image-temp', 'image');
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
 * ミッション完了入力モーダルを開く
 * @param {string} missionId
 * @param {string|null} overrideFormat
 */
export function openClearMissionModal(missionId, overrideFormat = null) {
  const project = state.projects.find(p => p.id === state.selectedProjectId);
  const m       = project?.missions.find(x => x.id === missionId);
  const title   = m ? m.title : 'ミッション';
  const format  = overrideFormat || (m ? m.clearFormat : 'text');
  const desc    = MISSION_DESCRIPTIONS[missionId]
                  || (m?.originProposalId ? MISSION_DESCRIPTIONS[m.originProposalId] : 'ミッションを完了してプロジェクトを進めましょう。');
  const checklist = Array.isArray(m?.checklist) ? m.checklist : [];

  let inputHtml;
  if (format === 'text') {
    inputHtml = `<textarea id="clear-input" class="w-full h-40 p-4 rounded-2xl bg-[#EBE8E5] focus:outline-none text-r"
      placeholder="内容を入力してください"></textarea>`;
  } else if (format === 'image') {
    inputHtml = `
      <div class="w-full aspect-video bg-[#EBE8E5] rounded-2xl flex flex-col items-center justify-center
        border-2 border-dashed border-[#A7AAAC] cursor-pointer" onclick="document.getElementById('file-input').click()">
        <img id="preview-img" class="hidden w-full h-full object-cover rounded-2xl">
        <div id="upload-placeholder" class="text-center">
          <img src="/images/icon/icon-image.svg" class="w-12 h-12 mx-auto mb-2 opacity-40">
          <p class="text-rs text-[#A7AAAC] font-bold">画像をアップロード</p>
        </div>
        <input type="file" id="file-input" class="hidden" accept="image/*" onchange="window._app.handleImageSelect(this)">
      </div>`;
  } else {
    inputHtml = `<input type="url" id="clear-input" class="w-full p-4 rounded-2xl bg-[#EBE8E5] focus:outline-none text-r"
      placeholder="https://...">`;
  }

  // チェック項目 UI
  const checklistHtml = checklist.length === 0 ? '' : `
    <div class="mt-5 mb-2">
      <p class="text-rs text-[#484545] font-bold mb-2">チェック項目</p>
      <div class="space-y-2 bg-[#FDFBF8] rounded-2xl border border-[#E1DFDC] p-3">
        ${checklist.map((item, i) => `
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" data-clear-checklist="${i}" class="mt-0.5 w-4 h-4 accent-[#0CA1E3]">
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
      <p class="text-rs text-[#A7AAAC] mb-6 font-bold whitespace-pre-wrap">${desc}</p>
      ${inputHtml}
      ${checklistHtml}
      <button onclick="window._app.submitMissionClear('${missionId}')"
        class="btn-primary w-full py-4 mt-8 heading-r font-bold">完了する</button>
    </div>`;
  document.body.appendChild(overlay);

  // === ドラフト復元 + 入力イベントで自動保存 ===
  const draft = _clearDraft.load(missionId);

  // テキスト/URL の復元
  const inputEl = document.getElementById('clear-input');
  if (inputEl && draft?.content && format !== 'image') {
    inputEl.value = draft.content;
  }

  // 画像の復元
  if (format === 'image' && draft?.content && draft.content.startsWith('data:image')) {
    const preview = document.getElementById('preview-img');
    const placeholder = document.getElementById('upload-placeholder');
    if (preview && placeholder) {
      preview.src = draft.content;
      preview.dataset.base64 = draft.content;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    }
  }

  // チェック項目の復元
  if (Array.isArray(draft?.checked)) {
    document.querySelectorAll('[data-clear-checklist]').forEach(cb => {
      const idx = parseInt(cb.dataset.clearChecklist, 10);
      if (draft.checked[idx]) cb.checked = true;
    });
  }

  // ドラフトを集めて保存
  const snapshot = () => {
    const inputElNow = document.getElementById('clear-input');
    const previewNow = document.getElementById('preview-img');
    let content = '';
    if (format === 'image') {
      content = previewNow?.dataset?.base64 || '';
    } else if (inputElNow) {
      content = inputElNow.value;
    }
    const checked = Array.from(document.querySelectorAll('[data-clear-checklist]'))
      .map(cb => !!cb.checked);
    _clearDraft.save(missionId, { content, format, checked });
  };

  // テキスト・URL 入力のリアルタイム保存
  inputEl?.addEventListener('input', snapshot);
  // チェックボックスのリアルタイム保存
  document.querySelectorAll('[data-clear-checklist]').forEach(cb => {
    cb.addEventListener('change', snapshot);
  });
  // 画像は handleImageSelect 後にもスナップショット
  overlay.dataset.snapshotTriggered = '1';
  overlay._snapshot = snapshot; // 外部からも呼び出せるように
}

/**
 * ミッション完了を確定する
 * @param {string} missionId
 */
export function submitMissionClear(missionId) {
  const project = state.projects.find(p => p.id === state.selectedProjectId);
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

  let content = '';
  if (m.clearFormat === 'image') {
    const preview = document.getElementById('preview-img');
    content = preview ? preview.dataset.base64 : '';
  } else {
    const input = document.getElementById('clear-input');
    content = input ? input.value : '';
  }

  if (!content) return alert('入力を完了させてください');

  project.clearedData[missionId] = { content, timestamp: Date.now(), title: m.title, format: m.clearFormat };
  // リーダーチェックありの場合は確認待ち、無しの場合はそのまま完了
  m.status = m.leaderCheck ? 'pending_leader_check' : 'cleared';

  // 送信成功 → ローカルドラフト破棄
  _clearDraft.discard(missionId);

  state.save();
  document.getElementById('clear-mission-modal')?.remove();
  state.render();
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
    const preview     = document.getElementById('preview-img');
    const placeholder = document.getElementById('upload-placeholder');
    if (preview && placeholder) {
      preview.src = e.target.result;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');
      preview.dataset.base64 = e.target.result;
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
  const p = state.projects.find(x => x.id === state.selectedProjectId);
  if (p && !p.hasLiked) {
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
  navigator.clipboard.writeText(code)
    .then(() => alert('招待コードをコピーしました！'))
    .catch(() => alert('コピーに失敗しました。直接メモしてください: ' + code));
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
    navigator.share(shareData).catch(err => {
      if (err.name !== 'AbortError') copyInviteCode(code);
    });
  } else {
    copyInviteCode(code);
  }
}

/**
 * プロジェクトの招待リンク管理モーダル
 * - オーナー：招待リンクの発行・コピー・取り消し、メンバー一覧の閲覧、除名
 * - メンバー：メンバー一覧の閲覧、自分の脱退
 * @param {string} _legacyCode  旧API互換のため受け取るが未使用（projectId経由で動作）
 */
export function showProjectInviteModal(_legacyCode) {
  const project = state.projects.find(p => p.id === state.selectedProjectId);
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
            <p class="text-[11px] text-[#A7AAAC] font-bold mb-3">プロジェクトを脱退</p>
            <button id="inv-leave" class="w-full py-2.5 text-[12px] font-bold text-[#EE3E12] bg-white border border-[#EE3E12] rounded-lg">
              プロジェクトから脱退する
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
    ctx.invites = [r.invite, ...ctx.invites];
    _renderInviteModal(overlay, ctx);
  } else {
    ctx.error = r.error || '招待の作成に失敗しました';
    _renderInviteModal(overlay, ctx);
  }
}

async function _revokeInvite(token, ctx, overlay) {
  if (!confirm('この招待リンクを取り消しますか？\n（既に参加した人は影響を受けません）')) return;
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
  if (!confirm(`${target.username} さんをプロジェクトから除名しますか？`)) return;
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
  if (!confirm('このプロジェクトから脱退しますか？\n（再度招待されないと参加できなくなります）')) return;
  const me = state.currentUser;
  const r = await api.leaveProject(ctx.projectId, me.id);
  if (r.ok) {
    overlay.remove();
    // HOMEに戻ってリロード
    state.selectedProjectId = null;
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
    .catch(() => alert('コピーに失敗しました: ' + text));
}

function _buildInviteText(url) {
  const project = state.projects.find(p => p.id === state.selectedProjectId);
  const projectName = project?.name || 'プロジェクト';
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
  const data = { title: 'プロジェクトへの招待', text, url };
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

// ===== プロジェクト作成フォーム =====

/**
 * プロジェクトドラフトの入力を更新する
 * @param {'name'|'description'} field
 * @param {string} value
 */
export function updateDraftInfo(field, value) {
  state.draftProject[field] = value;
  // 各ステップの「次へ」ボタンを ID で個別に活性化判定する
  const step1Btn = document.getElementById('cp-info-next');
  if (step1Btn) {
    const ok = !!state.draftProject.name;
    step1Btn.disabled = !ok;
    step1Btn.style.opacity = ok ? '1' : '0.5';
  }
  const step2Btn = document.getElementById('cp-dates-next');
  if (step2Btn) {
    const ok = state.draftProject.dates.length > 0;
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
  state.draftProject.dates = state.draftProject.dates.filter(d => !group.includes(d));
  state.render();
}

// ===== ミッション完了入力のローカルドラフト =====
// 入力途中でモーダルを閉じても、同じユーザーが再度開けば内容が復元される。
// 他ユーザーには共有されない（localStorage はそのブラウザ・そのアカウントだけ）。
// 「完了する」で送信成功した時点で破棄。

const DRAFT_KEY_PREFIX = 'evecre:clearDraft:v1';

/** key 生成（ユーザー × プロジェクト × ミッション）*/
function _draftKey(missionId) {
  const uid = state.currentUser?.id || '_anon';
  const pid = state.selectedProjectId || '_';
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
