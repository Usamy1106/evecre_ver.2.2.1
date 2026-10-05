// lib/webhookClient.js — Discord / Slack の Incoming Webhook へ投稿する
//
// 設計の要点（守ること）:
//  - 送り先は detectKind の正規表現に合う URL だけ（任意の URL へサーバーから POST させない）。
//    ★正規表現は public/js/constants.js の WEBHOOK_URL_PATTERNS と同じ値に保つこと
//  - メンションを起こさない：Discord は allowed_mentions: { parse: [] }、
//    Slack は & < > をエスケープ（<!channel> を作らせない）
//  - 本処理を止めない：send() は中で必ず catch し、例外を外へ出さない。タイムアウト 5 秒
//  - 壊れた URL に送り続けない：401/403/404/410 で status を broken にする
//  - 429 は待ち時間が 5 秒以内なら1回だけ待って再送。それ以上は待たない
//  - 投稿文に絵文字を使わない。用語は「タスク」

'use strict';

const webhookStore = require('./webhookStore');

const DISCORD_RE = /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
const SLACK_RE   = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;

const TIMEOUT_MS      = 5000;
const MAX_RETRY_WAIT  = 5000;
const MAX_ITEMS       = 10;     // 1通に載せるタスクの上限（Discord の embed は1通10個まで）。超えたぶんは「ほか N 件」
const DISCORD_COLOR   = 0x88C95E;
const BROKEN_STATUSES = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 410: 'gone' };

/** URL の形からサービスを判定する。合わなければ null（＝送らない） */
function detectKind(url) {
  const s = String(url || '').trim();
  if (DISCORD_RE.test(s)) return 'discord';
  if (SLACK_RE.test(s))   return 'slack';
  return null;
}

