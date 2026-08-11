// lib/aiProposalClient.js — Cloudflare Workers AI でミッション提案を生成する
//
// 既存の R2 と同じ Cloudflare エコシステムで完結（外部の OpenAI/Anthropic は使わない）。
// 失敗・タイムアウト・未設定時は例外を投げ、呼び出し側（server.js）が
// proposalEngine（テンプレ）へフォールバックする。提案は絶対に空にしない。
//
// 環境変数:
//   CF_ACCOUNT_ID    — Cloudflare アカウントID（無ければ R2_ACCOUNT_ID を流用）
//   CF_AI_API_TOKEN  — Workers AI 実行権限のある API トークン
//   CF_AI_MODEL      — モデル名（既定: @cf/qwen/qwen3-30b-a3b-fp8）
//
// モデル選定の経緯（Phase 0 でライブ比較）: qwen3-30b-a3b は日本語が自然・MoEで低コスト・
// tag/format 順守◎。`/no_think` で reasoning を抑制すると出力が ~200トークン・2秒台で安定する。
// CF は本モデルの result.response を「パース済み dict 配列」で返すことがあるため両対応する。

'use strict';

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '';
const API_TOKEN  = process.env.CF_AI_API_TOKEN || '';
const MODEL      = process.env.CF_AI_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8';

const VALID_TAGS    = ['企画', '運営', '制作', '広報'];
const VALID_FORMATS = ['text', 'image', 'link'];
const TIMEOUT_MS    = 15000;
const EARLY_COMPLETED_THRESHOLD = 3; // 完了ミッションがこの数「未満」なら序盤（気づき・調査枠を1件入れる）

function isConfigured() {
  return !!(ACCOUNT_ID && API_TOKEN);
}

// `/no_think` で qwen3 の reasoning を抑制（出力短縮・JSON途中切れ防止）
const SYSTEM_PROMPT =
  '/no_think あなたはイベント企画チームを支援するアシスタントです。' +
  '与えられたイベント情報を踏まえ、チームが次に取り組むべき実行可能なミッションを提案します。' +
  '各ミッションは title（簡潔で動詞で終わる短い句）と description（2〜3文の具体的な進め方）を持ちます。' +
  '日本語で出力してください。';

// ── タイトルの重複判定（表記ゆれ対応の正規化比較） ──
// 完全一致だけでなく「片方がもう片方を包含する（6文字以上）」も重複とみなす。
// 例:「メインビジュアルを作成する」と「メインビジュアル作成」は重複。
function _normTitle(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[、。・．，「」『』（）()[\]【】!！?？:：;；~〜\-ー]/g, '')
    .replace(/を/g, '')      // 助詞「を」の有無を吸収（「チラシを作成」=「チラシ作成」）
    .replace(/する$/, '');   // 語尾「する」の有無を吸収（「〜を作成する」=「〜作成」）
}

function _isDupTitle(a, b) {
  const na = _normTitle(a), nb = _normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer  = na.length <= nb.length ? nb : na;
  return shorter.length >= 5 && longer.includes(shorter);
}

/**
 * イベント名末尾の「班・部門」を取り出す。
 * 「富士見湯PR_広報」「文化祭-制作班」「学園祭（映像）」→ 広報 / 制作班 / 映像
 *
 * ★1つの催しを班ごとに別イベントとして立てる運用が実際に多い。ここを拾わないと
 *   兄弟イベント（広報／販促／WS／PM…）に同じ提案が並んでしまう。
 * 区切りが無い、または長すぎる（＝ただの名前）ときは null を返して従来どおり扱う。
 */
function _teamSuffix(name) {
  const s = String(name || '').trim();
  const m = s.match(/[_＿\-－—/／|｜]\s*([^_＿\-－—/／|｜]{1,12})$/)
         || s.match(/[（(]\s*([^（()）]{1,12})\s*[)）]\s*$/);
  if (!m) return null;
  const t = m[1].trim();
  // 年号・連番だけのサフィックスは班名ではない（例: 文化祭_2026, 展示-01）
  if (!t || /^[0-9０-９.\-\s]+$/.test(t)) return null;
  return t;
}

