// ===== メール送信モジュール =====
// .env で MAIL_TRANSPORT を切替:
//   - 'console' (default): コンソール出力のみ。dev時 devCode を返す
//   - 'gmail'    : Gmail SMTP (要 GMAIL_USER, GMAIL_APP_PASSWORD)
//   - 'smtp'     : 汎用 SMTP (要 SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
//   - 'sendgrid' : SendGrid SMTP (要 SENDGRID_API_KEY)
//   - 'resend'   : Resend SMTP (要 RESEND_API_KEY)

const nodemailer = require('nodemailer');

const TRANSPORT_KIND = (process.env.MAIL_TRANSPORT || 'console').toLowerCase();
const FROM_ADDRESS   = process.env.MAIL_FROM || process.env.GMAIL_USER || 'noreply@evecre.local';
const APP_NAME       = process.env.MAIL_APP_NAME || 'evecre';
const IS_DEV         = process.env.NODE_ENV !== 'production';

let _transporter = null;
let _initError   = null;

/**
 * トランスポーター初期化（遅延：最初のsendOtpEmail時）
 */
function _getTransporter() {
  if (_transporter || _initError) return _transporter;

  try {
    switch (TRANSPORT_KIND) {
      case 'gmail': {
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
          throw new Error('GMAIL_USER と GMAIL_APP_PASSWORD を .env に設定してください');
        }
        _transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
          },
        });
        break;
      }
      case 'sendgrid': {
        if (!process.env.SENDGRID_API_KEY) {
          throw new Error('SENDGRID_API_KEY を .env に設定してください');
        }
        _transporter = nodemailer.createTransport({
          host: 'smtp.sendgrid.net',
          port: 587,
          secure: false,
          auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
        });
        break;
      }
      case 'resend': {
        if (!process.env.RESEND_API_KEY) {
          throw new Error('RESEND_API_KEY を .env に設定してください');
        }
        _transporter = nodemailer.createTransport({
          host: 'smtp.resend.com',
          port: 587,
          secure: false,
          auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
        });
        break;
      }
      case 'smtp': {
        if (!process.env.SMTP_HOST) {
          throw new Error('SMTP_HOST を .env に設定してください');
        }
        _transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          } : undefined,
        });
        break;
      }
      case 'console':
      default:
        _transporter = null; // 明示的に null
        break;
    }
  } catch (e) {
    _initError = e;
    console.error('❌ メール送信の初期化に失敗:', e.message);
  }
  return _transporter;
}

/**
 * OTP メール送信
 * @param {string} to
 * @param {string} code
 * @param {string} purpose
 * @returns {Promise<{ok:boolean, devCode?:string, error?:string}>}
 */
async function sendOtpEmail(to, code, purpose) {
  const subject = `[${APP_NAME}] ${purpose}の認証コード`;
  const text =
`${purpose}の認証コードをお送りします。

  認証コード: ${code}

このコードは10分間有効です。
心当たりのない場合はこのメールを無視してください。

---
${APP_NAME}`;

  const html = `
<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #484545;">
  <h1 style="font-size: 18px; margin: 0 0 16px;">${_esc(purpose)}の認証コード</h1>
  <p style="font-size: 14px; line-height: 1.7; margin: 0 0 24px;">下のコードを入力して認証を完了してください。</p>
  <div style="background: #FDFBF8; border: 2px solid #0CA1E3; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 24px;">
    <div style="font-size: 32px; font-weight: bold; letter-spacing: 0.4em; color: #0CA1E3; font-family: 'SF Mono', Menlo, monospace;">
      ${_esc(code)}
    </div>
  </div>
  <p style="font-size: 12px; color: #A7AAAC; margin: 0;">このコードは10分間有効です。心当たりのない場合はこのメールを無視してください。</p>
  <hr style="border: none; border-top: 1px solid #E1DFDC; margin: 24px 0;">
  <p style="font-size: 11px; color: #A7AAAC; margin: 0;">${_esc(APP_NAME)}</p>
</div>`;

  // コンソール出力（常に。デバッグ用）
  if (IS_DEV) {
    const banner = '═'.repeat(60);
    console.log(`\n${banner}`);
    console.log(`  📧  ${purpose} 認証コード`);
    console.log(`  宛先: ${to}`);
    console.log(`  コード: ${code}（10分有効）`);
    console.log(`${banner}\n`);
  }

  // トランスポート未設定 → console モード
  const tx = _getTransporter();
  if (!tx) {
    if (TRANSPORT_KIND !== 'console') {
      console.warn(`⚠ MAIL_TRANSPORT=${TRANSPORT_KIND} ですが初期化失敗のためメール未送信`);
    }
    // dev時のみ devCode を返す（画面表示用）
    return { ok: true, devCode: IS_DEV ? code : undefined };
  }

  // 実送信
  try {
    const info = await tx.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      text,
      html,
    });
    console.log(`✅ メール送信成功: messageId=${info.messageId} → ${to}`);
    return { ok: true, devCode: IS_DEV ? code : undefined };
  } catch (e) {
    console.error(`❌ メール送信失敗 (${to}):`, e.message);
    return {
      ok: false,
      error: e.message,
      devCode: IS_DEV ? code : undefined, // 失敗してもdev時は画面で確認できるように
    };
  }
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * パスワードリセットリンクをメール送信
 * @param {string} to
 * @param {string} resetUrl   例: http://localhost:3000/reset-password/<token>
 * @returns {Promise<{ok:boolean, error?:string, devUrl?:string}>}
 */
