// ===== 参加申請フォーム =====
// 招待リンク経由（入口A）と招待コード入力（入口B）の**両方**から呼ばれる共通モジュール。
// ★片方だけに実装するとデータが欠けるので、必ずここを経由させること。
//
// 位置づけは「アンケート」ではなく「参加申請フォーム」。イベクリの利用者は事前に
// チームができている場合が多く、参加をためらう段階ではないため、申請に数項目あるのは
// 自然で離脱要因にならない。
//
// ★モーダル形式で1問ずつ順に聞く（ボトムシートに2問並べない）。
//   下の「次へ」で進み、2問目で送信する。「戻る」でスキルタグの選択は保持される。
//
// STEP 1  スキルタグ（タップで 未選択 → 得意 → やってみたい → 未選択 と回る2状態）
// STEP 2  意気込み（自由記述・任意）
// どちらも未回答のまま申請できる（必須にしない）。
//
// 送信＝ POST /api/invites/:token/accept。回答は pendingMembers のエントリに載り、
// 承認時に members へ引き継がれる（server.js）。

import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { Components } from '../components.js';
import { SKILL_TAGS, JOIN_MESSAGE_EXAMPLES } from '../constants.js';

const OVERLAY_ID = 'join-form-modal';
const MAX_MESSAGE = 200;
const PLACEHOLDER_INTERVAL_MS = 3000;

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * 参加申請フォームを開く。
 * @param {object}   opts
 * @param {object}   opts.invite  招待プレビュー（GET /api/invites/:token の invite）
 * @param {string}   opts.token   招待トークン
 * @param {'invite_link'|'code'} opts.entry どちらの入口から来たか（計測用）
 * @param {function} opts.onDone  accept 成功時に呼ばれる。引数はサーバーのレスポンス
 */
