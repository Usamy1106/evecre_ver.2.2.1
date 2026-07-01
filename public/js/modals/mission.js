// ===== ミッションモーダル =====
import { state } from '../state.js';
import { api } from '../api.js';
import { LABEL_CONFIG, MISSION_DESCRIPTIONS } from '../constants.js';
import { Components } from '../components.js';
import { logEvent } from '../logger.js';

/**
 * ミッション作成/編集モーダルを開く
 * @param {string|null} missionId - 編集時はID、新規作成時はnull
 */
export function openMissionModal(missionId = null, prefill = null) {
  // 一般ユーザーは編集禁止
  if (!state.canManageCurrentEvent()) {
    window._app?.showToast('このイベントを編集する権限がありません', 'error');
    return;
  }
  state.editingMissionId = missionId;

  const project = state.events.find(p => p.id === state.selectedEventId);
  if (missionId && project) {
    const m = project.missions.find(x => x.id === missionId);
    const labels = Array.isArray(m.tags) && m.tags.length > 0
      ? [...m.tags]
      : (m.tag ? [m.tag] : []);
    state.draftMission = {
      ...m,
      dates: [...(m.dates || [])],
      labels,
      assignee: m.assignee || null,
      assignees: Array.isArray(m.assignees) ? [...m.assignees] : [],
      checklist: Array.isArray(m.checklist) ? [...m.checklist] : [],
      description: m.description || '',
      selfClaim: !!m.selfClaim,
      leaderCheck: !!m.leaderCheck,
      claimMode: m.claimMode || 'selection',
      claimDeadline: m.claimDeadline || null,
      announce: !!m.announce,
      announceText: m.announceText || '',
      noInput: !!m.noInput,
      individualClear: !!m.individualClear,
    };
  } else {
    state.draftMission = {
      title: '', labels: [], priority: 0, dates: [],
      note: '', assignee: null, assignees: [], checklist: [],
      description: '', selfClaim: false, leaderCheck: false,
      claimMode: 'selection', claimDeadline: null,
      announce: false, announceText: '',
      noInput: false,
      individualClear: false,
      // 提案からの事前入力（title/labels/description/priority と採用元マーカー）
      ...(prefill || {}),
    };
  }

  state.missionModalTab = 'BASIC';

  // 担当者選択用にメンバー/ロールをロード（キャッシュ）
  if (project && (!state.assigneeCache || state.assigneeCache.projectId !== project.id)) {
    state.assigneeCache = { projectId: project.id, members: [], roles: [], loading: true };
    api.listMembers(project.id).then(r => {
      if (r?.ok) {
        state.assigneeCache.members = r.members || [];
        state.assigneeCache.roles   = r.roles   || [];
      }
      state.assigneeCache.loading = false;
      // モーダルが開いていれば再描画（モーダル本体の存在で判定）
      if (document.getElementById('mission-modal-content')) {
        renderMissionModalContent();
      }
    }).catch((e) => {
      console.error('[assignee] listMembers 失敗:', e);
      state.assigneeCache.loading = false;
      if (document.getElementById('mission-modal-content')) {
        renderMissionModalContent();
      }
    });
  }

  let overlay = document.getElementById('mission-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'mission-overlay';
  // フルスクリーン表示。背景クリックで閉じない（明示的な閉じるボタンで）
  overlay.className = 'fixed inset-0 z-[100] bg-[#FDFBF8]';
  overlay.innerHTML = `
    <div id="mission-panel"
      class="w-full h-full flex flex-col bg-[#FDFBF8] transition-transform transform translate-y-full">
      <!-- ヘッダー：閉じるボタン + タイトル -->
      <header class="flex items-center justify-between px-5 py-4 border-b border-[#E1DFDC] bg-[#FDFBF8] flex-shrink-0">
        <button onclick="window._app.closeMissionModal()" class="w-9 h-9 rounded-full bg-black/5 flex items-center justify-center active:scale-95">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <h2 class="text-[15px] font-bold text-[#484545]" id="mission-modal-title"></h2>
        <div class="w-9"></div>
      </header>
      <div id="mission-modal-content" class="flex-1 overflow-y-auto px-6 py-5"></div>
    </div>`;
  document.body.appendChild(overlay);

  // スライドアップアニメーション
  requestAnimationFrame(() => {
    document.getElementById('mission-panel')?.classList.remove('translate-y-full');
  });
  renderMissionModalContent();
}

/**
 * ミッションモーダルを閉じる
 */
export function closeMissionModal() {
  const panel = document.getElementById('mission-panel');
  if (panel) panel.classList.add('translate-y-full');
  setTimeout(() => {
    document.getElementById('mission-overlay')?.remove();
  }, 300);
}

/**
 * ミッションを削除する
 * @param {Event} e
 */
export function deleteMission(e) {
  if (e) e.stopPropagation();
  if (!state.editingMissionId) return;

  const project = state.events.find(p => p.id === state.selectedEventId);
  const m = project?.missions.find(x => x.id === state.editingMissionId);

  if (m && !m.isDeletable) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 page-transition';
    overlay.onclick = (e2) => { if (e2.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
        <h3 class="heading-m text-[#484545] mb-3 font-bold">削除できません</h3>
        <p class="text-rs text-[#484545] font-medium mb-8 leading-relaxed">初期フローのミッションは削除できません。</p>
        <button class="w-full py-3 heading-rs font-bold btn-secondary">閉じる</button>
      </div>`;
    overlay.querySelector('button').onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 page-transition';
  overlay.onclick = (e2) => { if (e2.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
      <h3 class="heading-m text-[#484545] mb-3 font-bold">ミッションを削除しますか</h3>
      <p class="text-rs text-[#484545] font-medium mb-8 leading-relaxed">一度削除すると元に戻せません。</p>
      <div class="flex gap-3">
        <button data-action="cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">戻る</button>
        <button data-action="confirm"
          class="flex-1 py-3 heading-rs font-bold text-white rounded-xl shadow-md"
          style="background-color: #EE3E12;">削除</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove();
  overlay.querySelector('[data-action="confirm"]').onclick = () => {
    overlay.remove();
    logEvent('mission_deleted', { tag: m?.tag });
    project.missions = project.missions.filter(x => x.id !== state.editingMissionId);
    state.save();
    closeMissionModal();
    state.render();
  };
}

/**
 * ミッションモーダルの内容を（再）レンダリングする
 */
export function renderMissionModalContent() {
  const container = document.getElementById('mission-modal-content');
  const titleEl   = document.getElementById('mission-modal-title');
  if (!container || !titleEl) return;

  const isEdit  = state.editingMissionId !== null;
  const isBasic = state.missionModalTab === 'BASIC';
  titleEl.innerText = isEdit ? 'ミッションを編集' : '新規ミッションを作成';

  const _sd = state.draftMission.dates;
  const dateDisplay = _sd.length === 0
    ? 'カレンダーから設定する'
    : _sd.length === 1
      ? `<div class="bg-[#EBE8E5] px-3 py-1.5 rounded-lg text-[#484545] font-bold text-rs">${_sd[0]}</div>`
      : `<div class="bg-[#EBE8E5] px-3 py-1.5 rounded-lg text-[#484545] font-bold text-rs">${_sd[0]} 〜 ${_sd[_sd.length - 1]}</div>`;

  if (isBasic) {
    container.innerHTML = _renderBasicTab(isEdit, dateDisplay);
  } else {
    container.innerHTML = _renderDetailTab(isEdit);
  }
}

function _renderBasicTab(isEdit, dateDisplay) {
  // 全タグ（組み込み4種類 + イベントのカスタムタグ）
  const project = state.events.find(p => p.id === state.selectedEventId);
  const customTags = Array.isArray(project?.customTags) ? project.customTags : [];

  const builtInTags = Object.keys(LABEL_CONFIG).map(name => ({
    name,
    color: LABEL_CONFIG[name].color,
    builtIn: true,
  }));
  const allTags = [...builtInTags, ...customTags.map(t => ({ ...t, builtIn: false }))];

  const labelButtons = allTags.map(t => {
    const sel = (state.draftMission.labels || []).includes(t.name);
    // 色からスタイル生成（インライン）
    const style = sel
      ? `border-color: ${t.color}; color: ${t.color}; background-color: ${t.color}1A;`
      : `border-color: #D3D6D8; color: #A7AAAC;`;
    return `<button onclick="window._app.toggleMissionLabel('${_esc(t.name)}')"
      class="px-4 py-1 rounded-full border text-[12px] font-bold transition-all"
      style="${style}">${_esc(t.name)}</button>`;
  }).join('');

  const addTagBtn = `
    <button onclick="window._app.openTagCreator()"
      class="px-3 py-1 rounded-full border border-dashed border-[#A7AAAC] text-[12px] font-bold text-[#A7AAAC] active:opacity-50">
      + 新しいタグ
    </button>`;

  const starButtons = [1, 2, 3, 4, 5].map(v =>
    `<button onclick="window._app.setMissionPriority(${v})" class="p-0.5">
      <svg width="32" height="32" viewBox="0 0 24 24"
        fill="${state.draftMission.priority >= v ? '#FFC300' : 'none'}"
        stroke="${state.draftMission.priority >= v ? '#FFC300' : '#E1DFDC'}"
        stroke-width="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    </button>`).join('');


  return `
    <div class="flex flex-col h-full">
      <div class="flex justify-center gap-10 mb-6">
        <button onclick="window._app.setMissionTab('BASIC')"
          class="text-[14px] font-bold pb-1 border-b-2 border-[#0CA1E3] text-[#0CA1E3]">基本設定</button>
        <button onclick="window._app.setMissionTab('DETAIL')"
          class="text-[14px] font-bold pb-1 border-b-2 border-transparent text-[#A7AAAC]">詳細設定</button>
      </div>
      <div class="space-y-4 flex-1">
        <div>
          <label class="heading-rs block mb-1 text-[#484545]">ミッション</label>
          <input type="text" id="mission-title-input" placeholder="ミッションを入力"
            value="${state.draftMission.title}"
            oninput="state.draftMission.title=this.value; this.style.borderColor=''"
            class="input-field w-full px-4 py-3 focus:outline-none border-2 border-transparent transition-colors">
          <p id="error-title" class="hidden text-[10px] font-bold mt-1" style="color: #e8383d;">※ミッション名は入力必須です</p>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-1">
            <label class="heading-rs text-[#484545]">ラベル</label>
            <span class="text-[10px] text-[#A7AAAC] font-bold">（複数選択可）</span>
          </div>
          <div class="flex gap-2 flex-wrap">${labelButtons}${addTagBtn}</div>
        </div>
        <div>
          <label class="heading-rs block mb-1 text-[#484545]">優先度</label>
          <div class="flex gap-1">${starButtons}</div>
        </div>
        <div>
          <label class="heading-rs block mb-1 text-[#484545]">担当者</label>
          ${_renderAssigneeSelect()}
        </div>
        <div>
          <label class="heading-rs block mb-1 text-[#484545]">スケジュール</label>
          <div class="flex items-center gap-2 mb-2 cursor-pointer" onclick="window._app.openCalendarModal('mission')">
            <img src="/images/icon/icon-Calender.svg" class="w-4 h-4 opacity-40">
            <span class="text-[12px] text-[#A7AAAC] font-bold">${dateDisplay}</span>
          </div>
        </div>
      </div>
      <button onclick="window._app.createOrUpdateMission()"
        class="btn-primary w-full py-4 heading-r font-bold mt-4 shadow-lg shadow-blue-200">
        ${isEdit ? '保存' : '作成'}
      </button>
    </div>`;
}

function _renderDetailTab(isEdit) {
  const canDelete = isEdit && state.draftMission.isDeletable !== false;
  const checklist = Array.isArray(state.draftMission.checklist) ? state.draftMission.checklist : [];
  const description = String(state.draftMission.description || '');
  const selfClaim = !!state.draftMission.selfClaim;
  const claimMode = state.draftMission.claimMode || 'selection';
  const claimDeadline = state.draftMission.claimDeadline || null;
  const leaderCheck = !!state.draftMission.leaderCheck;
  const announce = !!state.draftMission.announce;
  const noInput = !!state.draftMission.noInput;
  const individualClear = !!state.draftMission.individualClear;

  // 期限入力用：タイムスタンプ → datetime-local 形式
  const _toLocalDt = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // 申告期限の表示文字列
  const _fmtDeadlineDisplay = (ts) => {
    if (!ts) return null;
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()}（${['日','月','火','水','木','金','土'][d.getDay()]}）`;
  };
  const deadlineDisplay = _fmtDeadlineDisplay(claimDeadline);

  return `
    <div class="flex flex-col h-full">
      <div class="flex justify-center gap-10 mb-6">
        <button onclick="window._app.setMissionTab('BASIC')"
          class="text-[14px] font-bold pb-1 border-b-2 border-transparent text-[#A7AAAC]">基本設定</button>
        <button onclick="window._app.setMissionTab('DETAIL')"
          class="text-[14px] font-bold pb-1 border-b-2 border-[#9EDF05] text-[#9EDF05]">詳細設定</button>
      </div>
      <div class="space-y-6 flex-1">

        <!-- ミッションの説明 -->
        <div>
          <label class="heading-rs block mb-2 text-[#484545] font-bold">ミッションの説明</label>
          <textarea id="mission-desc-input" rows="4"
            placeholder="このミッションの目的・進め方など"
            oninput="state.draftMission.description=this.value"
            class="input-field w-full px-3 py-2.5 text-[13px] focus:outline-none resize-none">${_esc(description)}</textarea>
        </div>

        <!-- ワンタップ完了 -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="heading-rs text-[#484545] font-bold">ワンタップ完了</label>
            <button onclick="window._app.toggleMissionNoInput()" type="button"
              class="relative w-12 h-7 rounded-full transition-colors ${noInput ? 'bg-[#0CA1E3]' : 'bg-[#D3D6D8]'}">
              <span class="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${noInput ? 'translate-x-5' : ''}"></span>
            </button>
          </div>
          <p class="text-[11px] text-[#A7AAAC] leading-relaxed" style="padding-right: 5em;">テキスト・画像の入力欄はなく、完了ボタンのみで即完了するミッションになります。</p>
        </div>

        <!-- 個別完了 -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="heading-rs text-[#484545] font-bold">個別完了</label>
            <button onclick="window._app.toggleMissionIndividualClear()" type="button"
              class="relative w-12 h-7 rounded-full transition-colors ${individualClear ? 'bg-[#0CA1E3]' : 'bg-[#D3D6D8]'}">
              <span class="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${individualClear ? 'translate-x-5' : ''}"></span>
            </button>
          </div>
          <p class="text-[11px] text-[#A7AAAC] leading-relaxed" style="padding-right: 5em;">ユーザーごとに個別に回答・完了できるようになります。</p>
        </div>

        <!-- アナウンス -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="heading-rs text-[#484545] font-bold">アナウンス</label>
            <button onclick="window._app.toggleMissionAnnounce()" type="button"
              class="relative w-12 h-7 rounded-full transition-colors ${announce ? 'bg-[#0CA1E3]' : 'bg-[#D3D6D8]'}">
              <span class="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${announce ? 'translate-x-5' : ''}"></span>
            </button>
          </div>
          <p class="text-[11px] text-[#A7AAAC] leading-relaxed" style="padding-right: 5em;">担当者（無割当の場合は全員）のメインボード上部にアナウンスカードで表示します。</p>
        </div>

        <!-- リーダーによるチェック -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="heading-rs text-[#484545] font-bold">リーダーによるチェック</label>
            <button onclick="window._app.toggleMissionLeaderCheck()" type="button"
              class="relative w-12 h-7 rounded-full transition-colors ${leaderCheck ? 'bg-[#0CA1E3]' : 'bg-[#D3D6D8]'}">
              <span class="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${leaderCheck ? 'translate-x-5' : ''}"></span>
            </button>
          </div>
          <p class="text-[11px] text-[#A7AAAC] leading-relaxed" style="padding-right: 5em;">完了後すぐにはアーカイブされず、リーダーの確認待ちになります。</p>
        </div>

        <!-- 担当の申告制 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="heading-rs text-[#484545] font-bold">担当の申告制</label>
            <button onclick="window._app.toggleMissionSelfClaim()" type="button"
              class="relative w-12 h-7 rounded-full transition-colors ${selfClaim ? 'bg-[#0CA1E3]' : 'bg-[#D3D6D8]'}">
              <span class="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${selfClaim ? 'translate-x-5' : ''}"></span>
            </button>
          </div>

          <p class="text-[11px] text-[#A7AAAC] mb-2" style="padding-right: 5em;">メンバーが担当申告し、管理者が担当者を選定する形式になります。</p>
          ${selfClaim ? `
            <!-- 応募期限（カレンダーUIで設定） -->
            <div class="mt-1">
              <label class="text-[12px] text-[#484545] font-bold block mb-2">応募期限（任意）</label>
              <div class="flex items-center gap-2 cursor-pointer" onclick="window._app.openCalendarModal('claimDeadline')">
                <img src="/images/icon/icon-Calender.svg" class="w-4 h-4 opacity-40">
                ${deadlineDisplay
                  ? `<span class="text-[12px] font-bold text-[#484545]">${deadlineDisplay} 23:59 まで</span>`
                  : `<span class="text-[12px] font-bold text-[#A7AAAC]">カレンダーから設定する</span>`}
              </div>
              ${deadlineDisplay ? `
                <button onclick="window._app.setMissionClaimDeadline('')" type="button"
                  class="text-[10px] text-[#A7AAAC] underline mt-1">期限をクリア</button>` : ''}
            </div>
          ` : ''}
        </div>

        <!-- チェック項目 -->
        <div>
          <label class="heading-rs block mb-2 text-[#484545] font-bold">チェック項目</label>
          <p class="text-[11px] text-[#A7AAAC] mb-3" style="padding-right: 5em;">完了時にチェックしないと提出できません</p>
          ${checklist.length === 0 ? `
            <button onclick="window._app.addChecklistItem()"
              class="w-full text-[12px] text-[#A7AAAC] font-bold py-3 bg-[#FDFBF8] rounded-xl border border-dashed border-[#D3D6D8] active:opacity-50">
              チェック項目を追加
            </button>
          ` : `
            <div class="space-y-2">
              ${checklist.map((item, i) => `
                <div class="flex items-center gap-2">
                  <input type="text" data-cl-input="${i}" value="${_esc(item)}"
                    oninput="window._app.updateChecklistItem(${i}, this.value)"
                    placeholder="例：〇〇はできているか"
                    class="input-field flex-1 px-3 py-2 text-[13px] focus:outline-none">
                  <button onclick="window._app.removeChecklistItem(${i})"
                    class="w-9 h-9 rounded-full bg-[#EBE8E5] flex items-center justify-center active:scale-95">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>`).join('')}
            </div>
            <button onclick="window._app.addChecklistItem()"
              class="mt-2 text-[12px] text-[#0CA1E3] font-bold px-3 py-1.5 active:opacity-50">+ 追加</button>
          `}
        </div>

        ${canDelete ? `
          <button onclick="window._app.deleteMission(event)"
            class="w-full flex items-center justify-between p-4 bg-[#FFEEEA] text-[#EE3E12] rounded-2xl border border-[#EE3E12]/20 active:scale-95 transition-transform">
            <span class="font-bold">このミッションを削除する</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>` : ''}
      </div>
      <button onclick="window._app.createOrUpdateMission()"
        class="btn-primary w-full py-4 heading-r font-bold mt-4 shadow-lg shadow-blue-200">
        ${isEdit ? '保存' : '作成'}
      </button>
    </div>`;
}

/**
 * 提案をミッションとして追加する
 * @param {string} proposalId
 */
// 提案カードのタップ：即時追加ではなく、提案内容を事前入力したミッション作成シートを開く。
// 実際の作成（採用）は createOrUpdateMission で行い、そのとき採用元の提案を消す。
// AI提案の description はそのままミッションの説明として引き継ぐ。
export function addProposalToMission(proposalId) {
  const project  = state.events.find(p => p.id === state.selectedEventId);
  const proposal = project?.proposals.find(x => x.id === proposalId);
  if (!proposal) return;

  logEvent('proposal_opened', { tag: proposal.tag, proposalId: proposal.id });
  openMissionModal(null, {
    title:       proposal.title || '',
    labels:      proposal.tag ? [proposal.tag] : [],
    // 採用後の説明文は「提案のヒント（ヘルプ）」と同じ文をそのまま引き継ぐ
    description: _proposalHelpText(proposal),
    priority:    proposal.priority || 0,
    // 採用元マーカー（createOrUpdateMission で originProposalId / clearFormat に反映し提案を削除）
    _fromProposalId:  proposal.id,
    _fromProposalFmt: proposal.format || 'text',
  });
}

/**
 * 提案のヒント（ヘルプ）に表示する説明文を求める。
 * 採用時の prefill（addProposalToMission）と表示（showProposalHelp）で
 * 同じ文になるよう、フォールバック連鎖をここに一元化している。
 * @param {object} proposal  提案オブジェクト（id / description を持つ）
 * @returns {string}
 */
function _proposalHelpText(proposal) {
  return proposal?.description
    || MISSION_DESCRIPTIONS[proposal?.id]
    || 'ミッションを完了してイベントを進めましょう。';
}

/**
 * 提案のヒントモーダルを表示する
 * @param {Event} e
 * @param {string} proposalId
 */
export function showProposalHelp(e, proposalId) {
  e.stopPropagation();
  logEvent('proposal_help_viewed', { proposalId });
  // proposal オブジェクト自身が description を持っていればそれを優先
  const project  = state.events.find(p => p.id === state.selectedEventId);
  const proposal = project?.proposals?.find(pr => pr.id === proposalId);
  const desc = _proposalHelpText(proposal);

  const overlay = document.createElement('div');
  overlay.id = 'help-modal';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6 page-transition';
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-sm:w-[90%] max-w-sm p-8 shadow-2xl relative animate-fadeIn">
      <button onclick="document.getElementById('help-modal').remove()" class="absolute top-4 right-4 p-2 opacity-40">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="flex items-center gap-3 mb-4">
        <img src="/images/icon/icon-Help.svg" class="w-6 h-6">
        <h3 class="heading-m text-[#484545]">提案のヒント</h3>
      </div>
      <div class="bg-[#FDFBF8] p-5 rounded-2xl border border-[#D3D6D8]">
        <p class="text-rs text-[#484545] font-bold leading-relaxed whitespace-pre-wrap">${desc}</p>
      </div>
      <button onclick="document.getElementById('help-modal').remove()"
        class="btn-primary w-full py-4 mt-8 heading-r font-bold">わかった</button>
    </div>`;
  document.body.appendChild(overlay);
}

/**
 * ミッションカードの3点メニューを表示/非表示
 * @param {Event} e
 * @param {string} missionId
 */
// 座標 (x,y) 付近に「編集 / 削除」コンテキストメニューを表示する。
// 長押し（カレンダー/ガント/メインボード）とミートボール ⋮ の両方から使う。
// z-index はカレンダーシート（z-200）より上に出すため高めにする。
export function openMissionMenuAt(missionId, x, y) {
  document.getElementById('mission-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'mission-menu';
  menu.dataset.mid = missionId;
  menu.className = 'fixed bg-white border border-[#D3D6D8] rounded-xl shadow-xl z-[250] overflow-hidden min-w-[120px] animate-fadeIn';
  menu.style.visibility = 'hidden';
  menu.innerHTML = `
    <button id="mm-edit"
      class="w-full text-left px-4 py-3 active:bg-[#FDFBF8] text-rs font-bold border-b border-[#EBE8E5]">編集</button>
    <button id="mm-delete"
      class="w-full text-left px-4 py-3 active:bg-[#FDFBF8] text-rs font-bold text-[#EE3E12]">削除</button>`;
  document.body.appendChild(menu);

  // 画面内にクランプして配置
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth  - mw - 8))}px`;
  menu.style.top  = `${Math.max(8, Math.min(y, window.innerHeight - mh - 8))}px`;
  menu.style.visibility = 'visible';

  menu.querySelector('#mm-edit').onclick = (ev) => {
    ev.stopPropagation();
    menu.remove();
    openMissionModal(missionId);
  };
  menu.querySelector('#mm-delete').onclick = (ev) => {
    ev.stopPropagation();
    menu.remove();
    _openMissionDeleteConfirm(missionId);
  };

  // 外側タップで閉じる（bubble。長押し直後の抑止済みクリックでは閉じない）
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 10);
}

export function toggleMissionMenu(e, missionId) {
  e.stopPropagation();
  const existingMenu = document.getElementById('mission-menu');
  if (existingMenu) {
    const same = existingMenu.dataset.mid === missionId;
    existingMenu.remove();
    if (same) return;
  }
  // currentTarget が null になるモバイル Safari 対策：e.target にフォールバック
  const triggerEl = e.currentTarget ?? e.target;
  const rect      = triggerEl.getBoundingClientRect();
  openMissionMenuAt(missionId, rect.left, rect.bottom + 4);
}

// ミッションのタップ時アクションを返す（完了できない場合は null）。
// 個別完了 → 完了者リスト、通常で完了可 → 完了モーダル。
export function missionTapAction(m) {
  if (!m) return null;
  if (m.individualClear) return () => window._app.openIndividualClearListModal(m.id);
  if (m.status === 'cleared' || m.status === 'pending_leader_check') return null;
  const meId = state.currentUser?.id;
  const assignees = Array.isArray(m.assignees) ? m.assignees : [];
  const myMission = (m.assignee?.type === 'user' && m.assignee.userId === meId) || assignees.includes(meId);
  // 申告制で自分の担当でなければ完了不可
  if (m.selfClaim && !myMission) return null;
  return () => window._app.openClearMissionModal(m.id);
}

// root 内の [data-mission-id] にタップ＋（管理者の）長押しメニューを束ねる。
// useInlineTap=true の場合は要素側の inline onclick をタップに使い、ここでは長押しのみ束ねる。
const _LP_MS = 500, _LP_MOVE_TOL = 10;
export function bindMissionInteractions(root, p, { useInlineTap = false } = {}) {
  if (!root) return;
  const canMgr = state.canManageCurrentEvent();
  root.querySelectorAll('[data-mission-id]').forEach(el => {
    if (el.dataset.miBound === '1') return; // 二重バインド防止
    el.dataset.miBound = '1';
    const mid = el.dataset.missionId;
    const m = (p.missions || []).find(x => x.id === mid);
    if (!m) return;
    const tap = useInlineTap ? null : missionTapAction(m);

    let timer = null, startPt = null, consumed = false;
    const startLP = (e) => {
      if (!canMgr) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      consumed = false;
      startPt = { x: e.clientX, y: e.clientY };
      clearTimeout(timer);
      timer = setTimeout(() => {
        consumed = true;
        if (navigator.vibrate) navigator.vibrate(15);
        openMissionMenuAt(mid, e.clientX, e.clientY);
      }, _LP_MS);
    };
    const moveLP = (e) => {
      if (!startPt) return;
      if (Math.abs(e.clientX - startPt.x) > _LP_MOVE_TOL || Math.abs(e.clientY - startPt.y) > _LP_MOVE_TOL) cancelLP();
    };
    const cancelLP = () => { clearTimeout(timer); timer = null; startPt = null; };

    if (canMgr) {
      el.addEventListener('pointerdown',   startLP);
      el.addEventListener('pointermove',   moveLP);
      el.addEventListener('pointerup',     cancelLP);
      el.addEventListener('pointercancel', cancelLP);
      el.addEventListener('pointerleave',  cancelLP);
      el.addEventListener('contextmenu',   (ev) => ev.preventDefault());
    }

    // capture でクリックを判定：長押し発火後は抑止。inline onclick が無ければタップを実行。
    el.addEventListener('click', (ev) => {
      if (consumed) { ev.preventDefault(); ev.stopImmediatePropagation(); consumed = false; return; }
      if (tap) tap();
    }, true);
  });
}

function _openMissionDeleteConfirm(missionId) {
  const project = state.events.find(p => p.id === state.selectedEventId);
  const m = project?.missions.find(x => x.id === missionId);
  if (!m) return;
  if (m.isDeletable === false) {
    window._app?.showToast('このミッションは削除できません', 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'mission-delete-confirm';
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-fadeIn text-center">
      <h3 class="heading-m text-[#484545] mb-3 font-bold">ミッションを削除しますか</h3>
      <p class="text-rs text-[#484545] font-medium mb-8 leading-relaxed">一度削除すると元に戻せません。</p>
      <div class="flex gap-3">
        <button id="mdel-cancel" class="btn-secondary flex-1 py-3 heading-rs font-bold">戻る</button>
        <button id="mdel-confirm"
          class="flex-1 py-3 heading-rs font-bold text-white rounded-xl shadow-md"
          style="background-color: #EE3E12;">削除</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('mdel-cancel').onclick = () => overlay.remove();
  document.getElementById('mdel-confirm').onclick = () => {
    overlay.remove();
    logEvent('mission_deleted', { tag: m?.tag });
    project.missions = project.missions.filter(x => x.id !== missionId);
    state.save();
    state.render();
  };
}

/**
 * ソートメニューを表示/非表示
 * @param {Event} e
 */
export function toggleSortMenu(e) {
  e.stopPropagation();
  const existingMenu = document.getElementById('sort-menu');
  if (existingMenu) { existingMenu.remove(); return; }

  const menu = document.createElement('div');
  menu.id = 'sort-menu';
  menu.className = 'absolute right-0 top-10 bg-white border border-[#D3D6D8] rounded-2xl shadow-xl z-[60] overflow-hidden min-w-[140px] animate-fadeIn';
  const modes = [
    { id: 'createdAt', label: '制作日順' },
    { id: 'deadline',  label: '締切順' },
    { id: 'priority',  label: '優先度順' },
  ];
  menu.innerHTML = modes.map(m =>
    `<button onclick="window._app.changeMissionSort('${m.id}')"
      class="w-full text-left px-5 py-4 hover:bg-[#FDFBF8] text-rs font-bold border-b border-[#FDFBF8] flex items-center justify-between">
      ${m.label} ${state.missionSortMode === m.id ? '<span class="text-[#0CA1E3]">●</span>' : ''}
    </button>`).join('');
  e.currentTarget.parentElement.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 10);
}

/**
 * ミッション一覧モーダルを表示する
 */
export function showMissionListModal() {
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) return;
  const overlay = document.createElement('div');
  overlay.id = 'mission-list-modal';
  overlay.className = 'fixed inset-0 bg-black/60 z-[150] flex items-end justify-center page-transition';

  const items = p.missions.map(m => {
    const cleared = p.clearedData[m.id];
    // タグ：新形式 tags 配列、無ければ旧 tag をラップ
    const tagNames = Array.isArray(m.tags) && m.tags.length > 0
      ? m.tags
      : (m.tag ? [m.tag] : []);
    const tagsHtml = tagNames.map(t => Components.Tag(t)).join('');
    return `
      <div class="bg-[#FDFBF8] border border-[#D3D6D8] rounded-2xl p-5">
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          ${tagsHtml}
          ${m.status === 'cleared' ? '<span class="text-[8px] text-[#9EDF05] font-bold border border-[#9EDF05] px-1 rounded ml-1">CLEAR</span>' : ''}
        </div>
        <h3 class="text-r font-bold text-[#484545] mb-2">${m.title}</h3>
        ${cleared ? `
          <div class="mt-3 pt-3 border-t border-[#EBE8E5]">
            <div class="flex items-center justify-between mb-2">
              <p class="text-[10px] text-[#A7AAAC] font-bold">提出内容</p>
              ${cleared.timestamp ? `<p class="text-[10px] text-[#A7AAAC] font-bold">${_formatClearedAt(cleared.timestamp)} に完了</p>` : ''}
            </div>
            ${cleared.format === 'image'
              ? `<img src="${cleared.content}" class="w-full h-32 object-cover rounded-xl mt-1 shadow-inner">`
              : `<p class="text-rs text-[#484545] bg-white p-3 rounded-lg border border-[#EBE8E5] break-words">${cleared.content}</p>`
            }
          </div>` : '<p class="text-[10px] text-[#A7AAAC]">未提出</p>'}
      </div>`;
  }).join('');

  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="bg-white w-full max-w-md rounded-t-[40px] shadow-2xl h-[80vh] flex flex-col animate-fadeIn">
      <div class="shrink-0 px-6 pt-6 pb-4 flex items-center justify-between">
        <h2 class="heading-m text-[#484545]">ミッション一覧</h2>
        <button onclick="document.getElementById('mission-list-modal').remove()" class="p-2 opacity-40">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-6 pb-6 space-y-4">${items}</div>
    </div>`;
  document.body.appendChild(overlay);
}

