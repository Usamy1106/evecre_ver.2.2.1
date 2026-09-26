// ===== ヘルパーモーダル =====
import { state } from '../state.js';
import { api }   from '../api.js';
import { logEvent } from '../logger.js';
import { openCalendarModal } from './calendar.js';
import { getArchiveSummary, setArchiveSummary, getArchiveVenue, setArchiveVenue, getEventMainVisual } from '../utils.js';
import { REFLECT_SKIP_MISSION_IDS } from '../constants.js';
import {
  editorEl, readEditor, setEditorText, bindClearEditor, insertFiles,
  itemsForKeys, resetEditorImages, prepareImageFile,
} from '../clearEditor.js';

// ===== アーカイブ直接編集 =====

/**
 * アーカイブの基礎情報を編集する（管理者のみ）
 * ★どれもイベント自身の項目を書く（2026-09-26）。タスクの提出物（clearedData）は書かない。
 *   以前はタイトルで def-2 のタスクを作り、URL で「広報リンクを挿入」のタスクを作っていた。
 * @param {'title'|'summary'|'venue'|'period'|'image'} type
 */
export function editArchiveItem(type) {
  if (!state.canManageCurrentEvent()) return; // 管理者権限なし
  const p = state.events.find(x => x.id === state.selectedEventId);
  if (!p) return;

  if (type === 'title') {
    // ★タイトル＝イベント名（イベントページ・イベント設定と同じもの）
    openEditModal('イベント名', p.name || '', 'plain', (newVal) => {
      const v = String(newVal || '').trim();
      if (!v) { window._app?.showToast('イベント名を入力してください', 'error'); return; }
      p.name = v;
      state.save();
      state.render();
    });
  } else if (type === 'summary') {
    // ★イベント設定の「概要」と同じ場所を読み書きする（utils.js に集約）
    openEditModal('概要', getArchiveSummary(p), 'text', (newVal) => {
      setArchiveSummary(p, newVal);
      state.save();
      state.render();
    });
  } else if (type === 'venue') {
    // ★イベント設定の「開催場所」と同じ場所を読み書きする（utils.js に集約）
    openEditModal('開催場所', getArchiveVenue(p), 'plain', (newVal) => {
      setArchiveVenue(p, newVal);
      state.save();
      state.render();
    });
  } else if (type === 'period') {
    // テキスト入力ではなくカレンダー UI で開催日を編集
    openCalendarModal('projectEdit');
  } else if (type === 'image') {
    _openArchiveImageDialog(p);
  }
}

/**
 * ヘッダー画像を設定するダイアログ。
 * ★画像は選んだ時点で縮小し（clearEditor.js の prepareImageFile。提出画像と同じ上限）、
 *   「保存」で R2 に送って URL を p.headerImage に入れる。dataURL をイベントに持たせないこと
 *   （サーバーの _sanitizeEventFields が捨てる）。前の画像はサーバーが R2 から消す。
 */
