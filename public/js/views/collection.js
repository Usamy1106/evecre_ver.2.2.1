// ===== 図鑑（山登りオブジェクトコレクション）画面 =====
// ミッション完了で出会ったオブジェクトが埋まっていく。ホームのボトムナビ「図鑑」から遷移。
// 所持データは state.myCollection（openCollection() が GET /api/collection で取得）。
// 未所持はシルエット＋「???」。オブジェクト画像は後日支給（正方形プレースホルダー）。

import { state } from '../state.js';
import { Components } from '../components.js';
import { MOUNTAIN_OBJECTS, RARITY_CONFIG } from '../mountainObjects.js';

export function renderCollection(container) {
  const owned = state.myCollection || {};
  const total = MOUNTAIN_OBJECTS.length;
  const ownedCount = MOUNTAIN_OBJECTS.filter(o => owned[o.id]).length;

  const sections = ['common', 'rare', 'epic'].map(rarity => {
    const objs = MOUNTAIN_OBJECTS.filter(o => o.rarity === rarity);
    if (objs.length === 0) return '';
    const conf = RARITY_CONFIG[rarity];
    const cards = objs.map(o => {
      const entry = owned[o.id];
      if (!entry) {
        return `
          <div class="bg-white border border-[#E1DFDC] rounded-2xl p-3 flex flex-col items-center gap-2">
            ${Components.MountainObjectIcon(o.id, { silhouette: true, size: 56 })}
            <p class="text-[11px] font-bold text-[#A7AAAC]">？？？</p>
          </div>`;
      }
      return `
        <div class="bg-white border border-[#E1DFDC] rounded-2xl p-3 flex flex-col items-center gap-2 shadow-sm">
          ${Components.MountainObjectIcon(o.id, { size: 56 })}
          <p class="text-[11px] font-bold text-[#484545] text-center leading-tight">${o.name}</p>
          ${entry.count > 1 ? `<p class="text-[9px] font-bold text-[#A7AAAC] -mt-1">×${entry.count}</p>` : ''}
        </div>`;
    }).join('');
    return `
      <section class="mb-8">
        <div class="flex items-center gap-2 mb-3 pl-1">
          <span class="w-2.5 h-2.5 rounded-full" style="background-color:${conf.color}"></span>
          <h2 class="heading-m text-[#484545] font-bold">${conf.label}</h2>
        </div>
        <div class="grid grid-cols-3 gap-3">${cards}</div>
      </section>`;
  }).join('');

  container.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#FDFBF8]">
      ${Components.Header(null)}
      <main class="flex-1 px-6 pt-4 pb-32 page-transition">
        <div class="flex items-end justify-between mb-6 pl-1">
          <div>
            <h1 class="heading-m text-[#484545] font-bold">図鑑</h1>
            <p class="text-[11px] text-[#A7AAAC] font-bold mt-1">ミッションを完了すると、出会ったオブジェクトが集まっていきます</p>
          </div>
          <p class="text-[12px] font-bold text-[#484545] flex-shrink-0"><span class="text-[18px] font-mono text-[#0CA1E3]">${ownedCount}</span> / ${total}</p>
        </div>
        ${sections}
      </main>
      ${Components.BottomNav('COLLECTION')}
    </div>`;
}
