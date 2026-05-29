#!/usr/bin/env node
// scripts/test-email.js — Gmail 送信テスト
// 実行: node scripts/test-email.js <送信先メールアドレス>
// 例:   node scripts/test-email.js test@example.com

'use strict';

try { require('dotenv').config(); } catch (_) {}

const nodemailer = require('nodemailer');

const TO   = process.argv[2];
const USER = process.env.GMAIL_USER;
const PASS = process.env.GMAIL_APP_PASSWORD;
const MODE = process.env.MAIL_TRANSPORT || 'console';

console.log('=== Gmail 送信テスト ===');
console.log('MAIL_TRANSPORT :', MODE);
console.log('GMAIL_USER     :', USER || '(未設定)');
console.log('GMAIL_APP_PASSWORD :', PASS ? `設定済み (${PASS.length}文字)` : '(未設定)');
console.log('送信先         :', TO || '(引数なし)');
console.log('');

if (!TO) {
  console.error('使い方: node scripts/test-email.js <送信先メールアドレス>');
  process.exit(1);
}
if (!USER || !PASS) {
  console.error('❌ GMAIL_USER / GMAIL_APP_PASSWORD が .env に設定されていません');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: USER, pass: PASS },
});

console.log('接続確認中...');
transporter.verify((err, success) => {
  if (err) {
    console.error('❌ 接続失敗:', err.message);
    console.error('');
    console.error('よくある原因:');
    console.error('  1. アプリパスワードが正しくない（Google アカウント → セキュリティ → アプリパスワードで再生成）');
    console.error('  2. 2段階認証が無効（アプリパスワードには2段階認証が必須）');
    console.error('  3. Googleアカウントがアプリパスワードをブロック中（https://myaccount.google.com/security でアクセス確認）');
    process.exit(1);
  }

  console.log('✅ Gmail 接続成功。テストメール送信中...');
  transporter.sendMail({
    from: USER,
    to:   TO,
    subject: '[evecre] テストメール',
    text: 'このメールが届いていれば、Gmail 送信設定は正しく動作しています。',
  }, (err2, info) => {
    if (err2) {
      console.error('❌ 送信失敗:', err2.message);
      process.exit(1);
    }
    console.log('✅ 送信成功:', info.messageId);
    console.log('   受信箱（またはスパム）を確認してください。');
  });
});