/**
 * ミッションのソートモードを変更する
 * @param {string} mode
 */
export function changeMissionSort(mode) {
  state.missionSortMode = mode;
  state.render();
}

/**
 * ミッションを並び替えて返す
 * @param {Array} missions
 * @returns {Array}
 */
function _renderAssigneeSelect() {
  const cache = state.assigneeCache || {};
  const current = state.draftMission.assignee || null;
  const multiIds = Array.isArray(state.draftMission.assignees) ? state.draftMission.assignees : [];
  const selfClaim = !!state.draftMission.selfClaim;

  if (cache.loading) {
    return `<p class="text-[11px] text-[#A7AAAC] py-2">読み込み中…</p>`;
  }

  // 申告制ONの場合は無効化表示
  if (selfClaim) {
    return `
      <div class="input-field w-full px-4 py-3 text-[13px] text-left flex items-center justify-between opacity-60 cursor-not-allowed">
        <span class="text-[#A7AAAC]">申告制：メンバーが自分で割り当てます</span>
      </div>`;
  }

  const members = cache.members || [];
  const roles   = (cache.roles || []).filter(r => r.id !== 'owner');

  let label = '未割当';
  let hasValue = false;
  if (multiIds.length > 0) {
    const names = multiIds.map(uid => {
      const m = members.find(x => x.userId === uid);
      return m ? `@${m.username}` : uid;
    });
    label = names.join('、');
    hasValue = true;
  } else if (current?.type === 'role') {
    const r = roles.find(x => x.id === current.roleId)
           || (cache.roles || []).find(x => x.id === current.roleId);
    if (r) { label = r.name; hasValue = true; }
  }

  return `
    <button type="button" onclick="window._app.openAssigneeSheet()"
      class="input-field w-full px-4 py-3 focus:outline-none text-[13px] text-left flex items-center justify-between">
      <span class="${hasValue ? 'text-[#484545] font-bold' : 'text-[#A7AAAC]'}">${_esc(label)}</span>
      <img src="/images/icon/iocn-Chevron.svg" class="w-3 h-3 rotate-180 brightness-0 opacity-40">
    </button>`;
}

