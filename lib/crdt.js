// ===== CRDT コア =====
// LWW (Last-Writer-Wins) フィールド単位 + 削除トゥームストーン付きマップ
//
// データモデル:
//   event = {
//     id, ownerId, members, createdAt,        // 不変メタ情報
//     fields: { <key>: { v, t } },            // LWWフィールド
//     missions: { <id>: { id, fields, deletedAt, createdAt } },
//     proposals: { <id>: { id, fields, deletedAt, createdAt } },
//     clearedData: { fields: { <key>: { v, t } } },
//     rev: number                             // サーバー側の連番
//   }
//
// LWW の比較ルール:
//   - t（lamportタイムスタンプ）が大きい方が勝つ
//   - 同点なら、文字列比較で大きい方（決定論的タイブレーカー）

// ===== 単一値 LWW =====

/**
 * 2つの LWW セル {v, t} をマージ
 */
function mergeCell(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.t > b.t) return a;
  if (b.t > a.t) return b;
  // 同タイムスタンプ → 値を文字列化して大きい方を採用（決定論的）
  const sa = JSON.stringify(a.v);
  const sb = JSON.stringify(b.v);
  return sa >= sb ? a : b;
}

/**
 * fields マージ（オブジェクト全体を LWW で）
 */
function mergeFields(a = {}, b = {}) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) out[k] = mergeCell(a[k], b[k]);
  return out;
}

/**
 * map（ミッション/提案）マージ
 * - 追加：両方の id を残す
 * - 削除：deletedAt が大きい方を採用（削除がより新しい更新ならトゥームストーン）
 * - 編集：fields を要素単位で LWW マージ
 */
function mergeMap(a = {}, b = {}) {
  const out = {};
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    const ea = a[id];
    const eb = b[id];
    if (ea && !eb) { out[id] = ea; continue; }
    if (eb && !ea) { out[id] = eb; continue; }

    const mergedFields = mergeFields(ea.fields || {}, eb.fields || {});
    let deletedAt = maxOrNull(ea.deletedAt, eb.deletedAt);

    // 復活ルール: 削除より新しいフィールド編集があれば、そのアイテムは「復活」
    if (deletedAt) {
      const newestFieldT = _newestFieldTimestamp(mergedFields);
      if (newestFieldT > deletedAt) deletedAt = null;
    }

    out[id] = {
      id,
      createdAt: Math.min(ea.createdAt || Infinity, eb.createdAt || Infinity),
      deletedAt,
      fields: mergedFields,
    };
  }
  return out;
}

function _newestFieldTimestamp(fields) {
  let max = 0;
  for (const k in fields) {
    const t = fields[k]?.t || 0;
    if (t > max) max = t;
  }
  return max;
}

function maxOrNull(a, b) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

// ===== イベント全体マージ =====

/**
 * 2つのCRDTイベントをマージして新しいイベントを返す
 * 不変メタ情報（id, ownerId, members, createdAt）はサーバー側のものを優先
 */
function mergeEvent(server, incoming) {
  if (!incoming) return server;
  if (!server)   return incoming;
  return {
    id:        server.id,
    ownerId:   server.ownerId,
    members:   server.members,
    roles:          server.roles          || incoming.roles          || null,
    customTags:     server.customTags     || incoming.customTags     || null,
    memberProposals: server.memberProposals || incoming.memberProposals || [],
    pendingMembers:  server.pendingMembers  || incoming.pendingMembers  || [],
    createdAt: server.createdAt,
    fields:    mergeFields(server.fields || {}, incoming.fields || {}),
    missions:  mergeMap(server.missions || {}, incoming.missions || {}),
    proposals: mergeMap(server.proposals || {}, incoming.proposals || {}),
    clearedData: {
      fields: mergeFields(server.clearedData?.fields || {}, incoming.clearedData?.fields || {}),
    },
    rev: Math.max(server.rev || 0, incoming.rev || 0),
  };
}

// ===== フラット形式 ⇔ CRDT 形式 =====
// クライアントが扱う「フラット」形式: { id, name, dates, missions: [...], ... }
// サーバーが保存する「CRDT」形式:    { id, fields: {...}, missions: { <id>: ... }, ... }

const FLAT_EVENT_FIELDS = [
  'name', 'description', 'dates', 'dateTimes', 'seedType', 'isCompleted',
  'progress', 'daysLeft', 'lastProposalClearedTime',
  'likes', 'hasLiked', 'inviteCode', 'eventPhase',
];

const FLAT_MISSION_FIELDS = [
  'title', 'tag', 'tags', 'daysLeft', 'type', 'isDeletable', 'dates',
  'clearFormat', 'status', 'priority', 'note',
  'originProposalId', 'assignee', 'checklist',
  'description', 'selfClaim', 'leaderCheck',
  'claimMode', 'claimDeadline', 'claimApplicants', 'claimClosed', 'assignees',
  'createdBy',
  'announce', 'announceText',
  'noInput',
  'individualClear', 'individualClearedBy',
];

