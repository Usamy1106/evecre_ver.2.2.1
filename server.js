// ===== Express サーバー（MongoDB 版）=====
// ストレージ: JSON ファイル → MongoDB Atlas
// セッション: users.sessions[] → sessions コレクション
// 通知: data/notifications/*.json → notifications コレクション
// イベント: data/projects/*.json → events コレクション
// 招待: data/invites/*.json → invites コレクション
// 提出物: project.clearedData → submissions コレクション + R2

try { require('dotenv').config(); } catch (_) {}

const express      = require('express');
const crypto       = require('crypto');
const bcrypt       = require('bcryptjs');
const cookieParser = require('cookie-parser');

const { connectDb, closeDb, getDb, pingDb } = require('./lib/db');
const userStore       = require('./lib/userStore');
const sessionStore    = require('./lib/sessionStore');
const inviteStore     = require('./lib/inviteStore');
const eventStore      = require('./lib/eventStore');
const projectStore    = require('./lib/projectStore');
const notifStore      = require('./lib/notificationStore');
const submissionStore  = require('./lib/submissionStore');
const eventLogStore    = require('./lib/eventLogStore');
const r2               = require('./lib/r2');
const proposalEngine   = require('./lib/proposalEngine');
const eventBus        = require('./lib/eventBus');
const crdt            = require('./lib/crdt');
const { sendOtpEmail, sendPasswordResetEmail, generateOtp, IS_DEV, logTransportStatus } = require('./lib/email');

// Google サインイン用（オプショナル）
let googleAuthClient = null;
try {
  const { OAuth2Client } = require('google-auth-library');
  if (process.env.GOOGLE_CLIENT_ID) {
    googleAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
} catch (e) {
  console.warn('google-auth-library が見つかりません（Google サインイン機能は無効）');
}

// ===== COOKIE_SECRET は必須（ファイル自動生成は廃止）=====
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET) {
  console.error('[fatal] 環境変数 COOKIE_SECRET が設定されていません。');
  console.error('        openssl rand -hex 32 で生成して .env に追加してください。');
  process.exit(1);
}

const SALT_ROUNDS    = 12;
const SESSION_COOKIE = 'eve_sess';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30日
const OTP_TTL_MS     = 1000 * 60 * 10;             // 10分
const OTP_MAX_TRIES  = 5;
const INVITE_COOKIE  = 'invite_token';
const INVITE_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7日
const RESET_TTL_MS   = 30 * 60 * 1000; // 30分

const rateLimit = require('express-rate-limit');

const app = express();

// Render / 一般的なリバースプロキシ対応
// req.ip が正しいクライアント IP を返すようになる（rate limiting に必要）
app.set('trust proxy', 1);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' })); // iOS 向け Google サインインのフォーム POST 用
app.use(cookieParser(COOKIE_SECRET));

// ── レート制限 ─────────────────────────────────────────────
// 開発環境ではレート制限をスキップ（CI / テストを壊さないよう）
const _skipInDev = () => IS_DEV;

/** ログイン・登録・Google サインイン：10回 / 15分 / IP */
const authLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            30,
  standardHeaders: true,   // RateLimit-* ヘッダを返す（RFC 6585）
  legacyHeaders:  false,   // X-RateLimit-* は返さない
  skip:           _skipInDev,
  message: { ok: false, error: 'リクエストが多すぎます。しばらく待ってから再試行してください。', code: 'rate_limited' },
});

/** 行動ログ投稿：60回 / 分 / IP */
const logLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            60,
  standardHeaders: true,
  legacyHeaders:  false,
  skip:           _skipInDev,
  message: { ok: true },
});

/** OTP 検証・再送・パスワードリセット：5回 / 15分 / IP（より厳しく） */
const strictLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            5,
  standardHeaders: true,
  legacyHeaders:  false,
  skip:           _skipInDev,
  message: { ok: false, error: 'リクエストが多すぎます。しばらく待ってから再試行してください。', code: 'rate_limited' },
});

// ヘルスチェック（Render がデプロイ成功の確認に使う）
app.get('/healthz', async (_req, res) => {
  const dbOk = await pingDb();
  if (dbOk) {
    res.json({ ok: true, db: 'ok' });
  } else {
    res.status(503).json({ ok: false, db: 'unreachable' });
  }
});

// 静的配信。JS/HTML/CSS のキャッシュは setHeaders で権威的に制御する
// （express.static はデフォルトで Cache-Control: public, max-age=0 を自分でセットするため、
//  別ミドルウェアで設定しても上書きされうる。ここで一元管理する）。
// 本番は no-cache（ETag で必ず再検証 → 変更時のみ再取得、未変更なら 304）。
// これをしないとデプロイ後も古い JS がキャッシュされ続ける（特に iOS WebKit は強力にキャッシュ）。
// ES モジュールは import 先のファイルも個別にキャッシュされるため、ファイル単位で再検証させるのが要点。
app.use(require('express').static(require('path').join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(js|html|css)$/.test(filePath)) {
      if (IS_DEV) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  },
}));

// ===== バリデーション =====

const USERNAME_RE = /^[\p{L}\p{N}_\-]{2,20}$/u;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUsername(name) {
  if (!name) return 'ユーザー名を入力してください';
  if (!USERNAME_RE.test(name)) return '2〜20文字の英数字・日本語・全角文字で入力してください（記号は - と _ のみ可）';
  return null;
}
function validateEmail(email) {
  if (!email) return 'メールアドレスを入力してください';
  if (!EMAIL_RE.test(email)) return 'メールアドレスの形式が正しくありません';
  return null;
}
function validatePassword(pw) {
  if (!pw) return 'パスワードを入力してください';
  if (pw.length < 8)   return 'パスワードは8文字以上にしてください';
  if (pw.length > 100) return 'パスワードが長すぎます';
  return null;
}

// ===== セッション =====

function newToken() { return crypto.randomBytes(32).toString('hex'); }

async function attachSession(res, userId) {
  const token     = newToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await sessionStore.createSession(userId, token, expiresAt);
  // 本番(HTTPS)では SameSite=None; Secure を使う。
  // モバイル Chrome の Google サインイン(FedCM)直後、/api/auth/google のレスポンスが
  // クロスサイト文脈とみなされ、SameSite=Lax だと Cookie の保存が拒否されてログインできない
  // （デスクトップ/他ブラウザはポップアップで同一サイト扱いになり Lax でも通る）。
  // SameSite=None には Secure 必須。ローカル開発(HTTP)では None が使えないため Lax にフォールバック。
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE, `${userId}.${token}`, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    signed: true, maxAge: SESSION_TTL_MS, path: '/',
  });
}

async function requireAuth(req, res, next) {
  try {
    const raw = req.signedCookies[SESSION_COOKIE];
    if (!raw || typeof raw !== 'string' || !raw.includes('.')) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const [userId, token] = raw.split('.');
    const sess = await sessionStore.findByToken(token);
    if (!sess || sess.userId !== userId || sess.expiresAt < Date.now()) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const user = await userStore.findById(userId);
    if (!user) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    req.user = user; // フル情報（passwordHash 含む）。レスポンスに含めないこと
    next();
  } catch (e) {
    next(e);
  }
}

function userPublic(u) {
  return {
    id:         u.id,
    username:   u.username,
    email:      u.emailLower,
    isVerified: !!u.isVerified,
    avatarUrl:  u.avatarUrl || null,
  };
}

// ===== OTP ヘルパ =====
// user オブジェクトを直接変更後、呼び出し側で userStore.update() する

async function setVerificationOtp(user, purpose, extra = {}) {
  const code = generateOtp();
  user.otp = {
    purpose,
    codeHash:  await bcrypt.hash(code, 8),
    expiresAt: Date.now() + OTP_TTL_MS,
    tries: 0,
    ...extra,
  };
  return code;
}

async function consumeOtp(user, purpose, inputCode) {
  const otp = user.otp;
  if (!otp || otp.purpose !== purpose) return { ok: false, error: 'コードが要求されていません' };
  if (Date.now() > otp.expiresAt)      return { ok: false, error: 'コードの有効期限が切れました。送り直してください' };
  if (otp.tries >= OTP_MAX_TRIES)      return { ok: false, error: '入力回数の上限を超えました。送り直してください' };
  otp.tries += 1;
  // tries の更新を即時永続化（失敗試行もカウント）
  await userStore.update(user.id, { otp });
  let ok = false;
  try { ok = await bcrypt.compare(String(inputCode || ''), otp.codeHash); } catch (_) {}
  if (!ok) return { ok: false, error: 'コードが正しくありません' };
  return { ok: true, otp };
}

// ===== 招待 Cookie 自動受諾 =====

async function consumeInviteCookieIfAny(req, res, user) {
  const token = req.cookies?.[INVITE_COOKIE];
  if (!token) return null;

  const clearCookie = () => res.clearCookie(INVITE_COOKIE, { path: '/' });

  try {
    const inv = await inviteStore.loadInvite(token);
    if (!inv) { clearCookie(); return null; }

    const now = Date.now();
    if (inv.expiresAt && inv.expiresAt < now)              { clearCookie(); return null; }
    if (inv.maxUses   && inv.usedBy.length >= inv.maxUses) { clearCookie(); return null; }

    const p = await eventStore.loadEvent(inv.eventId);
    if (!p) { clearCookie(); return null; }

    const eventName = p.fields?.name?.v || 'イベント';

    if (eventStore.isMember(p, user.id)) {
      clearCookie();
      return { eventId: p.id, pending: false, eventName };
    }

    if ((p.pendingMembers || []).some(m => m.userId === user.id)) {
      // すでに申請済み → 再申請不要。メッセージだけ表示
      clearCookie();
      return { eventId: p.id, pending: true, eventName, alreadyPending: true };
    }

    // pendingMembers には追加しない。クライアント側で「参加申請する」ボタン押下後に
    // POST /api/invites/:token/accept を呼ばせる
    clearCookie();
    return { eventId: p.id, needsJoinConfirm: true, eventName, inviteToken: token };
  } catch (e) {
    console.error('consumeInviteCookieIfAny error:', e);
    clearCookie();
    return null;
  }
}

// ===== 通知ヘルパ =====

function _getManagerIds(project) {
  const roles = eventStore.getRoles(project);
  return (project.members || [])
    .filter(m => {
      const ids = eventStore.getMemberRoleIds(project, m.userId);
      return ids.some(rid => roles.find(r => r.id === rid)?.canManage);
    })
    .map(m => m.userId);
}