/**
 * 担当者選択ボトムシートを開く
 */
export function openAssigneeSheet() {
  const cache = state.assigneeCache || {};
  if (cache.loading) return;

  // 初期タブ：現在の選択がロールなら ROLE、それ以外は ACCOUNT
  const current = state.draftMission.assignee || null;
  state.assigneeSheetTab = current?.type === 'role' ? 'ROLE' : 'ACCOUNT';

  let overlay = document.getElementById('assignee-sheet-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'assignee-sheet-overlay';
  overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[210]';
  overlay.onclick = (e) => { if (e.target === overlay) closeAssigneeSheet(); };

  overlay.innerHTML = `
    <div id="assignee-sheet-panel" data-sheet
      class="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl transition-transform transform translate-y-full"
      style="height: 85vh; display: flex; flex-direction: column;">
      <div data-sheet-handle class="flex justify-center pt-3 pb-1 flex-shrink-0"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
      <h3 class="text-[15px] font-bold text-[#484545] text-center pt-2 pb-3 flex-shrink-0">担当者を選択</h3>

      <!-- タブ -->
      <div id="assignee-tabs" class="flex border-b border-[#E1DFDC] flex-shrink-0">
        <button data-assignee-tab="ACCOUNT"
          class="flex-1 py-3 text-[13px] font-bold transition-colors">
          アカウント
        </button>
        <button data-assignee-tab="ROLE"
          class="flex-1 py-3 text-[13px] font-bold transition-colors">
          ロール
        </button>
      </div>

      <!-- リスト -->
      <div id="assignee-sheet-list" class="flex-1 overflow-y-auto pb-6"></div>

      <!-- 確定ボタン（ACCOUNTタブのみ表示） -->
      <div id="assignee-confirm-bar" class="px-5 py-4 border-t border-[#E1DFDC] flex-shrink-0" style="display:none">
        <button id="assignee-confirm-btn"
          class="btn-primary w-full py-3 heading-r font-bold">確定</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    document.getElementById('assignee-sheet-panel')?.classList.remove('translate-y-full');
  });

  // タブクリック
  overlay.querySelectorAll('[data-assignee-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.assigneeSheetTab = btn.dataset.assigneeTab;
      _renderAssigneeSheetList();
    });
  });

  // 確定ボタン
  overlay.querySelector('#assignee-confirm-btn')?.addEventListener('click', () => {
    closeAssigneeSheet();
    renderMissionModalContent();
  });

  _renderAssigneeSheetList();
}

/**
 * 担当者シートのタブとリスト部分を描画
 */
function _renderAssigneeSheetList() {
  const overlay = document.getElementById('assignee-sheet-overlay');
  if (!overlay) return;

  const cache = state.assigneeCache || {};
  const members = cache.members || [];
  const roles   = (cache.roles || []).filter(r => r.id !== 'owner');
  const multiIds = Array.isArray(state.draftMission.assignees) ? state.draftMission.assignees : [];
  const current  = state.draftMission.assignee || null;
  const currentRoleVal = current?.type === 'role' ? `role:${current.roleId}` : '';

  const tab = state.assigneeSheetTab || 'ACCOUNT';

  // タブ active 状態
  overlay.querySelectorAll('[data-assignee-tab]').forEach(btn => {
    const active = btn.dataset.assigneeTab === tab;
    btn.className = `flex-1 py-3 text-[13px] font-bold transition-colors ${
      active
        ? 'text-[#0CA1E3] border-b-2 border-[#0CA1E3]'
        : 'text-[#A7AAAC]'
    }`;
  });

  // 確定バーはACCOUNTタブのみ表示
  const confirmBar = overlay.querySelector('#assignee-confirm-bar');
  if (confirmBar) confirmBar.style.display = tab === 'ACCOUNT' ? '' : 'none';

  let html = '';

  if (tab === 'ACCOUNT') {
    // ACCOUNTタブ：複数選択。チェックボックス風。
    const noneChecked = multiIds.length === 0 && !current?.type;
    html += `
      <button type="button" data-assignee-pick=""
        class="w-full text-left px-5 py-3 border-b border-[#E1DFDC] active:bg-[#FDFBF8] flex items-center justify-between">
        <p class="text-[13px] font-bold text-[#484545]">未割当</p>
        ${noneChecked ? '<span class="text-[#0CA1E3] font-bold text-[16px]">✓</span>' : ''}
      </button>`;
    if (members.length === 0) {
      html += '<p class="text-[11px] text-[#A7AAAC] text-center py-6">アカウントがありません</p>';
    } else {
      html += members.map(m => {
        const checked = multiIds.includes(m.userId);
        return `
          <button type="button" data-assignee-pick="user:${_escAttr(m.userId)}"
            class="w-full text-left px-5 py-3 border-b border-[#E1DFDC] active:bg-[#FDFBF8] flex items-center justify-between ${checked ? 'bg-[#EBF8FF]' : ''}">
            <p class="text-[13px] font-bold text-[#484545]">${_esc(m.username)}</p>
            ${checked ? '<span class="text-[#0CA1E3] font-bold text-[16px]">✓</span>' : '<span class="w-4 h-4 rounded border border-[#D3D6D8] inline-block"></span>'}
          </button>`;
      }).join('');
    }
  } else if (tab === 'ROLE') {
    // ROLEタブ：単一選択（従来通り）
    html += `
      <button type="button" data-assignee-pick=""
        class="w-full text-left px-5 py-3 border-b border-[#E1DFDC] active:bg-[#FDFBF8] flex items-center justify-between">
        <p class="text-[13px] font-bold text-[#484545]">未割当</p>
        ${!currentRoleVal ? '<span class="text-[#0CA1E3] font-bold">✓</span>' : ''}
      </button>`;
    if (roles.length === 0) {
      html += '<p class="text-[11px] text-[#A7AAAC] text-center py-6">ロールがありません</p>';
    } else {
      html += roles.map(r => `
        <button type="button" data-assignee-pick="role:${_escAttr(r.id)}"
          class="w-full text-left px-5 py-3 border-b border-[#E1DFDC] active:bg-[#FDFBF8] flex items-center justify-between">
          <div>
            <p class="text-[13px] font-bold text-[#484545]">${_esc(r.name)}</p>
            <p class="text-[10px] text-[#A7AAAC]">${r.canManage ? '管理者権限' : '一般ユーザー'}</p>
          </div>
          ${currentRoleVal === `role:${r.id}` ? '<span class="text-[#0CA1E3] font-bold">✓</span>' : ''}
        </button>`).join('');
    }
  }

  const list = overlay.querySelector('#assignee-sheet-list');
  if (list) list.innerHTML = html;

  // 行の選択ハンドラ
  overlay.querySelectorAll('[data-assignee-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.assigneePick;
      if (tab === 'ACCOUNT') {
        if (!val) {
          // 未割当：全クリア
          state.draftMission.assignees = [];
          state.draftMission.assignee  = null;
        } else {
          const uid = val.slice(5); // "user:xxx" → "xxx"
          const ids = state.draftMission.assignees || [];
          if (ids.includes(uid)) {
            state.draftMission.assignees = ids.filter(x => x !== uid);
          } else {
            state.draftMission.assignees = [...ids, uid];
          }
          state.draftMission.assignee = null; // ロール選択は解除
        }
        _renderAssigneeSheetList(); // 閉じずに再描画
      } else {
        // ROLEタブ：従来通り単一選択で閉じる
        if (!val) {
          state.draftMission.assignee  = null;
          state.draftMission.assignees = [];
        } else {
          state.draftMission.assignee  = { type: 'role', roleId: val.slice(5) };
          state.draftMission.assignees = [];
        }
        closeAssigneeSheet();
        renderMissionModalContent();
      }
    });
  });
}

export function closeAssigneeSheet() {
  const panel = document.getElementById('assignee-sheet-panel');
  if (panel) panel.classList.add('translate-y-full');
  setTimeout(() => document.getElementById('assignee-sheet-overlay')?.remove(), 280);
}

// =====================================================
// カスタムタグ作成ボトムシート
// =====================================================
// 利用可能なカラーパレット（重複なし）
const TAG_PALETTE = [
  '#0CA1E3', '#EE3E12', '#FFC300', '#9EDF05',
  '#7C4DFF', '#FF6B9D', '#00BFA5', '#FF7043',
  '#5C6BC0', '#26A69A', '#EC407A', '#FFA726',
];

export function openTagCreator() {
  const project = state.events.find(p => p.id === state.selectedEventId);
  if (!project) return;

  // ドラフト初期化
  state.tagCreator = { name: '', color: null };

  let overlay = document.getElementById('tag-creator-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'tag-creator-overlay';
  overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[220]';
  overlay.onclick = (e) => { if (e.target === overlay) closeTagCreator(); };

  overlay.innerHTML = `
    <div id="tag-creator-panel" data-sheet
      class="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl p-6 transition-transform transform translate-y-full"
      style="max-height: 85vh; overflow-y: auto;">
      <div data-sheet-handle class="flex justify-center pt-1 pb-3"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
      <h3 class="text-[15px] font-bold text-[#484545] text-center mb-5">新しいタグを作成</h3>

      <div class="mb-5">
        <label class="text-[12px] text-[#484545] font-bold mb-2 block">タグ名</label>
        <input id="tag-name-input" type="text" maxlength="20"
          placeholder="例：会計、デザインなど"
          class="input-field w-full px-4 py-3 focus:outline-none text-[13px]"
          value="${_esc(state.tagCreator.name)}">
      </div>

      <div class="mb-5">
        <label class="text-[12px] text-[#484545] font-bold mb-2 block">色（同じ色は選択できません）</label>
        <div id="tag-color-grid" class="grid grid-cols-6 gap-3"></div>
      </div>

      <div class="flex gap-2">
        <button onclick="window._app.closeTagCreator()"
          class="flex-1 py-3 rounded-xl text-[13px] font-bold text-[#484545] bg-[#EBE8E5]">キャンセル</button>
        <button id="tag-create-btn"
          class="flex-1 py-3 rounded-xl text-[13px] font-bold text-white bg-[#0CA1E3] disabled:opacity-40"
          disabled>作成</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    document.getElementById('tag-creator-panel')?.classList.remove('translate-y-full');
  });

  _renderTagColorGrid();

  // 名前入力
  const input = document.getElementById('tag-name-input');
  input?.addEventListener('input', e => {
    state.tagCreator.name = e.target.value;
    _updateTagCreateBtn();
  });

  // 作成ボタン
  document.getElementById('tag-create-btn')?.addEventListener('click', _doCreateTag);
}

