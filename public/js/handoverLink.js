// ===== 引き継ぎリンク（前の代のイベント）の読み取り =====
// 2026-11-11（指示書C）。作成フローの STEP 7 で使う。★指示書D（引き継ぎ）でも使い回す
//   （イベント設定からの後付け登録・取り込み画面の「リンクを貼る」）。ここ以外で URL を解釈しないこと。
//
// 受け付けるのは、イベクリ本体（いま開いているオリジン）と、外部サイト（PUBLIC_SITE_ORIGINS に並んだオリジン）のリンクだけ。
//   ★2026-11-12（指示書05）：公開ページが本体の /explore に移った。新しいリンクは本体の /explore/<id>・/explore?event=<id>。
//     外部サイトの古いリンク（保存していた人が貼る）も後方互換で受け付ける。
//   ★URL の形を決め打ちにしない。次の順で id を探す：
//     1. クエリの event=（本体の告知モーダル /explore?event=<id>）
//     2. クエリの id=（外部サイトの旧詳細ページ /pages/event-log/detail/?id=<id>）
//     3. パスの …/explore/<id>（本体のナレッジページ・アーカイブの「リンクをコピー」）
//     4. パスの …/events/<id>（旧アーカイブの「リンクをコピー」が作っていた外部サイトの形）
//   ★取り出した id は SAFE_ITEM_ID_RE と同じ形で確かめる（サーバーの _sanitizeEventFields も同じ検査をする）
//   ★イベントが本当にあるか（公開されているか）は、呼び出し側が GET /api/public/events/:id で確かめる

import { api } from './api.js';

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

let _originsPromise = null;

/** 受け付けるオリジンの一覧：本体（location.origin）＋ /api/config の publicSiteOrigins。1回だけ取る */
export function loadHandoverOrigins() {
  const self = typeof location !== 'undefined' ? [location.origin] : [];
  _originsPromise ||= api.getConfig()
    .then(r => [...self, ...(Array.isArray(r?.publicSiteOrigins) ? r.publicSiteOrigins.filter(o => typeof o === 'string') : [])])
    .catch(() => { _originsPromise = null; return self; });
  return _originsPromise;
}

/**
 * 貼られた文字列から前の代のイベントの id を取り出す。
 * @param {string} text     貼られた文字列
 * @param {string[]} origins 受け付けるオリジン（末尾の / なし）
 * @returns {{ id: string } | { error: 'empty' | 'invalid_url' | 'host' | 'no_id' }}
 */
export function parseHandoverLink(text, origins) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'empty' };
  let u;
  try { u = new URL(raw); } catch { return { error: 'invalid_url' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'invalid_url' };
  const allowed = new Set((origins || []).map(o => o.replace(/\/$/, '')));
  if (!allowed.has(u.origin)) return { error: 'host' };

  let id = u.searchParams.get('event') || u.searchParams.get('id');
  if (!id) {
    const m = u.pathname.match(/\/(?:explore|events)\/([^/?#]+)\/?$/);
    if (m) { try { id = decodeURIComponent(m[1]); } catch { id = null; } }
  }
  if (!id || !SAFE_ID_RE.test(id)) return { error: 'no_id' };
  return { id };
}

/** parseHandoverLink の error を画面に出す文に */
export function handoverLinkErrorText(code) {
  switch (code) {
    case 'invalid_url': return 'リンクの形になっていません。アーカイブのリンクをそのまま貼ってください';
    case 'host':        return 'イベクリの公開ページ（アーカイブ）のリンクを貼ってください';
    case 'no_id':       return 'このリンクからイベントを読み取れませんでした。アーカイブのページのリンクか確かめてください';
    case 'not_found':   return 'このリンクのイベントは見つかりませんでした。公開されているアーカイブのリンクか確かめてください';
    case 'network':     return '通信できませんでした。少し待ってから貼り直してください';
    default:            return '';
  }
}

/** 'YYYY-MM-DD' の配列を「2026年10月1日〜10月2日」の形に。日程が無ければ '' */
export function formatHandoverDates(dates) {
  const list = (Array.isArray(dates) ? dates : []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!list.length) return '';
  const p = (d) => { const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd }; };
  const a = p(list[0]); const b = p(list.at(-1));
  const first = `${a.y}年${a.m}月${a.d}日`;
  if (list[0] === list.at(-1)) return first;
  return a.y === b.y ? `${first}〜${b.m}月${b.d}日` : `${first}〜${b.y}年${b.m}月${b.d}日`;
}
