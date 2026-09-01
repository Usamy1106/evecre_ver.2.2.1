// ===== キャラクター（mizu / mori / iwa）の共用パーツ =====
//
// 3体は2箇所に出る。見た目（体・目）は同じものを使い、役割だけが違う：
//   - メインボードの提案ボックス（views/mainBoard.js）… 誰の提案かを表す
//   - HOME のひとこと（views/home.js）              … 助言・機能紹介をする
//
// ★体と目の HTML はこの1箇所で組む。両方に同じマークアップを書くと、
//   素材の差し替えや目の構造を変えたときに片方だけ直し忘れる。
// ★動き（瞬き・視線・登場）は CSS が持つ（object/project/_character.css）。
//   JS のタイマーで目を動かさないこと。

import { PROPOSAL_CHARACTERS } from './constants.js';

/**
 * 体＋目の HTML。呼び出し側は外側の箱と、必要なら状態クラスを用意する。
 *
 * ★目は「白目（character-eye.svg）＋ 虹彩（character-*-iris.svg）」の2枚重ね。
 *   1枚の絵にしてしまうと視線を動かせない。位置合わせの根拠は _character.css。
 *
 * @param {{id:string, body:string, iris:string}} ch PROPOSAL_CHARACTERS の1体
 */
export function characterFigureHtml(ch) {
  return `
      <div class="p-char__body" style="--char-body:url('/images/character/${ch.body}')"></div>
      <div class="p-char__face">
        <img class="p-char__eye" src="/images/character/character-eye.svg" alt="" aria-hidden="true">
        <img class="p-char__iris" src="/images/character/${ch.iris}" alt="" aria-hidden="true">
      </div>`;
}

// ===== HOME のひとこと =====
//
// ★役割はメインボードの提案ボックスとは別。あちらは担当領域（運営／制作・広報／企画）
//   だが、こちらは話す内容の種類で分けている：
//     mizu … イベントづくりの助言（考え方・進め方）
//     mori … イベクリの細かな機能の紹介
//     iwa  … イベクリそのものの説明（世界観・外部サイト・他キャラの紹介）
//   ★iwa は指示書では「石」と呼ばれている。素材と id は iwa で統一済み。
//
// ★文言を足すときはこの配列に1行足すだけでよい。重み付けはしていないので、
//   1体のメッセージを増やすとその体の中での出現率だけが下がる
//   （どの体が出るかは常に3分の1）。
export const CHARACTER_TIPS = {
  mizu: [
    'スケジュールを逆算してやることを整理して進めよう！',
    'まずは登る山、目的を定めてメンバーに共有しよう',
    '山登りで別々で行動する人はいないよね？目的・目標が共有できてないと遭難しちゃうよ！',
    '目的は困った時に立ち帰る軸になる',
    'みんなで同じ山頂を目指す。イベントづくりは山登りなんだ',
    'ミッションを作る時は具体的に書くといいよ！',
    'それぞれの得意分野を聞き出して、仕事を割り当てる際の参考にしよう',
    '不明瞭は不安のもとになる。',
    'わからない時は遠慮なく聞こう！',
    '困ったときは目的に立ち返ると霧が晴れるかも...',
    '悩むとは結論がないのを前提にしてしまうことだよ...',
  ],
  mori: [
    'ミッションの詳細設定からチェック項目をONにすると、ミッション報告前にチェックしてもらうことができるよ！',
    'ミッションの割り当てでは、ロールで一括指定することもできるよ！',
    'ミッション詳細のチャットは各ミッションのスレッドのように機能する',
    'プロジェクト機能でイベントページをまとめることができるよ',
    'カレンダーだけじゃなく、ガントチャートも自動生成されるよ',
  ],
  iwa: [
    'ミッションを期限内に提出するとレアなものが出現するらしい…',
    '森は、制作・広報に関する創造的な提案が得意だよ！',
    '水はイベントづくりのアドバイスをしてくれる。',
    'イベントに関して具体的に書いてくれるほど、僕らも提案する際にイメージしやすいんだよ',
    '外部サイトでは、他のユーザーのイベントの裏側を見れるよ',
    '外部サイトには、イベクリの機能と活用法を調べられるよ',
    '通知をオンにすると、締め切り前に知らせてくれるよ',
    'このイベクリは山登りをテーマにしているんだ',
    '登山や川下りなどの活動をワンダーフォーゲルって言うんだ',
  ],
};

/**
 * ひとことを1つ引く。体を先に選び、その体の持ちネタから1つ選ぶ。
 *
 * ★「全メッセージから1つ引く」ではなく「体 → メッセージ」の順に引く。
 *   前者だと持ちネタの多い mizu ばかり出てしまう（11 / 5 / 9 件）。
 * ★呼ぶのは HOME を開いた時だけ。render() のたびに引き直すと、
 *   タブの切り替えや SSE の受信でひとことが入れ替わって落ち着かない。
 *
 * @returns {{ character: object, text: string } | null}
 */
export function pickCharacterTip() {
  const ch = PROPOSAL_CHARACTERS[Math.floor(Math.random() * PROPOSAL_CHARACTERS.length)];
  const list = CHARACTER_TIPS[ch.id] || [];
  if (list.length === 0) return null;
  return { character: ch, text: list[Math.floor(Math.random() * list.length)] };
}

/**
 * ひとことの吹き出し＋キャラクター。HOME の右下に置く。
 *
 * ★エンプティーステート（イベントが1件も無い）では呼ばないこと。
 *   「イベントを作成」へ進んでもらう場面なので、助言で気を散らさない。
 *
 * @param {{ character: object, text: string }} tip pickCharacterTip の戻り値
 */
export function characterTipHtml(tip) {
  if (!tip) return '';
  const { character: ch, text } = tip;
  return `
    <div class="p-tip p-char p-char--${ch.id} p-char--ready" aria-live="off">
      <p class="p-tip__bubble">${_esc(text)}</p>
      <div class="p-tip__figure">${characterFigureHtml(ch)}</div>
    </div>`;
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