async function sendPasswordResetEmail(to, resetUrl) {
  const subject = `[${APP_NAME}] パスワードリセットのご案内`;
  const text =
`パスワードリセットのリクエストを受け付けました。

下記のリンクをクリックして、新しいパスワードを設定してください。
${resetUrl}

このリンクは30分間有効です。
心当たりのない場合は、このメールを無視してください。

---
${APP_NAME}`;

  const html = `
<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #484545;">
  <h1 style="font-size: 18px; margin: 0 0 16px;">パスワードリセットのご案内</h1>
  <p style="font-size: 14px; line-height: 1.7; margin: 0 0 24px;">下のボタンから新しいパスワードを設定してください。</p>
  <div style="text-align: center; margin: 0 0 24px;">
    <a href="${_esc(resetUrl)}" style="display: inline-block; background: #0CA1E3; color: #fff; font-weight: bold; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-size: 14px;">パスワードを再設定する</a>
  </div>
  <p style="font-size: 11px; color: #A7AAAC; margin: 0 0 8px;">ボタンが押せない場合は、下のURLをコピーしてブラウザに貼り付けてください:</p>
  <p style="font-size: 11px; color: #484545; word-break: break-all; margin: 0 0 24px;">${_esc(resetUrl)}</p>
  <p style="font-size: 12px; color: #A7AAAC; margin: 0;">このリンクは30分間有効です。心当たりのない場合はこのメールを無視してください。</p>
  <hr style="border: none; border-top: 1px solid #E1DFDC; margin: 24px 0;">
  <p style="font-size: 11px; color: #A7AAAC; margin: 0;">${_esc(APP_NAME)}</p>
</div>`;

  if (IS_DEV) {
    const banner = '═'.repeat(60);
    console.log(`\n${banner}`);
    console.log(`  📧  パスワードリセット URL`);
    console.log(`  宛先: ${to}`);
    console.log(`  URL: ${resetUrl}（30分有効）`);
    console.log(`${banner}\n`);
  }

  const tx = _getTransporter();
  if (!tx) {
    return { ok: true, devUrl: IS_DEV ? resetUrl : undefined };
  }

  try {
    const info = await tx.sendMail({ from: FROM_ADDRESS, to, subject, text, html });
    console.log(`✅ パスワードリセットメール送信成功: messageId=${info.messageId} → ${to}`);
    return { ok: true, devUrl: IS_DEV ? resetUrl : undefined };
  } catch (e) {
    console.error(`❌ パスワードリセットメール送信失敗 (${to}):`, e.message);
    return { ok: false, error: e.message, devUrl: IS_DEV ? resetUrl : undefined };
  }
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * 起動時にトランスポーターの状態をログ
 */
function logTransportStatus() {
  console.log(`📧 メール送信モード: ${TRANSPORT_KIND}`);
  if (TRANSPORT_KIND === 'console') {
    console.log('   コンソール出力のみ。実際のメールは送信されません。');
    console.log('   実送信を有効化するには .env で MAIL_TRANSPORT=gmail 等を設定してください。');
  } else {
    const tx = _getTransporter();
    if (tx) {
      console.log(`   送信元: ${FROM_ADDRESS}`);
    } else {
      console.log(`   ❌ 初期化失敗: ${_initError?.message || '不明'}`);
    }
  }
}

module.exports = { sendOtpEmail, sendPasswordResetEmail, generateOtp, IS_DEV, logTransportStatus };