function _openArchiveImageDialog(p) {
  const overlay = document.createElement('div');
  overlay.id = 'archive-image-dialog';
  // スタイル: public/css/object/project/_archive.css
  overlay.className = 'c-overlay c-overlay--edit c-overlay--blur';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const current = getEventMainVisual(p);
  overlay.innerHTML = `
    <div class="c-modal c-modal--left u-animate-fade">
      <h3 class="c-modal__title c-modal__title--loose">ヘッダー画像を設定</h3>
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

  let selected = null;
  const saveBtn = overlay.querySelector('[data-action="save"]');

  overlay.querySelector('#arch-file-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = await prepareImageFile(file);
    if (r.error) {
      window._app?.showToast(r.error === 'too_large'
        ? '画像が大きすぎます。別の画像を選んでください'
        : 'この形式の画像は読み込めませんでした（HEIC などは JPEG か PNG にしてください）', 'error');
      return;
    }
    selected = r.dataUrl;
    overlay.querySelector('#arch-img-src').src = selected;
    overlay.querySelector('#arch-img-preview').classList.remove('u-hidden');
    saveBtn.disabled = false;
  };

  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove();
  saveBtn.onclick = async () => {
    if (!selected) return;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="c-spinner__inline"><span class="c-spinner c-spinner--xs c-spinner--inverse"></span>保存中…</span>`;
    const up = await api.uploadSubmissionImage(p.id, selected);
    if (!up?.ok || !up.url) {
      window._app?.showToast('画像を保存できませんでした。もう一度お試しください', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
      return;
    }
    p.headerImage = up.url;
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
  // ★文章だけ。画像・PDF の印（{{image:N}} / {{file:N}}）は外す（下書きに入らないので、印だけ残ると宙に浮く）
  const snapshot = () => {
    const el      = editorEl();
    const content = el ? readEditor(el).text.replace(/\{\{(image|file):\d+\}\}/g, '') : '';
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
  const files      = itemsForKeys(read.fileKeys);
  const { content: textValue, format: detectedFormat } = editorContentAndFormat(read, images, files);

  if (!read.plain && images.length === 0 && files.length === 0 && !m.noInput) {
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
  // ★送信中はくるくる＋何をしているか（画像・PDF を送る間は数秒〜数十秒かかる）
  const setBusy = (text) => buttons.forEach(b => {
    b.disabled = true;
    b.innerHTML = `<span class="c-spinner__inline"><span class="c-spinner c-spinner--xs c-spinner--inverse"></span>${_esc(text)}</span>`;
  });
  const restore = () => { buttons.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; }); _clearSubmitting = false; };

  try {
    if (!(await uploadEditorEmbeds(project.id, missionId, images, files, setBusy, '完了する'))) {
      restore();
      return;
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
    content: textValue, format: detectedFormat, ...embedsPayload(images, files),
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
    fileCount:  files.length,
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

/**
 * 編集欄に置いた画像・PDF を、まだ送っていないものだけ1つずつ送る（完了フォームと提出内容の編集で共用）。
 * ★Promise.all で並列に送らないこと（サーバーは 512MB / 0.5CPU。dataURL の展開が重なると詰まる）。
 * ★1つでも失敗したら false（呼び出し側は保存しない）。何枚目が失敗したかを伝える（黙って一部だけ保存しない）。
 *   送れた分は url を覚えておき、もう一度押したときは残りだけを送る。
 * @param {string} eventId
 * @param {string} missionId   ログ用
 * @param {object[]} images    clearEditor の itemsForKeys（{ dataUrl, url }）
 * @param {object[]} files     同（{ kind:'file', blob, name, size, thumbDataUrl, url, thumbUrl, thumbReady }）
 * @param {(text:string) => void} setBusy  送信中の表示
 * @param {string} retryLabel  失敗時に「もう一度『○○』を押して」と案内するボタン名
 * @returns {Promise<boolean>}
 */
export async function uploadEditorEmbeds(eventId, missionId, images, files, setBusy, retryLabel) {
  for (let i = 0; i < images.length; i++) {
    const it = images[i];
    if (it.url) continue;
    setBusy(`画像を送信中… ${i + 1}/${images.length}`);
    const up = await api.uploadSubmissionImage(eventId, it.dataUrl);
    if (!up?.ok || !up.url) {
      const why = up?.code === 'network' ? '通信状況を確認して、'
        : up?.error === 'image_too_large' ? '画像が大きすぎます。別の画像にするか、'
        : '';
      window._app?.showToast(`${i + 1}枚目の画像を送れませんでした。${why}もう一度「${retryLabel}」を押してください`, 'error');
      logEvent('submission_image_failed', { missionId, index: i, count: images.length, error: up?.code || up?.error || null });
      return false;
    }
    it.url = up.url;
  }
  // PDF：1つずつ。1ページ目の絵を描き終えるのを待ってから送る
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.url && (f.thumbUrl || !f.thumbDataUrl)) continue;
    setBusy(files.length > 1 ? `PDFを送信中… ${i + 1}/${files.length}` : 'PDFを送信中…');
    await f.thumbReady;
    if (!f.url) {
      const up = await api.uploadSubmissionFile(eventId, f.blob);
      if (!up?.ok || !up.url) {
        const why = up?.code === 'network' ? '通信状況を確認して、'
          : up?.error === 'file_too_large' ? 'ファイルが大きすぎます（10MBまで）。'
          : up?.error === 'invalid_file' ? 'PDF として読めませんでした。'
          : '';
        window._app?.showToast(`「${f.name}」を送れませんでした。${why}もう一度「${retryLabel}」を押してください`, 'error');
        logEvent('submission_file_failed', { missionId, index: i, count: files.length, error: up?.code || up?.error || null });
        return false;
      }
      f.url = up.url;
    }
    // 1ページ目の絵（無くても添付はできるので、失敗しても止めない）
    if (f.thumbDataUrl && !f.thumbUrl) {
      const tu = await api.uploadSubmissionImage(eventId, f.thumbDataUrl);
      if (tu?.ok && tu.url) f.thumbUrl = tu.url; else f.thumbDataUrl = null;
    }
  }
  return true;
}

/**
 * 編集欄の中身から、保存する本文と format を決める（完了フォームと提出内容の編集で共用）。
 * ★画像だけのときは本文を空で送る（サーバーが旧形式の content に1枚目を入れる）。
 *   PDF があるときは、画像との並び順を残すため印つきの本文を送る
 * @returns {{ content: string, format: 'text'|'image'|'link' }}
 */
export function editorContentAndFormat(read, images, files) {
  const content = (read.plain || files.length > 0) ? read.text : '';
  const format = (images.length > 0 && files.length === 0 && !read.plain) ? 'image'
    : (images.length === 0 && files.length === 0 && /^https?:\/\/\S+$/i.test(read.plain)) ? 'link'
    : 'text';
  return { content, format };
}

/** 送った画像・PDF を、保存用の形（images / files）にする */
export function embedsPayload(images, files) {
  return {
    images: images.map(it => it.url),
    files:  files.map(f => ({ url: f.url, name: f.name, size: f.size, thumb: f.thumbUrl || null })),
  };
}

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
  await insertFiles(el, files, null, el._onEditorChange);
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