async function _notifyAssignmentDecided(p, mid, m, decidedUserIds, actor) {
  if (!Array.isArray(decidedUserIds) || decidedUserIds.length === 0) return;
  const users = await userStore.findManyByIds(decidedUserIds);
  const namesMap = {};
  for (const u of users) namesMap[u.id] = `@${u.username}`;
  const namesStr = decidedUserIds.map(uid => namesMap[uid] || '誰か').join('、');
  const memberIds = (p.members || []).map(x => x.userId);
  await notifStore.notifyAll(memberIds, {
    type:      'assignment_decided',
    message:   `「${m.title}」の担当が決定しました：${namesStr}`,
    eventId: p.id,
    missionId: mid,
    actorId:   actor?.id   || null,
    actorName: actor?.username || null,
  });
}

// ===== ミッションヘルパ =====

function _missionToFlat(cm, mid) {
  if (!cm || cm.deletedAt) return null;
  const flat = { id: mid };
  for (const k of Object.keys(cm.fields || {})) {
    flat[k] = cm.fields[k]?.v;
  }
  return flat;
}

function _setMissionField(p, mid, field, value, ts) {
  if (!p.missions[mid]) return false;
  if (!p.missions[mid].fields) p.missions[mid].fields = {};
  p.missions[mid].fields[field] = { v: value, t: ts || Date.now() };
  return true;
}

// ミッションの「内容変更」とみなすフィールド（管理者が編集モーダルで触る項目）。
// status / daysLeft / assignee / claimApplicants / individualClearedBy / clearFormat など
// 自動・完了フロー・専用通知のある項目は除外して、変更通知の誤発火を防ぐ。
const _MISSION_CONTENT_FIELDS = [
  'title', 'description', 'dates', 'tag', 'tags', 'priority', 'checklist',
  'selfClaim', 'leaderCheck', 'claimMode', 'claimDeadline',
  'noInput', 'individualClear', 'announce', 'announceText',
];
function _missionContentChanged(prev, m) {
  return _MISSION_CONTENT_FIELDS.some(k =>
    JSON.stringify(prev[k] ?? null) !== JSON.stringify(m[k] ?? null));
}

/**
 * flat イベントの clearedData を submissions コレクションに分離して保存する。
 * - format === 'image' かつ content が dataURL の場合、R2 にアップロードして URL に置換。
 * - R2 未設定の場合はそのまま submissions に保存（dataURL のまま）。
 * - flat.clearedData を in-place で削除して返す（applyPatch に渡さないよう除外）。
 *
 * @param {string} projectId
 * @param {object} flat  クライアントから来たフラット形式イベント（変更あり）
 */
async function _extractClearedData(projectId, flat) {
  if (!flat.clearedData || typeof flat.clearedData !== 'object') return;
  const entries = Object.entries(flat.clearedData);
  if (entries.length === 0) { delete flat.clearedData; return; }

  await Promise.all(entries.map(async ([missionId, submission]) => {
    if (!submission) return;
    let content = submission.content ?? '';

    // 画像 dataURL → R2 アップロード
    if (
      submission.format === 'image' &&
      typeof content === 'string' &&
      content.startsWith('data:') &&
      r2.isConfigured()
    ) {
      try {
        const ext = content.startsWith('data:image/png') ? 'png' : 'jpg';
        const key = `submissions/${projectId}/${missionId}_${r2.randomSuffix()}.${ext}`;
        content = await r2.uploadDataUrl(content, key);
      } catch (e) {
        console.error('[r2] submission upload error:', e.message);
        // R2 失敗時はそのまま保存（graceful degradation）
      }
    }

    await submissionStore.saveSubmission(projectId, missionId, {
      content,
      format:      submission.format      ?? 'text',
      title:       submission.title       ?? '',
      timestamp:   submission.timestamp   ?? Date.now(),
      submittedBy: submission.submittedBy ?? null,
    });
  }));

  // CRDT には clearedData を渡さない（submissions コレクションで管理）
  delete flat.clearedData;
}

/**
 * イベントのフラット表現に submissions データをマージする。
 * クライアントは引き続き project.clearedData として受け取れる。
 *
 * @param {string} projectId
 * @param {object} flatProject  crdtToFlat() の結果（変更あり）
 */
async function _mergeSubmissions(projectId, flatProject) {
  const submissions = await submissionStore.getSubmissionsForProject(projectId);
  flatProject.clearedData = submissions;
}

// ===== 認証エンドポイント =====

