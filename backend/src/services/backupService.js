// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * SQLite Automated Backup Service
 *
 * Backup format: <s3-prefix>/backup-<ISO-timestamp>.tar.gz.enc
 * Encryption:    AES-256-CBC — a random 16-byte IV is prepended to the payload.
 *
 * ─── RESTORE PROCEDURE ────────────────────────────────────────────────────────
 *
 * Prerequisites
 *   • BACKUP_ENCRYPTION_KEY env var (64-character hex string representing 32 bytes)
 *   • AWS credentials with s3:GetObject permission
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
 *   # Stop the app (or use credential rotation to avoid downtime)
 *   cp /tmp/db-restore/snapshot-<TIMESTAMP>.sqlite /path/to/database.sqlite
 *   # Restart the app
 *
 * Generate an encryption key (run once, store securely):
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Transform } from 'stream';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { mkdir, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import tar from 'tar';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AES_ALGORITHM = 'aes-256-cbc';
const AES_KEY_LENGTH = 32;
const AES_IV_LENGTH = 16;

// ─── Crypto Transforms ────────────────────────────────────────────────────────

class AES256CbcEncryptTransform extends Transform {
  constructor(key, options) {
    super(options);
    this._iv = randomBytes(AES_IV_LENGTH);
    this._cipher = createCipheriv(AES_ALGORITHM, key, this._iv);
    this._headerSent = false;
  }

  _transform(chunk, _encoding, callback) {
    try {
      const encrypted = this._cipher.update(chunk);
      if (!this._headerSent) {
        this._headerSent = true;
        this.push(Buffer.concat([this._iv, encrypted]));
      } else {
        if (encrypted.length) this.push(encrypted);
      }
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      const final = this._cipher.final();
      if (final.length) this.push(final);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

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

      if (this._ivBytesRead >= AES_IV_LENGTH) {
        const all = Buffer.concat(this._ivChunks);
        const iv = all.subarray(0, AES_IV_LENGTH);
        const remainder = all.subarray(AES_IV_LENGTH);
        this._decipher = createDecipheriv(AES_ALGORITHM, this._key, iv);
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

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const hexKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (hexKey && Buffer.from(hexKey, 'hex').length !== AES_KEY_LENGTH) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY must be ${AES_KEY_LENGTH * 2} hex chars (${AES_KEY_LENGTH} bytes). ` +
      `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return {
    s3Bucket: process.env.BACKUP_S3_BUCKET,
    s3Prefix: process.env.BACKUP_S3_PREFIX || 'sqlite-backups/',
    s3Region: process.env.BACKUP_S3_REGION || 'us-east-1',
    encryptionKeyHex: hexKey,
    tempDir: process.env.BACKUP_TEMP_DIR || path.join(os.tmpdir(), 'db-backups'),
    retentionCount: Math.max(1, parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || 30),
  };
}

function assertConfigComplete(cfg) {
  const missing = [];
  if (!cfg.s3Bucket) missing.push('BACKUP_S3_BUCKET');
  if (!cfg.encryptionKeyHex) missing.push('BACKUP_ENCRYPTION_KEY');
  if (missing.length) {
    throw new Error(`Backup service misconfigured — missing env vars: ${missing.join(', ')}`);
  }
}

function parseEncryptionKey(cfg) {
  return Buffer.from(cfg.encryptionKeyHex, 'hex');
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
    },
    queueSize: 4,
    partSize: 5 * 1024 * 1024, // 5 MB parts
  });
  return upload.done();
}

async function verifyS3Object(s3Client, bucket, key) {
  const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return { etag: head.ETag, contentLength: head.ContentLength };
}

async function pruneOldBackups(s3Client, bucket, prefix, retentionCount) {
  const objects = [];
  let token;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    objects.push(...(res.Contents || []));
    token = res.NextContinuationToken;
  } while (token);

  // Newest first — keep only the most recent `retentionCount` backups
  objects.sort((a, b) => b.LastModified - a.LastModified);
  const toDelete = objects.slice(retentionCount);

  if (!toDelete.length) return 0;

  await s3Client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: toDelete.map((o) => ({ Key: o.Key })),
        Quiet: true,
      },
    })
  );

  return toDelete.length;
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _lastResult = null;

