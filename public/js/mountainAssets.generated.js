// ===== 山の背景素材のマニフェスト（自動生成）=====
//
// ★このファイルは scripts/genBgManifest.mjs が書き出す。**手で編集しないこと。**
//   素材を足す・差し替えるときは public/images/bg/ に置いてから
//   `npm run bg:manifest` を流し直す。
//
// 1エントリ = { n: 通し番号, c: 色（a / b / c … の1文字）, w: 幅, h: 高さ,
//              f: ファイル名, v: 中身のハッシュ（キャッシュ更新用） }
//   ★w / h は**素材のピクセル**。画面px ではない。配置の計算はこの単位で行い、
//     実寸への変換は CSS の --art-unit が担う（端末幅で景色を変えないため）。
//   ★層が空配列のテーマは「その層を使わない」という意味。

export const BG_ASSETS = {
  MorningMeadow: {
    landform: [
      {"n":"01","c":"b","w":900,"h":650,"f":"MorningMeadow-landform-01-b.webp","v":"7cedc819"},
      {"n":"02","c":"c","w":900,"h":650,"f":"MorningMeadow-landform-02-c.webp","v":"7740e3bc"},
      {"n":"03","c":"b","w":900,"h":782,"f":"MorningMeadow-landform-03-b.webp","v":"75ace546"},
      {"n":"04","c":"a","w":900,"h":782,"f":"MorningMeadow-landform-04-a.webp","v":"8223425f"},
      {"n":"05","c":"b","w":900,"h":650,"f":"MorningMeadow-landform-05-b.webp","v":"a50a376f"},
      {"n":"06","c":"c","w":900,"h":650,"f":"MorningMeadow-landform-06-c.webp","v":"b3e5a824"},
      {"n":"07","c":"a","w":900,"h":782,"f":"MorningMeadow-landform-07-a.webp","v":"1539b776"},
      {"n":"08","c":"a","w":900,"h":650,"f":"MorningMeadow-landform-08-a.webp","v":"9b6ea887"},
      {"n":"09","c":"b","w":900,"h":782,"f":"MorningMeadow-landform-09-b.webp","v":"c32ddd48"},
      {"n":"10","c":"c","w":900,"h":782,"f":"MorningMeadow-landform-10-c.webp","v":"29017931"},
      {"n":"11","c":"a","w":900,"h":782,"f":"MorningMeadow-landform-11-a.webp","v":"f6baa873"},
      {"n":"12","c":"c","w":900,"h":782,"f":"MorningMeadow-landform-12-c.webp","v":"6c53a7c8"},
      {"n":"13","c":"c","w":900,"h":650,"f":"MorningMeadow-landform-13-c.webp","v":"008411af"},
      {"n":"14","c":"b","w":900,"h":650,"f":"MorningMeadow-landform-14-b.webp","v":"98e6e1ce"},
      {"n":"15","c":"a","w":900,"h":650,"f":"MorningMeadow-landform-15-a.webp","v":"f51ca15a"},
      {"n":"16","c":"a","w":900,"h":651,"f":"MorningMeadow-landform-16-a.webp","v":"dac4628c"},
      {"n":"17","c":"c","w":900,"h":651,"f":"MorningMeadow-landform-17-c.webp","v":"207ddb48"},
      {"n":"18","c":"b","w":900,"h":782,"f":"MorningMeadow-landform-18-b.webp","v":"ea57df05"},
      {"n":"19","c":"a","w":900,"h":783,"f":"MorningMeadow-landform-19-a.webp","v":"776850c3"},
      {"n":"20","c":"b","w":900,"h":651,"f":"MorningMeadow-landform-20-b.webp","v":"8835b1ca"},
      {"n":"21","c":"a","w":900,"h":984,"f":"MorningMeadow-landform-21-a.webp","v":"72282866"},
      {"n":"22","c":"a","w":900,"h":651,"f":"MorningMeadow-landform-22-a.webp","v":"31a597b1"},
      {"n":"23","c":"b","w":900,"h":651,"f":"MorningMeadow-landform-23-b.webp","v":"6f871b06"},
      {"n":"24","c":"a","w":900,"h":650,"f":"MorningMeadow-landform-24-a.webp","v":"c5eece4a"},
      {"n":"25","c":"b","w":900,"h":651,"f":"MorningMeadow-landform-25-b.webp","v":"9116b5a7"},
      {"n":"26","c":"a","w":900,"h":651,"f":"MorningMeadow-landform-26-a.webp","v":"bf054639"},
      {"n":"27","c":"a","w":900,"h":782,"f":"MorningMeadow-landform-27-a.webp","v":"139111ec"},
      {"n":"28","c":"c","w":900,"h":651,"f":"MorningMeadow-landform-28-c.webp","v":"3bd10dd4"},
    ],
    WorldSpawnedObjects: [
      {"n":"01","w":398,"h":913,"f":"plant-01.svg","v":"a3923511"},
      {"n":"02","w":398,"h":913,"f":"plant-02.svg","v":"fddffba9"},
      {"n":"03","w":398,"h":915,"f":"plant-03.svg","v":"33832e13"},
      {"n":"04","w":422,"h":639,"f":"plant-04.svg","v":"8b6d10bb"},
      {"n":"05","w":323,"h":636,"f":"plant-05.svg","v":"5fc4f7da"},
    ],
    phenomenon: [],
  },
  SnowyMountain: {
    landform: [
      {"n":"01","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-01-a.webp","v":"81001df6"},
      {"n":"02","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-02-a.webp","v":"2b1d746f"},
      {"n":"03","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-03-b.webp","v":"6994334b"},
      {"n":"04","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-04-b.webp","v":"4b4d4356"},
      {"n":"05","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-05-c.webp","v":"95087251"},
      {"n":"06","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-06-c.webp","v":"c2428a2f"},
      {"n":"07","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-07-a.webp","v":"6ec3ba51"},
      {"n":"08","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-08-a.webp","v":"df8f2733"},
      {"n":"09","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-09-b.webp","v":"2eac6427"},
      {"n":"10","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-10-b.webp","v":"5da4fdef"},
      {"n":"11","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-11-c.webp","v":"5ae98c3c"},
      {"n":"12","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-12-c.webp","v":"35c10388"},
      {"n":"13","c":"a","w":2049,"h":1481,"f":"SnowyMountain-landform-13-a.webp","v":"86def6f0"},
      {"n":"14","c":"b","w":2049,"h":1481,"f":"SnowyMountain-landform-14-b.webp","v":"4bd669c0"},
      {"n":"15","c":"c","w":2049,"h":1481,"f":"SnowyMountain-landform-15-c.webp","v":"f498c144"},
      {"n":"16","c":"a","w":2049,"h":1781,"f":"SnowyMountain-landform-16-a.webp","v":"d0beb634"},
      {"n":"17","c":"a","w":2049,"h":1781,"f":"SnowyMountain-landform-17-a.webp","v":"0a65f9c3"},
      {"n":"18","c":"b","w":2049,"h":1781,"f":"SnowyMountain-landform-18-b.webp","v":"4c829791"},
      {"n":"19","c":"b","w":2049,"h":1781,"f":"SnowyMountain-landform-19-b.webp","v":"d67e2108"},
      {"n":"20","c":"c","w":2049,"h":1781,"f":"SnowyMountain-landform-20-c.webp","v":"166d19c6"},
      {"n":"21","c":"c","w":2049,"h":1781,"f":"SnowyMountain-landform-21-c.webp","v":"5f7f9ec9"},
      {"n":"22","c":"a","w":2049,"h":2241,"f":"SnowyMountain-landform-22-a.webp","v":"cce999ba"},
      {"n":"23","c":"a","w":2049,"h":2241,"f":"SnowyMountain-landform-23-a.webp","v":"a08a4a9e"},
      {"n":"24","c":"b","w":2049,"h":2241,"f":"SnowyMountain-landform-24-b.webp","v":"6554512f"},
      {"n":"25","c":"b","w":2049,"h":2241,"f":"SnowyMountain-landform-25-b.webp","v":"6e061866"},
      {"n":"26","c":"c","w":2049,"h":2241,"f":"SnowyMountain-landform-26-c.webp","v":"d2d001f1"},
      {"n":"27","c":"c","w":2049,"h":2241,"f":"SnowyMountain-landform-27-c.webp","v":"d7382807"},
    ],
    WorldSpawnedObjects: [],
    phenomenon: [],
  },
  WindyMeadow: {
    landform: [
      {"n":"01","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-01-a.webp","v":"790139c2"},
      {"n":"02","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-02-b.webp","v":"e6a63063"},
      {"n":"03","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-03-b.webp","v":"2df9e132"},
      {"n":"04","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-04-b.webp","v":"ac0dfdd8"},
      {"n":"05","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-05-a.webp","v":"e9c12756"},
      {"n":"06","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-06-b.webp","v":"54c44725"},
      {"n":"07","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-07-a.webp","v":"d442c24f"},
      {"n":"08","c":"c","w":2049,"h":1781,"f":"WindyMeadow-landform-08-c.webp","v":"46180590"},
      {"n":"09","c":"c","w":2049,"h":1781,"f":"WindyMeadow-landform-09-c.webp","v":"ab6ddf14"},
      {"n":"10","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-10-b.webp","v":"8e5c7432"},
      {"n":"11","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-11-a.webp","v":"658801f1"},
      {"n":"12","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-12-b.webp","v":"46151b18"},
      {"n":"13","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-13-a.webp","v":"09d8f1d7"},
      {"n":"14","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-14-b.webp","v":"33a92091"},
      {"n":"15","c":"c","w":2049,"h":1481,"f":"WindyMeadow-landform-15-c.webp","v":"009d21d7"},
      {"n":"16","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-16-b.webp","v":"d6900858"},
      {"n":"17","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-17-b.webp","v":"63634173"},
      {"n":"18","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-18-a.webp","v":"79a7cfe0"},
      {"n":"19","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-19-b.webp","v":"a7aff799"},
      {"n":"20","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-20-b.webp","v":"065b3fa2"},
      {"n":"21","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-21-a.webp","v":"ad4bdce7"},
      {"n":"22","c":"b","w":2049,"h":2241,"f":"WindyMeadow-landform-22-b.webp","v":"08171112"},
      {"n":"23","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-23-b.webp","v":"a940ed71"},
      {"n":"24","c":"a","w":2049,"h":1781,"f":"WindyMeadow-landform-24-a.webp","v":"c9fe25ec"},
      {"n":"25","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-25-b.webp","v":"ab07ea59"},
      {"n":"26","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-26-b.webp","v":"5d77c98e"},
      {"n":"27","c":"a","w":2049,"h":2241,"f":"WindyMeadow-landform-27-a.webp","v":"90ff6fac"},
      {"n":"28","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-28-a.webp","v":"cf8ab859"},
      {"n":"29","c":"c","w":2049,"h":1481,"f":"WindyMeadow-landform-29-c.webp","v":"c3bc8f24"},
      {"n":"30","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-30-a.webp","v":"73b7be77"},
      {"n":"31","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-31-b.webp","v":"23a5bc2f"},
      {"n":"32","c":"b","w":2049,"h":1481,"f":"WindyMeadow-landform-32-b.webp","v":"5c3a6323"},
      {"n":"33","c":"a","w":2049,"h":1481,"f":"WindyMeadow-landform-33-a.webp","v":"f03826b2"},
      {"n":"34","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-34-b.webp","v":"29117513"},
      {"n":"35","c":"b","w":2049,"h":1781,"f":"WindyMeadow-landform-35-b.webp","v":"1d3e5a7a"},
    ],
    WorldSpawnedObjects: [
      {"n":"01","w":917,"h":799,"f":"plant-01.svg","v":"2579266d"},
      {"n":"02","w":519,"h":652,"f":"plant-02.svg","v":"8d288fc4"},
      {"n":"03","w":420,"h":667,"f":"plant-03.svg","v":"7612ada2"},
      {"n":"04","w":420,"h":667,"f":"plant-04.svg","v":"f6737d0a"},
    ],
    phenomenon: [],
  },
};

// テーマに属さない共通素材（雲）。どのテーマからでも使う。
export const BG_SHARED = {
  cloud: [
      {"n":"01","w":978,"h":426,"f":"cloud-01.svg","v":"221a1194"},
      {"n":"02","w":842,"h":373,"f":"cloud-02.svg","v":"c59aac0a"},
      {"n":"03","w":937,"h":411,"f":"cloud-03.svg","v":"d2ea4333"},
  ],
};

/** 素材の URL。★パスの組み立てはここ1箇所に集約する（呼び出し側で連結しないこと）
 *  ★?v=<中身のハッシュ> を必ず付ける。/images/bg/ は immutable で1年キャッシュ
 *    しているので、これが無いと**同じ名前で中身を差し替えても古い絵が出続ける**。
 *    ハッシュなので、変わったファイルだけが更新される。 */
export function bgUrl(theme, layer, file, v) {
  const base = theme
    ? `/images/bg/${theme}/${layer}/${file}`
    : `/images/bg/${layer}/${file}`;
  return v ? `${base}?v=${v}` : base;
}
