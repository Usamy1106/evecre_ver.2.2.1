// ===== ミッションモーダル =====
import { state } from '../state.js';
import { startMissionFormTour, onMissionFormClosed } from '../onboardingIntro.js';
import { api } from '../api.js';
import { LABEL_CONFIG, MISSION_DESCRIPTIONS } from '../constants.js';
import { suggestAssignees } from '../assigneeSuggest.js';
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
  overlay.className = 'c-overlay c-overlay--full';
  overlay.innerHTML = `
    <div id="mission-panel"
      class="c-sheet c-sheet--full">
      <!-- ヘッダー：閉じるボタン + タイトル -->
      <header class="p-mission-form__header">
        <button onclick="window._app.closeMissionModal()" class="p-mission-form__close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <h2 class="p-mission-form__heading" id="mission-modal-title"></h2>
        <div class="p-mission-form__spacer"></div>
      </header>
      <div id="mission-modal-content" class="p-mission-form__body"></div>
    </div>`;
  document.body.appendChild(overlay);

  // スライドアップアニメーション
  requestAnimationFrame(() => {
    document.getElementById('mission-panel')?.classList.add('is-open');
  });
  renderMissionModalContent();

  // ★初期オンボーディング③：作成モーダルが開いた直後にツールチップを出す（初回のみ）。
  //   条件（イントロ対象・②を済ませた直後か）は onboardingIntro 側が判定する。
  //   ★スライドイン（.c-sheet の transform、150ms）が終わってから始めること。
  //     途中で測ると入力欄はまだ画面の下にあり、1枚目の吹き出しだけが画面外に
  //     置かれる（2枚目以降は「次へ」の時点で測り直すので正しく出る）。
  const panel = document.getElementById('mission-panel');
  if (panel) {
    let started = false;
    const start = () => { if (started) return; started = true; startMissionFormTour(); };
    panel.addEventListener('transitionend', start, { once: true });
    // transition が走らない環境（動きを抑える設定など）でも必ず始める
    setTimeout(start, 400);
  } else {
    requestAnimationFrame(() => startMissionFormTour());
  }
}

/**
 * ミッションモーダルを閉じる
 */