export async function runBackup() {
  const cfg = getConfig();
  assertConfigComplete(cfg);

  const timestamp = buildTimestamp();
  const snapshotFile = path.join(cfg.tempDir, `snapshot-${timestamp}.sqlite`);
  const s3Key = buildS3Key(cfg.s3Prefix, timestamp);
  const encKey = parseEncryptionKey(cfg);

  logger.info(JSON.stringify({ level: 'info', msg: 'backup:start', timestamp, s3Key }));

  try {
    await mkdir(cfg.tempDir, { recursive: true });

    // 1. Point-in-time snapshot — non-blocking in WAL mode
    logger.info(JSON.stringify({ level: 'info', msg: 'backup:snapshot', file: snapshotFile }));
    await createDatabaseSnapshot(snapshotFile);

    // 2. tar.gz → AES-256-CBC encrypt → S3 multipart upload (fully stream-based)
    const s3Client = new S3Client({ region: cfg.s3Region });
    const encryptTransform = new AES256CbcEncryptTransform(encKey);

    const archiveStream = tar.create(
      { gzip: true, cwd: path.dirname(snapshotFile), portable: true },
      [path.basename(snapshotFile)]
    );

    // Propagate archive errors into the encrypt stream so the S3 upload aborts
    archiveStream.on('error', (err) => encryptTransform.destroy(err));
    archiveStream.pipe(encryptTransform);

    logger.info(JSON.stringify({ level: 'info', msg: 'backup:upload:start', s3Key }));
    await streamUploadToS3(s3Client, cfg.s3Bucket, s3Key, encryptTransform, {
      'backup-timestamp': timestamp,
      'backup-algorithm': AES_ALGORITHM,
      'backup-format': 'tar.gz.enc',
    });

    // 3. Verify the object landed in S3
    const { etag, contentLength } = await verifyS3Object(s3Client, cfg.s3Bucket, s3Key);
    logger.info(
      JSON.stringify({ level: 'info', msg: 'backup:verified', s3Key, etag, contentLength })
    );

    // 4. Prune backups older than the retention window
    const deleted = await pruneOldBackups(
      s3Client, cfg.s3Bucket, cfg.s3Prefix, cfg.retentionCount
    );
    if (deleted > 0) {
      logger.info(JSON.stringify({ level: 'info', msg: 'backup:pruned', count: deleted }));
    }

    const result = { success: true, s3Key, timestamp, etag, contentLength };
    _lastResult = { ...result, completedAt: new Date().toISOString() };
    logger.info(JSON.stringify({ level: 'info', msg: 'backup:complete', ...result }));
    return result;
  } catch (err) {
    const failure = { success: false, error: err.message, timestamp };
    _lastResult = { ...failure, completedAt: new Date().toISOString() };
    logger.error(JSON.stringify({ level: 'error', msg: 'backup:failed', error: err.message, s3Key }));
    alertManager.alert('backup_failed', { error: err.message, timestamp, s3Key });
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
  const cfg = getConfig();
  if (!cfg.encryptionKeyHex) {
    throw new Error('BACKUP_ENCRYPTION_KEY is required for restore');
  }
  const encKey = parseEncryptionKey(cfg);

  await mkdir(destDir, { recursive: true });

  const decryptTransform = new AES256CbcDecryptTransform(encKey);
  const sourceStream = createReadStream(sourcePath);
  const extractStream = tar.extract({ cwd: destDir });

  await pipeline(sourceStream, decryptTransform, createGunzip(), extractStream);

  logger.info(
    JSON.stringify({ level: 'info', msg: 'restore:complete', sourcePath, destDir })
  );
  return { success: true, destDir };
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
      .then(() => { console.log(`Restore complete → ${destDir}`); process.exit(0); })
      .catch((err) => { console.error('Restore failed:', err.message); process.exit(1); });
  } else {
    console.error('Unknown command. Available commands: restore');
    process.exit(1);
  }
}