function _buildUserPrompt(ctx) {
  const missions = Array.isArray(ctx.existingMissions) ? ctx.existingMissions : [];
  const missionLines = missions.length
    ? missions.map(m => `- ${m.title}（${m.tag || '?'}・${m.status || '?'}）`).join('\n')
    : '（なし）';
  // 禁止リスト：直近のものを優先して最大40件（プロンプト肥大を防ぐ）
  const avoidList = (ctx.avoidTitles || []).filter(Boolean).slice(-40);
  const avoidLines = avoidList.length
    ? avoidList.map(t => `- ${t}`).join('\n')
    : '（なし）';

  // 序盤判定は「完了済みミッション数」で行う（完了が少ない＝まだ序盤）
  const completed = missions.filter(m => m.status === '完了').length;
  const isEarly = completed < EARLY_COMPLETED_THRESHOLD;
  // ★ここに具体例を書かないこと。
  //   以前は「（例: 競合・類似イベントを調べる / ターゲット層のニーズを調査する / …）」と
  //   例示していたところ、モデルが例文をそのままコピーし、本番16イベント中9イベントで
  //   「ターゲット層の〜を調査する」系が出る事態になった（言い換えが多く _isDupTitle も
  //   すり抜ける）。例を出さず、条件で縛る。
  const sparkLine = isEarly
    ? '\n- 【このイベントはまだ序盤です】3件のうち**1件だけ**は、成果物を作るミッションではなく' +
      '「調べて分かったことをまとめる」軽量なミッションにしてください。ただし調査対象は' +
      '**このイベントの名前・説明に出てくる固有名詞（場所・団体・作品・テーマ）を必ず含める**こと。' +
      '「ターゲット層」「顧客層」「来場者層」のような一般的な言葉だけの調査ミッションは禁止です。' +
      '残り2件は具体的な成果物ミッションにしてください。'
    : '\n- 調査・リサーチだけのミッションは3件中1件までにしてください。';

  // 運営メンバーが自分1人のときだけ、仲間集めを促す（作成時に人数は尋ねない。実測値で判断する）
  const soloLine = ctx.memberCount === 1
    ? '\n- 【運営メンバーはまだ1人です】3件のうち1件は、一緒に動く仲間を集める・役割を頼むミッションにしてください。'
    : '';

  // 値が無い項目は行ごと省略する（「未設定」の行はトークンの無駄）
  const infoLines = ['# イベント情報', `- 名前: ${ctx.name || '(無題)'}`];
  if (ctx.eventTypeLabel)     infoLines.push(`- 種別: ${ctx.eventTypeLabel}`);
  if (ctx.expectedScaleLabel) infoLines.push(`- 想定来場者: ${ctx.expectedScaleLabel}`);
  if (ctx.memberCount)        infoLines.push(`- 運営メンバー: 現在${ctx.memberCount}人`);
  if (ctx.catchphrase)        infoLines.push(`- キャッチコピー: ${ctx.catchphrase}`);
  if (ctx.motivation)         infoLines.push(`- 意気込み: ${ctx.motivation}`);
  if (ctx.description)        infoLines.push(`- 説明: ${ctx.description}`);
  infoLines.push(
    `- フェーズ: ${ctx.phase || '不明'} / 明示フェーズ: ${ctx.eventPhase || '未設定'} / 開催まで: ${ctx.daysLeft == null ? '未定' : ctx.daysLeft + '日'}`,
    `- 完了済みミッション数: ${completed}`,
    '- 既存ミッション:',
    missionLines,
  );

  // ★イベント名の「班・部門サフィックス」を担当領域として扱う。
  //   本サービスの利用者は、1つの催しを班ごとに別イベントとして立てる運用をしている
  //   （例: 富士見湯PR_広報 / 富士見湯PR_販促 / 富士見湯PR_WS / 富士見湯PR_PM）。
  //   名前を弱く扱うと、どの班にも同じ提案が出て使い物にならない。
  const team = _teamSuffix(ctx.name);
  const teamLine = team
    ? `\n- 【最重要】このイベントは「${team}」の担当班です。**3件すべてを「${team}」の仕事の範囲**で提案してください。` +
      `他の班がやること（${team}以外の領域）は提案しないこと。` +
      `「${team}」が略語や独自の呼び方で意味が取れない場合は、説明・概要から担当領域を読み取ってください。`
    : '';

  return [
    ...infoLines,
    '',
    '# 禁止リスト（既存ミッション・過去の提案。再提案禁止）',
    avoidLines,
    '',
    '# 指示',
    '上記イベントに固有の、実行可能なミッションを必ず3件提案してください。制約:',
    // ★名前を最優先の手がかりにする。名前の固有名詞（場所・団体・作品名）を
    //   タイトルか説明に必ず含めさせることで、汎用的な提案に逃げるのを防ぐ。
    '- 【最重要】**イベント名を最優先の手がかり**にしてください。名前に含まれる固有名詞' +
      '（場所・団体・作品・題材の名前）を、3件のうち少なくとも2件のタイトルか説明に必ず入れること。'
      + teamLine,
    '- tag は「企画」「運営」「制作」「広報」のいずれか。3件はできるだけタグを分散させる。',
    '- format は「text」「image」「link」のいずれか（成果物の形式に応じて）。',
    '- 【最重要】禁止リストにあるものと同じタイトルはもちろん、**言い換え・類義語・目的が同じミッション**も提案しないこと' +
      '（例:「メインビジュアルを作成する」に対する「キービジュアルを制作する」は同じとみなし禁止）。',
    '- 【最重要】どのイベントにも当てはまる汎用的なミッションを書かないこと。' +
      '**このイベントの名前・説明・種別から読み取れる固有の事情**（扱う題材、場所、相手、作るもの）に踏み込んでください。',
    '- 完了済みの既存ミッションと同じ内容・目的のミッションを再提案しないこと（既に終わっている作業のため）。'
      + sparkLine + soloLine,
    '- 出力は厳密なJSON配列のみ。前後の説明文やMarkdownのコードフェンスを一切付けない。',
    '- 形式: [{"title":"...","description":"...","tag":"...","format":"..."}, ...]',
  ].join('\n');
}

