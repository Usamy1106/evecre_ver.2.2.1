#!/usr/bin/env node
// FLOCSS 移行の自己点検
//
//   node scripts/checkFlocss.mjs
//
// ★このファイルはリポジトリに置くこと。
//   以前は検証スクリプトを一時ディレクトリに置いていたが、/tmp が掃除された
//   ときにまとめて消えた。移行が終わるまでの安全網なので、コードと一緒に残す。
//
// 見ているのは次の3種類：
//   [A] 規約   … 接頭辞・トークン・登録漏れ。新しい CSS を足すと自動で対象になる
//   [B] 再発防止 … 実機で見つかった不具合。直した形が崩れていないか
//   [C] 完了条件 … 指示書の「JS 内に <style> を書かない」など

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ls = (d) => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.css')).sort();
/** コメントを外す。「!important」や色の説明文が本文と誤認されるのを防ぐ */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

/** コメントを除いたコードだけを返す。
 *  ★「ソースに X が現れないこと」の判定は必ずこれを通す。生のソースで判定すると、
 *    「X をしないこと」という**注意書きそのものがテストを落とす**
 *    （checkMountain.mjs でも同じ手当てをしている）。 */
const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const entry = R('public/css/style.css');
const readme = R('public/css/README.md');

// public/js 全体。Tailwind は撤去済みなので例外は無い。
const JS_ALL = [
  ...fs.readdirSync(path.join(ROOT, 'public/js')).filter(f => f.endsWith('.js')).map(f => `public/js/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'public/js/views')).map(f => `public/js/views/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'public/js/modals')).map(f => `public/js/modals/${f}`),
];

// ---------------------------------------------------------------- [A] 規約
section('[A] CSS の規約');

const LAYERS = [
  ['public/css/layout', '.l-'],
  ['public/css/object/component', '.c-'],
  ['public/css/object/project', '.p-'],
  ['public/css/object/utility', '.u-'],
];

// ★Phase 5 で接頭辞なしのクラスは全て改名済み。例外は作らないこと。
const LEGACY_CLASSES = new Set([]);

