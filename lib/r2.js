// lib/r2.js — Cloudflare R2 アップロードヘルパ
// @aws-sdk/client-s3 を使用（R2 は S3 互換 API）。
//
// 必要な環境変数:
//   R2_ACCOUNT_ID  — Cloudflare アカウント ID
//   R2_ACCESS_KEY  — R2 API トークンのアクセスキー ID
//   R2_SECRET_KEY  — R2 API トークンのシークレットアクセスキー
//   R2_BUCKET      — バケット名
//   R2_PUBLIC_URL  — 公開 URL プレフィックス（例: https://pub-xxx.r2.dev）
//                    ※ 末尾スラッシュなし
//
// R2 が未設定の場合は isConfigured() === false となり、
// 呼び出し元はフォールバック（dataURL のまま保存）できる。

'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET     = process.env.R2_BUCKET;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

/**
 * R2 が正しく設定されているか。
 * false の場合は R2 を使わずにフォールバック動作をする。
 */
function isConfigured() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET && R2_PUBLIC_URL);
}

/** S3Client インスタンスを都度生成（接続プールは SDK 内部で管理） */
function _client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });
}

/**
 * Buffer を R2 にアップロードし、公開 URL を返す。
 * @param {Buffer} buffer
 * @param {string} key        オブジェクトキー（例: 'avatars/user123.jpg'）
 * @param {string} contentType
 * @returns {Promise<string>} 公開 URL
 */
async function uploadBuffer(buffer, key, contentType) {
  await _client().send(new PutObjectCommand({
    Bucket:      R2_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

/**
 * dataURL（base64 エンコード）を R2 にアップロードし、公開 URL を返す。
 * @param {string} dataUrl  data:image/jpeg;base64,... 形式
 * @param {string} key
 * @returns {Promise<string>} 公開 URL
 */
async function uploadDataUrl(dataUrl, key) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error('[r2] Invalid dataURL');
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return uploadBuffer(buffer, key, contentType);
}

/**
 * R2 からオブジェクトを削除する。存在しない場合はエラーを無視。
 * @param {string} key
 */
async function deleteObject(key) {
  try {
    await _client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (e) {
    // 404 / NoSuchKey は無視
    if (e?.name !== 'NoSuchKey') throw e;
  }
}

/**
 * 公開 URL からオブジェクトキーを抽出する。
 * R2 URL 以外の文字列（dataURL, https://lh3.googleusercontent.com/... など）は null を返す。
 * @param {string} url
 * @returns {string|null}
 */
function urlToKey(url) {
  if (!url || !R2_PUBLIC_URL) return null;
  if (!url.startsWith(R2_PUBLIC_URL + '/')) return null;
  return url.slice(R2_PUBLIC_URL.length + 1);
}

/**
 * ランダムなファイル名サフィックスを生成（衝突回避用）
 * @returns {string}
 */
function randomSuffix() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { isConfigured, uploadBuffer, uploadDataUrl, deleteObject, urlToKey, randomSuffix };