const FLAT_PROPOSAL_FIELDS = ['id', 'title', 'tag', 'description', 'format', 'priority'];

const FLAT_CLEARED_FIELDS = ['title', 'summary', 'url', 'venue', 'period', 'image'];

/**
 * フラット形式の event を CRDT 形式に変換
 * @param {object} flat
 * @param {number} now lamport timestamp (Date.now() を渡す)
 * @returns {object}
 */
function flatToCrdt(flat, now) {
  const fields = {};
  for (const k of FLAT_EVENT_FIELDS) {
    if (flat[k] !== undefined) fields[k] = { v: flat[k], t: now };
  }

  const missions = {};
  for (const m of (flat.missions || [])) {
    if (!m?.id) continue;
    const mfields = {};
    for (const k of FLAT_MISSION_FIELDS) {
      if (m[k] !== undefined) mfields[k] = { v: m[k], t: now };
    }
    missions[m.id] = {
      id: m.id,
      createdAt: m.createdAt || now,
      deletedAt: null,
      fields: mfields,
    };
  }

  const proposals = {};
  for (const p of (flat.proposals || [])) {
    if (!p?.id) continue;
    const pfields = {};
    for (const k of FLAT_PROPOSAL_FIELDS) {
      if (p[k] !== undefined) pfields[k] = { v: p[k], t: now };
    }
    proposals[p.id] = {
      id: p.id,
      createdAt: now,
      deletedAt: null,
      fields: pfields,
    };
  }

  const clearedFields = {};
  if (flat.clearedData) {
    // すべてのキーを保存（archive用 title/summary/... + ミッション完了用 missionId）
    for (const k of Object.keys(flat.clearedData)) {
      if (flat.clearedData[k] !== undefined) clearedFields[k] = { v: flat.clearedData[k], t: now };
    }
  }

  return {
    id: flat.id,
    ownerId: flat.ownerId,
    members: flat.members || [],
    roles: flat.roles || null,
    customTags: flat.customTags || null,
    memberProposals: flat.memberProposals || [],
    pendingMembers:  flat.pendingMembers  || [],
    createdAt: flat.createdAt || now,
    fields,
    missions,
    proposals,
    clearedData: { fields: clearedFields },
    rev: flat.rev || 0,
  };
}

/**
 * CRDT 形式の event をクライアント表示用フラット形式に変換
 * @param {object} crdt
 * @returns {object}
 */
function crdtToFlat(crdt) {
  const out = {
    id: crdt.id,
    ownerId: crdt.ownerId,
    members: crdt.members || [],
    roles: crdt.roles || null,
    customTags: crdt.customTags || null,
    memberProposals: crdt.memberProposals || [],
    pendingMembers:  crdt.pendingMembers  || [],
    createdAt: crdt.createdAt,
    rev: crdt.rev || 0,
  };
  for (const k of FLAT_EVENT_FIELDS) {
    if (crdt.fields?.[k]) out[k] = crdt.fields[k].v;
  }

  out.missions = Object.values(crdt.missions || {})
    .filter(m => !m.deletedAt)
    .map(m => {
      const flat = { id: m.id, createdAt: m.createdAt };
      for (const k of FLAT_MISSION_FIELDS) {
        if (m.fields?.[k]) flat[k] = m.fields[k].v;
      }
      return flat;
    })
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  out.proposals = Object.values(crdt.proposals || {})
    .filter(p => !p.deletedAt)
    .map(p => {
      const flat = { id: p.id };
      for (const k of FLAT_PROPOSAL_FIELDS) {
        if (p.fields?.[k]) flat[k] = p.fields[k].v;
      }
      return flat;
    });

  out.clearedData = {};
  const cdFields = crdt.clearedData?.fields || {};
  for (const k of Object.keys(cdFields)) {
    if (cdFields[k]?.v !== undefined) out.clearedData[k] = cdFields[k].v;
  }

  return out;
}

/**
 * 古いフラット形式（v0.5まで）のイベントを CRDT 形式へ昇格
 * @param {object} oldFlat
 * @returns {object}
 */
function migrateFlatToCrdt(oldFlat) {
  // 既に CRDT 形式なら何もしない
  if (oldFlat?.fields && oldFlat?.missions && !Array.isArray(oldFlat.missions)) return oldFlat;
  return flatToCrdt(oldFlat, Date.now());
}

/**
 * クライアントから受け取った flat patch (差分のみ) を CRDT 化
 * - 渡された field のみ更新（undefinedは無視）
 * - missions/proposals は配列で渡された場合はそのまま再生成
 * - 削除されたミッションは server 側の missions と比較して deletedAt を立てる必要あり
 *
 * 単純化のため：クライアントは「全フラット表現＋更新タイムスタンプ」を送る
 * サーバーは「自分の現在値より新しいフィールドだけ」採用する
 */
function buildPatchFromFlat(flat, now) {
  return flatToCrdt(flat, now);
}

module.exports = {
  mergeCell, mergeFields, mergeMap, mergeEvent,
  flatToCrdt, crdtToFlat, migrateFlatToCrdt, buildPatchFromFlat,
};