for (const [dir, prefix] of LAYERS) {
  for (const f of ls(dir)) {
    const rel = `${dir}/${f}`;
    const css = R(rel);
    const body = strip(css);
    const sels = (body.match(/^\.[a-z][a-z0-9_-]*/gm) || []);
    const bad = [...new Set(sels.filter(s =>
      !s.startsWith(prefix) && !LEGACY_CLASSES.has(s)))];
    ok(`${f}: ${prefix} 接頭辞`, bad.length === 0, bad.join(' '));
    ok(`${f}: 使用箇所を書いてある`, css.includes('使用箇所:'));
    ok(`${f}: style.css に登録`, entry.includes(`${dir.replace('public/css/', '')}/${f}`));
    ok(`${f}: 生 HEX を書いていない`, !/#[0-9A-Fa-f]{6}/.test(body),
      (body.match(/#[0-9A-Fa-f]{6}/g) || []).join(' '));
    ok(`${f}: README に載っている`, readme.includes(f));
  }
}

// !important は原則禁止。特別な理由があるものだけここに列挙する。
const IMPORTANT_ALLOW = {
  'public/css/object/utility/_display.css': 'u-hidden（他のどの指定より強く隠す）',
};
for (const [dir] of LAYERS) {
  for (const f of ls(dir)) {
    const rel = `${dir}/${f}`;
    const n = (strip(R(rel)).match(/!important/g) || []).length;
    ok(`${f}: !important に理由がある`, n === 0 || rel in IMPORTANT_ALLOW, `${n}箇所`);
  }
}

section('[A-2] トークン');
const vars = R('public/css/foundation/_variables.css');
ok('原色は :root に集約されている', vars.includes('--create-blue: #209DDB'));
ok('z-index は用途名で持つ', /--z-modal:\s*300/.test(vars) && /--z-toast:\s*400/.test(vars));
ok('★z-index を連番に振り直していない（z-[…] の直書きがまだ残る）',
  vars.includes('重なり順が入れ替わる'));
ok('Tailwind の shadow-2xl を別トークンにしてある',
  /--shadow-2xl:\s*0 25px 50px -12px/.test(vars));

// @keyframes の名前がぶつかっていないか。名前は文書全体で1つの空間なので、
// 同名を2回定義すると後勝ちで別のアニメーションが化ける（実際に起きた）。
section('[A-3] @keyframes の名前が重複していない');
const allCss = [...entry.matchAll(/@import url\("\.\/([^"]+)"\)/g)]
  .map(m => R(`public/css/${m[1]}`)).join('\n');
const kf = [...strip(allCss).matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(m => m[1]);
const dupKf = kf.filter((v, i) => kf.indexOf(v) !== i);
ok('CSS 内で重複なし', dupKf.length === 0, dupKf.join(' '));
ok('slideUp と sheetRise を取り違えていない',
  /@keyframes sheetRise[\s\S]{0,80}translateY\(100%\)/.test(allCss) &&
  /@keyframes slideUp[\s\S]{0,80}translateY\(12px\)/.test(allCss));

// -------------------------------------------------------- [B] 再発防止
section('[B] 実機で見つかった不具合');

// ★入力欄の文字が 16px 未満だと、iOS Safari がタップ時に**勝手にズームする**。
//   一度ズームすると自分では戻せず、以後ずっと拡大表示のままになる（指摘を受けた）。
//   viewport に maximum-scale=1 を足せば止まるが、それはピンチズーム自体を殺すので
//   アクセシビリティ上やってはいけない。**入力欄を 16px 以上にするのが唯一の正解。**
{
  const FORM_TAGS = /^(input|textarea|select)$/i;
  // どのクラスが実際に input / textarea / select に付いているかを JS から拾う
  const formClasses = new Set();
  for (const f of JS_ALL) {
    const src = R(f);
    for (const m of src.matchAll(/<(input|textarea|select)\b[^<>]*?class="([^"]*)"/g)) {
      if (FORM_TAGS.test(m[1])) for (const c of m[2].split(/\s+/)) if (c) formClasses.add(c);
    }
  }

  const PX = { '--font-size-xs': 11, '--font-size-sm': 12, '--font-size-md': 14, '--font-size-lg': 16 };
  const small = [];
  // style.css が読み込んでいる全 CSS（＝実際に配信されるもの）を対象にする
  const cssPaths = [...entry.matchAll(/@import url\("\.\/([^"]+)"\)/g)]
    .map(m => `public/css/${m[1]}`);
  for (const f of cssPaths) {
    const src = R(f);
    for (const m of src.matchAll(/\.([A-Za-z0-9_-]+)[^{}]*\{([^{}]*)\}/g)) {
      if (!formClasses.has(m[1])) continue;
      const fs_ = /font-size:\s*([^;]+);/.exec(m[2]);
      if (!fs_) continue;
      const v = fs_[1].trim();
      let px = v.endsWith('px') ? parseFloat(v) : null;
      for (const [tok, n] of Object.entries(PX)) if (v.includes(tok)) px = n;
      if (px !== null && px < 16) small.push(`${path.basename(f)} .${m[1]} = ${v}`);
    }
  }
  ok('★入力欄（input/textarea/select）の文字が 16px 以上（iOS の自動ズーム対策）',
    small.length === 0, small.join('\n     '));

  // ★初期オンボーディングは「完了操作」でだけ段階を進めること。
  //   表示した時点で進めていた頃は、読んでいる途中でリロードやホーム移動をすると
  //   ①を飛ばして②から再開し、進め方を読まないまま先へ行っていた（指摘を受けた）。
  //   途中で閉じた人には、次にイベントページへ入ったときまた同じ段階から出す。
  //   ★①は3枚めくる形になった。**ページをめくった時点でも進めないこと**
  //     （最後の「わかった」だけ）。中途半端に進むと、2枚目まで読んで閉じた人が
  //     次に②から再開して、進め方を読み切れないまま先へ行ってしまう。
  {
    const intro = codeOnly(R('public/js/onboardingIntro.js'));
    const usage = intro.slice(intro.indexOf('export function showUsageModal'),
                              intro.indexOf('function isCoachOpen'));
    // 段階を進めるのは1箇所だけ。増えていたら「めくるたびに進めている」疑い
    const advances = (usage.match(/advanceIntro\(/g) || []).length;
    ok('★①で段階を進めるのは1箇所だけ（めくるたびに進めない）', advances === 1, `${advances}箇所`);
    // その1箇所は「最後のページの了承」経路にある（直前に ack のログが出ている）
    ok('★①は最後の「わかった」を押したときだけ段階を進める',
      /logEvent\('intro_usage_ack'\);\s*\n\s*advanceIntro\(INTRO\.USAGE\)/.test(usage));
    // 了承は最終ページ限定。isLast のガードを外すと途中でも完了扱いになる
    ok('★①の了承は最終ページだけ（isLast で分岐している）',
      /if \(!isLast\) \{[\s\S]*?return;\s*\n\s*\}/.test(usage));
    // 表示した時点では進めない（appendChild 〜 最初の paint までに advanceIntro が無い）
    ok('★①は表示した時点では段階を進めない',
      !/logEvent\('intro_usage_shown'\);[\s\S]*?advanceIntro\([\s\S]*?const paint/.test(usage));
  }

  // ★②の最後に CTA（「はじめる」）を置かないこと。②の直後に③「目的を定めよう」が
  //   続くので、ボタンを挟むとひと続きの案内が途切れる（そう直した経緯がある）。
  {
    const intro = codeOnly(R('public/js/onboardingIntro.js'));
    const tour = intro.slice(intro.indexOf('export function showFeatureTour'),
                             intro.indexOf('function _finishFeatureTour'));
    ok('★②の最後に CTA ボタンを置いていない（③へひと続きで繋ぐ）', !/cta:/.test(tour));
  }

  // ★コーチマークの文字は吹き出しの中に入れること。暗幕の上へ直接置くと、
  //   白いカードや画像と重なったときに読めない（実機で指摘を受けた）。
  //   尻尾の向きは置いた側と必ず揃える（上に置いたら下向き）。
  {
    const cm = R('public/js/modals/coachMark.js');
    const css = R('public/css/object/component/_coach-mark.css');
    ok('★コーチマークの文字が吹き出しの中にある', cm.includes('data-coach-bubble'));
    ok('★吹き出しの尻尾の向きを配置に合わせている',
      /copy\.classList\.add\('c-coach-mark__copy--above'\)/.test(cm) &&
      /copy\.classList\.add\('c-coach-mark__copy--below'\)/.test(cm));
    ok('★上に置いたら尻尾は下向き',
      /--above \.c-coach-mark__bubble::after \{[^}]*border-top/.test(css));
    ok('★下に置いたら尻尾は上向き',
      /--below \.c-coach-mark__bubble::after \{[^}]*border-bottom/.test(css));
  }

  // ★歓迎の🔥を閉じたら、次の案内（メンバー向けの進め方 M1）を評価させること。
  //   閉じる処理が overlay.remove() だけだと判定が走らず、
  //   「🔥は出たのに進め方が出ない」で止まる（実際にその報告を受けた）。
  {
    const lm = R('public/js/modals/leaderMotivationModal.js');
    const lmCode = codeOnly(lm);
    // ★閉じる経路は close() 1本に集約されていること。overlay.remove() を
    //   他所にも書くと、そこだけ state.render() を呼び忘れて止まる。
    ok('★🔥を閉じたら state.render() を呼ぶ（次の案内が続くため）',
      /overlay\.remove\(\);\s*\n\s*state\.render\(\);/.test(lmCode));
    ok('★閉じる処理は1箇所だけ（remove を散らさない）',
      (lmCode.match(/overlay\.remove\(\)/g) || []).length === 1);

    // ★Lottie は DOM を消しても requestAnimationFrame が止まらない。destroy を
    //   忘れると閉じたあともループが回り続け、山のスクロール（60fps）を削る。
    ok('★閉じるときに Lottie を destroy している（rAF ループを残さない）',
      /idleAnim\?\.destroy\(\)/.test(lmCode) && /pressedAnim\?\.destroy\(\)/.test(lmCode));

    // ★animationend はバブリングする。火の粉やボタンのバウンドは子要素で
    //   0.5秒動いているので、target を見ないと退場前に閉じてしまう。
    //   ★窓を広く取らないこと。すぐ下に overlay.onclick の同じ式があり、
    //     ゆるい正規表現だとそちらを拾って素通りする（実際に踏んだ）。
    //     コールバックの開き括弧から直接続いていることまで見る。
    ok('★退場の animationend を overlay 自身に限定している',
      /addEventListener\('animationend',\s*\(e\)\s*=>\s*\{\s*if \(e\.target === overlay\)/.test(lmCode));
    // ★animation が走らない環境（prefers-reduced-motion 等）では animationend が
    //   来ない。保険が無いとモーダルが永久に閉じなくなる。
    ok('★退場に時間切れの保険がある（animationend が来なくても閉じる）',
      /setTimeout\(close,/.test(lmCode));

    // ★アセットもライブラリも自ドメイン。外部CDN・LottieFiles を参照しないこと
    ok('★Lottie を自ドメインから読んでいる（CDN を参照しない）',
      /path: '\/animations\//.test(lmCode) &&
      !/lottiefiles|lottie\.host|cdn\.jsdelivr|unpkg/.test(lmCode));
    ok('★json が無くても絵文字に落ちる（フォールバックを消していない）',
      /data_failed/.test(lmCode) && /p-invite__fire-fallback/.test(lm));

    // ★ボタンが縮む長さは fire-pressed.json の実尺に合わせる。CSS に固定値を
    //   書き戻すと、AE 側で尺を変えたときに炎が見えないまま閉じる
    //   （実際に 0.5s 対 1.33s でそうなっていた）。
    const inv = strip(R('public/css/object/project/_invite.css'));
    ok('★ボタンが縮む長さを Lottie の実尺から取っている',
      /animation: fireLaunch var\(--fire-launch-dur/.test(inv) &&
      /setProperty\('--fire-launch-dur'/.test(lmCode));

    // ★ライブラリもアセットも自ドメイン。index.html から CDN を読まないこと。
    //   ★判定は**実際の src 属性だけ**を見る。生のHTMLに正規表現を当てると、
    //     「CDN を使わないこと」という注意書きのコメント自体が引っかかる
    //     （落とし穴 0-8。checkMountain の codeOnly と同じ趣旨で、実際に踏んだ）。
    const html = R('public/index.html');
    const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
    const lottieSrcs = srcs.filter(s => /lottie/i.test(s));
    // ★パスにバージョンが入っていること（/js/vendor/<名前>/<バージョン>/…）。
    //   server.js が /js/vendor/ 配下を immutable で配信するので、バージョンを
    //   入れずに同じパスで差し替えると古いものが配信され続ける。
    ok('★lottie-web を自ドメインから読んでいる（CDN を参照しない）',
      lottieSrcs.length === 1 && /^\/js\/vendor\/lottie-web\/\d+\.\d+\.\d+\/lottie_light\.min\.js$/.test(lottieSrcs[0]),
      lottieSrcs.join(', '));
    // ★第三者ドメインは初回描画の経路に置かない（2026-09-24）。
    //   接続先ドメインの数は、回線の細い環境（家庭回線のポート枯渇など）で効いてくる。
    {
      const html = R('public/index.html');
      // noscript の中だけは残す（JS 無効時のフォールバック）。それ以外に出てこないこと。
      // ★HTML コメントも必ず剥がす。剥がさないと「ここで読まないこと」という
      //   注意書きそのものがテストを落とす（codeOnly は // と /* */ しか見ない）。
      const htmlBody = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<noscript>[\s\S]*?<\/noscript>/g, ' ');
      ok('★GSI（accounts.google.com）を index.html から読まない（ログイン画面で読む）',
        !htmlBody.includes('accounts.google.com'));
      ok('★Google Fonts を index.html から読まない（山頂の看板を描くときに読む）',
        !htmlBody.includes('fonts.googleapis.com') && !htmlBody.includes('fonts.gstatic.com'));
      ok('GSI はログイン画面から動的に読む（views/auth.js の _loadGoogleScript）',
        /const GSI_SRC = 'https:\/\/accounts\.google\.com\/gsi\/client'/.test(R('public/js/views/auth.js')) &&
        /await _loadGoogleScript\(\)/.test(R('public/js/views/auth.js')));
      ok('山頂のフォントは看板を描くときに読む（mountainPath.js の _loadSummitFonts）',
        /_loadSummitFonts\(\);\s*\/\/ ★看板を描くときだけ/.test(R('public/js/mountainPath.js')));
      // ★URL は1文字も変えないこと。noscript 側と JS 側がずれると、JS 無効の人だけ
      //   別のフォントを取りに行く（Google 側のキャッシュキーも変わる）
      const nos = /<noscript>[\s\S]*?href="([^"]+)"[\s\S]*?<\/noscript>/.exec(html)?.[1] || '';
      const js  = /const SUMMIT_FONT_HREF =\s*'([^']+)'/.exec(R('public/js/mountainPath.js'))?.[1] || '';
      ok('★noscript のフォント URL と SUMMIT_FONT_HREF が完全に一致している',
        nos.length > 0 && nos.replace(/&amp;/g, '&') === js, `noscript=${nos}\n     js=${js}`);
    }
    // ★vendor の immutable 配信（.js の no-cache 判定より前に置く必要がある）
    {
      const sv = R('server.js');
      const vendorIdx = sv.indexOf("js[\\\\/]vendor");
      const jsIdx     = sv.indexOf("/\\.(js|html|css|md)$/.test(filePath)");
      ok('★/js/vendor/ を immutable で配信している（判定は .js の no-cache より前）',
        vendorIdx > 0 && jsIdx > 0 && vendorIdx < jsIdx);
    }
    // ★意気込みが無いイベントには出さない（空の箱を見せない）という設計。
    //   代償として、意気込みが未入力のイベントでは🔥が一度も出ない。
    //   ★2026-09-11、これは**このままでよい**と判断済み。モーダル側の条件を
    //     緩めて出そうとしないこと（一度やって戻した経緯がある）。出したいなら
    //     作成フローの STEP 6 を書いてもらう側で手当てする。
    // ★2026-09-21 から「出さなかった理由」を記録するので return の形が変わった
    //   （_skip(p.id, 'no_motivation')）。ガードそのものが残っていることを見る。
    ok('🔥は意気込みがあるときだけ出す（空の箱を見せない）',
      /if \(!_hasMotivation\(p\)\) return/.test(lm));
    // ★既読フラグはモーダルを出せてから立てる（先に立てると、描画で例外が起きたときに
    //   「見ていないのに既読」になり、そのイベントで二度と出ない）
    ok('★🔥の既読フラグはモーダルを出してから立てる',
      /_openModal\(p\);[\s\S]*?localStorage\.setItem\(key, '1'\)/.test(lm));
  }

  // ★オンボーディングには性質の違うものが同居している。混ぜると実務が止まる。
  //   - アプリの使い方の説明（L1/M1/M2/M3）… ユーザー生涯で1回（oncePerUser）
  //   - イベントの状態に紐づく催促（L3/L4/L5/L8/L9/L10）… **イベントごとに出す**
  //   - お祝い（L6/M4）… イベントごと
  //   とくに L4 は「承認しないとメンバーが1人も入れない」現状いちばんのボトルネックで、
  //   L9 は引き継ぎ日 → 自動完了の導線。1回限りにすると2つ目以降のイベントで止まる。
  {
    const ob = R('public/js/onboarding.js');
    // ★切り出しは STEPS 配列の中だけに閉じること。配列の外まで見ると、
    //   最後のステップ（M4）の本文に checkOnboarding の `step.oncePerUser` が
    //   紛れ込んで誤検知する（実際に踏んだ）。
    const stepsSrc = ob.slice(ob.indexOf('const STEPS = ['), ob.indexOf('\n];'));
    /** そのステップ定義の本文（次の `id:` まで）を取り出す */
    const stepBody = (id) => {
      const i = stepsSrc.indexOf(`id: '${id}',`);
      if (i < 0) return '';
      const next = stepsSrc.indexOf("    id: '", i + 10);
      return stepsSrc.slice(i, next < 0 ? stepsSrc.length : next);
    };
    const ONCE = ['L1', 'M1', 'M2', 'M3'];
    const PER_EVENT = ['L3', 'L4', 'L5', 'L6', 'L8', 'L9', 'L10', 'M4'];

    const missing = ONCE.filter(id => !/oncePerUser:\s*true/.test(stepBody(id)));
    ok('★使い方の説明（L1/M1/M2/M3）は oncePerUser（2つ目以降のイベントで出さない）',
      missing.length === 0, missing.join(', '));

    const leaked = PER_EVENT.filter(id => /oncePerUser/.test(stepBody(id)));
    ok('★催促とお祝いに oncePerUser を付けていない（2つ目以降で実務が止まる）',
      leaked.length === 0, leaked.join(', '));

    ok('checkOnboarding が isSeenElsewhere を見ている',
      /step\.oncePerUser && isSeenElsewhere\(/.test(codeOnly(ob)));

    // ★開催日を過ぎたら出さないもの。終わったイベントで「仲間を誘おう」
    //   「担当を決めよう」と催促しても、もうやることが無い。
    //   とくに L4 は repeatEveryMs で24時間ごとに繰り返すので、止めないと
    //   終わったイベントの承認待ちを永久に催促し続ける。
    const HIDE_AFTER = ['L1', 'L3', 'L4', 'L5', 'M2', 'M3'];
    const notHidden = HIDE_AFTER.filter(id => !/hideAfterEvent:\s*true/.test(stepBody(id)));
    ok('★開催後に意味が無い案内は hideAfterEvent（L1/L3/L4/L5/M2/M3）',
      notHidden.length === 0, notHidden.join(', '));

    // ★L9 / L10 は**開催後が本番**。付けると引き継ぎ日 → 自動完了の導線が丸ごと止まる。
    //   L6 / M4（お祝い）と M1（進め方）も止めない方針。
    const KEEP_AFTER = ['L6', 'L8', 'L9', 'L10', 'M1', 'M4'];
    const wrongly = KEEP_AFTER.filter(id => /hideAfterEvent/.test(stepBody(id)));
    ok('★開催後が本番のもの（L9/L10）と祝い（L6/M4）に hideAfterEvent を付けていない',
      wrongly.length === 0, wrongly.join(', '));

    ok('checkOnboarding が hideAfterEvent を見ている',
      /step\.hideAfterEvent && isAfterEventDates\(/.test(codeOnly(ob)));

    // ★「開催後か」の判定は utils の1本に集約する。各ファイルで日付を比べ直すと、
    //   当日を含める／含めないのような差が静かに生まれる。
    ok('★_detectPhase の after 判定も utils に寄せている',
      /if \(isAfterEventDates\(p\)\) return 'after';/.test(ob));

    // ★末尾一致に `:` を付けること。付けないと `L1` の既読が `L10` のキーにも当たり、
    //   どちらも実在するステップIDなので L1 が二度と出なくなる。
    ok('★他イベント判定の末尾一致がコロン付き（L1 が L10 に誤爆しない）',
      /const suffix = `:\$\{stepId\}`/.test(ob));
  }

  // ★開催日を過ぎたイベントで鳴り続けていたもの。
  //   目的リマインドの条件B（無活発）は、開催後に活動が止まるのが当然なので
  //   7日ごとに永久再表示されていた。スキル回収は「担当者のおすすめ」に使う
  //   データなので、割り当てるミッションが無いイベントで聞く意味が無い。
  {
    const pr = codeOnly(R('public/js/modals/purposeReminderModal.js'));
    ok('★目的リマインドは開催日を過ぎたら出さない（7日ごとの無限再表示を止める）',
      /if \(isAfterEventDates\(p\)\) return;/.test(pr));

    const sc = codeOnly(R('public/js/modals/skillCollectModal.js'));
    ok('★スキル回収は開催日を過ぎたら聞かない',
      /if \(isAfterEventDates\(p\)\) return;/.test(sc));

    // ★承認待ち・担当申請・リーダーチェックは開催後でも処理しないと
    //   相手が待たされたままになるので、止めないこと。
    //   （メンバー提案は機能ごと廃止済み。2026-09-16）
    const mn = codeOnly(R('public/js/main.js'));
    ok('★承認待ち・リーダーチェックは開催後も止めていない',
      /const pendingMembers = p\.pendingMembers \|\| \[\];/.test(mn) &&
      /const leaderMissions = \(p\.missions \|\| \[\]\)\.filter\(m => m\.status === 'pending_leader_check'\);/.test(mn));

  }

  // ★意気込みカードのトグルは、保存の往復を待たずにその場で見た目を切り替えること。
  //   以前は `await state.saveNow()` してから state.render() していたため、通信が
  //   終わるまでタップしても何も起きず、毎回ページ全体を描き直してスクロールも
  //   飛んでいた（「選べない・解除できない」という報告の原因）。
  {
    const es = R('public/js/views/eventSettings.js');
    const h = codeOnly(es.slice(es.indexOf('// 意気込みカードのトグル'),
                               es.indexOf('// 意気込みのひとこと')));
    ok('★意気込みのトグルが保存の往復を待たない', !/await state\.saveNow\(\)/.test(h));
    ok('★意気込みのトグルがその場で見た目を切り替える', /classList\.toggle\('is-on'/.test(h));
    ok('意気込みのトグルでページ全体を描き直さない', !/state\.render\(\)/.test(h));
    ok('意気込みのトグルが保存している', /state\.save\(\)/.test(h));
    // ★色だけに頼らない（選択中はチェックマークも出す）
    const css = R('public/css/object/project/_event-settings.css');
    ok('★選択中は色だけでなく印でも分かる',
      /\.p-event-settings__motivation-pick\.is-on::before/.test(css));
  }

  // ★画面いっぱいの高さは svh で取ること。100vh は「アドレスバーが隠れた状態」の
  //   高さなので、中身が収まっていても画面より縦に長くなり、下端に置いた
  //   「次へ」「戻る」がスクロールしないと押せなくなる（実機で指摘を受けた）。
  //   ★vh の行はフォールバックとして残す（svh を解さない古い端末向け）。
  {
    const FULL_HEIGHT = [
      'public/css/foundation/_base.css',
      'public/css/layout/_app.css',
      'public/css/object/project/_create-event.css',
      'public/css/object/project/_signup.css',
    ];
    const missing = FULL_HEIGHT.filter(f => !/min-height:\s*100svh/.test(R(f)));
    ok('★画面高は svh も指定している（下端のボタンが画面外に落ちる不具合）',
      missing.length === 0, missing.join(' '));
    const noFallback = FULL_HEIGHT.filter(f => !/min-height:\s*100vh/.test(R(f)));
    ok('vh のフォールバックを残している', noFallback.length === 0, noFallback.join(' '));
  }

  // ★完了済みのユーザーをアカウント作成へ戻さないこと。
  //   本番で、完了済みの人がアプリを開くたび STEP 6（どこで知ったか）に落ちて
  //   0〜4秒で離脱する事象が5回記録された（2026-08-29〜09-01）。
  //   users.onboarding は完了しており、resumeOnboardingIfNeeded のガードも
  //   当時から同じだったため**経路は未特定**。経路が分からなくても
  //   「完了済みなら入らない」は常に正しいので、入口そのものを塞いである。
  {
    const su = codeOnly(R('public/js/views/signup.js'));
    const body = su.slice(su.indexOf('async function _enterProfilePhase'));
    ok('★完了済みならプロフィール作成に入らない（アカウント作成へ戻さない）',
      /if \(ob\?\.completedAt \|\| ob\?\.currentStep === 'complete'\)/.test(body));
    ok('★戻さなかったときは HOME へ送る（画面が空にならない）',
      /currentStep === 'complete'\)[\s\S]{0,220}currentView = 'HOME'/.test(body));
    // 原因が未特定なので、次に起きたら経路が分かるようにしておく
    ok('どの経路で入ったか記録している（原因の特定用）',
      /logEvent\('signup_profile_phase_entered'/.test(body) &&
      /_enterProfilePhase\('resume'\)/.test(su) &&
      /_enterProfilePhase\('otp_skip'\)/.test(su) &&
      /_enterProfilePhase\('otp_verified'\)/.test(su));
    ok('診断ログに日本語ラベルが付いている',
      /signup_profile_phase_entered:/.test(R('public/js/main.js')) &&
      /signup_resume_blocked:/.test(R('public/js/main.js')));
  }

  // ★完了時の入力欄はタグごとに例文を出す。中身の無い提出（本番の text 提出 48件中
  //   35件が8文字以下で "OK" / "あ" / 氏名だけ）への対策で、**示すだけ**にしてある。
  //   必須化やバリデーションで弾くと完了率が落ちる。
  {
    const co = R('public/js/constants.js');
    const md = R('public/js/views/missionDetail.js');
    const ut = R('public/js/utils.js');
    const mr = R('public/js/views/missionReflect.js');
    const TABLES = [
      'SUBMISSION_PLACEHOLDERS',
      'REFLECT_STRUGGLE_PLACEHOLDERS', 'REFLECT_SOLUTION_PLACEHOLDERS',
      // 「うまくいった」側（2026-09-20）。成否で問いが変わるので例文も分ける
      'REFLECT_EFFECT_PLACEHOLDERS', 'REFLECT_WHY_PLACEHOLDERS',
    ];

    // ★DEFAULT が無いとカスタムタグで undefined が出る（本番の約1/4がカスタムタグ）
    const noDefault = TABLES.filter(t => {
      const b = (new RegExp(`export const ${t} = \\{([\\s\\S]*?)\\n\\};`).exec(co) || [])[1] || '';
      return !/DEFAULT:\s*'/.test(b);
    });
    ok('★プレースホルダーに DEFAULT がある（カスタムタグで undefined を出さない）',
      noDefault.length === 0, noDefault.join(', '));

    // ビルトイン4タグぶん揃っているか
    const missing = [];
    for (const t of TABLES) {
      const b = (new RegExp(`export const ${t} = \\{([\\s\\S]*?)\\n\\};`).exec(co) || [])[1] || '';
      for (const tag of ['企画', '運営', '制作', '広報']) if (!b.includes(`'${tag}':`)) missing.push(`${t}.${tag}`);
    }
    ok('★ビルトイン4タグぶんの例文が揃っている', missing.length === 0, missing.join(', '));

    ok('★プレースホルダーを _esc に通している',
      /placeholder="\$\{_esc\(placeholderFor\(/.test(md) &&
      /placeholder="\$\{_esc\(f\.(struggle|solution)\.placeholder\)\}"/.test(mr));
    // ★タグ別の出し分けは utils.js の placeholderFor 1本。各ファイルに書き写さないこと
    ok('★タグ別の例文の選び方が utils.js に1本化されている',
      /export function placeholderFor\(table, mission\)/.test(ut) &&
      !/function _placeholderFor/.test(codeOnly(md)) &&
      /import \{ placeholderFor \}/.test(md) && /import \{ placeholderFor \}/.test(mr));
    // ★tag（単数）と tags（配列）は両方実在する。片方だけ見ると取りこぼす
    ok('★tag と tags の両方を集合にしてから数えている',
      /Array\.isArray\(mission\?\.tags\) \? mission\.tags : \[\]/.test(codeOnly(ut)) &&
      /mission\?\.tag \? \[mission\.tag\] : \[\]/.test(codeOnly(ut)));
    // ★ビルトインが**ちょうど1つ**のときだけ、そのタグの例文を出す。
    //   2つ以上（例：企画＋広報）はどちらに寄せても片方に対して嘘になるので DEFAULT。
    ok('★ビルトインタグが1つのときだけ専用の例文を出す（複数なら DEFAULT）',
      /builtin\.length === 1 \? \(table\[builtin\[0\]\] \|\| table\.DEFAULT\) : table\.DEFAULT/.test(codeOnly(ut)));
    // ★4タグをここに書き写さないこと（増やしたとき片方だけ直す事故になる）
    ok('★ビルトインの判定を LABEL_CONFIG から引いている',
      /hasOwnProperty\.call\(LABEL_CONFIG, t\)/.test(codeOnly(ut)));

    // ===== 完了後の振り返りページ（2026-09-20。完了フォームの入力欄から移設）=====
    // ★完了は先に確定させ、振り返りは完全な任意。完了フォームに入力欄を戻さないこと
    //   （同じ id が2箇所に描画されると getElementById が壊れる）。
    ok('★完了フォームに振り返りの入力欄が無い（ページへ移設済み）',
      !/_renderReflectionInput/.test(md) && !/id="reflect-struggle"/.test(md));
    ok('★振り返りページが登録されている（ビュー MISSION_REFLECT）',
      /registerRenderer\('MISSION_REFLECT'/.test(R('public/js/main.js')));
    // ★保存は PATCH .../reflection だけ。completeMission を再送すると山のオブジェクトが
    //   引き直され、完了通知と Web Push も再送される
    // ★判定は codeOnly を通す。「completeMission を再送しないこと」という注意書き自体が
    //   引っかかるため（落とし穴 0-8）
    ok('★振り返りの保存に completeMission を再送していない',
      /api\.updateReflection\(/.test(mr) && !/completeMission/.test(codeOnly(mr)));
    // ★成否で問いを変える（「どう乗り越えた？」だけだと、乗り越えられなかった人が書けない）
    ok('★成否で見出しを切り替えている（REFLECT_LABELS）',
      /REFLECT_LABELS/.test(mr) && /REFLECT_LABELS/.test(md) &&
      /REFLECT_LABELS/.test(R('public/js/modals/reflectionEditModal.js')));
    // ★絵はイラストへ差し替える前提。constants.js の OUTCOME_CHOICES.art だけに置く
    //   ★ここも codeOnly を通す（「絵は constants.js にだけ置く」という注意書きに
    //     絵文字が出てくるため）
    const artEmoji = /[🎉🤔]/u;
    ok('★選択肢の絵が constants.js の1箇所にしかない',
      artEmoji.test(co) && !artEmoji.test(codeOnly(mr)) &&
      !artEmoji.test(codeOnly(R('public/css/object/project/_mission-reflect.css'))));
    // ★枠は正方形で固定（イラストに差し替えてもレイアウトが崩れないようにする）
    const mrc = R('public/css/object/project/_mission-reflect.css');
    ok('★絵の枠が正方形で確保されている（48〜56px・aspect-ratio）',
      /\.p-mission-reflect__chip-art \{[\s\S]*?width: 5[0-6]px;[\s\S]*?aspect-ratio: 1 \/ 1;/.test(mrc));
    // ★成否で演出の「量」に差をつけない。無反応だと正直な報告が損をする
    ok('★つまずいた側にも粒の演出がある',
      /is-pressed\[data-reflect-outcome="struggle"\][\s\S]*?animation: fireSpark/.test(mrc));
    ok('★受け止めの一言を両方に用意している（OUTCOME_REPLIES）',
      /OUTCOME_REPLIES = \{[\s\S]*?success:[\s\S]*?struggle:/.test(co) && /OUTCOME_REPLIES/.test(mr));
    // ★モバイルでキーボードが飛び出すので、開いたときに自動フォーカスしない
    ok('★入力欄を開いても自動フォーカスしない',
      !/(reflect-struggle|reflect-solution)'\)\?\.focus\(\)/.test(codeOnly(mr)));
    // ★height:auto のトランジションは効かない
    ok('★入力欄の開閉が max-height + opacity で作られている',
      /\.p-mission-reflect__fields \{[\s\S]*?max-height: 0;[\s\S]*?opacity: 0;/.test(mrc));
    ok('★prefers-reduced-motion で演出を止めている',
      /@media \(prefers-reduced-motion: reduce\)/.test(mrc));
    // ★@keyframes はグローバル名なので foundation/_animation.css に集める
    const anim = R('public/css/foundation/_animation.css');
    ok('★新しい @keyframes が foundation/_animation.css にある',
      /@keyframes popIn/.test(anim) && /@keyframes pressDown/.test(anim) &&
      !/@keyframes/.test(mrc));

    // ★示すだけ。完了時に中身のチェックを足さない
    const submit = codeOnly(R('public/js/modals/helpers.js'));
    const fn = submit.slice(submit.indexOf('export async function submitMissionClear'));
    ok('★提出の中身をバリデーションしていない（完了率を落とさない）',
      !/完了しました|minLength|trim\(\)\.length\s*[<>]=?\s*\d/.test(fn.slice(0, 2000)));
  }

  // ★タスク名の自動フォーカスは「タップのハンドラの中」で当てること。
  //   スマホはユーザー操作の外で呼ばれた focus() を無視する（PC だけ効いていた）。
  {
    const mi = codeOnly(R('public/js/modals/mission.js'));
    const open = mi.slice(mi.indexOf('export function openMissionModal'));
    const body = open.slice(0, open.indexOf('\n}\n'));
    // ★見るのは「関数の本体に直接書いてあるか」。コールバックの中に入っていると、
    //   呼ばれるのはタップが終わったあと＝スマホでは無視される。
    //   ★位置の前後だけで判定しないこと（コールバックの定義自体は手前にあるので
    //     素通りする。実際にこの書き方で見逃した）。
    //   見方は**字下げ**。関数の本体に直接書いた行は2つ空き、コールバックの中なら
    //   もっと深いか `=> {` と同じ行に来る。★「_focusTitle が現れる位置が
    //   transitionend より前か」で判定しないこと（コールバックの**定義**は手前に
    //   あるので素通りする。実際にこの書き方で見逃した）。
    const calls = [...body.matchAll(/^([ \t]*)_focusTitle\(\);/gm)].map(m => m[1].length);
    ok('★タスク名のフォーカスはタップの中で当てる（コールバックに入れない）',
      calls.length === 1 && calls[0] === 2, `字下げ ${calls.join(',') || 'なし'}`);
    // ★ツアーが**これから**走るときは当てない（DOM の有無では判定できない）
    ok('★ツアーが走る回は isMissionFormTourPending で避ける',
      /isMissionFormTourPending\(\)/.test(mi) &&
      /isMissionFormTourPending/.test(codeOnly(R('public/js/onboardingIntro.js'))));
  }

  // ★メインボードのミッションの並び。既定は締切順で、締切順のときだけ月の見出しが付く。
  {
    const mi = R('public/js/modals/mission.js');
    const st = R('public/js/state.js');
    const mb = R('public/js/views/mainBoard.js');

    // 並びは「締切順 → 優先度順 → 制作日順」
    const order = [...mi.matchAll(/\{ id: '(deadline|priority|createdAt)',/g)].map(m => m[1]);
    ok('★並び替えメニューが 締切順 → 優先度順 → 制作日順 の順',
      order.join(',') === 'deadline,priority,createdAt', order.join(','));
    ok('★既定の並びが締切順', /missionSortMode: 'deadline'/.test(st));

    // ★見出しは締切順のときだけ。他の並びで出すと「月の順に並んでいる」という嘘になる
    ok('★月の見出しは締切順のときだけ出す',
      /state\.missionSortMode !== 'deadline'\) return cards\.join\(''\)/.test(codeOnly(mb)));
    // ★m.dates は未ソート保存（落とし穴 12）。ソートしてから最終日を取ること
    ok('★締切は dates をソートしてから最終日を取っている',
      /\[\.\.\.dates\]\.sort\(\)\.at\(-1\)/.test(codeOnly(mb).slice(codeOnly(mb).indexOf('function _deadlineMonthKey'))));
    // 締切なしは末尾に「期限なし」でまとめる
    ok('★締切が無いものに「期限なし」の見出しを出す', /return '期限なし'/.test(mb));
    // 年をまたぐときだけ年を出す
    ok('★年をまたぐときだけ見出しに年を出す',
      /const withYear = years\.size > 1/.test(codeOnly(mb)));
    // 空のときは配列にならないので、見出し処理へ渡さない
    ok('★ミッションが0件のときは見出し処理を通さない',
      /Array\.isArray\(missionCardList\)/.test(codeOnly(mb)));
  }

  // ★人を表す箇所はアバターを出し、タップでプロフィールを開けるようにする。
  //   アバターは必ず Components.UserAvatar を通すこと。自前で <img> と頭文字を
  //   描き分けると、Google の画像が読めなかったときのフォールバックが無くなり、
  //   他の画面と見た目も揃わない（承認待ちと選定モーダルで実際にそうなっていた）。
  {
    const files = {
      'views/missionDetail.js': R('public/js/views/missionDetail.js'),
      'views/mainBoard.js':     R('public/js/views/mainBoard.js'),
      'modals/mission.js':      R('public/js/modals/mission.js'),
      'main.js':                R('public/js/main.js'),
    };
    // 自前で頭文字の丸を描いていないこと（UserAvatar のフォールバックに任せる）
    const handRolled = Object.entries(files).filter(([, src]) =>
      /charAt\(0\)\.toUpperCase\(\)/.test(codeOnly(src)));
    ok('★アバターを自前で描いていない（UserAvatar に任せる）',
      handRolled.length === 0, handRolled.map(([f]) => f).join(', '));

    // userId を渡してタップでプロフィールが開くこと
    const spots = [
      ['個別完了の完了状況リスト', files['views/missionDetail.js'], /size: 24, userId: uid/],
      ['担当者・応募者のチップ',   files['views/mainBoard.js'],     /size: 20, userId: uid/],
      ['選定モーダルの応募者',     files['modals/mission.js'],      /size: 36, userId: uid/],
      ['承認待ちメンバー',         files['main.js'],                /size: 36, userId: m\.userId/],
      ['リーダーチェックの提出者', files['main.js'],                /size: 24, userId: cd\.submittedBy/],
    ];
    const noProfile = spots.filter(([, src, re]) => !re.test(src)).map(([n]) => n);
    ok('★人のアイコンはタップでプロフィールが開く（userId を渡している）',
      noProfile.length === 0, noProfile.join(', '));

    // ★チップは HTML を返す。埋め込む側で _esc に通すと二重エスケープになる
    ok('★担当者チップを二重エスケープしていない',
      /class="p-main-board__mission-assignee">担当：\$\{names\}/.test(files['views/mainBoard.js']) &&
      /class="p-main-board__claim-names">\$\{names\}/.test(files['views/mainBoard.js']));

    // ★承認待ちカードの HTML は2箇所で組み立てる。アバターも共通ヘルパに集約すること
    ok('★承認待ちのアバターが2箇所とも共通ヘルパを通る',
      (files['main.js'].match(/\$\{_pendingAvatarHtml\(m\)\}/g) || []).length === 2);

    // ★リーダーチェックは「誰の提出か」を出す（以前は分からないまま判断させていた）
    ok('★リーダーチェックに提出者を出している',
      /c-list-sheet__submitter/.test(files['main.js']) && /cd\?\.submittedBy/.test(files['main.js']));

    // ★担当者シートの通常行にもアバターを出す（おすすめの行だけではない）
    ok('★担当者シートのメンバー行にアバターがある',
      /size: 28, userId: m\.userId/.test(files['modals/mission.js']) &&
      /p-assignee__row-user/.test(files['modals/mission.js']));

    // ★★<button> の中に <button> を置かないこと。HTML として不正で、パーサーが
    //   **外側の button を強制的に閉じる**。アバター以降の中身が行の外へ弾き出され、
    //   名前が中央に揃わないだけでなく、**そこをタップしても行が選択されない**
    //   （実際に起きた。parse5 で DOM を作って確認済み）。
    //   アバター（userId 付き＝button）を含む行は <div role="button"> にする。
    {
      const mi = files['modals/mission.js'];
      const userRows = [...mi.matchAll(/<(\w+)[^>]*data-assignee-pick="user:/g)].map(m => m[1]);
      ok('★アバターを含む行を <button> にしていない（button の入れ子は不正）',
        userRows.length > 0 && userRows.every(t => t === 'div'), userRows.join(', '));
      ok('★その行に role="button" と tabindex がある',
        (mi.match(/<div role="button" tabindex="0" data-assignee-pick="user:/g) || []).length === 2);
      // role="button" は Enter / Space で発火しないので、自前で補うこと
      ok('★role="button" の行をキーボードで操作できる',
        /getAttribute\('role'\) === 'button'/.test(codeOnly(mi)) &&
        /e\.key === 'Enter' \|\| e\.key === ' '/.test(codeOnly(mi)));
    }

    // ★プロフィールカードはシートより前に出すこと。既定の --z-overlay(100) だと
    //   担当者シート(210)やリーダーチェック(150)の裏に隠れて見えない（実際に起きた）。
    const up = R('public/js/modals/userProfileModal.js');
    const ov = R('public/css/object/component/_overlay.css');
    const vr = R('public/css/foundation/_variables.css');
    ok('★プロフィールカードがシートより前に出る',
      /c-overlay--profile/.test(up) &&
      /\.c-overlay--profile\s*\{[^}]*z-index: var\(--z-user-profile\)/.test(ov));
    {
      const z = (n) => +(new RegExp(`--z-${n}:\\s*(\\d+)`).exec(vr) || [])[1];
      const profile = z('user-profile');
      const sheets = ['sheet', 'sheet-stacked', 'pending', 'list-modal', 'schedule'].map(z);
      ok('★プロフィールの z がすべてのシートより大きい',
        sheets.every(v => profile > v), `profile=${profile} vs ${sheets.join(',')}`);
    }
  }

  // ★ズームを殺して逃げていないこと
  const html = R('public/index.html');
  ok('★viewport でピンチズームを禁止していない（maximum-scale / user-scalable）',
    !/maximum-scale|user-scalable/.test(html));
}

const overlay = R('public/css/object/component/_overlay.css');
ok('★ボトムシートの暗幕が横中央に寄せる（左へずれた不具合）',
  /\.c-overlay--bottom\s*\{[^}]*justify-content: center/.test(overlay));

const createEvent = R('public/js/views/createEvent.js');
const drag = createEvent.slice(createEvent.indexOf('function _bindCalendarDrag'));
ok('★開催日カレンダーは Pointer Events 1系統（単発タップで戻る不具合）',
  drag.includes("addEventListener('pointerdown'") &&
  !/addEventListener\('mousedown'/.test(drag) &&
  !/addEventListener\('touchstart'/.test(drag));
ok('★document にリスナーを溜めていない', !/document\.addEventListener/.test(drag));

// ★測るのは「開き終わってから」。開くアニメーションの最中だと入力欄がまだ
//   画面の下にあり、1枚目の吹き出しが出ないまま消えた（実機で見つかった）。
ok('★ツールチップは作成モーダルが開き終わってから測る（1枚目が出ない不具合）',
  R('public/js/modals/mission.js').includes("addEventListener('transitionend'"));
ok('吹き出しを画面内に収める処理がある',
  R('public/js/modals/tooltipTour.js').includes('innerHeight'));

// ★<br> を含む文言は「発生源でエスケープ、描画側ではしない」。
//   描画側で二重に esc すると <br> が文字として出る（実際に出した）。
const brRules = [
  ['オンボーディングの見出し', 'public/js/modals/onboardingModal.js', '">${o.title}</h3>'],
  ['アカウント作成の診断',     'public/js/views/signup.js',           '">${q.title}</h1>'],
];
for (const [label, f, needle] of brRules) {
  ok(`★${label}を描画側で esc していない`, R(f).includes(needle));
}
ok('★発生源（onboarding.js）でユーザー名をエスケープしている',
  R('public/js/onboarding.js').includes('_escapeName'));
ok('<br> を含まないコーチマークは esc したまま',
  R('public/js/modals/coachMark.js').includes('${_esc(o.title)}') &&
  !/title:\s*'[^']*<br>/.test(R('public/js/onboardingIntro.js')));

// ------------------------------------------------------ [C] 完了条件
section('[C] 完了条件');

const styleInJs = JS_ALL.filter(f => /<style>/.test(R(f)));
ok('★JS の中に <style> を書いていない', styleInJs.length === 0, styleInJs.join(' '));

// ★Tailwind は撤去済み。class="..." だけでなく className = '...' も見る。
//   Phase 5 で「0 になった」と判断した後、className で組み立てていた
//   オーバーレイ4つとトースト5つが取り残されていた（実機で発覚）。
//   当たるものが何も無いので、そのモーダルは位置指定を丸ごと失っていた。
const TW_TOKEN = /^(flex|grid|w-|h-|p[xytblr]?-|m[xytblr]?-|text-|bg-|border|rounded|gap-|items-|justify-|absolute|relative|fixed|sticky|z-|shadow|opacity-|truncate|overflow-|min-|max-|space-|leading-|font-|whitespace-|break-|object-|inline|block|cursor-|active:|hover:|peer|ring-|backdrop-|transition|duration-|scale-|translate|rotate-|list-|underline|resize|select-|pointer-events-|animate-)/;
const KEEP_TOKEN = /^(heading-(l|m|r|rs)|text-(m|r|rs))$/;
const twLeft = [];
for (const f of JS_ALL.concat(['public/index.html'])) {
  const src = R(f);
  const chunks = [
    ...[...src.matchAll(/class="([^"]*)"/g)].map(m => m[1]),
    ...[...src.matchAll(/className\s*=\s*'([^']*)'/g)].map(m => m[1]),
    ...[...src.matchAll(/className\s*=\s*`([^`]*)`/g)].map(m => m[1]),
  ];
  for (const ch of chunks) {
    for (const t of ch.split(/\s+/)) {
      if (!t || t.includes('${') || /^(l|c|p|u|js|is)-/.test(t)) continue;
      if (KEEP_TOKEN.test(t)) continue;
      if (TW_TOKEN.test(t)) twLeft.push(`${path.basename(f)}: ${t}`);
    }
  }
}
ok('★Tailwind のユーティリティが残っていない（className も含めて）',
  twLeft.length === 0, [...new Set(twLeft)].slice(0, 12).join(' / '));
ok('★Tailwind CDN を読み込んでいない',
  !R('public/index.html').includes('cdn.tailwindcss.com'));

// JS が掴んでいる id / data 属性。改名すると静かに壊れるので存在を見張る。
const HOOKS = [
  ['public/js/modals/mission.js', ['id="mission-panel"', 'id="assignee-sheet-panel"',
    'id="tag-creator-panel"', 'data-coach="mission-title"', 'data-coach="assignee"',
    'data-coach="schedule"']],
  ['public/js/modals/calendar.js', ['id="calendar-bottomsheet-panel"', 'data-sheet-handle']],
  ['public/js/dialog.js', ['id="cd-ok"', 'id="cd-cancel"', '__sheetClose']],
  ['public/js/modals/eventCalendarSheet.js', ['id="mb-cal-fixed"', 'id="mb-cal-list"',
    'id="gantt-header-inner"', 'id="gantt-body"', 'id="btn-view-calendar"',
    'id="btn-view-gantt"', 'data-mb-day', 'data-mb-section', 'data-mission-id',
    'data-sheet', 'data-sheet-handle']],
  ['public/js/views/missionDetail.js', ['id="clear-input"', 'id="file-input"']],
];
for (const [f, hooks] of HOOKS) {
  const src = R(f);
  const missing = hooks.filter(h => !src.includes(h));
  ok(`${path.basename(f)}: JS が掴む id / 属性が残っている`, missing.length === 0, missing.join(' '));
}

// 同じ id が別ファイルで使われていないか（白画面バグの原因になった）。
// 意図して共有しているものだけ除外する。
const SHARED_OK = new Set(['clear-mission-modal', 'clear-input', 'img-chip', 'preview-img',
  'file-input', 'clear-checklist-error']);
const idOwners = new Map();
for (const f of JS_ALL) {
  for (const m of R(f).matchAll(/id="([a-z][a-z0-9-]*)"/g)) {
    if (!idOwners.has(m[1])) idOwners.set(m[1], new Set());
    idOwners.get(m[1]).add(f);
  }
}
// ★既知：auth.js の renderCreateAccountInfo（旧アカウント作成画面）が
//   signup.js と同じ id を持つ。この関数はどこからも呼ばれていない死にコードで、
//   消すのが正しい直し方だが、削除の判断は保留中。両方が同時に DOM に出ることは
//   無いので実害は出ていない。★消したらこの除外も消すこと。
const KNOWN_DEAD_CODE = new Set(['ca-google-section', 'ca-google-btn']);
const clashes = [...idOwners].filter(([id, fs_]) =>
  fs_.size > 1 && !SHARED_OK.has(id) && !KNOWN_DEAD_CODE.has(id));
ok('★同じ id をファイル跨ぎで使っていない', clashes.length === 0,
  clashes.map(([id, fs_]) => `${id}: ${[...fs_].map(x => path.basename(x)).join(', ')}`).join('\n     '));
console.log('  ⚠️ 既知: auth.js の死にコード renderCreateAccountInfo が signup.js と'
  + ' id を共有している（ca-google-section / ca-google-btn）。削除の判断待ち。');

console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
