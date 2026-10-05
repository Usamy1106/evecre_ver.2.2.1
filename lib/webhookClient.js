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
const MAX_ITEMS       = 10;     // 1通に載せるタスクの上限。超えたぶんは「ほか N 件」
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

/**
 * 行を整える。タスクの行が MAX_ITEMS を超えたぶんは落として数える。
 * 中身が残らなかった見出しは消す。
 * lines: [{ text, url?, note?, heading? }]
 */
function _limitLines(lines) {
  const out = [];
  let items = 0, more = 0;
  for (const l of (lines || [])) {
    if (l.heading) { out.push(l); continue; }
    if (l.url) {
      if (items >= MAX_ITEMS) { more++; continue; }
      items++;
    }
    out.push(l);
  }
  // 直後に中身が無い見出し（次も見出し／末尾）を落とす
  const kept = out.filter((l, i) => !l.heading || (out[i + 1] && !out[i + 1].heading));
  return { lines: kept, more };
}

/**
 * 共通の中身からサービスごとのペイロードを作る。
 * @param {'discord'|'slack'} kind
 * @param {{ title: string, lines?: object[], footer?: string, moreCount?: number }} msg
 */
function buildMessage(kind, msg) {
  const { lines, more: dropped } = _limitLines(msg.lines);
  const more = dropped + (msg.moreCount || 0);

  if (kind === 'discord') {
    const body = lines.map(l => {
      if (l.heading) return `**${_escDiscord(l.text)}**`;
      const label = l.url ? `[${_escDiscord(_cut(l.text, 200))}](${l.url})` : _escDiscord(l.text);
      const note  = l.note ? `　${_escDiscord(l.note)}` : '';
      return l.url ? `- ${label}${note}` : `${label}${note}`;
    });
    if (more > 0) body.push(`ほか ${more} 件`);
    const embed = {
      title:       _cut(msg.title, 256),
      description: _cut(body.join('\n'), 4096),
      color:       DISCORD_COLOR,
    };
    if (msg.footer) embed.footer = { text: _cut(msg.footer, 2048) };
    return {
      username: 'イベクリ',
      embeds: [embed],
      allowed_mentions: { parse: [] },
    };
  }

  // slack
  const body = [`*${_escSlack(msg.title)}*`];
  for (const l of lines) {
    if (l.heading) { body.push(`*${_escSlack(l.text)}*`); continue; }
    const label = l.url ? `<${l.url}|${_escSlack(_cut(l.text, 200))}>` : _escSlack(l.text);
    const note  = l.note ? `　${_escSlack(l.note)}` : '';
    body.push(l.url ? `• ${label}${note}` : `${label}${note}`);
  }
  if (more > 0) body.push(`ほか ${more} 件`);
  if (msg.footer) body.push(_escSlack(msg.footer));
  return { text: body.join('\n') };
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