function _clampTag(t)    { return VALID_TAGS.includes(t)    ? t : '企画'; }
function _clampFormat(f) { return VALID_FORMATS.includes(f) ? f : 'text'; }

// CF の result.response は (a) パース済み dict 配列 / (b) 文字列 で返り得る。両対応 + choices フォールバック。
function _parseProposals(result) {
  let items = null;
  const resp = result && result.response;

  if (Array.isArray(resp) && resp.length && resp.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
    items = resp; // 既にパース済みのオブジェクト配列
  } else {
    let text = '';
    if (typeof resp === 'string') text = resp;
    else if (Array.isArray(resp)) text = resp.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join('');
    if (!text) {
      const choice = result && Array.isArray(result.choices) ? result.choices[0] : null;
      text = (choice && choice.message && choice.message.content) || '';
    }
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '');
    const tryParse = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };
    const arrMatch = text.match(/\[[\s\S]*\]/);
    const arr = arrMatch ? tryParse(arrMatch[0]) : null;
    if (Array.isArray(arr)) {
      items = arr;
    } else {
      // 配列括弧なしの {…}{…}{…} 連結に対応：個々のオブジェクトを抽出
      items = [];
      const objs = text.match(/\{[^{}]*\}/g) || [];
      for (const o of objs) { const parsed = tryParse(o); if (parsed) items.push(parsed); }
    }
  }

  return (items || [])
    .filter(p => p && typeof p.title === 'string' && p.title.trim())
    .slice(0, 3)
    .map(p => ({
      title:       String(p.title).trim().slice(0, 80),
      description: String(p.description || '').trim().slice(0, 400),
      tag:         _clampTag(p.tag),
      format:      _clampFormat(p.format),
    }));
}

async function _callOnce(ctx) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: _buildUserPrompt(ctx) },
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Cloudflare AI HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.success === false) {
      throw new Error('Cloudflare AI error: ' + JSON.stringify(data.errors || []).slice(0, 200));
    }
    const proposals = _parseProposals(data && data.result);
    if (!proposals.length) throw new Error('Cloudflare AI returned no valid proposals');

    // ── 後段フィルタ（プロンプト頼みにしない）──
    // 禁止リスト（既存ミッション・現在の提案・過去の提案履歴）と正規化比較で重複するもの、
    // および今回の3件同士で重複するものを落とす。全滅なら throw → リトライ → テンプレへ。
    const avoid = (ctx.avoidTitles || []).filter(Boolean);
    const kept = [];
    for (const pr of proposals) {
      if (avoid.some(t => _isDupTitle(pr.title, t))) continue;
      if (kept.some(k => _isDupTitle(pr.title, k.title))) continue;
      kept.push(pr);
    }
    if (!kept.length) throw new Error('all AI proposals duplicated existing/recent titles');
    return kept;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * イベント文脈からミッション提案（最大3件）を生成する。
 * 失敗時は例外を投げる（呼び出し側でテンプレエンジンにフォールバックすること）。
 * @param {object} ctx
 *   { name, description, phase, eventPhase, daysLeft,
 *     existingMissions:[{title,tag,status}], avoidTitles:[...] }
 * @returns {Promise<Array<{title,description,tag,format}>>}
 */
async function generateMissionProposals(ctx) {
  if (!isConfigured()) throw new Error('Cloudflare Workers AI is not configured');
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) { // 失敗時に1回だけリトライ
    try { return await _callOnce(ctx); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

module.exports = { generateMissionProposals, isConfigured, MODEL };
