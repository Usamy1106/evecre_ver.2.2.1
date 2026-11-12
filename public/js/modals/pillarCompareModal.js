// ===== 前回の柱と今回の柱を並べて見せる（2026-11-12。指示書D §4-4。この機能の山場）=====
//
// ★出すのは、前の代があるイベントで、**自分たちの柱を立てたあと**に1回だけ（先に見せると写すだけになる）
// ★文言は比較だけ。「同じにしましょう」「変えましょう」のような促しを書かない
// ★前の代の柱が取れない（非公開でメンバーでもない・柱を立てていない）ときは出さない
// ★判定は render() 駆動（state.js）。他のモーダルが開いていたら持ち越す（modalGuard の AUTO_MODAL_IDS に登録済み）
// ★既読は localStorage（ユーザー×イベント）。表示できたときだけ立てる

import { state } from '../state.js';
import { api } from '../api.js';
import { logEvent } from '../logger.js';
import { getPillars } from '../utils.js';
import { isAnyAutoModalOpen } from '../modalGuard.js';

const OVERLAY_ID = 'pillar-compare-overlay';
const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _key = (uid, eid) => `evecre:pillarCompare:v1:${uid}:${eid}`;
const _seen = (uid, eid) => { try { return localStorage.getItem(_key(uid, eid)) === '1'; } catch (_) { return true; } };
const _markSeen = (uid, eid) => { try { localStorage.setItem(_key(uid, eid), '1'); } catch (_) {} };

const _fetched = new Map();   // sourceId → pillars[]|null（画面を開いている間だけ覚える。毎回の render で取り直さない）

async function _sourcePillars(sourceId) {
  if (_fetched.has(sourceId)) return _fetched.get(sourceId);
  _fetched.set(sourceId, null);
  const member = state.events.some(e => e.id === sourceId);
  const r = member ? await api.handoverSource(sourceId) : await api.exploreEvent(sourceId);
  const pillars = r?.ok && Array.isArray(r.pillars) && r.pillars.length ? r.pillars : null;
  _fetched.set(sourceId, pillars);
  return pillars;
}

export async function checkPillarCompare() {
  if (state.currentView !== 'MAIN_BOARD') return;
  const p = state.events.find(e => e.id === state.selectedEventId);
  const uid = state.currentUser?.id;
  if (!p || !uid || !p.parentEventId) return;
  const mine = getPillars(p).map(x => x.name).filter(Boolean);
  if (!mine.length || _seen(uid, p.id)) return;
  if (document.getElementById(OVERLAY_ID) || isAnyAutoModalOpen(OVERLAY_ID)) return;
  const prev = await _sourcePillars(p.parentEventId);
  if (!prev) return;
  // 取り終えるまでに画面やモーダルが変わっていたら持ち越す
  if (state.currentView !== 'MAIN_BOARD' || state.selectedEventId !== p.id || isAnyAutoModalOpen(OVERLAY_ID)) return;

  const rows = Math.max(prev.length, mine.length);
  const ov = document.createElement('div');
  ov.id = OVERLAY_ID;
  ov.className = 'c-overlay c-overlay--center c-overlay--blur u-animate-fade';
  ov.innerHTML = `
    <div class="p-pillar-compare" role="dialog" aria-modal="true" aria-labelledby="pcmp-title">
      <h2 id="pcmp-title" class="p-pillar-compare__title">前回の柱と、今回の柱</h2>
      <table class="p-pillar-compare__table">
        <thead><tr><th scope="col">前回の柱</th><th scope="col">今回の柱</th></tr></thead>
        <tbody>${Array.from({ length: rows }, (_, i) => `
          <tr><td>${_esc(prev[i] || '')}</td><td>${_esc(mine[i] || '')}</td></tr>`).join('')}</tbody>
      </table>
      <button type="button" class="c-button c-button--primary p-pillar-compare__close" data-pcmp-close>閉じる</button>
    </div>`;
  document.body.appendChild(ov);
  if (!document.body.contains(ov)) return;
  _markSeen(uid, p.id);
  logEvent('pillar_compare_shown', { eventId: p.id, prev: prev.length, mine: mine.length });
  const close = () => { ov.remove(); state.render(); };
  ov.querySelector('[data-pcmp-close]').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}