function _getUsedColors() {
  const project = state.events.find(p => p.id === state.selectedEventId);
  const builtIn = Object.values(LABEL_CONFIG).map(c => c.color);
  const custom  = (project?.customTags || []).map(t => t.color);
  return new Set([...builtIn, ...custom].map(c => String(c).toUpperCase()));
}

function _renderTagColorGrid() {
  const grid = document.getElementById('tag-color-grid');
  if (!grid) return;
  const used = _getUsedColors();

  grid.innerHTML = TAG_PALETTE.map(color => {
    const isUsed   = used.has(color.toUpperCase());
    const isPicked = state.tagCreator.color === color;
    const baseCls  = 'rounded-full transition-all flex items-center justify-center';
    if (isUsed) {
      return `<div class="${baseCls} opacity-30 cursor-not-allowed relative"
        style="width:40px;height:40px;background-color:${color};">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </div>`;
    }
    return `<button data-tag-color="${color}"
      class="${baseCls} active:scale-95 ${isPicked ? 'ring-4 ring-[#484545]/30' : ''}"
      style="width:40px;height:40px;background-color:${color};">
      ${isPicked ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </button>`;
  }).join('');

  grid.querySelectorAll('[data-tag-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tagCreator.color = btn.dataset.tagColor;
      _renderTagColorGrid();
      _updateTagCreateBtn();
    });
  });
}