// 新規登録
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const username = (req.body?.username ?? '').trim();
    const email    = (req.body?.email    ?? '').trim();
    const password =  req.body?.password ?? '';

    const errors = {};
    const e1 = validateUsername(username); if (e1) errors.username = e1;
    const e2 = validateEmail(email);       if (e2) errors.email    = e2;
    const e3 = validatePassword(password); if (e3) errors.password = e3;
    if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

    const emailLower = email.toLowerCase();
    if (await userStore.emailExists(emailLower)) {
      return res.status(409).json({ ok: false, errors: { email: 'このメールアドレスは既に登録されています' } });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = crypto.randomBytes(8).toString('hex');
    const user = {
      id, username, emailLower, passwordHash,
      isVerified: false,
      createdAt: Date.now(),
    };
    await userStore.insert(user);

    await attachSession(res, id);
    res.json({ ok: true, user: userPublic(user) });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// 認証コード再送
app.post('/api/auth/resend-verification', strictLimiter, requireAuth, async (req, res) => {
  try {
    if (req.user.isVerified) return res.json({ ok: true, alreadyVerified: true });
    const code = await setVerificationOtp(req.user, 'verify');
    await userStore.update(req.user.id, { otp: req.user.otp });
    const mail = await sendOtpEmail(req.user.emailLower, code, '新規登録');
    res.json({ ok: true, devCode: mail.devCode, mailError: mail.ok ? null : mail.error });
  } catch (e) {
    console.error('resend-verification error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// メール認証コード照合
app.post('/api/auth/verify-email', strictLimiter, requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    if (req.user.isVerified) return res.json({ ok: true, alreadyVerified: true });
    const r = await consumeOtp(req.user, 'verify', code);
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    req.user.isVerified = true;
    delete req.user.otp;
    await userStore.update(req.user.id, { isVerified: true, otp: null });
    const inv = await consumeInviteCookieIfAny(req, res, req.user);
    res.json({
      ok: true,
      user:             userPublic(req.user),
      pendingEventId:   inv?.eventId       || null,
      pendingApproval:  inv?.pending       ?? false,
      pendingEventName: inv?.eventName     || null,
      needsJoinConfirm: inv?.needsJoinConfirm ?? false,
      inviteToken:      inv?.inviteToken   || null,
    });
  } catch (e) {
    console.error('verify-email error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ログイン
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email    = String((req.body?.email ?? req.body?.identifier ?? '')).trim();
    const password =  req.body?.password ?? '';
    if (!email || !password) return res.status(400).json({ ok: false, error: 'メールアドレスとパスワードを入力してください' });

    const emailLower = email.toLowerCase();
    const user = await userStore.findByEmail(emailLower);

    const hashToCompare = user?.passwordHash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalida';
    let ok = false;
    try { ok = await bcrypt.compare(password, hashToCompare); } catch (_) {}
    if (!user || !ok) return res.status(401).json({ ok: false, error: 'メールアドレスまたはパスワードが違います' });

    await attachSession(res, user.id);
    const inv = await consumeInviteCookieIfAny(req, res, user);
    res.json({
      ok: true,
      user:             userPublic(user),
      pendingEventId:   inv?.eventId       || null,
      pendingApproval:  inv?.pending       ?? false,
      pendingEventName: inv?.eventName     || null,
      needsJoinConfirm: inv?.needsJoinConfirm ?? false,
      inviteToken:      inv?.inviteToken   || null,
    });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// 公開設定（Google Client ID など）
app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleEnabled:  !!googleAuthClient,
  });
});

// Google サインイン
// iOS(WebKit/ITP) では XHR レスポンスの Set-Cookie が保存されないため、クライアントは
// トップレベルのフォーム POST（application/x-www-form-urlencoded）で送ってくる。その場合は
// JSON ではなくリダイレクトで応答し、Cookie を first-party のトップレベル遷移で保存させる。
app.post('/api/auth/google', authLimiter, async (req, res) => {
  const isFormPost = !!req.is('application/x-www-form-urlencoded');
  const fail = (status, code, jsonError) => {
    if (isFormPost) return res.redirect(`/?gerror=${code}`);
    return res.status(status).json({ ok: false, error: jsonError });
  };
  try {
    if (!googleAuthClient) {
      return fail(503, 'config', 'Google サインインは設定されていません');
    }
    const credential = String(req.body?.credential || '');
    if (!credential) return fail(400, 'nocred', 'credential が必要です');

    let payload = null;
    try {
      const ticket = await googleAuthClient.verifyIdToken({
        idToken: credential, audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (e) {
      console.error('[google-signin] ID トークン検証失敗:', e?.message);
      return fail(401, 'verify', 'Google ID トークンの検証に失敗しました');
    }

    if (!payload?.email) return fail(400, 'email', 'Google アカウントのメールアドレスが取得できませんでした');
    if (payload.email_verified === false) return fail(400, 'email', 'Google アカウントのメールアドレスが未認証です');

    const email     = String(payload.email).toLowerCase().trim();
    const googleSub = String(payload.sub);

    let pictureUrl = payload.picture || null;
    if (pictureUrl) pictureUrl = pictureUrl.replace(/=s\d+-c$/, '=s256-c');

    let user = await userStore.findByEmailOrGoogleSub(email, googleSub);

    if (user) {
      const updates = {};
      if (!user.googleSub) updates.googleSub = googleSub;
      updates.isVerified = true;
      if (pictureUrl && (!user.avatarUrl || !String(user.avatarUrl).startsWith('data:'))) {
        updates.avatarUrl = pictureUrl;
      }
      await userStore.update(user.id, updates);
      user = { ...user, ...updates };
    } else {
      let base = String(payload.name || email.split('@')[0] || 'user').trim();
      base = base.replace(/[^\p{L}\p{N}_\-]/gu, '').slice(0, 18) || 'user';
      // ユーザー名衝突回避（MongoDB で都度チェック）
      let username = base;
      let n = 1;
      while (true) {
        // ユーザー名の重複チェック（username フィールドで検索）
        const taken = await getDb().collection('users').countDocuments({ username }, { limit: 1 });
        if (!taken) break;
        username = `${base}_${n}`;
        n++;
      }
      user = {
        id: crypto.randomBytes(8).toString('hex'),
        username, emailLower: email,
        passwordHash: null, googleSub,
        isVerified: true,
        avatarUrl: pictureUrl,
        createdAt: Date.now(),
      };
      await userStore.insert(user);
    }

    await attachSession(res, user.id);
    const inv = await consumeInviteCookieIfAny(req, res, user);

    // iOS(フォーム POST): トップレベル遷移なので Cookie が first-party で保存される。
    // アプリ(/)に戻すと init→/api/auth/me が Cookie を読み、招待の保留状態も復元される。
    if (isFormPost) {
      return res.redirect('/');
    }

    res.json({
      ok: true,
      user:             userPublic(user),
      pendingEventId:   inv?.eventId       || null,
      pendingApproval:  inv?.pending       ?? false,
      pendingEventName: inv?.eventName     || null,
      needsJoinConfirm: inv?.needsJoinConfirm ?? false,
      inviteToken:      inv?.inviteToken   || null,
    });
  } catch (e) {
    console.error('google-signin error:', e);
    if (isFormPost) return res.redirect('/?gerror=server');
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ログアウト
app.post('/api/auth/logout', async (req, res) => {
  try {
    const raw = req.signedCookies[SESSION_COOKIE];
    if (raw && raw.includes('.')) {
      const token = raw.split('.')[1];
      await sessionStore.deleteByToken(token);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (e) {
    console.error('logout error:', e);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }
});

// セッション確認
app.get('/api/auth/me', async (req, res) => {
  try {
    const raw = req.signedCookies[SESSION_COOKIE];
    if (!raw || !raw.includes('.')) return res.json({ ok: true, user: null });

    const [userId, token] = raw.split('.');
    const sess = await sessionStore.findByToken(token);
    if (!sess || sess.userId !== userId || sess.expiresAt < Date.now()) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return res.json({ ok: true, user: null });
    }
    const user = await userStore.findById(userId);
    if (!user) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return res.json({ ok: true, user: null });
    }
    const inv = await consumeInviteCookieIfAny(req, res, user);
    res.json({
      ok: true,
      user:             userPublic(user),
      pendingEventId:   inv?.eventId       || null,
      pendingApproval:  inv?.pending       ?? false,
      pendingEventName: inv?.eventName     || null,
      needsJoinConfirm: inv?.needsJoinConfirm ?? false,
      inviteToken:      inv?.inviteToken   || null,
    });
  } catch (e) {
    console.error('GET /api/auth/me error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== アカウント設定 =====

// ユーザー名変更
app.post('/api/account/change-username', requireAuth, async (req, res) => {
  try {
    const newName = (req.body?.username ?? '').trim();
    const e1 = validateUsername(newName);
    if (e1) return res.status(400).json({ ok: false, errors: { username: e1 } });
    if (newName === req.user.username) return res.json({ ok: true, user: userPublic(req.user) });
    await userStore.update(req.user.id, { username: newName });
    req.user.username = newName;
    res.json({ ok: true, user: userPublic(req.user) });
  } catch (e) {
    console.error('change-username error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// メールアドレス変更：コード送信
app.post('/api/account/change-email/request', requireAuth, async (req, res) => {
  try {
    const newEmail = (req.body?.email ?? '').trim();
    const e1 = validateEmail(newEmail);
    if (e1) return res.status(400).json({ ok: false, errors: { email: e1 } });

    const newLower = newEmail.toLowerCase();
    if (newLower === req.user.emailLower)
      return res.status(400).json({ ok: false, errors: { email: '現在のメールアドレスと同じです' } });
    if (await userStore.emailExists(newLower, req.user.id))
      return res.status(409).json({ ok: false, errors: { email: 'このメールアドレスは既に登録されています' } });

    const password = req.body?.password ?? '';
    if (!password) return res.status(400).json({ ok: false, errors: { password: '現在のパスワードを入力してください' } });
    const okPw = await bcrypt.compare(password, req.user.passwordHash);
    if (!okPw) return res.status(401).json({ ok: false, errors: { password: 'パスワードが違います' } });

    const code = await setVerificationOtp(req.user, 'changeEmail', { pendingEmail: newLower });
    await userStore.update(req.user.id, { otp: req.user.otp });
    const mail = await sendOtpEmail(newLower, code, 'メールアドレス変更');
    res.json({ ok: true, devCode: mail.devCode, mailError: mail.ok ? null : mail.error });
  } catch (e) {
    console.error('change-email/request error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// メールアドレス変更：コード照合 → 適用
app.post('/api/account/change-email/confirm', requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    const r = await consumeOtp(req.user, 'changeEmail', code);
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });

    const newLower = r.otp.pendingEmail;
    if (!newLower) {
      await userStore.update(req.user.id, { otp: null });
      return res.status(400).json({ ok: false, error: '保留中の変更が見つかりません' });
    }
    if (await userStore.emailExists(newLower, req.user.id)) {
      await userStore.update(req.user.id, { otp: null });
      return res.status(409).json({ ok: false, error: 'このメールアドレスは既に登録されています' });
    }

    await userStore.update(req.user.id, { emailLower: newLower, isVerified: true, otp: null });
    req.user.emailLower = newLower;
    req.user.isVerified = true;
    res.json({ ok: true, user: userPublic(req.user) });
  } catch (e) {
    console.error('change-email/confirm error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// パスワード変更：コード送信
app.post('/api/account/change-password/request', requireAuth, async (req, res) => {
  try {
    const currentPassword = req.body?.currentPassword ?? '';
    const newPassword     = req.body?.newPassword     ?? '';

    const errors = {};
    if (!currentPassword) errors.currentPassword = '現在のパスワードを入力してください';
    const eNew = validatePassword(newPassword);
    if (eNew) errors.newPassword = eNew;
    if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

    const okCur = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!okCur) return res.status(401).json({ ok: false, errors: { currentPassword: '現在のパスワードが違います' } });
    if (currentPassword === newPassword) return res.status(400).json({ ok: false, errors: { newPassword: '現在のパスワードと同じです' } });

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const code = await setVerificationOtp(req.user, 'changePassword', { pendingPasswordHash: newHash });
    await userStore.update(req.user.id, { otp: req.user.otp });
    const mail = await sendOtpEmail(req.user.emailLower, code, 'パスワード変更');
    res.json({ ok: true, devCode: mail.devCode, mailError: mail.ok ? null : mail.error });
  } catch (e) {
    console.error('change-password/request error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// パスワード変更：コード照合 → 適用
app.post('/api/account/change-password/confirm', requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    const r = await consumeOtp(req.user, 'changePassword', code);
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });

    const newHash = r.otp.pendingPasswordHash;
    if (!newHash) {
      await userStore.update(req.user.id, { otp: null });
      return res.status(400).json({ ok: false, error: '保留中の変更が見つかりません' });
    }

    const raw = req.signedCookies[SESSION_COOKIE];
    const currentToken = (raw && raw.includes('.')) ? raw.split('.')[1] : null;
    if (currentToken) {
      await sessionStore.deleteAllExceptToken(req.user.id, currentToken);
    }
    await userStore.update(req.user.id, { passwordHash: newHash, otp: null });
    res.json({ ok: true });
  } catch (e) {
    console.error('change-password/confirm error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// アバター変更
app.post('/api/account/change-avatar', requireAuth, async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    if (!dataUrl) {
      // 旧 R2 アバターがあれば削除
      const oldKey = r2.urlToKey(req.user.avatarUrl);
      if (oldKey) r2.deleteObject(oldKey).catch(e => console.warn('[r2] avatar delete warn:', e.message));
      await userStore.update(req.user.id, { avatarUrl: null });
      req.user.avatarUrl = null;
      return res.json({ ok: true, user: userPublic(req.user) });
    }
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(dataUrl)) {
      return res.status(400).json({ ok: false, error: 'invalid_image' });
    }
    if (dataUrl.length > 600 * 1024) {
      return res.status(400).json({ ok: false, error: 'image_too_large' });
    }

    let avatarUrl = dataUrl;
    if (r2.isConfigured()) {
      // R2 にアップロードして URL に置換
      const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
      const key = `avatars/${req.user.id}_${r2.randomSuffix()}.${ext}`;
      avatarUrl = await r2.uploadDataUrl(dataUrl, key);
      // 旧アバターを削除（エラーは無視）
      const oldKey = r2.urlToKey(req.user.avatarUrl);
      if (oldKey) r2.deleteObject(oldKey).catch(e => console.warn('[r2] old avatar delete warn:', e.message));
    }

    await userStore.update(req.user.id, { avatarUrl });
    req.user.avatarUrl = avatarUrl;
    res.json({ ok: true, user: userPublic(req.user) });
  } catch (e) {
    console.error('change-avatar error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== 通知 =====

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const data = await notifStore.loadNotifications(req.user.id);
    res.json({ ok: true, notifications: data.notifications || [] });
  } catch (e) {
    console.error('GET /api/notifications error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    // eventId 指定時はそのイベントの通知だけ既読にする（未指定なら全件・後方互換）
    const eventId = req.body?.eventId || null;
    await notifStore.markAllRead(req.user.id, eventId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await notifStore.markRead(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.delete('/api/notifications/:id', requireAuth, async (req, res) => {
  try {
    await notifStore.deleteNotification(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.delete('/api/notifications', requireAuth, async (req, res) => {
  try {
    await notifStore.clearAll(req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== イベント =====

// 全イベント取得（HOME 用）
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    const rawEvents = await eventStore.listEventsForUser(req.user.id);

    // members 配列に username / avatarUrl を埋め込む（クライアントの表示用）
    const events = await Promise.all(rawEvents.map(async p => {
      const flat = crdt.crdtToFlat(p);
      if (Array.isArray(flat.members)) {
        const memberIds = flat.members.map(m => m.userId);
        const users = await userStore.findManyByIds(memberIds);
        const usersMap = {};
        for (const u of users) usersMap[u.id] = u;
        flat.members = flat.members.map(mem => ({
          ...mem,
          username:  usersMap[mem.userId]?.username  || '(削除されたユーザー)',
          avatarUrl: usersMap[mem.userId]?.avatarUrl || null,
        }));
      }
      // submissions をマージ（clearedData として返す）
      await _mergeSubmissions(p.id, flat);
      // CRDT外フィールドを付与
      flat.lastProposalGeneratedAt = p.lastProposalGeneratedAt || null;
      flat.folderId = p.folderId || null;
      return flat;
    }));

    res.json({ events });
  } catch (e) {
    console.error('GET /api/data error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// 単一イベント取得
app.get('/api/events/:id', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!eventStore.isMember(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });
    const flatProject = crdt.crdtToFlat(p);
    await _mergeSubmissions(req.params.id, flatProject);
    flatProject.lastProposalGeneratedAt = p.lastProposalGeneratedAt || null;
    flatProject.folderId                = p.folderId                || null;
    res.json({ ok: true, project: flatProject });
  } catch (e) {
    console.error('GET /api/events/:id error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// CRDT 版イベント保存（単一）
app.put('/api/events/:id', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!eventStore.isMember(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'このイベントを編集する権限がありません', code: 'no_manage_permission' });

    const flat = req.body?.project || {};
    // clearedData を submissions コレクションに分離（R2 画像アップロード含む）
    await _extractClearedData(req.params.id, flat);

    const merged = await eventStore.applyPatch(req.params.id, flat, {
      timestamp:         Date.now(),
      missionDeletions:  req.body?.missionDeletions  || [],
      proposalDeletions: req.body?.proposalDeletions || [],
    });

    const flatMerged = crdt.crdtToFlat(merged);
    await _mergeSubmissions(req.params.id, flatMerged);

    const clientId = req.get('X-Client-Id') || null;
    eventBus.broadcast(req.params.id, 'eventUpdated', {
      eventId: req.params.id,
      rev:     merged.rev,
      event:   flatMerged,
    }, clientId);

    res.json({ ok: true, project: flatMerged });
  } catch (e) {
    console.error('PUT /api/events/:id error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ミッション提案を動的生成（ルールベースエンジン）
app.post('/api/events/:id/proposals/generate', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!eventStore.isMember(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });

    const flat           = crdt.crdtToFlat(p);
    const existingTitles = flat.missions.map(m => m.title).filter(Boolean);
    const usedProposalIds = p.usedProposalIds || [];

    const { proposals, newUsedIds } = proposalEngine.generateProposals({
      name:           flat.name        || '',
      description:    flat.description || '',
      existingTitles,
      usedProposalIds,
      // 進捗連動: 開催日・残り日数からフェーズ判定、既存ミッションのタグ×完了状況からギャップ検出
      eventDates:     Array.isArray(flat.dates) ? flat.dates : [],
      daysLeft:       typeof flat.daysLeft === 'number' ? flat.daysLeft : null,
      // イベント設定の明示フェーズ（カレンダー優先＋補助加点 / 序盤フェーズで気づき枠を確保）
      eventPhase:     typeof flat.eventPhase === 'string' ? flat.eventPhase : null,
      missions:       flat.missions.map(m => ({
        tag: m.tag, tags: m.tags, status: m.status, dates: m.dates,
        originProposalId: m.originProposalId,
      })),
    });

    // usedProposalIds と lastProposalGeneratedAt を直接更新（CRDT外フィールド）
    const now = Date.now();
    await getDb().collection('events').updateOne(
      { _id: req.params.id },
      { $set: { usedProposalIds: newUsedIds, lastProposalGeneratedAt: now } }
    );

    res.json({ ok: true, proposals, lastProposalGeneratedAt: now });
  } catch (e) {
    console.error('proposals/generate error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 旧 PUT /api/data（後方互換）
app.put('/api/data', requireAuth, async (req, res) => {
  try {
    const incoming  = req.body?.events || req.body?.projects || [];  // eventsが新名、projectsは後方互換
    const current   = await eventStore.listEventsForUser(req.user.id);
    const currentIds  = new Set(current.map(p => p.id));
    const incomingIds = new Set(incoming.map(p => p.id));

    // --- 新規イベント ---
    const created = incoming.filter(p => !currentIds.has(p.id));
    if (created.length > 0 && !req.user.isVerified) {
      return res.status(403).json({ ok: false, error: 'メール認証が完了するまで新規イベントを作成できません', code: 'verification_required' });
    }
    const now = Date.now();
    for (const p of created) {
      const cp = crdt.flatToCrdt(p, now);
      cp.members   = [{ userId: req.user.id, role: 'owner', roles: ['owner'], joinedAt: now }];
      cp.ownerId   = req.user.id;
      cp.createdAt = p.createdAt || now;
      cp.rev = 1;
      await eventStore.saveEvent(cp);
      eventBus.broadcast(cp.id, 'eventUpdated', {
        eventId: cp.id, rev: cp.rev, event: crdt.crdtToFlat(cp),
      });
    }

    // --- 既存イベントの更新 ---
    const clientId = req.get('X-Client-Id') || null;
    for (const incomingP of incoming) {
      if (!currentIds.has(incomingP.id)) continue;
      const existing = await eventStore.loadEvent(incomingP.id);
      if (!existing || !eventStore.isMember(existing, req.user.id)) continue;
      if (!eventStore.canManage(existing, req.user.id)) continue;

      // 通知トリガー検出（変更前後のミッション比較）
      const prevMissionsMap = {};
      for (const mid of Object.keys(existing.missions || {})) {
        const cm = existing.missions[mid];
        if (cm.deletedAt) continue;
        const flat = { id: mid };
        for (const k of Object.keys(cm.fields || {})) flat[k] = cm.fields[k]?.v;
        prevMissionsMap[mid] = flat;
      }

      const notifications = [];
      for (const m of (incomingP.missions || [])) {
        const prev = prevMissionsMap[m.id];
        const projectMembers = (existing.members || []).map(x => x.userId);

        // (A) 担当者の新規割当（手動アサイン）
        const prevAssigneeUser = (prev?.assignee?.type === 'user') ? prev.assignee.userId : null;
        const newAssigneeUser  = (m.assignee?.type  === 'user')    ? m.assignee.userId    : null;
        if (newAssigneeUser && newAssigneeUser !== prevAssigneeUser && newAssigneeUser !== req.user.id) {
          if (!m.selfClaim) {
            notifications.push({
              userIds: [newAssigneeUser],
              notif: {
                type:      'assigned_to_me',
                message:   `${req.user.username} さんが「${m.title}」をあなたに割り当てました`,
                eventId: incomingP.id,
                missionId: m.id,
                actorId:   req.user.id,
                actorName: req.user.username,
              },
            });
          }
        }

        // (B) ミッション完了
        const prevStatus = prev?.status || 'yet';
        const newStatus  = m.status     || 'yet';
        if (prevStatus !== 'cleared' && newStatus === 'cleared') {
          notifications.push({
            userIds: projectMembers.filter(uid => uid !== req.user.id),
            notif: {
              type:      'mission_cleared',
              message:   `${req.user.username} さんが「${m.title}」を完了しました`,
              eventId: incomingP.id,
              missionId: m.id,
              actorId:   req.user.id,
              actorName: req.user.username,
            },
          });
        }

        // (C) リーダー確認待ち
        if (prevStatus !== 'pending_leader_check' && newStatus === 'pending_leader_check') {
          const managerIds = _getManagerIds(existing).filter(uid => uid !== req.user.id);
          notifications.push({
            userIds: managerIds,
            notif: {
              type:      'pending_leader_check',
              message:   `${req.user.username} さんが「${m.title}」を提出しました。確認をお願いします`,
              eventId: incomingP.id,
              missionId: m.id,
              actorId:   req.user.id,
              actorName: req.user.username,
            },
          });
        }

        // (E) アーカイブから未完了に戻された（cleared → cleared 以外）→ 全メンバー（実行者除く）
        if (prevStatus === 'cleared' && newStatus !== 'cleared') {
          notifications.push({
            userIds: projectMembers.filter(uid => uid !== req.user.id),
            notif: {
              type:      'mission_reverted',
              message:   `${req.user.username} さんが「${m.title}」を未完了に戻しました`,
              eventId: incomingP.id,
              missionId: m.id,
              actorId:   req.user.id,
              actorName: req.user.username,
            },
          });
        }

        // (D) 新規ミッション作成 / (F) 既存ミッションの内容変更 → 全メンバー（実行者除く）
        if (!prev) {
          notifications.push({
            userIds: projectMembers.filter(uid => uid !== req.user.id),
            notif: {
              type:      'mission_created',
              message:   `${req.user.username} さんが「${m.title}」を作成しました`,
              eventId: incomingP.id,
              missionId: m.id,
              actorId:   req.user.id,
              actorName: req.user.username,
            },
          });
        } else if (_missionContentChanged(prev, m)) {
          notifications.push({
            userIds: projectMembers.filter(uid => uid !== req.user.id),
            notif: {
              type:      'mission_updated',
              message:   `${req.user.username} さんが「${m.title}」を変更しました`,
              eventId: incomingP.id,
              missionId: m.id,
              actorId:   req.user.id,
              actorName: req.user.username,
            },
          });
        }
      }

      const existingMissionIds  = Object.keys(existing.missions  || {});
      const existingProposalIds = Object.keys(existing.proposals || {});
      const incomingMissionIds  = new Set((incomingP.missions  || []).map(m => m.id));
      const incomingProposalIds = new Set((incomingP.proposals || []).map(p => p.id));
      const missionDeletions   = existingMissionIds.filter(id  => !incomingMissionIds.has(id)  && !existing.missions[id].deletedAt);
      const proposalDeletions  = existingProposalIds.filter(id => !incomingProposalIds.has(id) && !existing.proposals[id].deletedAt);

      // clearedData を submissions コレクションに分離
      const patchFlat = { ...incomingP };
      await _extractClearedData(incomingP.id, patchFlat);

      const merged = await eventStore.applyPatch(incomingP.id, patchFlat, {
        timestamp: now, missionDeletions, proposalDeletions,
      });

      const broadcastFlat = crdt.crdtToFlat(merged);
      await _mergeSubmissions(incomingP.id, broadcastFlat);
      eventBus.broadcast(incomingP.id, 'eventUpdated', {
        eventId: incomingP.id, rev: merged.rev, event: broadcastFlat,
      }, clientId);

      await Promise.all(notifications.map(n => notifStore.notifyAll(n.userIds, n.notif)));
    }

    // --- 削除 ---
    for (const p of current) {
      if (incomingIds.has(p.id)) continue;
      const role = eventStore.getRole(p, req.user.id);
      if (role === 'owner') {
        await eventStore.deleteEvent(p.id);
        await submissionStore.deleteAllForProject(p.id);
        eventBus.broadcast(p.id, 'eventDeleted', { eventId: p.id });
      } else if (role === 'member') {
        p.members = p.members.filter(m => m.userId !== req.user.id);
        await eventStore.saveEvent(p);
        eventBus.broadcast(p.id, 'memberLeft', { eventId: p.id, userId: req.user.id });
        logServerEvent(p.id, req.user.id, 'member_left', {});
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/data error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== 操作履歴（行動ログ） =====

// サーバー側の権威ある操作を event_logs に記録する（fire-and-forget）。
// クライアントの logger.js（同意制・任意）では取りこぼす重要操作の監査用。
// ログ失敗で本処理を妨げないよう必ず catch する。
function logServerEvent(eventId, userId, event, props = {}) {
  eventLogStore.insertEvents([{
    event:     String(event).slice(0, 64),
    ts:        new Date(),
    clientTs:  new Date(),
    userId:    userId || null,
    sessionId: null,
    projectId: eventId ? String(eventId).slice(0, 64) : null,
    props:     (props && typeof props === 'object' && !Array.isArray(props)) ? props : {},
    ctx:       { source: 'server' },
  }]).catch(e => console.error('[logServerEvent]', e.message));
}

// イベントの操作履歴を取得（管理者権限必須）。event_logs を projectId で絞って新しい順に返す。
app.get('/api/events/:id/logs', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });

    const limit = parseInt(req.query.limit, 10) || 200;
    const docs  = await eventLogStore.findByProject(req.params.id, limit);

    // userId → username 解決（ログに残る非メンバー/退会者も拾えるよう userStore で引く）
    const ids   = [...new Set(docs.map(d => d.userId).filter(Boolean))];
    const users = await userStore.findManyByIds(ids);
    const nameById = new Map(users.map(u => [u.id, u.username]));

    const logs = docs.map(d => ({
      event:    d.event,
      ts:       d.ts,
      userId:   d.userId || null,
      username: d.userId ? (nameById.get(d.userId) || '不明なユーザー') : 'ゲスト',
      props:    (d.props && typeof d.props === 'object') ? d.props : {},
    }));
    res.json({ ok: true, logs });
  } catch (e) {
    console.error('events/:id/logs error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== メンバー =====

app.get('/api/events/:id/members', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.isMember(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });

    const memberIds = (p.members || []).map(m => m.userId);
    const users = await userStore.findManyByIds(memberIds);
    const usersMap = {};
    for (const u of users) usersMap[u.id] = u;

    const members = (p.members || []).map(m => {
      const roleIds = eventStore.getMemberRoleIds(p, m.userId);
      return {
        userId:    m.userId,
        role:      roleIds[0] || null,
        roles:     roleIds,
        joinedAt:  m.joinedAt,
        username:  usersMap[m.userId]?.username  || '(削除されたユーザー)',
        avatarUrl: usersMap[m.userId]?.avatarUrl || null,
      };
    });

    res.json({ ok: true, members, ownerId: p.ownerId, roles: eventStore.getRoles(p) });
  } catch (e) {
    console.error('GET /api/events/:id/members error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// メンバーのロール変更（後方互換：単一ロール）
app.put('/api/events/:id/members/:userId/role', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: '管理者権限が必要です' });

    const targetId = req.params.userId;
    const newRole  = String(req.body?.role || '');
    const roles = eventStore.getRoles(p);
    if (!roles.find(r => r.id === newRole) || newRole === 'owner')
      return res.status(400).json({ ok: false, error: 'invalid_role' });

    const target = (p.members || []).find(m => m.userId === targetId);
    if (!target) return res.status(404).json({ ok: false, error: 'member not found' });
    if (eventStore.getRole(p, targetId) === 'owner')
      return res.status(400).json({ ok: false, error: 'オーナーのロールは変更できません' });

    eventStore.setMemberRoleIds(p, targetId, [newRole]);
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'memberRoleChanged', { eventId: p.id, userId: targetId, role: newRole });
    logServerEvent(p.id, req.user.id, 'role_changed', { targetUserId: targetId, roles: [newRole] });
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/events/:id/members/:userId/role error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// メンバーのロール変更（複数ロール）
app.put('/api/events/:id/members/:userId/roles', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    const callerIds = eventStore.getMemberRoleIds(p, req.user.id);
    console.log('[roles PUT] caller=%s callerRoles=%j canManage=%s', req.user.id, callerIds, eventStore.canManage(p, req.user.id));
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: '管理者権限が必要です' });

    const targetId = req.params.userId;
    let newRoles = req.body?.roles;
    if (!Array.isArray(newRoles)) return res.status(400).json({ ok: false, error: 'roles is required (array)' });
    newRoles = [...new Set(newRoles.map(String))];

    const allRoles = eventStore.getRoles(p);
    if (newRoles.includes('owner')) return res.status(400).json({ ok: false, error: 'owner ロールは割当不可' });
    for (const rid of newRoles) {
      if (!allRoles.find(r => r.id === rid)) return res.status(400).json({ ok: false, error: `不明なロール: ${rid}` });
    }

    const target = (p.members || []).find(m => m.userId === targetId);
    if (!target) return res.status(404).json({ ok: false, error: 'member not found' });
    if (eventStore.getRole(p, targetId) === 'owner')
      return res.status(400).json({ ok: false, error: 'オーナーのロールは変更できません' });

    if (newRoles.length === 0) newRoles = ['member'];

    eventStore.setMemberRoleIds(p, targetId, newRoles);
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'memberRolesChanged', { eventId: p.id, userId: targetId, roles: newRoles });
    logServerEvent(p.id, req.user.id, 'role_changed', { targetUserId: targetId, roles: newRoles });

    if (targetId !== req.user.id) {
      const roleNames = newRoles.map(rid => allRoles.find(r => r.id === rid)?.name || rid);
      const pName = p.fields?.name?.v || 'イベント';
      await notifStore.addNotification(targetId, {
        type:      'role_assigned',
        message:   `「${pName}」でロール「${roleNames.join('・')}」が付与されました`,
        eventId: p.id,
        actorId:   req.user.id,
        actorName: req.user.username,
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/events/:id/members/:userId/roles error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== カスタムロール CRUD =====

app.get('/api/events/:id/roles', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.isMember(p, req.user.id)) return res.status(403).json({ ok: false, error: 'forbidden' });
    res.json({ ok: true, roles: eventStore.getRoles(p) });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/events/:id/roles', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'ロールの追加は管理者権限を持つメンバーのみ可能です' });

    const name      = String(req.body?.name || '').trim();
    const canManage = !!req.body?.canManage;
    if (!name || name.length > 20) return res.status(400).json({ ok: false, error: 'ロール名は1〜20文字で入力してください' });

    const roles = eventStore.getRoles(p);
    if (roles.some(r => r.name === name)) return res.status(409).json({ ok: false, error: '同じ名前のロールが既に存在します' });

    const newRole = { id: eventStore.newRoleId(), name, canManage, builtIn: false };
    roles.push(newRole);
    eventStore.setRoles(p, roles);
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'rolesChanged', { eventId: p.id });
    res.json({ ok: true, role: newRole });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.put('/api/events/:id/roles/:roleId', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'ロールの編集は管理者権限を持つメンバーのみ可能です' });

    const roles  = eventStore.getRoles(p);
    const target = roles.find(r => r.id === req.params.roleId);
    if (!target) return res.status(404).json({ ok: false, error: 'role not found' });
    if (target.builtIn && req.params.roleId === 'owner') return res.status(400).json({ ok: false, error: 'オーナーロールは変更できません' });

    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim();
      if (!name || name.length > 20) return res.status(400).json({ ok: false, error: 'ロール名は1〜20文字で入力してください' });
      if (roles.some(r => r.name === name && r.id !== target.id)) return res.status(409).json({ ok: false, error: '同じ名前のロールが既に存在します' });
      target.name = name;
    }
    if (typeof req.body?.canManage === 'boolean') {
      if (req.params.roleId === 'owner') {
        // owner は常に true（変更不可）
      } else if (req.params.roleId === 'admin' && req.body.canManage === false) {
        return res.status(400).json({ ok: false, error: '管理者ロールの管理者権限は変更できません' });
      } else {
        target.canManage = req.body.canManage;
      }
    }

    eventStore.setRoles(p, roles);
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'rolesChanged', { eventId: p.id });
    res.json({ ok: true, role: target });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.delete('/api/events/:id/roles/:roleId', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'ロールの削除は管理者権限を持つメンバーのみ可能です' });

    const roles  = eventStore.getRoles(p);
    const target = roles.find(r => r.id === req.params.roleId);
    if (!target) return res.status(404).json({ ok: false, error: 'role not found' });
    if (target.builtIn) return res.status(400).json({ ok: false, error: '組み込みロールは削除できません' });

    (p.members || []).forEach(m => {
      const ids      = eventStore.getMemberRoleIds(p, m.userId);
      const filtered = ids.filter(rid => rid !== target.id);
      eventStore.setMemberRoleIds(p, m.userId, filtered.length > 0 ? filtered : ['member']);
    });

    eventStore.setRoles(p, roles.filter(r => r.id !== target.id));
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'rolesChanged', { eventId: p.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== ミッション申告 =====

app.post('/api/events/:id/missions/:mid/claim', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.isMember(p, req.user.id)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const m = _missionToFlat(p.missions?.[req.params.mid], req.params.mid);
    if (!m) return res.status(404).json({ ok: false, error: 'mission not found' });
    if (!m.selfClaim) return res.status(400).json({ ok: false, error: 'このミッションは申告制ではありません' });

    if (m.claimDeadline && Date.now() > m.claimDeadline)
      return res.status(400).json({ ok: false, error: '応募期限を過ぎています' });
    if (Array.isArray(m.assignees) && m.assignees.length > 0)
      return res.status(400).json({ ok: false, error: '既に担当が確定しています' });

    const applicants = Array.isArray(m.claimApplicants) ? m.claimApplicants.slice() : [];
    if (applicants.includes(req.user.id)) return res.status(400).json({ ok: false, error: '既に申告済みです' });
    applicants.push(req.user.id);
    _setMissionField(p, req.params.mid, 'claimApplicants', applicants);
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'missionApplicantAdded', { eventId: p.id, missionId: req.params.mid, userId: req.user.id });
    logServerEvent(p.id, req.user.id, 'claim_applied', { missionId: req.params.mid, title: m.title });

    const managerIds = _getManagerIds(p).filter(uid => uid !== req.user.id);
    await notifStore.notifyAll(managerIds, {
      type:      'someone_claimed',
      message:   `${req.user.username} さんが「${m.title}」に応募しました`,
      eventId: p.id, missionId: req.params.mid,
      actorId: req.user.id, actorName: req.user.username,
    });
    await notifStore.addNotification(req.user.id, {
      type:      'self_claimed',
      message:   `「${m.title}」に応募しました。担当者が決まり次第お知らせします`,
      eventId: p.id, missionId: req.params.mid,
      actorId: req.user.id, actorName: req.user.username,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('POST claim error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// 申告取り消し
app.delete('/api/events/:id/missions/:mid/claim', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.isMember(p, req.user.id)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const m = _missionToFlat(p.missions?.[req.params.mid], req.params.mid);
    if (!m) return res.status(404).json({ ok: false, error: 'mission not found' });
    if (!m.selfClaim) return res.status(400).json({ ok: false, error: 'このミッションは申告制ではありません' });

    if (Array.isArray(m.assignees) && m.assignees.length > 0)
      return res.status(400).json({ ok: false, error: '担当確定後は取り消せません' });
    const applicants = Array.isArray(m.claimApplicants) ? m.claimApplicants.slice() : [];
    const idx = applicants.indexOf(req.user.id);
    if (idx < 0) return res.status(400).json({ ok: false, error: '申告していません' });
    applicants.splice(idx, 1);
    _setMissionField(p, req.params.mid, 'claimApplicants', applicants);

    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'missionUnclaimed', { eventId: p.id, missionId: req.params.mid });
    logServerEvent(p.id, req.user.id, 'claim_unapplied', { missionId: req.params.mid, title: m.title });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE claim error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// 選定（selection）
app.post('/api/events/:id/missions/:mid/select-claims', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id)) return res.status(403).json({ ok: false, error: '管理者権限がありません' });

    const m = _missionToFlat(p.missions?.[req.params.mid], req.params.mid);
    if (!m) return res.status(404).json({ ok: false, error: 'mission not found' });
    if (!m.selfClaim)
      return res.status(400).json({ ok: false, error: '申告制のミッションのみ選定できます' });
    if (Array.isArray(m.assignees) && m.assignees.length > 0)
      return res.status(400).json({ ok: false, error: '既に選定済みです' });

    let selected = req.body?.userIds;
    if (!Array.isArray(selected) || selected.length === 0)
      return res.status(400).json({ ok: false, error: 'userIds (配列) を1名以上指定してください' });
    selected = [...new Set(selected.map(String))];

    const applicants = Array.isArray(m.claimApplicants) ? m.claimApplicants : [];
    for (const uid of selected) {
      if (!applicants.includes(uid)) return res.status(400).json({ ok: false, error: '申告者の中から選んでください' });
    }

    _setMissionField(p, req.params.mid, 'assignees', selected);
    _setMissionField(p, req.params.mid, 'assignee',  { type: 'user', userId: selected[0] });
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'missionSelected', { eventId: p.id, missionId: req.params.mid });
    logServerEvent(p.id, req.user.id, 'claim_selected', { missionId: req.params.mid, title: m.title, assignees: selected });
    await _notifyAssignmentDecided(p, req.params.mid, m, selected, req.user);
    res.json({ ok: true, assignees: selected });
  } catch (e) {
    console.error('select-claims error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== リーダーチェック =====

app.post('/api/events/:id/missions/:mid/approve', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id)) return res.status(403).json({ ok: false, error: '管理者権限がありません' });

    const m = _missionToFlat(p.missions?.[req.params.mid], req.params.mid);
    if (!m) return res.status(404).json({ ok: false, error: 'mission not found' });
    if (m.status !== 'pending_leader_check') return res.status(400).json({ ok: false, error: '確認待ち状態ではありません' });

    _setMissionField(p, req.params.mid, 'status', 'cleared');
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'missionApproved', { eventId: p.id, missionId: req.params.mid });
    logServerEvent(p.id, req.user.id, 'leader_approved', { missionId: req.params.mid, title: m.title });

    const submitterId = m.assignee?.type === 'user' ? m.assignee.userId : null;
    if (submitterId && submitterId !== req.user.id) {
      await notifStore.addNotification(submitterId, {
        type:      'leader_approved',
        message:   `${req.user.username} さんが「${m.title}」を承認しました`,
        eventId: p.id, missionId: req.params.mid,
        actorId:   req.user.id, actorName: req.user.username,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('approve error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/events/:id/missions/:mid/reject', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id)) return res.status(403).json({ ok: false, error: '管理者権限がありません' });

    const m = _missionToFlat(p.missions?.[req.params.mid], req.params.mid);
    if (!m) return res.status(404).json({ ok: false, error: 'mission not found' });
    if (m.status !== 'pending_leader_check') return res.status(400).json({ ok: false, error: '確認待ち状態ではありません' });

    _setMissionField(p, req.params.mid, 'status', 'yet');
    await eventStore.saveEvent(p);
    // 提出物を削除（submissions コレクションで管理）
    await submissionStore.deleteSubmission(req.params.id, req.params.mid);
    eventBus.broadcast(p.id, 'missionRejected', { eventId: p.id, missionId: req.params.mid });
    logServerEvent(p.id, req.user.id, 'leader_rejected', { missionId: req.params.mid, title: m.title });

    const submitterId = m.assignee?.type === 'user' ? m.assignee.userId : null;
    if (submitterId && submitterId !== req.user.id) {
      await notifStore.addNotification(submitterId, {
        type:      'leader_rejected',
        message:   `${req.user.username} さんが「${m.title}」を差し戻しました。再度提出してください`,
        eventId: p.id, missionId: req.params.mid,
        actorId:   req.user.id, actorName: req.user.username,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('reject error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ミッション完了（メンバー可）
// PUT /api/data は canManage 必須のため、一般メンバーが完了しても永続化されず
// 再読み込みで未完了に戻る不具合があった。完了はメンバーの正当な操作なので専用化する。
// load→mutate→saveEvent パターン（CLAUDE.md「ミッション操作系」）。
app.post('/api/events/:id/missions/:mid/complete', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.isMember(p, req.user.id)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const mid = req.params.mid;
    const m = _missionToFlat(p.missions?.[mid], mid);
    if (!m) return res.status(404).json({ ok: false, error: 'mission not found' });
    if (m.status === 'cleared') return res.status(400).json({ ok: false, error: '既に完了しています' });

    const userId = req.user.id;
    let content   = String(req.body?.content ?? '');
    const format  = ['text', 'image', 'link'].includes(req.body?.format) ? req.body.format : 'text';
    const now     = Date.now();

    // 画像 dataURL → R2 アップロード（_extractClearedData と同じ扱い）
    if (format === 'image' && content.startsWith('data:') && r2.isConfigured()) {
      try {
        const ext = content.startsWith('data:image/png') ? 'png' : 'jpg';
        const key = `submissions/${p.id}/${mid}_${r2.randomSuffix()}.${ext}`;
        content = await r2.uploadDataUrl(content, key);
      } catch (e) {
        console.error('[r2] complete upload error:', e.message);
      }
    }

    let becameCleared        = false;
    let becamePendingCheck   = false;

    if (m.individualClear) {
      // 個別完了：individualClearedBy に自分を追加し、composite key で提出を保存
      const clearedBy = Array.isArray(m.individualClearedBy) ? m.individualClearedBy.slice() : [];
      if (clearedBy.includes(userId)) return res.status(400).json({ ok: false, error: '既に完了しています' });
      clearedBy.push(userId);
      _setMissionField(p, mid, 'individualClearedBy', clearedBy, now);
      _setMissionField(p, mid, 'clearFormat', format, now);
      await submissionStore.saveSubmission(p.id, `${mid}_u_${userId}`, {
        content, format, title: m.title, timestamp: now, submittedBy: userId,
      });

      // 全担当者が完了したら status を進める
      const assigneeIds = Array.isArray(m.assignees) && m.assignees.length > 0
        ? m.assignees
        : (m.assignee?.type === 'user' ? [m.assignee.userId] : []);
      const allDone = assigneeIds.length > 0 && assigneeIds.every(id => clearedBy.includes(id));
      if (allDone) {
        const next = m.leaderCheck ? 'pending_leader_check' : 'cleared';
        _setMissionField(p, mid, 'status', next, now);
        becameCleared      = next === 'cleared';
        becamePendingCheck = next === 'pending_leader_check';
      }
    } else {
      const next = m.leaderCheck ? 'pending_leader_check' : 'cleared';
      _setMissionField(p, mid, 'clearFormat', format, now);
      _setMissionField(p, mid, 'status', next, now);
      await submissionStore.saveSubmission(p.id, mid, {
        content, format, title: m.title, timestamp: now, submittedBy: userId,
      });
      becameCleared      = next === 'cleared';
      becamePendingCheck = next === 'pending_leader_check';
    }

    await eventStore.saveEvent(p);

    const flat = crdt.crdtToFlat(p);
    await _mergeSubmissions(p.id, flat);
    eventBus.broadcast(p.id, 'eventUpdated', {
      eventId: p.id, rev: p.rev, event: flat,
    }, req.get('X-Client-Id') || null);

    // 通知（PUT /api/data の (B)(C) と同じ条件）
    if (becameCleared) {
      await notifStore.notifyAll(
        (p.members || []).map(x => x.userId).filter(uid => uid !== userId),
        {
          type: 'mission_cleared',
          message: `${req.user.username} さんが「${m.title}」を完了しました`,
          eventId: p.id, missionId: mid,
          actorId: userId, actorName: req.user.username,
        });
    }
    if (becamePendingCheck) {
      await notifStore.notifyAll(
        _getManagerIds(p).filter(uid => uid !== userId),
        {
          type: 'pending_leader_check',
          message: `${req.user.username} さんが「${m.title}」を提出しました。確認をお願いします`,
          eventId: p.id, missionId: mid,
          actorId: userId, actorName: req.user.username,
        });
    }

    res.json({ ok: true, mission: _missionToFlat(p.missions[mid], mid) });
  } catch (e) {
    console.error('complete error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// メンバー脱退・除名
app.delete('/api/events/:id/members/:userId', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.isMember(p, req.user.id)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const targetId   = req.params.userId;
    const myRole     = eventStore.getRole(p, req.user.id);
    const targetRole = eventStore.getRole(p, targetId);

    if (req.user.id !== targetId && myRole !== 'owner')
      return res.status(403).json({ ok: false, error: 'オーナーのみが他のメンバーを除名できます' });
    if (targetRole === 'owner')
      return res.status(400).json({ ok: false, error: 'オーナーは脱退・除名できません。イベントを削除してください' });

    p.members = (p.members || []).filter(m => m.userId !== targetId);
    await eventStore.saveEvent(p);
    eventBus.broadcast(p.id, 'memberLeft', { eventId: p.id, userId: targetId });
    // 本人なら脱退、他者なら除名として記録
    logServerEvent(p.id, req.user.id,
      req.user.id === targetId ? 'member_left' : 'member_removed',
      { targetUserId: targetId });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE member error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== 招待 =====

const INVITE_DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7日

app.get('/api/events/:id/invites', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id)) return res.status(403).json({ ok: false, error: 'forbidden' });
    res.json({ ok: true, invites: await inviteStore.listInvitesForProject(p.id) });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/events/:id/invites', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: '管理者権限を持つメンバーのみ招待を作成できます' });

    const ttlMs   = Number(req.body?.ttlMs) > 0 ? Number(req.body.ttlMs) : INVITE_DEFAULT_TTL_MS;
    const maxUses = Number(req.body?.maxUses) > 0 ? Number(req.body.maxUses) : null;

    const invite = {
      token:     inviteStore.newInviteToken(),
      eventId: p.id,
      createdBy: req.user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      maxUses,
      usedBy: [],
    };
    await inviteStore.saveInvite(invite);
    res.json({ ok: true, invite });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.delete('/api/events/:id/invites/:token', requireAuth, async (req, res) => {
  try {
    const inv = await inviteStore.loadInvite(req.params.token);
    if (!inv || inv.eventId !== req.params.id)
      return res.status(404).json({ ok: false, error: 'invite not found' });
    const p = await eventStore.loadEvent(req.params.id);
    if (!eventStore.canManage(p, req.user.id)) return res.status(403).json({ ok: false, error: 'forbidden' });
    await inviteStore.deleteInvite(req.params.token);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// 招待プレビュー（認証不要）
app.get('/api/invites/:token', async (req, res) => {
  try {
    const inv = await inviteStore.loadInvite(req.params.token);
    if (!inv) return res.status(404).json({ ok: false, error: 'invite_not_found' });

    const now = Date.now();
    if (inv.expiresAt && inv.expiresAt < now) return res.status(410).json({ ok: false, error: 'invite_expired' });
    if (inv.maxUses && inv.usedBy.length >= inv.maxUses) return res.status(410).json({ ok: false, error: 'invite_used_up' });

    const p = await eventStore.loadEvent(inv.eventId);
    if (!p) return res.status(404).json({ ok: false, error: 'project_not_found' });

    const owner = await userStore.findById(p.ownerId);
    const flat  = crdt.crdtToFlat(p);
    res.json({
      ok: true,
      invite: {
        eventName: flat.name,
        seedType:    flat.seedType,
        ownerName:   owner?.username || '不明',
        memberCount: (p.members || []).length,
        expiresAt:   inv.expiresAt,
      },
    });
  } catch (e) {
    console.error('GET /api/invites/:token error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// 招待受け入れ
app.post('/api/invites/:token/accept', requireAuth, async (req, res) => {
  try {
    const inv = await inviteStore.loadInvite(req.params.token);
    if (!inv) return res.status(404).json({ ok: false, error: 'invite_not_found' });

    const now = Date.now();
    if (inv.expiresAt && inv.expiresAt < now) return res.status(410).json({ ok: false, error: 'invite_expired' });
    if (inv.maxUses && inv.usedBy.length >= inv.maxUses) return res.status(410).json({ ok: false, error: 'invite_used_up' });

    const p = await eventStore.loadEvent(inv.eventId);
    if (!p) return res.status(404).json({ ok: false, error: 'project_not_found' });

    if (eventStore.isMember(p, req.user.id)) {
      return res.json({ ok: true, eventId: p.id, alreadyMember: true });
    }

    // 既に承認待ちかチェック
    const alreadyPending = (p.pendingMembers || []).some(m => m.userId === req.user.id);
    if (alreadyPending) {
      const eventName = p.fields?.name?.v || 'イベント';
      return res.json({ ok: true, pending: true, eventId: p.id, eventName: eventName });
    }

    // 承認待ちリストに追加（即時参加しない）
    const pendingEntry = {
      userId:      req.user.id,
      username:    req.user.username,
      avatarUrl:   req.user.avatarUrl || null,
      requestedAt: now,
      inviteToken: req.params.token,
    };
    await getDb().collection('events').updateOne(
      { _id: p.id },
      { $push: { pendingMembers: pendingEntry } }
    );

    inv.usedBy.push({ userId: req.user.id, joinedAt: now });
    await inviteStore.saveInvite(inv);

    // 管理者に通知 + SSE ブロードキャスト
    const updatedP  = await eventStore.loadEvent(p.id);
    const flatP     = crdt.crdtToFlat(updatedP);
    const eventName = p.fields?.name?.v || 'イベント';

    const managerIds = (p.members || [])
      .filter(m => eventStore.canManage(p, m.userId))
      .map(m => m.userId);
    if (managerIds.length > 0) {
      await notifStore.notifyAll(managerIds, {
        type:      'member_applied',
        message:   `${req.user.username} さんが「${eventName}」への参加を申請しました`,
        eventId: p.id,
        actorId:   req.user.id,
        actorName: req.user.username,
      });
    }

    eventBus.broadcast(p.id, 'eventUpdated', { eventId: p.id, event: flatP });

    res.json({ ok: true, pending: true, eventId: p.id, eventName: eventName });
  } catch (e) {
    console.error('POST /api/invites/:token/accept error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== 承認待ちメンバー =====

app.post('/api/events/:id/pending-members/:uid/approve', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });

    const pending = (p.pendingMembers || []).find(m => m.userId === req.params.uid);
    if (!pending) return res.status(404).json({ ok: false, error: 'pending member not found' });

    // すでにメンバーなら重複防止（2回押し対策）
    if (eventStore.isMember(p, req.params.uid)) {
      return res.json({ ok: true });
    }

    // roleIds 配列（新）または roleId 単一（後方互換）を受け付ける
    const roleIds = Array.isArray(req.body?.roleIds) && req.body.roleIds.length > 0
      ? req.body.roleIds.map(String).filter(Boolean)
      : [String(req.body?.roleId || 'member')];
    const now = Date.now();

    // pendingMembers から削除し members に追加。
    // 同時リクエストによる二重追加を防ぐため、members に uid がないことを条件にする
    const result = await getDb().collection('events').updateOne(
      {
        _id: req.params.id,
        'pendingMembers.userId': req.params.uid,
        'members.userId': { $ne: req.params.uid },
      },
      {
        $pull: { pendingMembers: { userId: req.params.uid } },
        $push: { members: { userId: req.params.uid, role: roleIds[0], roles: roleIds, joinedAt: now } },
      }
    );
    if (result.modifiedCount === 0) {
      // すでに承認済み or レースコンディション → 冪等に OK を返す
      return res.json({ ok: true });
    }

    const eventName = p.fields?.name?.v || 'イベント';

    // 承認されたユーザーに通知
    await notifStore.addNotification(req.params.uid, {
      type:      'member_joined',
      message:   `「${eventName}」への参加が承認されました`,
      eventId: p.id,
      actorId:   req.user.id,
      actorName: req.user.username,
    });

    // 既存メンバー全員（承認者・被承認者を除く）に通知
    const memberIds = (p.members || [])
      .map(m => m.userId)
      .filter(id => id !== req.user.id && id !== req.params.uid);
    if (memberIds.length > 0) {
      await notifStore.notifyAll(memberIds, {
        type:      'member_joined',
        message:   `${req.user.username} さんが ${pending.username} さんを「${eventName}」に参加承認しました`,
        eventId: p.id,
        actorId:   req.user.id,
        actorName: req.user.username,
      });
    }

    const updatedP = await eventStore.loadEvent(p.id);
    const flatP    = crdt.crdtToFlat(updatedP);
    eventBus.broadcast(p.id, 'eventUpdated', { eventId: p.id, event: flatP });
    // 新メンバーにリアルタイムで「承認されました」を通知
    eventBus.broadcastToUser(req.params.uid, 'memberApproved', { eventId: p.id });
    logServerEvent(p.id, req.user.id, 'member_approved', { targetUserId: req.params.uid });

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /pending-members/approve error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/events/:id/pending-members/:uid', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });

    await getDb().collection('events').updateOne(
      { _id: req.params.id },
      { $pull: { pendingMembers: { userId: req.params.uid } } }
    );

    const updatedP = await eventStore.loadEvent(p.id);
    const flatP    = crdt.crdtToFlat(updatedP);
    eventBus.broadcast(p.id, 'eventUpdated', { eventId: p.id, event: flatP });

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /pending-members error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== メンバー提案 =====

app.post('/api/events/:id/member-proposals', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not found' });
    if (!eventStore.isMember(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });
    if (eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: '管理者はミッション提案を送信できません' });

    const text = String(req.body?.text || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ ok: false, error: 'text required' });

    const proposal = {
      id:             crypto.randomBytes(6).toString('hex'),
      text,
      proposedBy:     req.user.id,
      proposedByName: req.user.username,
      proposedAt:     Date.now(),
    };

    await getDb().collection('events').updateOne(
      { _id: req.params.id },
      { $push: { memberProposals: proposal } }
    );

    // SSE で管理者のダッシュボードを更新
    const updated = await eventStore.loadEvent(req.params.id);
    const flat = crdt.crdtToFlat(updated);
    eventBus.broadcast(req.params.id, 'eventUpdated', { eventId: req.params.id, event: flat });

    res.json({ ok: true, proposal });
  } catch (e) {
    console.error('POST /member-proposals error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/events/:id/member-proposals/:pid', requireAuth, async (req, res) => {
  try {
    const p = await eventStore.loadEvent(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'not found' });
    if (!eventStore.canManage(p, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });

    await getDb().collection('events').updateOne(
      { _id: req.params.id },
      { $pull: { memberProposals: { id: req.params.pid } } }
    );

    const updated = await eventStore.loadEvent(req.params.id);
    const flat = crdt.crdtToFlat(updated);
    eventBus.broadcast(req.params.id, 'eventUpdated', { eventId: req.params.id, event: flat });

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /member-proposals error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== 行動ログ =====

app.post('/api/log', logLimiter, async (req, res) => {
  // クライアントを崩さないよう常に 200 で即応答し、DB 書き込みは非同期で処理
  res.json({ ok: true });

  (async () => {
    try {
      const events = req.body?.events;
      if (!Array.isArray(events) || events.length === 0) return;

      // セッション Cookie からユーザーを解決（任意）
      let userId = null;
      try {
        const raw = req.signedCookies[SESSION_COOKIE];
        if (raw && typeof raw === 'string' && raw.includes('.')) {
          const [uid, token] = raw.split('.');
          const sess = await sessionStore.findByToken(token);
          if (sess && sess.userId === uid && sess.expiresAt > Date.now()) userId = uid;
        }
      } catch (_) {}

      const docs = events
        .slice(0, 100)
        .filter(e => e && typeof e.event === 'string')
        .map(e => ({
          event:     String(e.event).slice(0, 64),
          ts:        new Date(),
          clientTs:  e.clientTs ? new Date(e.clientTs) : new Date(),
          userId,
          sessionId: e.sessionId ? String(e.sessionId).slice(0, 64) : null,
          // クライアント(logger.js)は projectId フィールドで選択中イベントIDを送る。
          // 旧 eventId も後方互換で受ける（過去は eventId を読んでおり常に null になっていた）。
          projectId: (e.projectId || e.eventId) ? String(e.projectId || e.eventId).slice(0, 64) : null,
          props:     (e.props && typeof e.props === 'object' && !Array.isArray(e.props)) ? e.props : {},
          ctx:       (e.ctx   && typeof e.ctx   === 'object' && !Array.isArray(e.ctx))   ? e.ctx   : {},
        }));

      if (docs.length > 0) await eventLogStore.insertEvents(docs);
    } catch (e) {
      console.error('[api/log]', e.message);
    }
  })();
});

// ===== プロジェクト（フォルダ）=====

// フォルダ一覧（自分が所属するもの、各件にイベント数付き）
app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const folders = await projectStore.listForUser(req.user.id);
    const foldersWithCount = await Promise.all(folders.map(async (f) => {
      const count = await getDb().collection('events').countDocuments({ folderId: f.id });
      return { ...f, eventCount: count };
    }));
    res.json({ ok: true, projects: foldersWithCount });
  } catch (e) {
    console.error('GET /api/projects error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// フォルダ新規作成
app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'プロジェクト名を入力してください' });
    const description = String(req.body?.description || '').trim();
    const project = await projectStore.create({ name, description, ownerId: req.user.id });
    res.json({ ok: true, project });
  } catch (e) {
    console.error('POST /api/projects error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// フォルダ詳細（所属イベント一覧付き）
app.get('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await projectStore.getById(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'not found' });
    if (!projectStore.isMember(project, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });

    const rawEvents = await eventStore.listByFolder(req.params.id);
    const events = await Promise.all(rawEvents.map(async (p) => {
      const flat = crdt.crdtToFlat(p);
      flat.folderId = p.folderId || null;
      await _mergeSubmissions(p.id, flat);
      return flat;
    }));
    res.json({ ok: true, project, events });
  } catch (e) {
    console.error('GET /api/projects/:id error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// フォルダ更新（名前・説明）
app.put('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await projectStore.getById(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'not found' });
    if (project.ownerId !== req.user.id)
      return res.status(403).json({ ok: false, error: 'forbidden' });
    const { name, description } = req.body || {};
    if (name !== undefined && !String(name).trim())
      return res.status(400).json({ ok: false, error: 'プロジェクト名を入力してください' });
    await projectStore.update(req.params.id, { name, description });
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/projects/:id error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// フォルダ削除（所属イベントの folderId は null に戻す）
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await projectStore.getById(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'not found' });
    if (project.ownerId !== req.user.id)
      return res.status(403).json({ ok: false, error: 'forbidden' });
    await projectStore.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/projects/:id error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// イベントをフォルダに追加（folderId 設定）
app.post('/api/projects/:id/events/:eventId', requireAuth, async (req, res) => {
  try {
    const project = await projectStore.getById(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!projectStore.isMember(project, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });
    const event = await eventStore.loadEvent(req.params.eventId);
    if (!event) return res.status(404).json({ ok: false, error: 'event not found' });
    if (!eventStore.isMember(event, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });
    await eventStore.setFolderId(req.params.eventId, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/projects/:id/events/:eventId error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// イベントをフォルダから除外（folderId を null に）
app.delete('/api/projects/:id/events/:eventId', requireAuth, async (req, res) => {
  try {
    const project = await projectStore.getById(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'project not found' });
    if (!projectStore.isMember(project, req.user.id))
      return res.status(403).json({ ok: false, error: 'forbidden' });
    await eventStore.setFolderId(req.params.eventId, null);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/projects/:id/events/:eventId error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== SSE =====

app.get('/api/events', requireAuth, async (req, res) => {
  try {
    const eventIdsParam = (req.query.eventIds || '').toString();
    const eventIds  = eventIdsParam.split(',').filter(Boolean);
    const clientId  = (req.query.cid || '').toString() || null;

    const allowed = [];
    for (const pid of eventIds) {
      const p = await eventStore.loadEvent(pid);
      if (p && eventStore.isMember(p, req.user.id)) allowed.push(pid);
    }

    res.set({
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ eventIds: allowed, clientId })}\n\n`);

    res.__clientId = clientId;
    const unsubscribe     = eventBus.subscribe(allowed, res);
    const unsubscribeUser = eventBus.subscribeUser(req.user.id, res);

    req.on('close', () => {
      unsubscribe();
      unsubscribeUser();
      try { res.end(); } catch (_) {}
    });
  } catch (e) {
    console.error('GET /api/events error:', e);
    try { res.end(); } catch (_) {}
  }
});

// ===== 招待リンク受信（Cookie保存）=====

app.get('/invite/:token', (req, res) => {
  const token = req.params.token;
  if (!/^[A-Za-z0-9]+$/.test(token)) return res.redirect('/');
  res.cookie(INVITE_COOKIE, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    signed:   false,
    maxAge:   INVITE_COOKIE_MAX_AGE,
    path:     '/',
  });
  res.redirect('/');
});

// ===== パスワードリセット =====

app.post('/api/auth/password-reset/request', strictLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ ok: false, error: 'メールアドレスを入力してください' });

    const user = await userStore.findByEmail(email);
    if (!user) {
      if (IS_DEV) console.log(`[password-reset] 該当ユーザーなし: ${email}`);
      return res.json({ ok: true });
    }
    if (!user.passwordHash) {
      if (IS_DEV) console.log(`[password-reset] Google 専用アカウントのためスキップ: ${email}`);
      return res.json({ ok: true });
    }

    const token = newToken();
    const passwordReset = { token, expiresAt: Date.now() + RESET_TTL_MS, requestedAt: Date.now() };
    await userStore.update(user.id, { passwordReset });

    const origin   = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${origin}/reset-password/${token}`;
    const mail = await sendPasswordResetEmail(email, resetUrl);

    res.json({ ok: true, devUrl: mail.devUrl, mailError: mail.ok ? null : mail.error });
  } catch (e) {
    console.error('password-reset/request error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.get('/api/auth/password-reset/verify/:token', strictLimiter, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[a-f0-9]{32,}$/.test(token)) return res.status(400).json({ ok: false, error: 'invalid_token' });

    const user = await userStore.findByPasswordResetToken(token);
    if (!user) return res.status(404).json({ ok: false, error: 'token_not_found' });
    if (user.passwordReset.expiresAt < Date.now()) return res.status(410).json({ ok: false, error: 'token_expired' });

    res.json({ ok: true, email: user.emailLower });
  } catch (e) {
    console.error('password-reset/verify error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/auth/password-reset/confirm', strictLimiter, async (req, res) => {
  try {
    const token       = String(req.body?.token       || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!/^[a-f0-9]{32,}$/.test(token)) return res.status(400).json({ ok: false, error: 'invalid_token' });
    const pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ ok: false, errors: { newPassword: pwErr } });

    const user = await userStore.findByPasswordResetToken(token);
    if (!user) return res.status(404).json({ ok: false, error: 'token_not_found' });
    if (user.passwordReset.expiresAt < Date.now()) return res.status(410).json({ ok: false, error: 'token_expired' });

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await sessionStore.deleteAllForUser(user.id);
    await userStore.update(user.id, { passwordHash: newHash, passwordReset: null });

    res.json({ ok: true });
  } catch (e) {
    console.error('password-reset/confirm error:', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました' });
  }
});

// ===== SPA フォールバック =====

app.get('*', (_req, res) => {
  // エントリ HTML は常に再検証させる（古い HTML が JS の古い参照を読み込むのを防ぐ）。
  // sendFile(send) は既定で Cache-Control を上書きするため cacheControl:false にして自前指定を効かせる。
  res.set('Cache-Control', 'no-cache');
  res.sendFile(require('path').join(__dirname, 'public', 'index.html'), { cacheControl: false });
});

// ===== 起動 =====

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDb();

  const server = app.listen(PORT, () => {
    eventBus.startHeartbeat();
    console.log(`✅ サーバー起動: http://localhost:${PORT}  ${IS_DEV ? '[DEV]' : '[PROD]'}`);
    logTransportStatus();
    if (googleAuthClient) {
      console.log(`🔵 Google サインイン: 有効 (clientId=${process.env.GOOGLE_CLIENT_ID.slice(0, 20)}...)`);
    } else {
      console.log(`🔵 Google サインイン: 無効（GOOGLE_CLIENT_ID 未設定）`);
    }
    if (IS_DEV) console.log(`   開発モード: OTPはサーバーログ＆画面にも表示されます\n`);
  });

  // SIGTERM ハンドラ（Render のデプロイ・スケールダウン時）
  // Render はデフォルト 10 秒待ってから SIGKILL を送る。
  // SSE 接続を先に閉じ、新規接続受付を停止してから DB を切断する。
  process.on('SIGTERM', () => {
    console.log('[SIGTERM] グレースフルシャットダウン開始...');

    // SSE 接続を全部閉じる（クライアントが再接続する）
    eventBus.closeAll?.();

    // 強制終了タイムアウト：8 秒以内に完了しなければ強制終了
    const forceExit = setTimeout(() => {
      console.warn('[SIGTERM] タイムアウト — 強制終了');
      process.exit(1);
    }, 8_000);
    forceExit.unref(); // タイマーだけが残ってもプロセスを維持しない

    server.close(async () => {
      clearTimeout(forceExit);
      try { await closeDb(); } catch (_) {}
      console.log('[SIGTERM] シャットダウン完了');
      process.exit(0);
    });
  });
}

start().catch(e => {
  console.error('[fatal] 起動失敗:', e);
  process.exit(1);
});
