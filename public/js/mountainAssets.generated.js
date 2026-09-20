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
      {"n":"1","c":"b","w":900,"h":650,"f":"MorningMeadow-1-b.webp","v":"7cedc819"},
      {"n":"2","c":"c","w":900,"h":650,"f":"MorningMeadow-2-c.webp","v":"7740e3bc"},
      {"n":"3","c":"b","w":900,"h":782,"f":"MorningMeadow-3-b.webp","v":"75ace546"},
      {"n":"4","c":"b","w":900,"h":651,"f":"MorningMeadow-4-b.webp","v":"9116b5a7"},
      {"n":"5","c":"b","w":900,"h":650,"f":"MorningMeadow-5-b.webp","v":"a50a376f"},
      {"n":"6","c":"c","w":900,"h":650,"f":"MorningMeadow-6-c.webp","v":"b3e5a824"},
      {"n":"7","c":"c","w":900,"h":651,"f":"MorningMeadow-7-c.webp","v":"3bd10dd4"},
      {"n":"8","c":"a","w":900,"h":650,"f":"MorningMeadow-8-a.webp","v":"9b6ea887"},
      {"n":"9","c":"b","w":900,"h":782,"f":"MorningMeadow-9-b.webp","v":"c32ddd48"},
      {"n":"10","c":"c","w":900,"h":782,"f":"MorningMeadow-10-c.webp","v":"29017931"},
      {"n":"11","c":"a","w":900,"h":782,"f":"MorningMeadow-11-a.webp","v":"f6baa873"},
      {"n":"12","c":"c","w":900,"h":782,"f":"MorningMeadow-12-c.webp","v":"6c53a7c8"},
      {"n":"13","c":"c","w":900,"h":650,"f":"MorningMeadow-13-c.webp","v":"008411af"},
      {"n":"14","c":"b","w":900,"h":650,"f":"MorningMeadow-14-b.webp","v":"98e6e1ce"},
      {"n":"15","c":"a","w":900,"h":650,"f":"MorningMeadow-15-a.webp","v":"f51ca15a"},
      {"n":"16","c":"a","w":900,"h":651,"f":"MorningMeadow-16-a.webp","v":"dac4628c"},
      {"n":"17","c":"c","w":900,"h":651,"f":"MorningMeadow-17-c.webp","v":"207ddb48"},
      {"n":"18","c":"b","w":900,"h":782,"f":"MorningMeadow-18-b.webp","v":"ea57df05"},
      {"n":"19","c":"a","w":900,"h":783,"f":"MorningMeadow-19-a.webp","v":"776850c3"},
      {"n":"20","c":"b","w":900,"h":651,"f":"MorningMeadow-20-b.webp","v":"8835b1ca"},
      {"n":"21","c":"a","w":900,"h":984,"f":"MorningMeadow-21-a.webp","v":"72282866"},
      {"n":"22","c":"a","w":900,"h":651,"f":"MorningMeadow-22-a.webp","v":"bf054639"},
      {"n":"23","c":"b","w":900,"h":651,"f":"MorningMeadow-23-b.webp","v":"6f871b06"},
      {"n":"24","c":"a","w":900,"h":650,"f":"MorningMeadow-24-a.webp","v":"c5eece4a"},
    ],
    WorldSpawnedObjects: [
      {"n":"1","w":213,"h":358,"f":"MorningMeadow-1.webp","v":"dda1d729"},
      {"n":"2","w":213,"h":358,"f":"MorningMeadow-2.webp","v":"ff69aa84"},
      {"n":"3","w":213,"h":358,"f":"MorningMeadow-3.webp","v":"0ea73c35"},
      {"n":"4","w":185,"h":295,"f":"MorningMeadow-4.webp","v":"7de9f451"},
      {"n":"5","w":185,"h":295,"f":"MorningMeadow-5.webp","v":"d0cc1d34"},
      {"n":"6","w":186,"h":295,"f":"MorningMeadow-6.webp","v":"6df6d7b0"},
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
      {"n":"8","c":"a","w":900,"h":651,"f":"SnowyMountain-8-a.webp","v":"49ea2263"},
      {"n":"9","c":"b","w":900,"h":651,"f":"SnowyMountain-9-b.webp","v":"f1e532c0"},
      {"n":"10","c":"b","w":900,"h":651,"f":"SnowyMountain-10-b.webp","v":"5a3acf5a"},
      {"n":"11","c":"c","w":900,"h":651,"f":"SnowyMountain-11-c.webp","v":"a0ff70a2"},
      {"n":"12","c":"c","w":900,"h":651,"f":"SnowyMountain-12-c.webp","v":"463a080c"},
      {"n":"13","c":"a","w":900,"h":782,"f":"SnowyMountain-13-a.webp","v":"41912f72"},
      {"n":"14","c":"a","w":900,"h":782,"f":"SnowyMountain-14-a.webp","v":"0a072db1"},
      {"n":"15","c":"b","w":900,"h":782,"f":"SnowyMountain-15-b.webp","v":"b40b04bc"},
      {"n":"16","c":"b","w":900,"h":782,"f":"SnowyMountain-16-b.webp","v":"095b1a78"},
      {"n":"17","c":"c","w":900,"h":782,"f":"SnowyMountain-17-c.webp","v":"466a5d2d"},
      {"n":"18","c":"c","w":900,"h":782,"f":"SnowyMountain-18-c.webp","v":"efa80ea7"},
      {"n":"19","c":"a","w":900,"h":984,"f":"SnowyMountain-19-a.webp","v":"40018981"},
      {"n":"20","c":"a","w":900,"h":984,"f":"SnowyMountain-20-a.webp","v":"e4399f17"},
      {"n":"21","c":"b","w":900,"h":984,"f":"SnowyMountain-21-b.webp","v":"cbef345a"},
      {"n":"22","c":"b","w":900,"h":984,"f":"SnowyMountain-22-b.webp","v":"4a73133b"},
      {"n":"23","c":"c","w":900,"h":984,"f":"SnowyMountain-23-c.webp","v":"45270744"},
      {"n":"24","c":"c","w":900,"h":984,"f":"SnowyMountain-24-c.webp","v":"9f18fa21"},
    ],
    WorldSpawnedObjects: [],
    phenomenon: [],
  },
  WindyMeadow: {
    landform: [
      {"n":"1","c":"a","w":900,"h":650,"f":"WindyMeadow-1-a.webp","v":"130ffe17"},
      {"n":"2","c":"a","w":900,"h":650,"f":"WindyMeadow-2-a.webp","v":"e6c730e6"},
      {"n":"3","c":"a","w":900,"h":782,"f":"WindyMeadow-3-a.webp","v":"8a091044"},
      {"n":"4","c":"b","w":900,"h":650,"f":"WindyMeadow-4-b.webp","v":"a66da52d"},
      {"n":"5","c":"c","w":900,"h":650,"f":"WindyMeadow-5-c.webp","v":"7fab7624"},
      {"n":"6","c":"c","w":900,"h":650,"f":"WindyMeadow-6-c.webp","v":"31356999"},
      {"n":"7","c":"b","w":900,"h":782,"f":"WindyMeadow-7-b.webp","v":"f16d5e2a"},
      {"n":"8","c":"b","w":900,"h":782,"f":"WindyMeadow-8-b.webp","v":"8afe1c18"},
      {"n":"9","c":"c","w":900,"h":782,"f":"WindyMeadow-9-c.webp","v":"7fa5eb4d"},
      {"n":"10","c":"b","w":900,"h":650,"f":"WindyMeadow-10-b.webp","v":"17917484"},
      {"n":"11","c":"a","w":900,"h":650,"f":"WindyMeadow-11-a.webp","v":"690150db"},
      {"n":"12","c":"b","w":900,"h":650,"f":"WindyMeadow-12-b.webp","v":"75323cd2"},
      {"n":"13","c":"c","w":900,"h":782,"f":"WindyMeadow-13-c.webp","v":"d04689b1"},
      {"n":"14","c":"a","w":900,"h":984,"f":"WindyMeadow-14-a.webp","v":"957ccf82"},
      {"n":"15","c":"a","w":900,"h":782,"f":"WindyMeadow-15-a.webp","v":"3343641e"},
      {"n":"16","c":"c","w":900,"h":782,"f":"WindyMeadow-16-c.webp","v":"9e43ef4d"},
      {"n":"17","c":"b","w":900,"h":650,"f":"WindyMeadow-17-b.webp","v":"d44bdc88"},
      {"n":"18","c":"a","w":900,"h":650,"f":"WindyMeadow-18-a.webp","v":"d5f35a6d"},
      {"n":"19","c":"b","w":900,"h":782,"f":"WindyMeadow-19-b.webp","v":"4eb2d833"},
      {"n":"20","c":"c","w":900,"h":651,"f":"WindyMeadow-20-c.webp","v":"a391722a"},
    ],
    WorldSpawnedObjects: [
      {"n":"1","w":407,"h":363,"f":"WindyMeadow-1.webp","v":"630580c2"},
      {"n":"2","w":263,"h":310,"f":"WindyMeadow-2.webp","v":"0fdd4e07"},
      {"n":"3","w":187,"h":316,"f":"WindyMeadow-3.webp","v":"72cbfe66"},
      {"n":"4","w":187,"h":316,"f":"WindyMeadow-4.webp","v":"c7bbad0c"},
      {"n":"5","w":188,"h":316,"f":"WindyMeadow-5.webp","v":"aca342c4"},
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
