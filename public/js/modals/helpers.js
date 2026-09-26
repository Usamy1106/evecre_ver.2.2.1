// ===== ヘルパーモーダル =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { openCalendarModal } from './calendar.js';
import { getArchiveSummary, setArchiveSummary, getArchiveVenue, setArchiveVenue } from '../utils.js';
import { REFLECT_SKIP_MISSION_IDS } from '../constants.js';
import {
  editorEl, readEditor, setEditorText, bindClearEditor, insertImageFiles,
  itemsForKeys, resetEditorImages,
} from '../clearEditor.js';

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
    //   以前はタスクをタイトルで探して venue-temp を作っていたが、アーカイブ側は
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
    // タスク経由ではなく専用ダイアログで画像を保存
    _openArchiveImageDialog(p);
    return;
  }

  openEditModal(titleLabel, currentVal, format, (newVal) => {
    let m = p.missions.find(x => x.id === missionId);
    if (!m) {
      m = {
        id: missionId,
        // venue / summary はここを通らない（上で早期 return して utils.js 経由で保存する）
        // ★イベント作成時に def-2 を自動生成しなくなったので、タイトルは必ず
        //   ここで作られる。type をそのまま入れると 'title' という名前になる。
        title: type === 'url'   ? '広報リンクを挿入'
             : type === 'title' ? 'イベントのタイトルを決める'
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
  const inputEl = editorEl();
  // ★編集欄は描き直しをまたいで同じノードが戻ってくる（missionDetail.js）。
  //   配線済みなら中身は書きかけのまま＝下書きで上書きしない。
  const fresh = inputEl && !inputEl._bound;
  if (draft) {
    // テキスト復元
    // ★下書きに残すのは文章とチェックだけ。画像は入れない（複数枚の dataURL は
    //   localStorage の約5MBをすぐにあふれる）。旧形式の下書きに残っている画像は読まない。
    if (fresh && draft.content && !draft.content.startsWith('data:image')) {
      setEditorText(inputEl, draft.content);
    }
    // チェックボックス復元（チェックボックスは描き直しのたびに新しいノード）
    if (Array.isArray(draft.checked)) {
      document.querySelectorAll('[data-clear-checklist]').forEach(cb => {
        const idx = parseInt(cb.dataset.clearChecklist, 10);
        if (draft.checked[idx]) cb.checked = true;
      });
    }
  }

  // === ドラフト自動保存 ===
  // ★文章だけ。画像の印（{{image:N}}）は外す（画像は下書きに入らないので、印だけ残ると宙に浮く）
  const snapshot = () => {
    const el      = editorEl();
    const content = el ? readEditor(el).text.replace(/\{\{image:\d+\}\}/g, '') : '';
    const checked = Array.from(document.querySelectorAll('[data-clear-checklist]')).map(cb => !!cb.checked);
    _clearDraft.save(missionId, { content, checked });
  };
  bindClearEditor(inputEl, { onChange: snapshot });
  document.querySelectorAll('[data-clear-checklist]').forEach(cb => {
    cb.addEventListener('change', snapshot);
  });
  if (container) container._snapshot = snapshot;
}

/**
 * タスク完了を確定する
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

  // ── 本文と画像 ───────────────────────────────────────────
  // ★本文の中に画像の位置（{{image:N}}）が入る（clearEditor.js の readEditor）。
  //   format は本文の種類（URL だけ → link、それ以外 → text）。
  //   画像だけのときは本文を空で送り 'image'（サーバーが旧形式の content にも1枚目を入れる）。
  const read       = readEditor(editorEl());
  const images     = itemsForKeys(read.keys);
  const textValue  = read.plain ? read.text : '';

  const detectedFormat = (images.length > 0 && !read.plain) ? 'image'
    : (images.length === 0 && /^https?:\/\/\S+$/i.test(read.plain)) ? 'link'
    : 'text';

  if (!read.plain && images.length === 0 && !m.noInput) {
    window._app?.showToast('入力を完了させてください', 'error');
    return;
  }

  // ── 画像を1枚ずつ送る ───────────────────────────────────
  // ★Promise.all で並列に送らないこと（サーバーは 512MB / 0.5CPU。dataURL の展開が重なると詰まる）。
  // ★1枚でも失敗したら完了しない。何枚目が失敗したかを伝える（黙って一部だけ保存しない）。
  //   送れた分は url を覚えておき、もう一度押したときは残りだけを送る。
  if (_clearSubmitting) return;
  _clearSubmitting = true;
  const buttons = [...document.querySelectorAll('[data-clear-submit]')];
  const labels  = buttons.map(b => b.textContent);
  const setBusy = (text) => buttons.forEach(b => { b.disabled = !!text; if (text) b.textContent = text; });
  const restore = () => { buttons.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; }); _clearSubmitting = false; };

  try {
    for (let i = 0; i < images.length; i++) {
      const it = images[i];
      if (it.url) continue;
      setBusy(`画像を送信中… ${i + 1}/${images.length}`);
      const up = await api.uploadSubmissionImage(project.id, it.dataUrl);
      if (!up?.ok || !up.url) {
        const why = up?.code === 'network' ? '通信状況を確認して、'
          : up?.error === 'image_too_large' ? '画像が大きすぎます。別の画像にするか、'
          : '';
        window._app?.showToast(`${i + 1}枚目の画像を送れませんでした。${why}もう一度「完了する」を押してください`, 'error');
        logEvent('submission_image_failed', { missionId, index: i, count: images.length, error: up?.code || up?.error || null });
        restore();
        return;
      }
      it.url = up.url;
    }
    setBusy('送信中…');
  } catch (e) {
    restore();
    throw e;
  }

  // ── サーバーで永続化 ─────────────────────────────────────
  // PUT /api/data は canManage 必須のため、一般メンバーの完了が保存されず
  // 再読み込みで未完了に戻る不具合があった。完了は専用エンドポイントで永続化する。
  // ── 振り返りは完了**後**に聞く（views/missionReflect.js のページ）─────────
  // ★完了フォームには振り返りの入力欄を置かない（2026-09-20 に移設）。
  //   完了ボタンまでの道のりを軽くし、達成感がいちばん高い直後に聞くため。
  //   ★ここで struggle / solution を送らないこと。送ると空文字で上書きされる。
  const r = await api.completeMission(project.id, missionId, {
    content: textValue, format: detectedFormat, images: images.map(it => it.url),
  });
  restore();
  if (!r.ok) {
    window._app?.showToast(r.error || '完了の保存に失敗しました', 'error');
    return;
  }
  // 送信済み → 選んだ画像を捨てる
  resetEditorImages();

  logEvent('mission_completed', {
    missionId,
    tag:      m.tag || (Array.isArray(m.tags) ? m.tags[0] : null),
    format:   detectedFormat,
    imageCount: images.length,
    priority: m.priority,
    // ★振り返りは完了後のページで書く。書かれたかどうかは reflect_saved で数える
  });

  // 送信成功 → ローカルドラフト破棄
  _clearDraft.discard(missionId);
  // leaderCheck 提出時はインフォモーダルを再表示できるようリセット
  if (m.leaderCheck) state._infoModalShownForEvent = null;

  // サーバーの権威ある状態（status / individualClearedBy / clearedData）を取り込む
  await state.silentReloadEvents();

  // ★山の演出（マスに色がつく／次のマスが現れる）は、実際にマスが増えたときだけ。
  //   マスの数は「完了数 + 先の1マス」なので、status が 'cleared' になった時にしか増えない。
  //   leaderCheck（承認待ち）と、individualClear で全員が終わっていない間は
  //   status が 'yet' / 'pending_leader_check' のままなので、ここで祝うと
  //   「増えていないのに祝う」ことになる。フラグは renderMainBoard が消費する。
  if (r.mission?.status === 'cleared') state.mountainCelebrate = true;

  document.getElementById('clear-mission-modal')?.remove();

  // ★完了したら振り返りページへ進む（modals ではなくページ。views/missionReflect.js）。
  //   ★入力欄が無いタスク（noInput）と、イベント作成時に入る初期タスク（目的・概要。
  //     constants.js の REFLECT_SKIP_MISSION_IDS）では出さない。書くことが無い／
  //     決める作業で成否を問う対象ではないため（アーカイブからはいつでも書ける）。
  //   ★リーダーチェックの提出・個別完了（自分ぶんだけ完了）でも出す。提出物はもう
  //     作られていて、振り返りは自分の提出物に対して書けるため。
  // ★タスク詳細ページから完了したときは、そのページを閉じてから遷移する。完了した画面に
  //   留まり続ける理由がなく、ボードへ戻ったところでオンボーディングの
  //   「はじめての完了」（M4 / L6）を出したいため。
  const returnTab = state.currentView === 'MISSION_DETAIL'
    ? (state.missionDetailReturn?.tab || state.mainBoardTab)
    : state.mainBoardTab;
  if (state.currentView === 'MISSION_DETAIL' && state.selectedMissionId === missionId) {
    state.selectedMissionId = null;
    state.missionDetailReturn = null;
    state.missionChat = null;
  }
  // ★初期タスク（目的・概要）でも出さない。決める作業で、成否を問う対象ではない
  if (m.noInput || REFLECT_SKIP_MISSION_IDS.includes(m.id)) {
    if (state.currentView === 'MISSION_DETAIL') {
      state.currentView = 'MAIN_BOARD';
      state.mainBoardTab = returnTab;
      window.scrollTo(0, 0);
    }
    state.render();
  } else {
    state.openMissionReflect(missionId, { tab: returnTab });
  }

  // トースト文言はサーバーが返した最新 status から判定
  const newStatus = r.mission?.status || 'yet';
  if (m.individualClear && newStatus === 'yet') {
    window._app?.showToast('完了を記録しました');
  } else {
    window._app?.showToast(m.leaderCheck ? 'リーダーチェック提出完了' : 'タスク完了');
  }

  // 山に出たオブジェクトを続けて知らせる。
  // ★期限内に終わらせて珍しいものが出たことが伝わらないと、動機づけとして働かない。
  //   抽選はサーバーが行い、結果（tier つき）をレスポンスで返してくる。
  _announceMountainObject(r.object);
}

/**
 * 完了で出たオブジェクトをトーストで伝える。
 * ★tier で文言を変える。tag は毎回必ず出るので控えめに、期限内でしか引けない
 *   ontime / rare は「期限内に終わらせたから出た」と分かる言い方にする。
 */
async function _announceMountainObject(rolled) {
  if (!rolled?.objectId) return;
  try {
    const { findObject } = await import('../mountainObjects.js');
    const o = findObject(rolled.objectId);
    if (!o) return;
    const msg = rolled.objectTier === 'rare'
      ? `期限内達成！めずらしい「${o.name}」が現れた ${o.icon}`
      : rolled.objectTier === 'ontime'
        ? `期限内達成！「${o.name}」が現れた ${o.icon}`
        : `山に「${o.name}」が増えた ${o.icon}`;
    // 完了トーストと重ならないよう少し遅らせる
    setTimeout(() => window._app?.showToast(msg), 1800);
  } catch (_) { /* 演出なので、失敗しても完了自体は成立している */ }
}

// ★縮小と 2MB 上限は clearEditor.js（_resizeImageDataUrl / SUBMISSION_MAX_BYTES）に移した

// 完了の送信中か（二重送信を防ぐ）
let _clearSubmitting = false;

/**
 * 画像ボタンで選んだとき（複数選択可）。カーソルがあった位置へ入れる。
 * ★縮小・2MB 上限・枚数の上限は clearEditor.js の insertImageFiles が1枚ごとに通す。
 * @param {HTMLInputElement} input
 */
export async function handleImageSelect(input) {
  const files = [...(input.files || [])];
  input.value = '';   // 同じ画像をもう一度選べるように
  const el = editorEl();
  if (!el || files.length === 0) return;
  await insertImageFiles(el, files, null, el._onEditorChange);
}

// ===== 招待機能 =====

/**
 * タスクのディープリンク（/m/<eventId>/<missionId>）をクリップボードにコピーする。
 * 管理者はミートボールメニュー、一般ユーザーはリンクアイコンから呼ばれる。
 * @param {string} missionId
 */
export function copyMissionLink(missionId) {
  const url = `${location.origin}/m/${state.selectedEventId}/${missionId}`;
  logEvent('mission_link_copied', { missionId });
  navigator.clipboard.writeText(url)
    .then(() => window._app?.showToast('リンクをコピーしました'))
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


// ===== タスク完了入力のローカルドラフト =====
// 入力途中でモーダルを閉じても、同じユーザーが再度開けば内容が復元される。
// 他ユーザーには共有されない（localStorage はそのブラウザ・そのアカウントだけ）。
// 「完了する」で送信成功した時点で破棄。

const DRAFT_KEY_PREFIX = 'evecre:clearDraft:v1';

/** key 生成（ユーザー × イベント × タスク）*/
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
