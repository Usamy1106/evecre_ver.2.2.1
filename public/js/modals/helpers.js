// ===== ヘルパーモーダル =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { openCalendarModal } from './calendar.js';
import { getArchiveSummary, setArchiveSummary, getArchiveVenue, setArchiveVenue } from '../utils.js';

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
    // ★イベント設定の「概要」と同じ場所を読み書きする（utils.js に集約）
    openEditModal('概要', getArchiveSummary(p), 'text', (newVal) => {
      setArchiveSummary(p, newVal);
      state.save();
      state.render();
    });
    return;
  } else if (type === 'venue') {
    // ★イベント設定の「開催場所」と同じ場所を読み書きする（utils.js に集約）。
    //   以前はミッションをタイトルで探して venue-temp を作っていたが、アーカイブ側は
    //   originProposalId==='p1' を読んでいたため、編集しても表示に反映されなかった。
    openEditModal('開催場所', getArchiveVenue(p), 'text', (newVal) => {
      setArchiveVenue(p, newVal);
      state.save();
      state.render();
    });
    return;
  } else if (type === 'url') {
    const m     = p.missions.find(x => x.title === '広報リンクを挿入');
    missionId   = m?.id || 'url-temp';
    currentVal  = p.clearedData[missionId]?.content || '';
    format      = 'link';
    titleLabel  = 'URL';
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
        // venue / summary はここを通らない（上で早期 return して utils.js 経由で保存する）
        title: type === 'url' ? '広報リンクを挿入'
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
  // スタイル: public/css/object/project/_archive.css
  overlay.className = 'c-overlay c-overlay--edit c-overlay--blur';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const current = p.clearedData?.['archive-image']?.content;
  overlay.innerHTML = `
    <div class="c-modal c-modal--left u-animate-fade">
      <h3 class="c-modal__title c-modal__title--loose">メインビジュアルを設定</h3>
      <div id="arch-img-preview" class="p-archive__image-preview${current ? '' : ' u-hidden'}">
        <img id="arch-img-src" src="${_esc(current || '')}" class="p-archive__image-thumb">
      </div>
      <label class="p-archive__file-label">
        <div class="p-archive__dropzone">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span class="p-archive__dropzone-text">画像を選択</span>
        </div>
        <input type="file" id="arch-file-input" class="u-hidden" accept="image/*">
      </label>
      <div class="c-modal__actions c-modal__actions--spaced">
        <button data-action="cancel" class="c-button c-button--secondary c-modal__button">キャンセル</button>
        <button data-action="save" class="c-button c-button--primary c-modal__button" disabled>保存</button>
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
      overlay.querySelector('#arch-img-preview').classList.remove('u-hidden');
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
  // スタイル: public/css/object/project/_archive.css
  overlay.className = 'c-overlay c-overlay--edit c-overlay--blur u-page-transition';

  // ★currentVal はユーザーが入れた値。属性・本文どちらにもエスケープして差し込む
  const val = _esc(currentVal ?? '');
  let inputHtml;
  if (format === 'text' || title === '概要' || title === '期間') {
    inputHtml = `<textarea id="edit-input" class="p-archive__edit-input p-archive__edit-input--tall"
      placeholder="内容を入力してください">${val}</textarea>`;
  } else if (format === 'link') {
    inputHtml = `<input type="url" id="edit-input" class="p-archive__edit-input"
      placeholder="https://..." value="${val}">`;
  } else {
    inputHtml = `<input type="text" id="edit-input" class="p-archive__edit-input"
      placeholder="内容を入力してください" value="${val}">`;
  }

  overlay.innerHTML = `
    <div class="c-modal c-modal--left c-modal--fluid u-animate-fade">
      <button onclick="document.getElementById('edit-archive-modal').remove()" class="c-modal__close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h3 class="c-modal__title c-modal__title--loose p-archive__edit-title">${_esc(title)}の編集</h3>
      ${inputHtml}
      <button id="save-edit-btn" class="c-button c-button--primary p-archive__edit-save">保存する</button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('save-edit-btn').onclick = () => {
    const val = document.getElementById('edit-input').value;
    if (val !== null) onSave(val);
    overlay.remove();
  };
}

export function initClearDraft(missionId, container) {
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
        chip.classList.remove('u-hidden');
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
  if (container) container._snapshot = snapshot;
}

/**
 * 画像チップをクリアする（×ボタンから呼ばれる）
 */
