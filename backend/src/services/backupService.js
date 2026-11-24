// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * SQLite Automated Backup Service + PostgreSQL WAL-G PITR Orchestration
 *
 * Backup format: <s3-prefix>/backup-<ISO-timestamp>.tar.gz.enc
 * Encryption:    AES-256-GCM (streaming). Payload layout: "SGCM1" + 12-byte IV
 *                + ciphertext + 16-byte auth tag. Legacy AES-256-CBC backups
 *                (raw 16-byte IV prefix) can still be restored for compatibility.
 *
 * Key management:
 *   - Preferred: decrypt a data key via AWS KMS (BACKUP_KMS_KEY_ID /
 *     BACKUP_KMS_ENCRYPTED_KEY_B64) or fetch from HashiCorp Vault
 *     (BACKUP_VAULT_ADDR + BACKUP_VAULT_SECRET_PATH [+ token/field]).
 *   - BACKUP_ENCRYPTION_KEY (hex) is supported only as an explicitly
 *     acknowledged fallback and must never be committed to source control.
 *
 * ─── RESTORE PROCEDURE ────────────────────────────────────────────────────────
 *
 * Prerequisites
 *   • Encryption key available via KMS, Vault, or BACKUP_ENCRYPTION_KEY
 *   • AWS credentials with s3:GetObject permission (for S3 restores)
 *
 * Step 1 — Download the backup from S3
 *   aws s3 cp s3://<BUCKET>/<PREFIX>/backup-<TIMESTAMP>.tar.gz.enc /tmp/backup.tar.gz.enc
 *
 * Step 2a — Restore via CLI (recommended)
 *   node backend/src/services/backupService.js restore \
 *     --source /tmp/backup.tar.gz.enc \
 *     --destination /tmp/db-restore/
 *
 * Step 2b — Restore programmatically
 *   import { restoreFromFile } from './backupService.js';
 *   await restoreFromFile({ sourcePath: '/tmp/backup.tar.gz.enc', destDir: '/tmp/db-restore/' });
 *
 * Step 3 — Swap the restored file into production
 *   cp /tmp/db-restore/snapshot-<TIMESTAMP>.sqlite /path/to/database.sqlite
 *
 * See `backend/scripts/backup/README.md` for the operational runbook.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Transform } from 'stream';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { chmod, mkdir, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { execFile } from 'child_process';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import * as tar from 'tar';
import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getDatabase } from '../database/connection.js';
import logger from '../utils/logger.js';
import { alertManager } from '../utils/alerting.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_MAGIC = Buffer.from('SGCM1');
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const AES_KEY_LENGTH = 32;

// Legacy CBC support for restoring older backups
const LEGACY_CBC_ALGORITHM = 'aes-256-cbc';
const LEGACY_CBC_IV_LENGTH = 16;

const WALG_SCRIPT_PATH =
  process.env.WALG_SCRIPT_PATH ||
  path.resolve(_dirname, '../../scripts/backup/walGPostgres.sh');

let _cachedKeyMaterial = null;

// ─── Crypto Transforms (AES-256-GCM) ─────────────────────────────────────────

export class AES256GcmEncryptTransform extends Transform {
  constructor(key, options) {
    super(options);
    this._iv = randomBytes(GCM_IV_LENGTH);
    this._cipher = createCipheriv(GCM_ALGORITHM, key, this._iv);
    this._headerSent = false;
  }