function _updateTagCreateBtn() {
  const btn = document.getElementById('tag-create-btn');
  if (!btn) return;
  const ok = state.tagCreator.name.trim().length > 0 && state.tagCreator.color;
  btn.disabled = !ok;
}

function _doCreateTag() {
  const project = state.events.find(p => p.id === state.selectedEventId);
  if (!project) return;
  const name  = String(state.tagCreator.name || '').trim().slice(0, 20);
  const color = state.tagCreator.color;
  if (!name || !color) return;

  // 同名チェック
  const existsBuiltIn = Object.keys(LABEL_CONFIG).includes(name);
  const existsCustom  = (project.customTags || []).some(t => t.name === name);
  if (existsBuiltIn || existsCustom) {
    window._app?.showToast('同じ名前のタグが既に存在します', 'error');
    return;
  }
  // 同色チェック（保険）
  if (_getUsedColors().has(color.toUpperCase())) {
    window._app?.showToast('この色は既に使われています', 'error');
    return;
  }

  if (!Array.isArray(project.customTags)) project.customTags = [];
  const id = 'tag_' + Math.random().toString(36).slice(2, 10);
  project.customTags.push({ id, name, color });

  // 新タグを直ちに draftMission.labels に追加（選択状態に）
  if (!state.draftMission.labels.includes(name)) {
    state.draftMission.labels.push(name);
  }

  state.save();
  closeTagCreator();
  renderMissionModalContent();
}

