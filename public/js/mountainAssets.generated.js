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
      {"n":"1","c":"b","w":900,"h":650,"f":"MorningMeadow-landform-1-b.webp","v":"7cedc819"},
      {"n":"2","c":"c","w":900,"h":650,"f":"MorningMeadow-landform-2-c.webp","v":"7740e3bc"},
      {"n":"3","c":"b","w":900,"h":782,"f":"MorningMeadow-landform-3-b.webp","v":"75ace546"},
      {"n":"4","c":"a","w":900,"h":782,"f":"MorningMeadow-landform-4-a.webp","v":"8223425f"},
      {"n":"5","c":"b","w":900,"h":650,"f":"MorningMeadow-landform-5-b.webp","v":"a50a376f"},
      {"n":"6","c":"c","w":900,"h":650,"f":"MorningMeadow-landform-6-c.webp","v":"b3e5a824"},
      {"n":"7","c":"a","w":900,"h":782,"f":"MorningMeadow-landform-7-a.webp","v":"1539b776"},
      {"n":"8","c":"a","w":900,"h":650,"f":"MorningMeadow-landform-8-a.webp","v":"9b6ea887"},
      {"n":"9","c":"b","w":900,"h":782,"f":"MorningMeadow-landform-9-b.webp","v":"c32ddd48"},
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
      {"n":"1","c":"a","w":900,"h":650,"f":"SnowyMountain-1-a.webp","v":"51e9502d"},
      {"n":"2","c":"a","w":900,"h":650,"f":"SnowyMountain-2-a.webp","v":"0cf2ac32"},
      {"n":"3","c":"b","w":900,"h":651,"f":"SnowyMountain-3-b.webp","v":"d36f5242"},
      {"n":"4","c":"b","w":900,"h":650,"f":"SnowyMountain-4-b.webp","v":"e130eef7"},
      {"n":"5","c":"c","w":900,"h":650,"f":"SnowyMountain-5-c.webp","v":"70911c52"},
      {"n":"6","c":"c","w":900,"h":650,"f":"SnowyMountain-6-c.webp","v":"d83b3c0c"},
      {"n":"7","c":"a","w":900,"h":651,"f":"SnowyMountain-7-a.webp","v":"77a25675"},
      {"n":"8","c":"a","w":900,"h":651,"f":"SnowyMountain-8-a.webp","v":"1ae7ea6d"},
      {"n":"9","c":"b","w":900,"h":651,"f":"SnowyMountain-9-b.webp","v":"8c0bbed4"},
      {"n":"10","c":"b","w":900,"h":651,"f":"SnowyMountain-10-b.webp","v":"f1e532c0"},
      {"n":"11","c":"c","w":900,"h":651,"f":"SnowyMountain-11-c.webp","v":"2e21bcc9"},
      {"n":"12","c":"c","w":900,"h":651,"f":"SnowyMountain-12-c.webp","v":"a0ff70a2"},
      {"n":"13","c":"a","w":900,"h":651,"f":"SnowyMountain-13-a.webp","v":"49ea2263"},
      {"n":"14","c":"b","w":900,"h":651,"f":"SnowyMountain-14-b.webp","v":"5a3acf5a"},
      {"n":"15","c":"c","w":900,"h":651,"f":"SnowyMountain-15-c.webp","v":"463a080c"},
      {"n":"16","c":"a","w":900,"h":782,"f":"SnowyMountain-16-a.webp","v":"41912f72"},
      {"n":"17","c":"a","w":900,"h":782,"f":"SnowyMountain-17-a.webp","v":"0a072db1"},
      {"n":"18","c":"b","w":900,"h":782,"f":"SnowyMountain-18-b.webp","v":"b40b04bc"},
      {"n":"19","c":"b","w":900,"h":782,"f":"SnowyMountain-19-b.webp","v":"095b1a78"},
      {"n":"20","c":"c","w":900,"h":782,"f":"SnowyMountain-20-c.webp","v":"466a5d2d"},
      {"n":"21","c":"c","w":900,"h":782,"f":"SnowyMountain-21-c.webp","v":"efa80ea7"},
      {"n":"22","c":"a","w":900,"h":984,"f":"SnowyMountain-22-a.webp","v":"40018981"},
      {"n":"23","c":"a","w":900,"h":984,"f":"SnowyMountain-23-a.webp","v":"e4399f17"},
      {"n":"24","c":"b","w":900,"h":984,"f":"SnowyMountain-24-b.webp","v":"cbef345a"},
      {"n":"25","c":"b","w":900,"h":984,"f":"SnowyMountain-25-b.webp","v":"4a73133b"},
      {"n":"26","c":"c","w":900,"h":984,"f":"SnowyMountain-26-c.webp","v":"45270744"},
      {"n":"27","c":"c","w":900,"h":984,"f":"SnowyMountain-27-c.webp","v":"9f18fa21"},
    ],
    WorldSpawnedObjects: [],
    phenomenon: [],
  },
  WindyMeadow: {
    landform: [
      {"n":"1","c":"a","w":900,"h":651,"f":"WindyMeadow-landform-1-a.webp","v":"cb1ba157"},
      {"n":"2","c":"a","w":900,"h":650,"f":"WindyMeadow-landform-2-a.webp","v":"83d52dc5"},
      {"n":"3","c":"a","w":900,"h":782,"f":"WindyMeadow-landform-3-a.webp","v":"a00fc072"},
      {"n":"4","c":"b","w":900,"h":651,"f":"WindyMeadow-landform-4-b.webp","v":"4be57d58"},
      {"n":"5","c":"c","w":900,"h":651,"f":"WindyMeadow-landform-5-c.webp","v":"ca1ef8eb"},
      {"n":"6","c":"b","w":900,"h":650,"f":"WindyMeadow-landform-6-b.webp","v":"6b075d0c"},
      {"n":"7","c":"c","w":900,"h":782,"f":"WindyMeadow-landform-7-c.webp","v":"d50f5840"},
      {"n":"8","c":"c","w":900,"h":782,"f":"WindyMeadow-landform-8-c.webp","v":"73464b55"},
      {"n":"9","c":"b","w":900,"h":782,"f":"WindyMeadow-landform-9-b.webp","v":"c2646389"},
      {"n":"10","c":"b","w":900,"h":782,"f":"WindyMeadow-landform-10-b.webp","v":"e0d38182"},
      {"n":"11","c":"c","w":900,"h":783,"f":"WindyMeadow-landform-11-c.webp","v":"af072135"},
      {"n":"12","c":"c","w":900,"h":782,"f":"WindyMeadow-landform-12-c.webp","v":"973955e2"},
      {"n":"13","c":"b","w":900,"h":651,"f":"WindyMeadow-landform-13-b.webp","v":"64d34f63"},
      {"n":"14","c":"a","w":900,"h":650,"f":"WindyMeadow-landform-14-a.webp","v":"26d8bc2b"},
      {"n":"15","c":"a","w":900,"h":650,"f":"WindyMeadow-landform-15-a.webp","v":"6a6c4606"},
      {"n":"16","c":"b","w":900,"h":650,"f":"WindyMeadow-landform-16-b.webp","v":"b5ee3ed8"},
      {"n":"17","c":"c","w":900,"h":782,"f":"WindyMeadow-landform-17-c.webp","v":"8a015616"},
      {"n":"18","c":"a","w":900,"h":984,"f":"WindyMeadow-landform-18-a.webp","v":"b546a661"},
      {"n":"19","c":"a","w":900,"h":782,"f":"WindyMeadow-landform-19-a.webp","v":"12e88112"},
      {"n":"20","c":"c","w":900,"h":782,"f":"WindyMeadow-landform-20-c.webp","v":"8cd51427"},
      {"n":"21","c":"b","w":900,"h":651,"f":"WindyMeadow-landform-21-b.webp","v":"77b86ad3"},
      {"n":"22","c":"a","w":900,"h":651,"f":"WindyMeadow-landform-22-a.webp","v":"18780c9c"},
      {"n":"23","c":"b","w":900,"h":650,"f":"WindyMeadow-landform-23-b.webp","v":"907e65c1"},
      {"n":"24","c":"c","w":900,"h":650,"f":"WindyMeadow-landform-24-c.webp","v":"05c834b6"},
      {"n":"25","c":"a","w":900,"h":650,"f":"WindyMeadow-landform-25-a.webp","v":"f425c151"},
      {"n":"26","c":"c","w":900,"h":650,"f":"WindyMeadow-landform-26-c.webp","v":"ed2b7c77"},
      {"n":"27","c":"c","w":900,"h":782,"f":"WindyMeadow-landform-27-c.webp","v":"9a31c065"},
      {"n":"28","c":"b","w":900,"h":650,"f":"WindyMeadow-landform-28-b.webp","v":"05064bc8"},
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