export function closeMissionModal() {
  // ★途中で閉じても③は「一度見た」として完了扱いにする（状態を宙ぶらりんにしない）
  onMissionFormClosed();
  const panel = document.getElementById('mission-panel');
  if (panel) panel.classList.remove('is-open');
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
    overlay.className = 'c-overlay c-overlay--action-dialog c-overlay--blur u-page-transition';
    overlay.onclick = (e2) => { if (e2.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="c-modal u-animate-fade">
        <h3 class="c-modal__title">削除できません</h3>
        <p class="c-modal__text c-modal__text--strong">初期フローのミッションは削除できません。</p>
        <button class="c-button c-button--secondary c-modal__button">閉じる</button>
      </div>`;
    overlay.querySelector('button').onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'c-overlay c-overlay--action-dialog c-overlay--blur u-page-transition';
  overlay.onclick = (e2) => { if (e2.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade">
      <h3 class="c-modal__title">ミッションを削除しますか</h3>
      <p class="c-modal__text c-modal__text--strong">一度削除すると元に戻せません。</p>
      <div class="c-modal__actions">
        <button data-action="cancel" class="c-button c-button--secondary c-modal__button">戻る</button>
        <button data-action="confirm"
          class="c-button c-button--danger c-modal__button c-modal__button--shadow">削除</button>
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
      ? `<div class="text-rs p-mission-form__date-chip">${_esc(_sd[0])}</div>`
      : `<div class="text-rs p-mission-form__date-chip">${_esc(_sd[0])} 〜 ${_esc(_sd[_sd.length - 1])}</div>`;

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
    // ★色はイベントごとにユーザーが作れるので CSS に書けない。
    //   選ばれたときの塗りは同じ色の 10%（末尾の 1A）。
    const vars = sel ? `--tag-color:${_escAttr(t.color)};--tag-tint:${_escAttr(t.color)}1A` : '';
    return `<button onclick="window._app.toggleMissionLabel('${_escAttr(t.name)}')"
      class="p-mission-form__tag${sel ? ' is-selected' : ''}"
      style="${vars}">${_esc(t.name)}</button>`;
  }).join('');

  const addTagBtn = `
    <button onclick="window._app.openTagCreator()"
      class="p-mission-form__tag p-mission-form__tag--add">
      + 新しいタグ
    </button>`;

  const starButtons = [1, 2, 3, 4, 5].map(v =>
    `<button onclick="window._app.setMissionPriority(${v})" class="p-mission-form__star">
      <svg width="32" height="32" viewBox="0 0 24 24"
        fill="${state.draftMission.priority >= v ? '#F5B600' : 'none'}"
        stroke="${state.draftMission.priority >= v ? '#F5B600' : '#E1DFDC'}"
        stroke-width="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    </button>`).join('');


  return `
    <div class="p-mission-form__inner">
      <div class="p-mission-form__tabs">
        <button onclick="window._app.setMissionTab('BASIC')"
          class="p-mission-form__tab is-active">基本設定</button>
        <button onclick="window._app.setMissionTab('DETAIL')"
          class="p-mission-form__tab">詳細設定</button>
      </div>
      <div class="p-mission-form__fields">
        <div>
          <label class="heading-rs p-mission-form__label">ミッション名</label>
          <input type="text" id="mission-title-input" data-coach="mission-title" placeholder="ミッションを入力"
            value="${_escAttr(state.draftMission.title || '')}"
            oninput="state.draftMission.title=this.value; this.style.borderColor=''"
            class="c-input p-mission-form__input">
          <p id="error-title" class="p-mission-form__error u-hidden">※ミッション名は入力必須です</p>
        </div>
        <div>
          <label class="heading-rs p-mission-form__label">ミッションの説明</label>
          <textarea id="mission-desc-input" rows="3"
            placeholder="このミッションの目的・進め方など"
            oninput="state.draftMission.description=this.value"
            class="c-input p-mission-form__textarea">${_esc(state.draftMission.description || '')}</textarea>
        </div>
        <div>
          <div class="p-mission-form__label-row">
            <label class="heading-rs p-mission-form__label">ラベル</label>
            <span class="p-mission-form__hint">（複数選択可）</span>
          </div>
          <div class="p-mission-form__tags">${labelButtons}${addTagBtn}</div>
        </div>
        <div>
          <label class="heading-rs p-mission-form__label">優先度</label>
          <div class="p-mission-form__stars">${starButtons}</div>
        </div>
        <div data-coach="assignee">
          <label class="heading-rs p-mission-form__label">担当者</label>
          ${_renderAssigneeSelect()}
        </div>
        <div data-coach="schedule">
          <label class="heading-rs p-mission-form__label">スケジュール</label>
          <p class="p-mission-form__note">ミッションを行う期間を設定します。</p>
          <div class="p-mission-form__date" onclick="window._app.openCalendarModal('mission')">
            <img src="/images/icon/icon-Calender.svg" class="p-mission-form__date-icon">
            <span class="p-mission-form__date-text">${dateDisplay}</span>
          </div>
        </div>
      </div>
      <button onclick="window._app.createOrUpdateMission()"
        class="c-button c-button--primary p-mission-form__submit">
        ${isEdit ? '保存' : '作成'}
      </button>
    </div>`;
}

function _renderDetailTab(isEdit) {
  const canDelete = isEdit && state.draftMission.isDeletable !== false;
  const checklist = Array.isArray(state.draftMission.checklist) ? state.draftMission.checklist : [];
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

  // 応募期限の表示文字列
  const _fmtDeadlineDisplay = (ts) => {
    if (!ts) return null;
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()}（${['日','月','火','水','木','金','土'][d.getDay()]}）`;
  };
  const deadlineDisplay = _fmtDeadlineDisplay(claimDeadline);

  return `
    <div class="p-mission-form__inner">
      <div class="p-mission-form__tabs">
        <button onclick="window._app.setMissionTab('BASIC')"
          class="p-mission-form__tab">基本設定</button>
        <button onclick="window._app.setMissionTab('DETAIL')"
          class="p-mission-form__tab p-mission-form__tab--detail is-active">詳細設定</button>
      </div>
      <div class="p-mission-form__fields p-mission-form__fields--roomy">

        <!-- チェック項目 -->
        <div>
          <label class="heading-rs p-mission-form__label p-mission-form__label--loose">チェック項目</label>
          <p class="p-mission-form__desc">担当者にチェックしてもらいたい項目を設定できます。</p>
          ${checklist.length === 0 ? `
            <button onclick="window._app.addChecklistItem()"
              class="p-mission-form__checklist-add">
              チェック項目を追加
            </button>
          ` : `
            <div class="p-mission-form__checklist">
              ${checklist.map((item, i) => `
                <div class="p-mission-form__checklist-row">
                  <input type="text" data-cl-input="${i}" value="${_escAttr(item)}"
                    oninput="window._app.updateChecklistItem(${i}, this.value)"
                    placeholder="例：〇〇はできているか"
                    class="c-input p-mission-form__checklist-input">
                  <button onclick="window._app.removeChecklistItem(${i})"
                    class="p-mission-form__checklist-remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>`).join('')}
            </div>
            <button onclick="window._app.addChecklistItem()"
              class="p-mission-form__checklist-more">+ 追加</button>
          `}
        </div>

        <!-- 担当の応募型 -->
        <div>
          <div class="p-mission-form__row p-mission-form__row--loose">
            <label class="heading-rs p-mission-form__label">担当の応募型</label>
            <button onclick="window._app.toggleMissionSelfClaim()" type="button"
              class="c-toggle${selfClaim ? ' is-on' : ''}">
              <span class="c-toggle__knob"></span>
            </button>
          </div>

          <p class="p-mission-form__desc p-mission-form__desc--tight">担当したいメンバーがこのミッションへ応募し、管理者が担当者を選定することができるようになります。</p>
          ${selfClaim ? `
            <!-- 応募期限（カレンダーUIで設定） -->
            <div>
              <label class="p-mission-form__sub-label">応募期限（任意）</label>
              <div class="p-mission-form__date p-mission-form__date--flush" onclick="window._app.openCalendarModal('claimDeadline')">
                <img src="/images/icon/icon-Calender.svg" class="p-mission-form__date-icon">
                ${deadlineDisplay
                  ? `<span class="p-mission-form__date-text p-mission-form__date-text--set">${_esc(deadlineDisplay)} 23:59 まで</span>`
                  : `<span class="p-mission-form__date-text">カレンダーから設定する</span>`}
              </div>
              ${deadlineDisplay ? `
                <button onclick="window._app.setMissionClaimDeadline('')" type="button"
                  class="p-mission-form__clear-deadline">期限をクリア</button>` : ''}
            </div>
          ` : ''}
        </div>

        <!-- アナウンス -->
        <div>
          <div class="p-mission-form__row">
            <label class="heading-rs p-mission-form__label">アナウンス</label>
            <button onclick="window._app.toggleMissionAnnounce()" type="button"
              class="c-toggle${announce ? ' is-on' : ''}">
              <span class="c-toggle__knob"></span>
            </button>
          </div>
          <p class="p-mission-form__desc p-mission-form__desc--flush">メインボードにてアナウンスされます。</p>
        </div>

        <!-- ワンタップ完了 -->
        <div>
          <div class="p-mission-form__row">
            <label class="heading-rs p-mission-form__label">ワンタップ完了</label>
            <button onclick="window._app.toggleMissionNoInput()" type="button"
              class="c-toggle${noInput ? ' is-on' : ''}">
              <span class="c-toggle__knob"></span>
            </button>
          </div>
          <p class="p-mission-form__desc p-mission-form__desc--flush">テキスト・完了ボタンのみで即完了するミッションになります。</p>
        </div>

        <!-- 個別完了 -->
        <div>
          <div class="p-mission-form__row">
            <label class="heading-rs p-mission-form__label">個別完了</label>
            <button onclick="window._app.toggleMissionIndividualClear()" type="button"
              class="c-toggle${individualClear ? ' is-on' : ''}">
              <span class="c-toggle__knob"></span>
            </button>
          </div>
          <p class="p-mission-form__desc p-mission-form__desc--flush">ユーザーごとに個別に回答・完了できるようになります。</p>
        </div>

        <!-- リーダーによるチェック -->
        <div>
          <div class="p-mission-form__row">
            <label class="heading-rs p-mission-form__label">リーダーによるチェック</label>
            <button onclick="window._app.toggleMissionLeaderCheck()" type="button"
              class="c-toggle${leaderCheck ? ' is-on' : ''}">
              <span class="c-toggle__knob"></span>
            </button>
          </div>
          <p class="p-mission-form__desc p-mission-form__desc--flush">完了だけではアーカイブ化されず、提出の確認ができるようになります。</p>
        </div>

        ${canDelete ? `
          <button onclick="window._app.deleteMission(event)"
            class="p-mission-form__delete">
            <span>このミッションを削除する</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>` : ''}
      </div>
      <button onclick="window._app.createOrUpdateMission()"
        class="c-button c-button--primary p-mission-form__submit">
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
  overlay.className = 'c-overlay c-overlay--help c-overlay--blur u-page-transition';
  overlay.innerHTML = `
    <div class="c-modal c-modal--left c-modal--fluid u-animate-fade">
      <button onclick="document.getElementById('help-modal').remove()" class="c-modal__close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="p-main-board__help-head">
        <img src="/images/icon/icon-Help.svg" class="p-main-board__help-icon">
        <h3 class="c-modal__title c-modal__title--tight">提案のヒント</h3>
      </div>
      <div class="p-main-board__help-box">
        <p class="text-rs p-main-board__help-text">${_esc(desc)}</p>
      </div>
      <button onclick="document.getElementById('help-modal').remove()"
        class="c-button c-button--primary p-main-board__help-close">わかった</button>
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
  menu.className = 'c-context-menu c-context-menu--mission u-animate-fade';
  menu.style.visibility = 'hidden';
  menu.innerHTML = `
    <button id="mm-copy-link" class="c-context-menu__item">リンクをコピー</button>
    <button id="mm-edit" class="c-context-menu__item">編集</button>
    <button id="mm-delete" class="c-context-menu__item c-context-menu__item--danger">削除</button>`;
  document.body.appendChild(menu);

  // 画面内にクランプして配置
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth  - mw - 8))}px`;
  menu.style.top  = `${Math.max(8, Math.min(y, window.innerHeight - mh - 8))}px`;
  menu.style.visibility = 'visible';

  menu.querySelector('#mm-copy-link').onclick = (ev) => {
    ev.stopPropagation();
    menu.remove();
    window._app.copyMissionLink(missionId);
  };
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

// ミッションのタップ時アクションを返す。
// 全ミッションでミッション詳細ページを開く（完了入力欄はページ側で従来条件のまま出し分け）。
// カレンダー/ガントシートから開いた場合は openMissionDetail がシートを閉じ、
// 戻るボタンで同じビューを再オープンする。
export function missionTapAction(m) {
  if (!m) return null;
  return () => window._app.openMissionDetail(m.id);
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
  overlay.className = 'c-overlay c-overlay--action-dialog c-overlay--blur u-page-transition';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="c-modal u-animate-fade">
      <h3 class="c-modal__title">ミッションを削除しますか</h3>
      <p class="c-modal__text c-modal__text--strong">一度削除すると元に戻せません。</p>
      <div class="c-modal__actions">
        <button id="mdel-cancel" class="c-button c-button--secondary c-modal__button">戻る</button>
        <button id="mdel-confirm"
          class="c-button c-button--danger c-modal__button c-modal__button--shadow">削除</button>
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
  menu.className = 'c-context-menu c-context-menu--dropdown u-animate-fade';
  const modes = [
    { id: 'createdAt', label: '制作日順' },
    { id: 'deadline',  label: '締切順' },
    { id: 'priority',  label: '優先度順' },
  ];
  menu.innerHTML = modes.map(m =>
    `<button onclick="window._app.changeMissionSort('${m.id}')"
      class="c-context-menu__item">
      ${m.label} ${state.missionSortMode === m.id ? '<span class="c-context-menu__marker">●</span>' : ''}
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
  overlay.className = 'c-overlay c-overlay--list u-page-transition';

  const items = p.missions.map(m => {
    const cleared = p.clearedData[m.id];
    // タグ：新形式 tags 配列、無ければ旧 tag をラップ
    const tagNames = Array.isArray(m.tags) && m.tags.length > 0
      ? m.tags
      : (m.tag ? [m.tag] : []);
    const tagsHtml = tagNames.map(t => Components.Tag(t)).join('');
    return `
      <div class="p-main-board__list-card">
        <div class="p-main-board__list-tags">
          ${tagsHtml}
          ${m.status === 'cleared' ? '<span class="p-main-board__list-clear">CLEAR</span>' : ''}
        </div>
        <h3 class="text-r p-main-board__list-title">${_esc(m.title)}</h3>
        ${cleared ? `
          <div class="p-main-board__list-submission">
            <div class="p-main-board__list-submission-head">
              <p class="p-main-board__list-meta">提出内容</p>
              ${cleared.timestamp ? `<p class="p-main-board__list-meta">${_formatClearedAt(cleared.timestamp)} に完了</p>` : ''}
            </div>
            ${cleared.format === 'image'
              ? `<img src="${_escAttr(cleared.content)}" class="p-main-board__list-image">`
              : `<p class="text-rs p-main-board__list-text">${_esc(cleared.content)}</p>`
            }
          </div>` : '<p class="p-main-board__list-meta">未提出</p>'}
      </div>`;
  }).join('');

  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="p-main-board__list-modal u-animate-fade">
      <div class="p-main-board__list-head">
        <h2 class="c-modal__title c-modal__title--tight">ミッション一覧</h2>
        <button onclick="document.getElementById('mission-list-modal').remove()" class="p-main-board__list-close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="p-main-board__list-body">${items}</div>
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
    return `<p class="p-assignee__loading">読み込み中…</p>`;
  }

  // 応募制ONの場合は無効化表示
  if (selfClaim) {
    return `
      <div class="c-input p-assignee__trigger p-assignee__trigger--disabled">
        <span class="p-assignee__trigger-label">応募型：メンバーが自分で割り当てます</span>
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
      class="c-input p-assignee__trigger">
      <span class="p-assignee__trigger-label${hasValue ? ' is-set' : ''}">${_esc(label)}</span>
      <img src="/images/icon/iocn-Chevron.svg" class="p-assignee__chevron">
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
  overlay.className = 'c-overlay c-overlay--blur c-overlay--sheet';
  overlay.onclick = (e) => { if (e.target === overlay) closeAssigneeSheet(); };

  overlay.innerHTML = `
    <div id="assignee-sheet-panel" data-sheet class="c-sheet p-assignee__sheet">
      <div data-sheet-handle class="c-sheet__handle c-sheet__handle--low"><div class="c-sheet__grip"></div></div>
      <h3 class="p-assignee__title">担当者を選択</h3>

      <!-- タブ -->
      <div id="assignee-tabs" class="p-assignee__tabs">
        <button data-assignee-tab="ACCOUNT" class="p-assignee__tab">
          アカウント
        </button>
        <button data-assignee-tab="ROLE" class="p-assignee__tab">
          ロール
        </button>
      </div>

      <!-- リスト -->
      <div id="assignee-sheet-list" class="p-assignee__list"></div>

      <!-- 確定ボタン（ACCOUNTタブのみ表示） -->
      <div id="assignee-confirm-bar" class="p-assignee__confirm-bar" style="display:none">
        <button id="assignee-confirm-btn"
          class="c-button c-button--primary p-assignee__confirm">確定</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    document.getElementById('assignee-sheet-panel')?.classList.add('is-open');
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
 * 担当者シート上部の「参加時の回答からのおすすめ」。
 *
 * ★出す根拠が無ければ空文字を返す（suggestAssignees が空配列を返す）。
 *   ラベル未選択・誰も参加時フォームに答えていない・関係する回答が無い、の3通り。
 * ★行は下の一覧と同じ data-assignee-pick を使うので、選択ハンドラは共通のまま。
 *
 * @param {Array} members  assigneeCache のメンバー（表示名の正）
 * @param {string[]} multiIds 選択中の userId
 * @returns {string}
 */
function _assigneeSuggestHtml(members, multiIds) {
  const p = state.events.find(x => x.id === state.selectedEventId);
  const recs = suggestAssignees(p, state.draftMission.labels || [], {
    // 脱退したメンバーを出さない（回答はイベント側に残るため）
    onlyUserIds: members.map(m => m.userId),
  });
  if (recs.length === 0) return '';

  const nameOf = (uid) => members.find(m => m.userId === uid)?.username || '';

  return `
    <div class="p-assignee__suggest">
      <p class="p-assignee__suggest-title">参加時の回答からのおすすめ</p>
      <div class="p-assignee__suggest-list">
        ${recs.map(r => {
          const checked = multiIds.includes(r.userId);
          return `
            <button type="button" data-assignee-pick="user:${_escAttr(r.userId)}"
              class="p-assignee__suggest-item${checked ? ' is-checked' : ''}">
              <div>
                <p class="p-assignee__name">${_esc(nameOf(r.userId))}</p>
                <p class="p-assignee__reason">${_esc(r.reason)}</p>
              </div>
              ${checked
                ? '<span class="p-assignee__check">✓</span>'
                : '<span class="p-assignee__checkbox"></span>'}
            </button>`;
        }).join('')}
      </div>
    </div>`;
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
    btn.classList.toggle('is-active', active);
  });

  // 確定バーはACCOUNTタブのみ表示
  const confirmBar = overlay.querySelector('#assignee-confirm-bar');
  if (confirmBar) confirmBar.style.display = tab === 'ACCOUNT' ? '' : 'none';

  let html = '';

  if (tab === 'ACCOUNT') {
    // ★参加時回答からのおすすめ（根拠が無ければ空文字を返す）
    html += _assigneeSuggestHtml(members, multiIds);
    // ACCOUNTタブ：複数選択。チェックボックス風。
    const noneChecked = multiIds.length === 0 && !current?.type;
    html += `
      <button type="button" data-assignee-pick="" class="p-assignee__row">
        <p class="p-assignee__row-name">未割当</p>
        ${noneChecked ? '<span class="p-assignee__check">✓</span>' : ''}
      </button>`;
    if (members.length === 0) {
      html += '<p class="p-assignee__empty">アカウントがありません</p>';
    } else {
      html += members.map(m => {
        const checked = multiIds.includes(m.userId);
        return `
          <button type="button" data-assignee-pick="user:${_escAttr(m.userId)}"
            class="p-assignee__row${checked ? ' is-checked' : ''}">
            <p class="p-assignee__row-name">${_esc(m.username)}</p>
            ${checked ? '<span class="p-assignee__check">✓</span>' : '<span class="p-assignee__checkbox"></span>'}
          </button>`;
      }).join('');
    }
  } else if (tab === 'ROLE') {
    // ROLEタブ：単一選択（従来通り）
    html += `
      <button type="button" data-assignee-pick="" class="p-assignee__row">
        <p class="p-assignee__row-name">未割当</p>
        ${!currentRoleVal ? '<span class="p-assignee__check">✓</span>' : ''}
      </button>`;
    if (roles.length === 0) {
      html += '<p class="p-assignee__empty">ロールがありません</p>';
    } else {
      html += roles.map(r => `
        <button type="button" data-assignee-pick="role:${_escAttr(r.id)}"
          class="p-assignee__row">
          <div>
            <p class="p-assignee__row-name">${_esc(r.name)}</p>
            <p class="p-assignee__row-sub">${r.canManage ? '管理者権限' : '一般ユーザー'}</p>
          </div>
          ${currentRoleVal === `role:${r.id}` ? '<span class="p-assignee__check">✓</span>' : ''}
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
  if (panel) panel.classList.remove('is-open');
  setTimeout(() => document.getElementById('assignee-sheet-overlay')?.remove(), 280);
}

// =====================================================
// カスタムタグ作成ボトムシート
// =====================================================
// 利用可能なカラーパレット（重複なし）
const TAG_PALETTE = [
  '#209DDB', '#EE3E12', '#F5B600', '#28AB3D',
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
  overlay.className = 'c-overlay c-overlay--blur c-overlay--sheet-stacked';
  overlay.onclick = (e) => { if (e.target === overlay) closeTagCreator(); };

  overlay.innerHTML = `
    <div id="tag-creator-panel" data-sheet
      class="c-sheet c-sheet--padded p-tag-creator__sheet">
      <div data-sheet-handle class="c-sheet__handle"><div class="c-sheet__grip"></div></div>
      <h3 class="p-tag-creator__title">新しいタグを作成</h3>

      <div class="p-tag-creator__field">
        <label class="p-tag-creator__label">タグ名</label>
        <input id="tag-name-input" type="text" maxlength="20"
          placeholder="例：会計、デザインなど"
          class="c-input p-tag-creator__input"
          value="${_escAttr(state.tagCreator.name)}">
      </div>

      <div class="p-tag-creator__field">
        <label class="p-tag-creator__label">色（同じ色は選択できません）</label>
        <div id="tag-color-grid" class="p-tag-creator__grid"></div>
      </div>

      <div class="p-tag-creator__actions">
        <button onclick="window._app.closeTagCreator()"
          class="c-button c-button--muted">キャンセル</button>
        <button id="tag-create-btn"
          class="c-button c-button--primary"
          disabled>作成</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    document.getElementById('tag-creator-panel')?.classList.add('is-open');
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
    // 色はパレット（constants.js）から来るので CSS に書けない。--swatch で渡す
    const sw = `--swatch:${_escAttr(color)}`;
    if (isUsed) {
      return `<div class="p-tag-creator__swatch p-tag-creator__swatch--used" style="${sw}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </div>`;
    }
    return `<button data-tag-color="${_escAttr(color)}"
      class="p-tag-creator__swatch${isPicked ? ' is-picked' : ''}" style="${sw}">
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
  if (panel) panel.classList.remove('is-open');
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
 * 応募型（選定あり・複数人可）の選定モーダル。
 * 管理者が応募者リストから1名以上選んで割り当てる。
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
  overlay.className = 'c-overlay c-overlay--bottom c-overlay--action-dialog c-overlay--blur';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  // ★参加時回答からのおすすめ。応募者の中だけで採点し、該当者を上に寄せて理由を添える。
  //   根拠が無ければ（ラベル未設定・誰も未回答・関係する回答なし）空配列が返り、
  //   並びも表示も従来どおりになる。
  const missionTags = (Array.isArray(m.tags) && m.tags.length > 0)
    ? m.tags
    : (m.tag ? [m.tag] : []);
  const recs = suggestAssignees(p, missionTags, {
    onlyUserIds: applicants,
    limit: applicants.length,
  });
  const recIndex = new Map(recs.map((r, i) => [r.userId, { rank: i, reason: r.reason }]));

  // おすすめを先頭へ（同順位は元の応募順を保つ）
  const ordered = [...applicants].sort((a, b) => {
    const ra = recIndex.has(a) ? recIndex.get(a).rank : Number.MAX_SAFE_INTEGER;
    const rb = recIndex.has(b) ? recIndex.get(b).rank : Number.MAX_SAFE_INTEGER;
    return ra - rb || applicants.indexOf(a) - applicants.indexOf(b);
  });

  const applicantRows = ordered.map(uid => {
    const member = (p.members || []).find(mem => mem.userId === uid);
    const name = member ? member.username : '(不明なユーザー)';
    const rec = recIndex.get(uid) || null;
    const avatarHtml = member?.avatarUrl
      ? `<img src="${_escAttr(member.avatarUrl)}" referrerpolicy="no-referrer" class="p-assignee__applicant-avatar">`
      : `<div class="p-assignee__applicant-initial">${_esc(name.charAt(0).toUpperCase())}</div>`;
    return `
      <label class="p-assignee__applicant${rec ? ' is-recommended' : ''}">
        <input type="checkbox" data-select-claim value="${_escAttr(uid)}" class="p-assignee__applicant-check">
        ${avatarHtml}
        <span class="p-assignee__applicant-body">
          <span class="p-assignee__applicant-name">@${_esc(name)}</span>
          ${rec ? `<span class="p-assignee__applicant-reason">${_esc(rec.reason)}</span>` : ''}
        </span>
        ${rec ? '<span class="p-assignee__applicant-badge">おすすめ</span>' : ''}
      </label>`;
  }).join('');

  const modeLabel = '選定あり';

  overlay.innerHTML = `
    <div data-sheet class="p-assignee__select-sheet">
      <div data-sheet-handle class="c-sheet__handle c-sheet__handle--low"><div class="c-sheet__grip"></div></div>
      <h3 class="p-assignee__select-title">担当者を選定</h3>
      <div class="p-assignee__select-badge-row">
        <span class="p-assignee__select-badge">応募型（${modeLabel}）</span>
      </div>
      <p class="p-assignee__select-lead">「${_esc(m.title)}」<br>応募者から1名以上選んでください</p>
      <p class="p-assignee__select-count">${applicants.length}名が応募中</p>
      <div class="p-assignee__select-list">
        ${applicantRows}
      </div>
      <div class="p-assignee__select-actions">
        <button onclick="document.getElementById('select-claim-overlay').remove()"
          class="c-button c-button--muted">キャンセル</button>
        <button onclick="window._app.submitSelectClaims('${missionId}')"
          class="c-button c-button--warning">担当者を確定する</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