export function clearImagePreview() {
  document.getElementById('img-chip')?.classList.add('u-hidden');
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
export async function submitMissionClear(missionId) {
  const project = state.events.find(p => p.id === state.selectedEventId);
  const m = project?.missions.find(x => x.id === missionId);
  if (!project || !m) return;

  // チェック項目のバリデーション
  const checklist = Array.isArray(m.checklist) ? m.checklist : [];
  if (checklist.length > 0) {
    const checked = Array.from(document.querySelectorAll('[data-clear-checklist]'));
    const allChecked = checked.length === checklist.length && checked.every(c => c.checked);
    const errorEl = document.getElementById('clear-checklist-error');
    if (!allChecked) {
      if (errorEl) errorEl.classList.remove('u-hidden');
      return;
    }
    if (errorEl) errorEl.classList.add('u-hidden');
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

  // ── サーバーで永続化 ─────────────────────────────────────
  // PUT /api/data は canManage 必須のため、一般メンバーの完了が保存されず
  // 再読み込みで未完了に戻る不具合があった。完了は専用エンドポイントで永続化する。
  const r = await api.completeMission(project.id, missionId, { content, format: detectedFormat });
  if (!r.ok) {
    window._app?.showToast(r.error || '完了の保存に失敗しました', 'error');
    return;
  }

  logEvent('mission_completed', {
    missionId,
    tag:      m.tag || (Array.isArray(m.tags) ? m.tags[0] : null),
    format:   detectedFormat,
    priority: m.priority,
  });

  // 送信成功 → ローカルドラフト破棄
  _clearDraft.discard(missionId);
  // leaderCheck 提出時はインフォモーダルを再表示できるようリセット
  if (m.leaderCheck) state._infoModalShownForEvent = null;

  // サーバーの権威ある状態（status / individualClearedBy / clearedData）を取り込む
  await state.silentReloadEvents();

  document.getElementById('clear-mission-modal')?.remove();

  // ★ミッション詳細ページから完了したときは、そのページを自動で閉じてイベントページへ戻す。
  //   完了した画面に留まり続ける理由がなく、戻ったところでオンボーディングの
  //   「はじめての完了」（M4 / L6）を出したいため。
  //   詳細ページ以外（アーカイブの一覧など）から完了した場合は現在地を維持する。
  if (state.currentView === 'MISSION_DETAIL' && state.selectedMissionId === missionId) {
    state.closeMissionDetail();
  } else {
    state.render();
  }

  // トースト文言はサーバーが返した最新 status から判定
  const newStatus = r.mission?.status || 'yet';
  if (m.individualClear && newStatus === 'yet') {
    window._app?.showToast('完了を記録しました');
  } else {
    window._app?.showToast(m.leaderCheck ? 'リーダーチェック提出完了' : 'ミッション完了');
  }
}

/**
 * 画像ファイル選択を処理する
 * @param {HTMLInputElement} input
 */
// 提出物画像の上限。server.js の SUBMISSION_MAX_BYTES と揃えること（2MB）。
const SUBMISSION_MAX_BYTES = 2 * 1024 * 1024;
const RESIZE_MAX_EDGE      = 1600;  // 長辺の上限(px)
const RESIZE_QUALITY       = 0.8;   // JPEG 品質

/**
 * dataURL を canvas で縮小する。スマホの写真は 3〜8MB あり、そのままでは
 * サーバの上限（2MB）に引っかかるため送信前に必ず通す。
 * 既に上限内かつ小さい画像は再エンコードせず元のまま返す（無駄な劣化を避ける）。
 * @param {string} dataUrl
 * @returns {Promise<string>} 縮小後の dataURL（失敗時は元の dataURL）
 */
function _resizeImageDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const longEdge = Math.max(img.width, img.height);
        // 十分小さく、かつ上限内ならそのまま使う
        if (longEdge <= RESIZE_MAX_EDGE && dataUrl.length <= SUBMISSION_MAX_BYTES) {
          return resolve(dataUrl);
        }
        const scale = Math.min(1, RESIZE_MAX_EDGE / longEdge);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        // JPEG は透過を持てないので白で下地を塗る（PNG の透過部分が黒くなるのを防ぐ）
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        let out = canvas.toDataURL('image/jpeg', RESIZE_QUALITY);
        // まだ大きい場合は品質を段階的に落とす
        for (let q = 0.6; out.length > SUBMISSION_MAX_BYTES && q >= 0.4; q -= 0.2) {
          out = canvas.toDataURL('image/jpeg', q);
        }
        resolve(out);
      } catch (_) {
        resolve(dataUrl);   // 失敗しても送信は止めない（サーバ側で弾かれる）
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function handleImageSelect(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const resized = await _resizeImageDataUrl(e.target.result);
    if (resized.length > SUBMISSION_MAX_BYTES) {
      window._app?.showToast('画像サイズが大きすぎます。別の画像を選んでください', 'error');
      input.value = '';
      return;
    }
    const chip    = document.getElementById('img-chip');
    const preview = document.getElementById('preview-img');
    if (chip && preview) {
      preview.src = resized;
      preview.dataset.base64 = resized;
      chip.classList.remove('u-hidden');
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
 * ミッションのディープリンク（/m/<eventId>/<missionId>）をクリップボードにコピーする。
 * 管理者はミートボールメニュー、一般ユーザーはリンクアイコンから呼ばれる。
 * @param {string} missionId
 */
export function copyMissionLink(missionId) {
  const url = `${location.origin}/m/${state.selectedEventId}/${missionId}`;
  logEvent('mission_link_copied', { missionId });
  navigator.clipboard.writeText(url)
    .then(() => window._app?.showToast('ミッションリンクをコピーしました'))
    .catch(() => window._app?.showToast('コピーに失敗しました: ' + url, 'error'));
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