// ── 文面のエスケープ ──────────────────────────────────────────
// Discord：Markdown の記号を無効にする（タスク名で表示を崩したり、
//   [偽](別URL) でリンクをすり替えたりさせない）
function _escDiscord(s) {
  return String(s ?? '').replace(/[\\*_~`|[\]()>#-]/g, '\\$&');
}
// Slack：& < > だけをエスケープすれば <!channel> や <url|偽> は作れない
function _escSlack(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _cut(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** 'YYYY-MM-DD' → 「10月6日まで」。label（今日・明日）があれば「10月6日（明日）まで」 */
function _deadlineText(dateStr, label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return '';
  return `${Number(m[2])}月${Number(m[3])}日${label ? `（${label}）` : ''}まで`;
}

/** タスク1件の補足行（担当 → 締切の順） */
function _itemNotes(it) {
  const notes = [];
  if (it.assignees?.length) notes.push(`担当：${it.assignees.join('、')}`);
  const dl = _deadlineText(it.deadline, it.deadlineLabel);
  if (dl) notes.push(`締切：${dl}`);
  return notes;
}

/**
 * 共通の中身からサービスごとのペイロードを作る。
 * ★タスク名をいちばん大きく見せる：タスクごとに1つの枠（Discord は embed の title、
 *   Slack は header ブロック）にし、その下に「担当」「締切」を並べる。
 *   「〇〇さんがタスクを作成しました」などの説明は枠の外の1行（title）。
 * @param {'discord'|'slack'} kind
 * @param {{ title: string, text?: string, footer?: string,
 *           items?: { title: string, url: string, assignees?: string[], deadline?: string|null, deadlineLabel?: string }[] }} msg
 *   items が無いとき（連携の確認・テスト送信）は title と text だけの1通
 */
function buildMessage(kind, msg) {
  const all   = Array.isArray(msg.items) ? msg.items : [];
  const items = all.slice(0, MAX_ITEMS);
  const more  = all.length - items.length;
  const footer = msg.footer ? _cut(msg.footer, 2048) : '';

  if (kind === 'discord') {
    const base = { username: 'イベクリ', allowed_mentions: { parse: [] } };
    if (items.length === 0) {
      const embed = { title: _cut(msg.title, 256), description: _cut(_escDiscord(msg.text || ''), 4096), color: DISCORD_COLOR };
      if (footer) embed.footer = { text: footer };
      return { ...base, embeds: [embed] };
    }
    const embeds = items.map((it, i) => {
      // ★embed の title は Markdown のリンクにならない（すり替えの心配が無い）のでエスケープしない
      const e = { title: _cut(it.title || '(無題のタスク)', 256), url: it.url, color: DISCORD_COLOR };
      const notes = _itemNotes(it).map(_escDiscord);
      if (notes.length) e.description = _cut(notes.join('\n'), 4096);
      if (footer && i === items.length - 1) e.footer = { text: footer };
      return e;
    });
    const content = _escDiscord(msg.title) + (more > 0 ? `\nほか ${more} 件` : '');
    return { ...base, content: _cut(content, 2000), embeds };
  }

  // slack：text は通知のプレビュー用（blocks があると本文は blocks が描かれる）
  if (items.length === 0) {
    const body = [`*${_escSlack(msg.title)}*`];
    if (msg.text) body.push(_escSlack(msg.text));
    if (footer) body.push(_escSlack(footer));
    return { text: body.join('\n') };
  }
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: _escSlack(msg.title) } }];
  for (const it of items) {
    // header は plain_text（いちばん大きい文字。メンションもリンクも作られない）
    blocks.push({ type: 'header', text: { type: 'plain_text', text: _cut(it.title || '(無題のタスク)', 150), emoji: false } });
    const notes = _itemNotes(it).map(_escSlack);
    notes.push(`<${it.url}|イベクリで開く>`);
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: notes.join('　') }] });
  }
  if (more > 0) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `ほか ${more} 件` }] });
  if (footer) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: _escSlack(footer) }] });
  const text = `${_escSlack(msg.title)}：${items.map(it => _escSlack(it.title)).join('、')}${more > 0 ? ` ほか ${more} 件` : ''}`;
  return { text: _cut(text, 3000), blocks };
}

async function _post(url, payload) {
  return fetch(url, {
    method:   'POST',
    headers:  { 'Content-Type': 'application/json' },
    body:     JSON.stringify(payload),
    redirect: 'manual',   // ★リダイレクトは失敗扱い（別の宛先へ飛ばさない）
    signal:   AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** 429 の待ち時間（ms）。Discord は JSON 本文の retry_after（秒）、Slack は Retry-After ヘッダ（秒） */
async function _retryAfterMs(res) {
  const h = Number(res.headers.get('retry-after'));
  let sec = Number.isFinite(h) && h > 0 ? h : null;
  if (sec == null) {
    try { const j = await res.json(); if (Number.isFinite(j?.retry_after)) sec = j.retry_after; } catch {}
  }
  return sec == null ? null : Math.ceil(sec * 1000);
}

/**
 * 実際に POST する（store は見ない）。
 * @returns {Promise<{ ok: boolean, error?: string, broken?: boolean }>}
 */
async function sendRaw(kind, url, msg) {
  const s = String(url || '').trim();
  if (!kind || detectKind(s) !== kind) return { ok: false, error: 'invalid_url' };
  try {
    const payload = buildMessage(kind, msg);
    let res = await _post(s, payload);
    if (res.status === 429) {
      const wait = await _retryAfterMs(res);
      if (wait == null || wait > MAX_RETRY_WAIT) return { ok: false, error: 'rate_limited' };
      await new Promise(r => setTimeout(r, wait));
      res = await _post(s, payload);
    }
    if (res.status >= 200 && res.status < 300) return { ok: true };
    if (res.status >= 300 && res.status < 400) return { ok: false, error: 'redirect' };
    if (BROKEN_STATUSES[res.status]) return { ok: false, error: BROKEN_STATUSES[res.status], broken: true };
    if (res.status === 429) return { ok: false, error: 'rate_limited' };
    return { ok: false, error: `http_${res.status}` };
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { ok: false, error: timeout ? 'timeout' : 'network' };
  }
}

/**
 * イベントの連携先へ投稿する（fire-and-forget で呼んでよい。例外を外へ出さない）。
 * status が ok でなければ送らない。401/403/404/410 なら broken にする。
 */
async function send(eventId, msg) {
  try {
    const doc = await webhookStore.get(eventId);
    if (!doc || doc.status !== 'ok') return { ok: false, error: 'not_configured' };
    const r = await sendRaw(doc.kind, doc.url, msg);
    if (r.broken) {
      await webhookStore.setStatus(eventId, 'broken', r.error);
      console.warn(`[webhook] 連携先が無効になった event=${eventId} ${r.error}`);
    } else if (!r.ok) {
      console.warn(`[webhook] 送信に失敗 event=${eventId} ${r.error}`);
    }
    return r;
  } catch (e) {
    console.error('[webhook] send error:', e.message);
    return { ok: false, error: 'internal' };
  }
}

module.exports = { detectKind, buildMessage, sendRaw, send, MAX_ITEMS };