export function openJoinFormModal({ invite, token, entry = 'code', onDone }) {
  if (document.getElementById(OVERLAY_ID)) return;

  // skills[tagId] = 'good' | 'want'（未選択のキーは持たない）
  // step は 1（スキルタグ）→ 2（意気込み）。1問ずつ順に聞く。
  const ctx = { step: 1, skills: {}, message: '', sending: false, error: '' };
  let placeholderIdx = 0;
  let placeholderTimer = null;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'fixed inset-0 z-[240] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6';
  document.body.appendChild(overlay);

  logEvent('join_form_shown', { entry });

  const close = () => {
    clearInterval(placeholderTimer);
    overlay.remove();
  };

  /** モーダルの外枠。本文だけ差し替える（1問ずつ表示） */
  const shell = (body, footer) => `
    <div class="bg-white rounded-3xl w-full max-w-sm shadow-2xl max-h-[85vh] flex flex-col animate-fadeIn">
      <div class="shrink-0 px-7 pt-7 pb-2">
        <p class="text-[11px] text-[#A7AAAC] font-bold text-center">
          「${_esc(invite?.eventName || 'イベント')}」に参加を申請
        </p>
      </div>
      <div class="flex-1 overflow-y-auto px-7 py-4">${body}</div>
      <div class="shrink-0 px-7 pb-7 pt-2">
        ${Components.StepIndicator(ctx.step, 2, { compact: true })}
        ${ctx.error ? `<p class="text-[11px] text-[#EE3E12] font-bold text-center mb-2">${_esc(ctx.error)}</p>` : ''}
        ${footer}
      </div>
    </div>`;

  const render = () => {
    if (ctx.step === 1) {
      // Q1 スキルタグ。タップで始めるのは、いきなりテキスト入力を出すと止まるため
      overlay.innerHTML = shell(`
        <h3 class="text-[16px] font-bold text-[#484545] text-center mb-2">できること・<br>やってみたいこと</h3>
        <p class="text-[11px] text-[#A7AAAC] font-bold text-center mb-4 leading-relaxed">
          タップで切り替わります<br>選ばなくても申請できます
        </p>
        <div class="flex items-center justify-center gap-4 mb-4">
          <span class="flex items-center gap-1 text-[10px] font-bold text-[#0CA1E3]">
            <span class="w-2.5 h-2.5 rounded-full bg-[#0CA1E3]"></span>得意
          </span>
          <span class="flex items-center gap-1 text-[10px] font-bold text-[#7BB100]">
            <span class="w-2.5 h-2.5 rounded-full bg-[#9EDF05]"></span>やってみたい
          </span>
        </div>
        <div class="flex flex-wrap gap-2 justify-center">
          ${SKILL_TAGS.map(t => _tagHtml(t, ctx.skills[t.id])).join('')}
        </div>
      `, `
        <button id="jf-next" class="btn-primary w-full py-4 heading-m font-bold shadow-lg">次へ</button>
        <button id="jf-cancel" class="w-full py-3 mt-1 text-[13px] font-bold text-[#A7AAAC]">やめる</button>
      `);

      // タグのトグル（未選択 → 得意 → やってみたい → 未選択）
      overlay.querySelectorAll('[data-jf-tag]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.jfTag;
          const cur = ctx.skills[id];
          if (!cur) ctx.skills[id] = 'good';
          else if (cur === 'good') ctx.skills[id] = 'want';
          else delete ctx.skills[id];
          render();
        });
      });

      document.getElementById('jf-next').onclick = () => { ctx.step = 2; ctx.error = ''; render(); };
      document.getElementById('jf-cancel').onclick = () => close();
      return;
    }

    // Q2 意気込み（任意）
    overlay.innerHTML = shell(`
      <h3 class="text-[16px] font-bold text-[#484545] text-center mb-2">
        意気込み <span class="text-[12px] text-[#A7AAAC]">（任意）</span>
      </h3>
      <p class="text-[11px] text-[#A7AAAC] font-bold text-center mb-4">承認されるとチームに共有されます</p>
      <textarea id="jf-message" rows="4" maxlength="${MAX_MESSAGE}"
        placeholder="${_esc(JOIN_MESSAGE_EXAMPLES[placeholderIdx])}"
        class="input-field w-full px-4 py-3 text-[13px] focus:outline-none resize-none">${_esc(ctx.message)}</textarea>
      <p id="jf-count" class="text-[10px] text-[#A7AAAC] font-bold text-right mt-1">${ctx.message.length}/${MAX_MESSAGE}</p>
    `, `
      <button id="jf-submit" class="btn-primary w-full py-4 heading-m font-bold shadow-lg"
        ${ctx.sending ? 'disabled style="opacity:.5"' : ''}>
        ${ctx.sending ? '送信中…' : '参加を申請する'}
      </button>
      <button id="jf-back" class="w-full py-3 mt-1 text-[13px] font-bold text-[#A7AAAC]"
        ${ctx.sending ? 'disabled' : ''}>戻る</button>
    `);

    // 入力のたびに再描画するとフォーカスが飛ぶので、state と文字数だけ更新する
    const ta = document.getElementById('jf-message');
    ta?.addEventListener('input', (e) => {
      ctx.message = e.target.value;
      const counter = document.getElementById('jf-count');
      if (counter) counter.textContent = `${ctx.message.length}/${MAX_MESSAGE}`;
    });

    // 戻ってもスキルタグの選択は保持される（ctx を作り直さないため）
    document.getElementById('jf-back').onclick = () => { if (!ctx.sending) { ctx.step = 1; ctx.error = ''; render(); } };
    document.getElementById('jf-submit').onclick = () => _submit();
  };

  async function _submit() {
    if (ctx.sending) return;
    ctx.sending = true; ctx.error = '';
    render();

    const skillsGood = Object.keys(ctx.skills).filter(k => ctx.skills[k] === 'good');
    const skillsWant = Object.keys(ctx.skills).filter(k => ctx.skills[k] === 'want');
    const message    = ctx.message.trim();

    logEvent('join_form_submitted', {
      entry,
      skillsGoodCount: skillsGood.length,
      skillsWantCount: skillsWant.length,
      hasMessage: !!message,
    });
    // 2問とも未回答のまま申請された割合を必ず取る。
    // これが多ければフォーム自体が機能していないということ。
    if (skillsGood.length === 0 && skillsWant.length === 0 && !message) {
      logEvent('join_form_skipped_all', { entry });
    }

    try {
      const r = await api.acceptInvite(token, { skillsGood, skillsWant, joinMessage: message });
      if (r?.ok) {
        close();
        onDone?.(r);
      } else {
        ctx.sending = false;
        ctx.error = _explainError(r?.error);
        render();
      }
    } catch (_) {
      ctx.sending = false;
      ctx.error = 'ネットワークエラーが発生しました';
      render();
    }
  }

  render();

  // プレースホルダーを順に切り替えて書き出しを促す。
  // ★入力中は切り替えない（気が散るため）。close() で必ず止める。
  placeholderTimer = setInterval(() => {
    const ta = document.getElementById('jf-message');
    if (!ta || ta.value) return;
    placeholderIdx = (placeholderIdx + 1) % JOIN_MESSAGE_EXAMPLES.length;
    ta.placeholder = JOIN_MESSAGE_EXAMPLES[placeholderIdx];
  }, PLACEHOLDER_INTERVAL_MS);
}

/** タグ1つ。得意＝青、やってみたい＝黄緑。色だけに頼らずアイコンでも区別する */
function _tagHtml(tag, stateVal) {
  if (stateVal === 'good') {
    return `
      <button data-jf-tag="${tag.id}"
        class="flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-full border-2
          border-[#0CA1E3] bg-[#0CA1E3]/10 text-[#0CA1E3] active:scale-95 transition-all">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        ${_esc(tag.label)}
      </button>`;
  }
  if (stateVal === 'want') {
    return `
      <button data-jf-tag="${tag.id}"
        class="flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-full border-2
          border-[#9EDF05] bg-[#9EDF05]/10 text-[#7BB100] active:scale-95 transition-all">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        ${_esc(tag.label)}
      </button>`;
  }
  return `
    <button data-jf-tag="${tag.id}"
      class="text-[12px] font-bold px-3.5 py-2 rounded-full border-2
        border-[#E1DFDC] bg-white text-[#A7AAAC] active:scale-95 transition-all">
      ${_esc(tag.label)}
    </button>`;
}

function _explainError(code) {
  switch (code) {
    case 'invite_not_found':  return '招待が見つかりません。リンクが取り消された可能性があります';
    case 'invite_expired':    return '招待の有効期限が切れています';
    case 'invite_used_up':    return '招待の使用上限に達しています';
    case 'project_not_found': return 'イベントが見つかりません';
    default: return code || '参加申請に失敗しました';
  }
}