export function closeTagCreator() {
  const panel = document.getElementById('tag-creator-panel');
  if (panel) panel.classList.add('translate-y-full');
  setTimeout(() => document.getElementById('tag-creator-overlay')?.remove(), 280);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/** 完了日時のフォーマット: 2026/5/19 14:30 のような形式 */
function _formatClearedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}
function _escAttr(s) {
  return String(s ?? '').replace(/"/g,'&quot;');
}

export function getSortedMissions(missions) {
  return [...missions].sort((a, b) => {
    if (state.missionSortMode === 'priority') return (b.priority || 0) - (a.priority || 0);
    if (state.missionSortMode === 'deadline') {
      // 締切 = スケジュール期間の最終日基準（_missionDeadlineText の表示と揃える。
      //  m.dates は未ソート保存なのでソートしてから最終日を取る）
      const dateA = a.dates?.length > 0 ? new Date([...a.dates].sort().at(-1)).getTime() : Infinity;
      const dateB = b.dates?.length > 0 ? new Date([...b.dates].sort().at(-1)).getTime() : Infinity;
      return dateA - dateB;
    }
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/**
 * 申告制（選定あり・複数人可）の選定モーダル。
 * 管理者が申告者リストから1名以上選んで割り当てる。
 * selection モードと multi モードの両方に対応。
 */
export function openSelectClaimModal(missionId) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const m = p?.missions.find(x => x.id === missionId);
  if (!m || !p) return;

  const applicants = Array.isArray(m.claimApplicants) ? m.claimApplicants : [];
  if (applicants.length === 0) {
    window._app?.showToast('応募者がいません', 'error');
    return;
  }

  let overlay = document.getElementById('select-claim-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'select-claim-overlay';
  overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[210] flex items-end';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const applicantRows = applicants.map(uid => {
    const member = (p.members || []).find(mem => mem.userId === uid);
    const name = member ? member.username : '(不明なユーザー)';
    const avatarHtml = member?.avatarUrl
      ? `<img src="${_escAttr(member.avatarUrl)}" referrerpolicy="no-referrer" class="w-8 h-8 rounded-full object-cover flex-shrink-0">`
      : `<div class="w-8 h-8 rounded-full bg-[#0CA1E3]/20 flex items-center justify-center flex-shrink-0 text-[12px] font-bold text-[#0CA1E3]">${_esc(name.charAt(0).toUpperCase())}</div>`;
    return `
      <label class="flex items-center gap-3 px-4 py-3 border-b border-[#E1DFDC] cursor-pointer active:bg-[#FDFBF8]">
        <input type="checkbox" data-select-claim value="${_escAttr(uid)}" class="w-4 h-4 accent-[#0CA1E3]">
        ${avatarHtml}
        <span class="text-[13px] font-bold text-[#484545] flex-1">@${_esc(name)}</span>
      </label>`;
  }).join('');

  const modeLabel = '選定あり';

  overlay.innerHTML = `
    <div data-sheet class="bg-white w-full rounded-t-3xl shadow-2xl flex flex-col" style="max-height: 85vh">
      <div data-sheet-handle class="flex justify-center pt-3 pb-1"><div class="w-12 h-1.5 bg-[#E1DFDC] rounded-full"></div></div>
      <h3 class="text-[15px] font-bold text-[#484545] text-center pt-2 pb-1">担当者を選定</h3>
      <div class="flex justify-center pb-2">
        <span class="text-[9px] text-[#9b7700] font-bold border border-[#FFC300] px-2 py-0.5 rounded bg-[#FFF8E1]">申告制（${modeLabel}）</span>
      </div>
      <p class="text-[11px] text-[#A7AAAC] text-center pb-3 px-6">「${_esc(m.title)}」<br>応募者から1名以上選んでください</p>
      <p class="text-[10px] text-center text-[#A7AAAC] pb-2">${applicants.length}名が応募中</p>
      <div class="flex-1 overflow-y-auto border-t border-[#E1DFDC]">
        ${applicantRows}
      </div>
      <div class="p-4 flex gap-2 border-t border-[#E1DFDC]">
        <button onclick="document.getElementById('select-claim-overlay').remove()"
          class="flex-1 py-3 rounded-xl text-[13px] font-bold text-[#484545] bg-[#EBE8E5]">キャンセル</button>
        <button onclick="window._app.submitSelectClaims('${missionId}')"
          class="flex-1 py-3 rounded-xl text-[13px] font-bold text-white bg-[#FFC300]">担当者を確定する</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
