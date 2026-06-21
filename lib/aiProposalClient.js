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

function _buildUserPrompt(ctx) {
  const missions = Array.isArray(ctx.existingMissions) ? ctx.existingMissions : [];
  const missionLines = missions.length
    ? missions.map(m => `- ${m.title}（${m.tag || '?'}・${m.status || '?'}）`).join('\n')
    : '（なし）';
  const avoid = (ctx.avoidTitles || []).join('、') || '（なし）';

  // 序盤判定は「完了済みミッション数」で行う（完了が少ない＝まだ序盤）
  const completed = missions.filter(m => m.status === '完了').length;
  const isEarly = completed < EARLY_COMPLETED_THRESHOLD;
  const sparkLine = isEarly
    ? '\n- 【このイベントはまだ序盤です】3件のうち**1件**は、成果物を作るミッションではなく' +
      '「調査・リサーチ・情報収集・気づき」を促す軽量なミッションにしてください' +
      '（例: 競合・類似イベントを調べる / ターゲット層のニーズを調査する / 参考になる事例や事業者を集める）。' +
      '残り2件は具体的な成果物ミッションにしてください。'
    : '';

  return [
    '# イベント情報',
    `- 名前: ${ctx.name || '(無題)'}`,
    `- 説明: ${ctx.description || '(説明なし)'}`,
    `- フェーズ: ${ctx.phase || '不明'} / 明示フェーズ: ${ctx.eventPhase || '未設定'} / 開催まで: ${ctx.daysLeft == null ? '未定' : ctx.daysLeft + '日'}`,
    `- 完了済みミッション数: ${completed}`,
    '- 既存ミッション:',
    missionLines,
    `- 避けるべきタイトル（重複禁止）: ${avoid}`,
    '',
    '# 指示',
    '上記イベントに固有の、実行可能なミッションを必ず3件提案してください。制約:',
    '- tag は「企画」「運営」「制作」「広報」のいずれか。3件はできるだけタグを分散させる。',
    '- format は「text」「image」「link」のいずれか（成果物の形式に応じて）。',
    '- 既存ミッション・避けるべきタイトルと意味が重複しないこと。' + sparkLine,
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
    return proposals;
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
