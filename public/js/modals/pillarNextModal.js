// ===== 柱を決めたあと「やることを作ってみよう」（2026-11-12）=====
//
// ★出すのは、柱を**初めて**保存したあとに1回だけ（views/pillarEdit.js の _save が印を立てる）。管理者だけ
// ★メインボードに戻ったとき、他の自動モーダルが出ていなければ出す（modalGuard に登録済み）
// ★前の代があるイベントでは「前の代のタスクから追加する」も出す（2026-11-14。views/handoverPick.js）
// ★既読はユーザー×イベント（localStorage）。出せたときに 'done' にする
// ★「やることを作る」でタスク作成のシートを開く。「あとで」で閉じるだけ

import { state } from '../state.js';
import { logEvent } from '../logger.js';
import { getPillars } from '../utils.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';

const OVERLAY_ID = 'pillar-next-overlay';
const _key = (uid, eid) => `evecre:pillarNext:v1:${uid}:${eid}`;
const _get = (uid, eid) => { try { return localStorage.getItem(_key(uid, eid)); } catch (_) { return 'done'; } };
const _set = (uid, eid, v) => { try { localStorage.setItem(_key(uid, eid), v); } catch (_) {} };
const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 柱を初めて保存したときに呼ぶ（pillarEdit.js）。一度出したイベントでは立て直さない */
export function markPillarNextPending(eventId) {
  const uid = state.currentUser?.id;
  if (!uid || !eventId || _get(uid, eventId) === 'done') return;
  _set(uid, eventId, 'pending');
}

export function checkPillarNext() {
  if (state.currentView !== 'MAIN_BOARD' || state.mainBoardTab !== 'MAIN') return;
  const p = state.events.find(e => e.id === state.selectedEventId);
  const uid = state.currentUser?.id;
  if (!p || !uid || _get(uid, p.id) !== 'pending' || !state.canManageCurrentEvent()) return;
  if (document.getElementById(OVERLAY_ID) || isAnyAutoModalOpen(OVERLAY_ID)) return;
  const pillars = getPillars(p).map(x => x.name).filter(Boolean);
  if (!pillars.length) return;

  const ov = document.createElement('div');
  ov.id = OVERLAY_ID;
  ov.className = 'c-overlay c-overlay--center c-overlay--blur u-animate-fade';
  ov.innerHTML = `
    <div class="p-pillar-next" role="dialog" aria-modal="true" aria-labelledby="pnext-title">
      <h2 id="pnext-title" class="p-pillar-next__title">柱が決まりました！</h2>
      <ul class="p-pillar-next__pillars">${pillars.map(n => `<li class="p-pillar-next__pillar">${_esc(n)}</li>`).join('')}</ul>
      <p class="p-pillar-next__text">次は、この柱を進める「やること」を作ってみよう。<br>まずはひとつで大丈夫です。</p>
      <button type="button" class="c-button c-button--primary p-pillar-next__go" data-pnext-go>やることを作る</button>
      ${p.parentEventId ? `<button type="button" class="c-button c-button--secondary p-pillar-next__go p-pillar-next__handover" data-pnext-handover>前の代のタスクから追加する</button>` : ''}
      <button type="button" class="p-pillar-next__later" data-pnext-later>あとで</button>
    </div>`;
  document.body.appendChild(ov);
  if (!document.body.contains(ov)) return;
  _set(uid, p.id, 'done');
  logEvent('pillar_next_shown', { eventId: p.id, pillars: pillars.length });
  const close = () => ov.remove();
  ov.querySelector('[data-pnext-go]').addEventListener('click', () => {
    logEvent('pillar_next_create', { eventId: p.id });
    close();
    window._app?.openMissionModal?.();
  });
  ov.querySelector('[data-pnext-handover]')?.addEventListener('click', () => {
    logEvent('pillar_next_handover', { eventId: p.id });
    close();
    window._app?.openHandoverPick?.('pillar_next');
  });
  ov.querySelector('[data-pnext-later]').addEventListener('click', () => {
    logEvent('pillar_next_later', { eventId: p.id });
    close();
    state.render();
  });
}
