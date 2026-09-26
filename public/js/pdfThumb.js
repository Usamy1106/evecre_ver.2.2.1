// ===== PDF の1ページ目を絵にする（完了の編集欄に PDF を置いたとき）=====
//
// ★pdf.js（public/js/vendor/pdfjs-dist/<版>/）は**PDF を置いたときに初めて読む**（動的 import）。
//   本体 約0.5MB ＋ worker 約1.3MB。起動時に読まないこと（PDF を使わない人に払わせない）。
//   /js/vendor/ は immutable 配信なので、2回目以降は通信しない。
// ★絵は**置いた人の端末で1回だけ**作り、R2 に保存する（見る人の端末では PDF を開かない）。
//   見る人の端末で毎回描くと、全員が 1.8MB を読んで描画することになる。
// ★CDN を使わない（lottie と同じくセルフホスト）。legacy ビルドを使う（古めの Safari でも動く）。
//   更新するときは必ずパスの版を変えること（immutable なので同じパスだと古いものが出続ける）。
// ★描けなかったら null を返す（壊れた PDF・パスワード付き・重すぎる）。その場合は
//   絵なしのカードで出す。PDF 自体は添付できる。

const PDFJS_BASE = '/js/vendor/pdfjs-dist/6.3.289';
const THUMB_WIDTH   = 800;   // 絵の横幅(px)。表示は最大 448px なので2倍解像度で足りる
const THUMB_QUALITY = 0.8;
const RENDER_TIMEOUT_MS = 20000;

let _libPromise = null;
function _lib() {
  if (!_libPromise) {
    _libPromise = import(`${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return lib;
    }).catch((e) => { _libPromise = null; throw e; });   // 失敗したら次回また試す
  }
  return _libPromise;
}

function _withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/**
 * @param {Blob} blob  PDF
 * @returns {Promise<{ dataUrl: string, pages: number } | null>}
 */
export async function renderPdfThumb(blob) {
  let doc = null;
  try {
    const lib = await _lib();
    const data = new Uint8Array(await blob.arrayBuffer());
    const task = lib.getDocument({
      data,
      // 日本語など、埋め込まれていないフォントの文字を出すための対応表・標準フォント
      cMapUrl: `${PDFJS_BASE}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
      // ★PDF の中の JavaScript・式を実行しない（サムネイルに不要で、危ない）
      isEvalSupported: false,
      enableScripting: false,
    });
    doc = await _withTimeout(task.promise, RENDER_TIMEOUT_MS);
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    // 透明な背景は JPEG で黒くなるので白で塗る
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await _withTimeout(page.render({ canvasContext: ctx, canvas, viewport }).promise, RENDER_TIMEOUT_MS);
    const dataUrl = canvas.toDataURL('image/jpeg', THUMB_QUALITY);
    return { dataUrl, pages: doc.numPages };
  } catch (e) {
    console.warn('[pdfThumb] 1ページ目を描けませんでした:', e?.message || e);
    return null;
  } finally {
    try { await doc?.destroy(); } catch (_) { /* noop */ }
  }
}
