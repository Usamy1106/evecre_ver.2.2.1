// ===== 山の背景素材のマニフェスト（自動生成）=====
//
// ★このファイルは scripts/genBgManifest.mjs が書き出す。**手で編集しないこと。**
//   素材を足す・差し替えるときは public/images/bg/ に置いてから
//   `npm run bg:manifest` を流し直す。
//
// 1エントリ = { n: 通し番号, c: 色（a / b / c … の1文字）, w: 幅, h: 高さ, f: ファイル名 }
//   ★w / h は**素材のピクセル**。画面px ではない。配置の計算はこの単位で行い、
//     実寸への変換は CSS の --art-unit が担う（端末幅で景色を変えないため）。
//   ★層が空配列のテーマは「その層を使わない」という意味。

export const BG_ASSETS = {
  MorningMeadow: {
    landform: [
      {"n":"01","c":"b","w":2049,"h":1481,"f":"MorningMeadow-landform-01-b.webp"},
      {"n":"02","c":"c","w":2049,"h":1481,"f":"MorningMeadow-landform-02-c.webp"},
      {"n":"03","c":"b","w":2049,"h":1781,"f":"MorningMeadow-landform-03-b.webp"},
      {"n":"04","c":"a","w":2049,"h":1781,"f":"MorningMeadow-landform-04-a.webp"},
      {"n":"05","c":"b","w":2049,"h":1481,"f":"MorningMeadow-landform-05-b.webp"},
      {"n":"06","c":"c","w":2049,"h":1481,"f":"MorningMeadow-landform-06-c.webp"},
      {"n":"07","c":"a","w":2049,"h":1781,"f":"MorningMeadow-landform-07-a.webp"},
      {"n":"08","c":"a","w":2049,"h":1481,"f":"MorningMeadow-landform-08-a.webp"},
      {"n":"09","c":"b","w":2049,"h":1781,"f":"MorningMeadow-landform-09-b.webp"},
      {"n":"10","c":"c","w":2049,"h":1781,"f":"MorningMeadow-landform-10-c.webp"},
      {"n":"11","c":"a","w":2049,"h":1781,"f":"MorningMeadow-landform-11-a.webp"},
      {"n":"12","c":"c","w":2049,"h":1781,"f":"MorningMeadow-landform-12-c.webp"},
      {"n":"13","c":"c","w":2049,"h":1481,"f":"MorningMeadow-landform-13-c.webp"},
      {"n":"14","c":"b","w":2049,"h":1481,"f":"MorningMeadow-landform-14-b.webp"},
      {"n":"15","c":"a","w":2049,"h":1481,"f":"MorningMeadow-landform-15-a.webp"},
      {"n":"16","c":"a","w":2049,"h":1481,"f":"MorningMeadow-landform-16-a.webp"},
      {"n":"17","c":"c","w":2049,"h":1481,"f":"MorningMeadow-landform-17-c.webp"},
      {"n":"18","c":"b","w":2049,"h":1781,"f":"MorningMeadow-landform-18-b.webp"},
      {"n":"19","c":"a","w":2049,"h":1781,"f":"MorningMeadow-landform-19-a.webp"},
      {"n":"20","c":"b","w":2049,"h":1481,"f":"MorningMeadow-landform-20-b.webp"},
      {"n":"21","c":"a","w":2049,"h":2241,"f":"MorningMeadow-landform-21-a.webp"},
      {"n":"22","c":"a","w":2049,"h":1481,"f":"MorningMeadow-landform-22-a.webp"},
      {"n":"23","c":"b","w":2049,"h":1481,"f":"MorningMeadow-landform-23-b.webp"},
      {"n":"24","c":"a","w":2049,"h":1481,"f":"MorningMeadow-landform-24-a.webp"},
      {"n":"25","c":"b","w":2049,"h":1481,"f":"MorningMeadow-landform-25-b.webp"},
      {"n":"26","c":"a","w":2049,"h":1481,"f":"MorningMeadow-landform-26-a.webp"},
      {"n":"27","c":"a","w":2049,"h":1781,"f":"MorningMeadow-landform-27-a.webp"},
      {"n":"28","c":"c","w":2049,"h":1481,"f":"MorningMeadow-landform-28-c.webp"},
    ],
    WorldSpawnedObjects: [
      {"n":"01","w":398,"h":913,"f":"plant-01.svg"},
      {"n":"02","w":398,"h":913,"f":"plant-02.svg"},
      {"n":"03","w":398,"h":915,"f":"plant-03.svg"},
      {"n":"04","w":422,"h":639,"f":"plant-04.svg"},
      {"n":"05","w":323,"h":636,"f":"plant-05.svg"},
    ],
    phenomenon: [],
  },
  SnowyMountain: {
    landform: [
      {"n":"01","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-01-a.webp"},
      {"n":"02","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-02-a.webp"},
      {"n":"03","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-03-b.webp"},
      {"n":"04","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-04-b.webp"},
      {"n":"05","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-05-c.webp"},
      {"n":"06","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-06-c.webp"},
      {"n":"07","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-07-a.webp"},
      {"n":"08","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-08-a.webp"},
      {"n":"09","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-09-b.webp"},
      {"n":"10","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-10-b.webp"},
      {"n":"11","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-11-c.webp"},
      {"n":"12","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-12-c.webp"},
      {"n":"13","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-13-a.webp"},
      {"n":"14","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-14-b.webp"},
      {"n":"15","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-15-c.webp"},
      {"n":"16","c":"a","w":2049,"h":1781,"f":"SnowyMountain-landform-16-a.webp"},
      {"n":"17","c":"a","w":2049,"h":1781,"f":"SnowyMountain-landform-17-a.webp"},
      {"n":"18","c":"b","w":2049,"h":1781,"f":"SnowyMountain-landform-18-b.webp"},
      {"n":"19","c":"b","w":2049,"h":1781,"f":"SnowyMountain-landform-19-b.webp"},
      {"n":"20","c":"c","w":2049,"h":1781,"f":"SnowyMountain-landform-20-c.webp"},
      {"n":"21","c":"c","w":2049,"h":1781,"f":"SnowyMountain-landform-21-c.webp"},
      {"n":"22","c":"a","w":2049,"h":2241,"f":"SnowyMountain-landform-22-a.webp"},
      {"n":"23","c":"a","w":2049,"h":2241,"f":"SnowyMountain-landform-23-a.webp"},
      {"n":"24","c":"b","w":2049,"h":2241,"f":"SnowyMountain-landform-24-b.webp"},
      {"n":"25","c":"b","w":2049,"h":2241,"f":"SnowyMountain-landform-25-b.webp"},
      {"n":"26","c":"c","w":2049,"h":2241,"f":"SnowyMountain-landform-26-c.webp"},
      {"n":"27","c":"c","w":2049,"h":2241,"f":"SnowyMountain-landform-27-c.webp"},
    ],
    WorldSpawnedObjects: [],
    phenomenon: [],
  },
  WindyMeadow: {
    landform: [
      {"n":"01","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-01-a.webp"},
      {"n":"02","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-02-b.webp"},
      {"n":"03","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-03-b.webp"},
      {"n":"04","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-04-b.webp"},
      {"n":"05","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-05-a.webp"},
      {"n":"06","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-06-b.webp"},
      {"n":"07","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-07-a.webp"},
      {"n":"08","c":"c","w":2049,"h":1781,"f":"WindyMeadow-landform-08-c.webp"},
      {"n":"09","c":"c","w":2049,"h":1781,"f":"WindyMeadow-landform-09-c.webp"},
      {"n":"10","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-10-b.webp"},
      {"n":"11","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-11-a.webp"},
      {"n":"12","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-12-b.webp"},
      {"n":"13","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-13-a.webp"},
      {"n":"14","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-14-b.webp"},
      {"n":"15","c":"c","w":2049,"h":1481,"f":"WindyMeadow-landform-15-c.webp"},
      {"n":"16","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-16-b.webp"},
      {"n":"17","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-17-b.webp"},
      {"n":"18","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-18-a.webp"},
      {"n":"19","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-19-b.webp"},
      {"n":"20","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-20-b.webp"},
      {"n":"21","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-21-a.webp"},
      {"n":"22","c":"b","w":2049,"h":2241,"f":"WindyMeadow-landform-22-b.webp"},
      {"n":"23","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-23-b.webp"},
      {"n":"24","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-24-a.webp"},
      {"n":"25","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-25-b.webp"},
      {"n":"26","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-26-b.webp"},
      {"n":"27","c":"a","w":2049,"h":2241,"f":"WindyMeadow-landform-27-a.webp"},
      {"n":"28","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-28-a.webp"},
      {"n":"29","c":"c","w":2049,"h":1481,"f":"WindyMeadow-landform-29-c.webp"},
      {"n":"30","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-30-a.webp"},
      {"n":"31","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-31-b.webp"},
      {"n":"32","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-32-b.webp"},
      {"n":"33","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-33-a.webp"},
      {"n":"34","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-34-b.webp"},
      {"n":"35","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-35-b.webp"},
    ],
    WorldSpawnedObjects: [
      {"n":"01","w":917,"h":799,"f":"plant-01.svg"},
      {"n":"02","w":519,"h":652,"f":"plant-02.svg"},
      {"n":"03","w":420,"h":667,"f":"plant-03.svg"},
      {"n":"04","w":420,"h":667,"f":"plant-04.svg"},
    ],
    phenomenon: [],
  },
};

// テーマに属さない共通素材（雲）。どのテーマからでも使う。
export const BG_SHARED = {
  cloud: [
      {"n":"01","w":978,"h":426,"f":"cloud-01.svg"},
      {"n":"02","w":842,"h":373,"f":"cloud-02.svg"},
      {"n":"03","w":937,"h":411,"f":"cloud-03.svg"},
  ],
};

/** 素材の URL。★パスの組み立てはここ1箇所に集約する（呼び出し側で連結しないこと） */
export function bgUrl(theme, layer, file) {
  return theme
    ? `/images/bg/${theme}/${layer}/${file}`
    : `/images/bg/${layer}/${file}`;
}