  _transform(chunk, _encoding, callback) {
    try {
      if (!this._headerSent) {
        this._headerSent = true;
        this.push(Buffer.concat([GCM_MAGIC, this._iv]));
      }
      const encrypted = this._cipher.update(chunk);
      if (encrypted.length) this.push(encrypted);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      const final = this._cipher.final();
      if (final.length) this.push(final);
      this.push(this._cipher.getAuthTag());
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

export class AES256GcmDecryptTransform extends Transform {
  constructor(key, options) {
    super(options);
    this._key = key;
    this._headerDone = false;
    this._buffer = Buffer.alloc(0);
    this._decipher = null;
  }

  _transform(chunk, _encoding, callback) {
    try {
      this._buffer = Buffer.concat([this._buffer, chunk]);
      if (!this._headerDone) {
        const headerLen = GCM_MAGIC.length + GCM_IV_LENGTH;
        if (this._buffer.length < headerLen) return callback();
        const magic = this._buffer.subarray(0, GCM_MAGIC.length);
        if (!magic.equals(GCM_MAGIC)) {
          return callback(
            new Error('Unsupported backup format: expected AES-256-GCM payload')
          );
        }
        const iv = this._buffer.subarray(
          GCM_MAGIC.length,
          GCM_MAGIC.length + GCM_IV_LENGTH
        );
        this._decipher = createDecipheriv(GCM_ALGORITHM, this._key, iv);
        this._buffer = this._buffer.subarray(headerLen);
        this._headerDone = true;
      }

      if (this._buffer.length > GCM_TAG_LENGTH) {
        const toDecipher = this._buffer.subarray(
          0,
          this._buffer.length - GCM_TAG_LENGTH
        );
        this._buffer = this._buffer.subarray(this._buffer.length - GCM_TAG_LENGTH);
        if (toDecipher.length) {
          const decrypted = this._decipher.update(toDecipher);
          if (decrypted.length) this.push(decrypted);
        }
      }
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      if (!this._decipher) {
        return callback(new Error('Invalid encrypted backup payload'));
      }
      if (this._buffer.length !== GCM_TAG_LENGTH) {
        return callback(new Error('Invalid GCM authentication tag'));
      }
      this._decipher.setAuthTag(this._buffer);
      const final = this._decipher.final();
      if (final.length) this.push(final);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

// ─── Legacy CBC decrypt (restore compatibility) ──────────────────────────────

class AES256CbcDecryptTransform extends Transform {
  constructor(key, options) {
    super(options);
    this._key = key;
    this._decipher = null;
    this._ivChunks = [];
    this._ivBytesRead = 0;
  }

  _transform(chunk, _encoding, callback) {
    try {
      if (this._decipher) {
        const decrypted = this._decipher.update(chunk);
        if (decrypted.length) this.push(decrypted);
        return callback();
      }

      this._ivChunks.push(chunk);
      this._ivBytesRead += chunk.length;

      if (this._ivBytesRead >= LEGACY_CBC_IV_LENGTH) {
        const all = Buffer.concat(this._ivChunks);
        const iv = all.subarray(0, LEGACY_CBC_IV_LENGTH);
        const remainder = all.subarray(LEGACY_CBC_IV_LENGTH);
        this._decipher = createDecipheriv(LEGACY_CBC_ALGORITHM, this._key, iv);
        this._ivChunks = null;
        if (remainder.length) {
          const decrypted = this._decipher.update(remainder);
          if (decrypted.length) this.push(decrypted);
        }
      }
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      if (this._decipher) {
        const final = this._decipher.final();
        if (final.length) this.push(final);
      }
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

/**
 * Detects backup format and returns the appropriate decrypt transform.
 * GCM backups start with magic "SGCM1"; legacy CBC backups start with a raw IV.
 */
export async function createDecryptTransformForFile(sourcePath, key) {
  const fd = await (await import('fs/promises')).open(sourcePath, 'r');
  try {
    const probe = Buffer.alloc(GCM_MAGIC.length);
    const { bytesRead } = await fd.read(probe, 0, GCM_MAGIC.length, 0);
    if (bytesRead === GCM_MAGIC.length && probe.equals(GCM_MAGIC)) {
      return new AES256GcmDecryptTransform(key);
    }
    return new AES256CbcDecryptTransform(key);
  } finally {
    await fd.close();
  }
}

// ─── Key management (KMS / Vault) ────────────────────────────────────────────

function parseKeyBytes(raw, source) {
  if (!raw) throw new Error(`Empty encryption key material from ${source}`);
  let buf;
  const trimmed = String(raw).trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === AES_KEY_LENGTH * 2) {
    buf = Buffer.from(trimmed, 'hex');
  } else {
    buf = Buffer.from(trimmed, 'base64');
  }
  if (buf.length !== AES_KEY_LENGTH) {
    throw new Error(
      `Encryption key from ${source} must be ${AES_KEY_LENGTH} bytes (got ${buf.length})`
    );
  }
  return buf;
}

async function resolveKeyFromKms() {
  const keyId = process.env.BACKUP_KMS_KEY_ID;
  const encryptedB64 = process.env.BACKUP_KMS_ENCRYPTED_KEY_B64;
  if (!keyId && !encryptedB64) return null;

  const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
  const client = new KMSClient({ region: process.env.BACKUP_KMS_REGION || process.env.BACKUP_S3_REGION || process.env.AWS_REGION || 'us-east-1' });

  if (encryptedB64) {
    const res = await client.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedB64, 'base64'),
        KeyId: keyId || undefined,
      })
    );
    if (!res.Plaintext) throw new Error('KMS Decrypt returned empty plaintext');
    const buf = Buffer.from(res.Plaintext);
    if (buf.length !== AES_KEY_LENGTH) {
      throw new Error(`KMS-decrypted key must be ${AES_KEY_LENGTH} bytes`);
    }
    return buf;
  }

  // If only a key id is provided, generate and immediately decrypt a data key
  // for use as process-local material (caller should prefer encrypted blobs).
  const { GenerateDataKeyCommand } = await import('@aws-sdk/client-kms');
  const res = await client.send(
    new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' })
  );
  if (!res.Plaintext) throw new Error('KMS GenerateDataKey returned empty plaintext');
  return Buffer.from(res.Plaintext);
}

async function resolveKeyFromVault() {
  const addr = process.env.BACKUP_VAULT_ADDR;
  const secretPath = process.env.BACKUP_VAULT_SECRET_PATH;
  if (!addr || !secretPath) return null;

  const token = process.env.BACKUP_VAULT_TOKEN;
  const namespace = process.env.BACKUP_VAULT_NAMESPACE;
  const field = process.env.BACKUP_VAULT_SECRET_FIELD || 'key';
  const url = `${addr.replace(/\/$/, '')}/v1/${secretPath.replace(/^\//, '')}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Vault-Token'] = token;
  if (namespace) headers['X-Vault-Namespace'] = namespace;

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`Vault key fetch failed (${resp.status})`);
  }
  const body = await resp.json();
  const data = body?.data?.data || body?.data || {};
  return parseKeyBytes(data[field], `Vault ${secretPath}:${field}`);
}

async function resolveEncryptionKeyMaterial({ forceRefresh = false } = {}) {
  if (_cachedKeyMaterial && !forceRefresh) return _cachedKeyMaterial;

  const kmsKey = await resolveKeyFromKms();
  if (kmsKey) {
    _cachedKeyMaterial = kmsKey;
    return kmsKey;
  }

  const vaultKey = await resolveKeyFromVault();
  if (vaultKey) {
    _cachedKeyMaterial = vaultKey;
    return vaultKey;
  }

  const hexKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (hexKey) {
    logger.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'backup:key:insecure_env',
        hint: 'Configure BACKUP_KMS_KEY_ID/BACKUP_KMS_ENCRYPTED_KEY_B64 or BACKUP_VAULT_ADDR+BACKUP_VAULT_SECRET_PATH for managed key storage.',
      })
    );
    _cachedKeyMaterial = parseKeyBytes(hexKey, 'BACKUP_ENCRYPTION_KEY');
    return _cachedKeyMaterial;
  }

  throw new Error(
    'Backup encryption key is required. Configure AWS KMS (BACKUP_KMS_KEY_ID or BACKUP_KMS_ENCRYPTED_KEY_B64) or HashiCorp Vault (BACKUP_VAULT_ADDR, BACKUP_VAULT_SECRET_PATH).'
  );
}

export function clearCachedBackupKey() {
  _cachedKeyMaterial = null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function getConfig() {
  const retentionDaysRaw =
    process.env.BACKUP_RETENTION_DAYS || process.env.BACKUP_RETENTION_COUNT;
  const retentionDays = Math.max(1, parseInt(retentionDaysRaw, 10) || 30);
  return {
    s3Bucket: process.env.BACKUP_S3_BUCKET,
    s3Prefix: process.env.BACKUP_S3_PREFIX || 'sqlite-backups/',
    s3Region: process.env.BACKUP_S3_REGION || 'us-east-1',
    tempDir:
      process.env.BACKUP_TEMP_DIR || path.join(os.tmpdir(), 'db-backups'),
    retentionDays,
  };
}

function assertS3Config(cfg) {
  if (!cfg.s3Bucket) {
    throw new Error(
      'Backup service misconfigured — missing env var: BACKUP_S3_BUCKET'
    );
  }
}

async function getEncryptionKey(cfg) {
  // cfg retained for API compatibility; key resolution uses secure providers.
  void cfg;
  return resolveEncryptionKeyMaterial();
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

function buildTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function buildS3Key(prefix, timestamp) {
  return `${prefix}backup-${timestamp}.tar.gz.enc`;
}

async function createDatabaseSnapshot(snapshotPath) {
  const db = getDatabase();
  // VACUUM INTO creates an atomic, consistent copy that is safe in WAL mode
  // without blocking concurrent reads or writes.
  await db.run('VACUUM INTO ?', [snapshotPath]);
  try {
    await chmod(snapshotPath, 0o600);
  } catch {
    // Best-effort on platforms/filesystems that do not support POSIX modes.
  }
}

async function streamUploadToS3(s3Client, bucket, key, bodyStream, metadata) {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: bodyStream,
      ContentType: 'application/octet-stream',
      Metadata: metadata,
      ServerSideEncryption: 'AES256',
    },
    queueSize: 4,
    partSize: 5 * 1024 * 1024, // 5 MB parts
  });
  return upload.done();
}

async function verifyS3Object(s3Client, bucket, key) {
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key })
  );
  return { etag: head.ETag, contentLength: head.ContentLength };
}

async function pruneOldBackups(s3Client, bucket, prefix, retentionDays) {
  const objects = [];
  let token;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    objects.push(...(res.Contents || []));
    token = res.NextContinuationToken;
  } while (token);

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const toDelete = objects.filter((o) => {
    if (!o.LastModified) return false;
    return new Date(o.LastModified).getTime() < cutoff;
  });

  if (!toDelete.length) return 0;

  // DeleteObjects supports up to 1000 keys per request.
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((o) => ({ Key: o.Key })),
          Quiet: true,
        },
      })
    );
  }

  return toDelete.length;
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _lastResult = null;

export async function runBackup() {
  const cfg = getConfig();
  assertS3Config(cfg);

  const timestamp = buildTimestamp();
  const snapshotFile = path.join(cfg.tempDir, `snapshot-${timestamp}.sqlite`);
  const s3Key = buildS3Key(cfg.s3Prefix, timestamp);
  const encKey = await getEncryptionKey(cfg);

  logger.info(
    JSON.stringify({ level: 'info', msg: 'backup:start', timestamp, s3Key })
  );

  try {
    await mkdir(cfg.tempDir, { recursive: true, mode: 0o700 });
    try {
      await chmod(cfg.tempDir, 0o700);
    } catch {
      // Best-effort on non-POSIX filesystems.
    }

    // 1. Point-in-time snapshot — non-blocking in WAL mode
    logger.info(
      JSON.stringify({
        level: 'info',
        msg: 'backup:snapshot',
        file: snapshotFile,
      })
    );
    await createDatabaseSnapshot(snapshotFile);

    // 2. tar.gz → AES-256-GCM encrypt → S3 multipart upload (streaming)
    const s3Client = new S3Client({ region: cfg.s3Region });
    const encryptTransform = new AES256GcmEncryptTransform(encKey);

    const archiveStream = tar.create(
      { gzip: true, cwd: path.dirname(snapshotFile), portable: true },
      [path.basename(snapshotFile)]
    );

    // Propagate archive errors into the encrypt stream so the S3 upload aborts
    archiveStream.on('error', (err) => encryptTransform.destroy(err));
    archiveStream.pipe(encryptTransform);

    logger.info(
      JSON.stringify({ level: 'info', msg: 'backup:upload:start', s3Key })
    );
    await streamUploadToS3(s3Client, cfg.s3Bucket, s3Key, encryptTransform, {
      'backup-timestamp': timestamp,
      'backup-algorithm': GCM_ALGORITHM,
      'backup-format': 'tar.gz.enc.sgcm1',
      'backup-key-provider': process.env.BACKUP_KMS_KEY_ID
        ? 'aws-kms'
        : process.env.BACKUP_VAULT_ADDR
          ? 'hashicorp-vault'
          : 'env-fallback',
    });

    // 3. Verify the object landed in S3
    const { etag, contentLength } = await verifyS3Object(
      s3Client,
      cfg.s3Bucket,
      s3Key
    );
    logger.info(
      JSON.stringify({
        level: 'info',
        msg: 'backup:verified',
        s3Key,
        etag,
        contentLength,
      })
    );

    // 4. Prune backups older than the retention window (default 30 days)
    const deleted = await pruneOldBackups(
      s3Client,
      cfg.s3Bucket,
      cfg.s3Prefix,
      cfg.retentionDays
    );
    if (deleted > 0) {
      logger.info(
        JSON.stringify({
          level: 'info',
          msg: 'backup:pruned',
          count: deleted,
          retentionDays: cfg.retentionDays,
        })
      );
    }

    const result = {
      success: true,
      s3Key,
      timestamp,
      etag,
      contentLength,
      encrypted: true,
      algorithm: GCM_ALGORITHM,
      retentionDays: cfg.retentionDays,
    };
    _lastResult = { ...result, completedAt: new Date().toISOString() };
    logger.info(
      JSON.stringify({ level: 'info', msg: 'backup:complete', ...result })
    );
    return result;
  } catch (err) {
    const failure = { success: false, error: err.message, timestamp };
    _lastResult = { ...failure, completedAt: new Date().toISOString() };
    logger.error(
      JSON.stringify({
        level: 'error',
        msg: 'backup:failed',
        error: err.message,
        s3Key,
      })
    );
    alertManager.alert('backup_failed', {
      error: err.message,
      timestamp,
      s3Key,
    });
    throw err;
  } finally {
    await unlink(snapshotFile).catch(() => {});
  }
}

export function getLastBackupResult() {
  return _lastResult;
}

/**
 * Decrypt and extract a backup archive from a local file.
 *
 * @param {object} opts
 * @param {string} opts.sourcePath  Path to the .tar.gz.enc backup file
 * @param {string} opts.destDir     Directory where the SQLite file will be extracted
 */
export async function restoreFromFile({ sourcePath, destDir }) {
  const encKey = await resolveEncryptionKeyMaterial();
  await mkdir(destDir, { recursive: true });

  const decryptTransform = await createDecryptTransformForFile(sourcePath, encKey);
  const sourceStream = createReadStream(sourcePath);
  const extractStream = tar.extract({ cwd: destDir });

  await pipeline(sourceStream, decryptTransform, createGunzip(), extractStream);

  logger.info(
    JSON.stringify({
      level: 'info',
      msg: 'restore:complete',
      sourcePath,
      destDir,
    })
  );
  return { success: true, destDir };
}

export async function verifyBackupFile({ sourcePath, destDir }) {
  const workDir =
    destDir || path.join(os.tmpdir(), `db-restore-verify-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  try {
    await restoreFromFile({ sourcePath, destDir: workDir });
    const { readdir } = await import('fs/promises');
    const files = await readdir(workDir);
    if (!files.length) {
      throw new Error('Restore verification failed: no files extracted');
    }
    logger.info(
      JSON.stringify({
        level: 'info',
        msg: 'restore:verify:complete',
        sourcePath,
        files: files.length,
      })
    );
    return { success: true, files };
  } finally {
    if (!destDir) {
      const { rm } = await import('fs/promises');
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ─── PostgreSQL WAL-G orchestration ───────────────────────────────────────────

function runWalGScript(args, { timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      WALG_SCRIPT_PATH,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const wrapped = new Error(
            `walGPostgres.sh ${args.join(' ')} failed: ${err.message}`
          );
          wrapped.stdout = stdout;
          wrapped.stderr = stderr;
          return reject(wrapped);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * Trigger a full PostgreSQL base backup via WAL-G.
 * Encrypted client-side with GPG before being pushed to object storage.
 */
export async function runPostgresBaseBackup() {
  const startedAt = new Date().toISOString();
  logger.info(
    JSON.stringify({ level: 'info', msg: 'pg_backup:start', startedAt })
  );
  try {
    const { stdout } = await runWalGScript(['base-backup']);
    const result = { success: true, startedAt, stdout: stdout.trim() };
    logger.info(
      JSON.stringify({ level: 'info', msg: 'pg_backup:complete', startedAt })
    );
    return result;
  } catch (err) {
    logger.error(
      JSON.stringify({
        level: 'error',
        msg: 'pg_backup:failed',
        error: err.message,
      })
    );
    alertManager.alert('pg_backup_failed', {
      error: err.message,
      startedAt,
    });
    throw err;
  }
}

/**
 * Restore PostgreSQL to a specific point in time.
 *
 * @param {object} opts
 * @param {string} opts.targetTime  RFC3339 timestamp, e.g. "2026-01-15T12:34:56Z"
 * @param {string} [opts.targetDir] Optional isolated restore directory
 */
export async function runPostgresPitr({ targetTime, targetDir } = {}) {
  if (!targetTime) {
    throw new Error('runPostgresPitr requires a targetTime (RFC3339)');
  }
  const args = ['pitr', '--target-time', targetTime];
  if (targetDir) args.push('--target-dir', targetDir);

  logger.info(
    JSON.stringify({ level: 'info', msg: 'pg_pitr:start', targetTime })
  );
  try {
    const { stdout } = await runWalGScript(args, { timeoutMs: 60 * 60 * 1000 });
    const result = {
      success: true,
      targetTime,
      targetDir: targetDir || null,
      stdout: stdout.trim(),
    };
    logger.info(
      JSON.stringify({ level: 'info', msg: 'pg_pitr:complete', targetTime })
    );
    return result;
  } catch (err) {
    logger.error(
      JSON.stringify({
        level: 'error',
        msg: 'pg_pitr:failed',
        error: err.message,
        targetTime,
      })
    );
    alertManager.alert('pg_pitr_failed', {
      error: err.message,
      targetTime,
    });
    throw err;
  }
}

/**
 * Run the weekly automated restore drill in an isolated environment.
 * The script performs integrity verification (pg_amcheck / row counts).
 */
export async function runRestoreDrill() {
  const startedAt = new Date().toISOString();
  logger.info(
    JSON.stringify({ level: 'info', msg: 'pg_drill:start', startedAt })
  );
  try {
    const { stdout } = await runWalGScript(['restore-drill'], {
      timeoutMs: 60 * 60 * 1000,
    });
    const result = { success: true, startedAt, stdout: stdout.trim() };
    logger.info(
      JSON.stringify({ level: 'info', msg: 'pg_drill:complete', startedAt })
    );
    return result;
  } catch (err) {
    logger.error(
      JSON.stringify({
        level: 'error',
        msg: 'pg_drill:failed',
        error: err.message,
      })
    );
    alertManager.alert('pg_restore_drill_failed', {
      error: err.message,
      startedAt,
    });
    throw err;
  }
}

/**
 * Inspect WAL archive lag. Emits a Prometheus-backed alert when the
 * number of unarchived WAL segments exceeds the configured threshold
 * (default: 3 consecutive segments).
 */
export async function checkWalArchiveLag({ threshold = 3 } = {}) {
  try {
    const { stdout } = await runWalGScript(['wal-lag', '--json'], {
      timeoutMs: 60 * 1000,
    });
    const parsed = JSON.parse(stdout);
    const lag = Number(parsed.lagSegments) || 0;
    if (lag > threshold) {
      alertManager.alert('wal_archive_lag', {
        lagSegments: lag,
        threshold,
        lastArchived: parsed.lastArchived || null,
      });
    }
    return { success: true, lagSegments: lag, threshold };
  } catch (err) {
    logger.error(
      JSON.stringify({
        level: 'error',
        msg: 'pg_wal_lag:failed',
        error: err.message,
      })
    );
    alertManager.alert('wal_archive_lag_check_failed', {
      error: err.message,
    });
    throw err;
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);

  const flag = (name) => {
    const idx = rest.indexOf(name);
    return idx !== -1 ? rest[idx + 1] : undefined;
  };

  if (command === 'restore') {
    const sourcePath = flag('--source');
    const destDir = flag('--destination');
    if (!sourcePath || !destDir) {
      console.error(
        'Usage: node backupService.js restore --source <file.tar.gz.enc> --destination <dir>'
      );
      process.exit(1);
    }
    restoreFromFile({ sourcePath, destDir })
      .then(() => {
        console.log(`Restore complete → ${destDir}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('Restore failed:', err.message);
        process.exit(1);
      });
  } else if (command === 'verify-restore') {
    const sourcePath = flag('--source');
    const destDir = flag('--destination');
    if (!sourcePath) {
      console.error(
        'Usage: node backupService.js verify-restore --source <file.tar.gz.enc> [--destination <dir>]'
      );
      process.exit(1);
    }
    verifyBackupFile({ sourcePath, destDir })
      .then((r) => {
        console.log(JSON.stringify(r));
        process.exit(0);
      })
      .catch((err) => {
        console.error('Restore verification failed:', err.message);
        process.exit(1);
      });
  } else if (command === 'pg-base-backup') {
    runPostgresBaseBackup()
      .then((r) => {
        console.log(JSON.stringify(r));
        process.exit(0);
      })
      .catch((err) => {
        console.error('PostgreSQL base backup failed:', err.message);
        process.exit(1);
      });
  } else if (command === 'pg-pitr') {
    const targetTime = flag('--target-time');
    const targetDir = flag('--target-dir');
    runPostgresPitr({ targetTime, targetDir })
      .then((r) => {
        console.log(JSON.stringify(r));
        process.exit(0);
      })
      .catch((err) => {
        console.error('PostgreSQL PITR failed:', err.message);
        process.exit(1);
      });
  } else if (command === 'pg-restore-drill') {
    runRestoreDrill()
      .then((r) => {
        console.log(JSON.stringify(r));
        process.exit(0);
      })
      .catch((err) => {
        console.error('PostgreSQL restore drill failed:', err.message);
        process.exit(1);
      });
  } else if (command === 'pg-wal-lag') {
    const threshold = parseInt(flag('--threshold'), 10) || 3;
    checkWalArchiveLag({ threshold })
      .then((r) => {
        console.log(JSON.stringify(r));
        process.exit(0);
      })
      .catch((err) => {
        console.error('WAL lag check failed:', err.message);
        process.exit(1);
      });
  } else {
    console.error(
      'Unknown command. Available commands: restore, verify-restore, pg-base-backup, pg-pitr, pg-restore-drill, pg-wal-lag'
    );
    process.exit(1);
  }
}
