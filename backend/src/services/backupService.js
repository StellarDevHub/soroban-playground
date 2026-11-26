// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * SQLite Automated Backup Service + PostgreSQL WAL-G PITR Orchestration
 *
 * Backup format: <s3-prefix>/backup-<ISO-timestamp>.tar.gz.enc
 * Encryption:    AES-256-GCM with a per-backup data key wrapped by AWS KMS or Vault.
 *
 * ─── RESTORE PROCEDURE ────────────────────────────────────────────────────────
 *
 * Prerequisites
 *   • BACKUP_KMS_PROVIDER=aws-kms or vault and the matching KMS/Vault configuration
 *   • AWS credentials with s3:GetObject and kms:Decrypt permission
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
 * The service generates a per-backup data key and wraps it with the configured
 * KMS/Vault provider; no backup encryption key is stored in application config.
 *
 * ─── POSTGRESQL WAL-G PITR ────────────────────────────────────────────────────
 *
 * The PostgreSQL disaster-recovery pipeline is driven by
 * `backend/scripts/backup/walGPostgres.sh`. This service exposes thin
 * orchestration helpers so the Node backend can trigger base backups,
 * PITR restores, and weekly restore drills, and can emit Prometheus
 * alerts when WAL archiving falls behind.
 *
 *   import { runPostgresBaseBackup, runPostgresPitr, runRestoreDrill,
 *            checkWalArchiveLag } from './backupService.js';
 *
 * See `backend/scripts/backup/README.md` for the operational runbook.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Transform } from 'stream';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { mkdir, unlink, chmod, rmdir } from 'fs/promises';
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
import { AwsKmsProvider, VaultTransitProvider } from './kmsService.js';
import logger from '../utils/logger.js';
import { alertManager } from '../utils/alerting.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const AES_ALGORITHM = 'aes-256-gcm';
const AES_KEY_LENGTH = 32;
const AES_IV_LENGTH = 12;
const AES_TAG_LENGTH = 16;
const BACKUP_MAGIC = Buffer.from('SBKUP001');
const BACKUP_RETENTION_DAYS = 30;

const WALG_SCRIPT_PATH =
  process.env.WALG_SCRIPT_PATH ||
  path.resolve(_dirname, '../../scripts/backup/walGPostgres.sh');

// ─── Crypto Transforms ────────────────────────────────────────────────────────

class AES256GcmEncryptTransform extends Transform {
  constructor(key, iv, wrappedKey, options) {
    super(options);
    this._iv = iv;
    this._header = Buffer.alloc(BACKUP_MAGIC.length + 4 + AES_IV_LENGTH);
    BACKUP_MAGIC.copy(this._header);
    this._header.writeUInt32BE(wrappedKey.length, BACKUP_MAGIC.length);
    iv.copy(this._header, BACKUP_MAGIC.length + 4);
    this._header = Buffer.concat([this._header, wrappedKey]);
    this._cipher = createCipheriv(AES_ALGORITHM, key, iv);
    this._headerSent = false;
  }

  _transform(chunk, _encoding, callback) {
    try {
      const encrypted = this._cipher.update(chunk);
      if (!this._headerSent) {
        this._headerSent = true;
        this.push(this._header);
      }
      if (encrypted.length) this.push(encrypted);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      if (!this._headerSent) this.push(this._header);
      const final = this._cipher.final();
      if (final.length) this.push(final);
      this.push(this._cipher.getAuthTag());
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

class AES256GcmDecryptTransform extends Transform {
  constructor(keyProvider, options) {
    super(options);
    this._keyProvider = keyProvider;
    this._header = Buffer.alloc(0);
    this._headerLength = null;
    this._decipher = null;
    this._tail = Buffer.alloc(0);
  }

  _transform(chunk, _encoding, callback) {
    this._processChunk(chunk).then(
      () => callback(),
      (err) => callback(err)
    );
  }

  async _processChunk(chunk) {
    let remaining = chunk;
    if (!this._decipher) {
      this._header = Buffer.concat([this._header, remaining]);
      remaining = Buffer.alloc(0);
      if (
        this._header.length >= BACKUP_MAGIC.length + 4 &&
        this._headerLength === null
      ) {
        if (
          !this._header
            .subarray(0, BACKUP_MAGIC.length)
            .equals(BACKUP_MAGIC)
        ) {
          throw new Error('Unsupported or invalid backup format');
        }
        this._headerLength =
          BACKUP_MAGIC.length +
          4 +
          AES_IV_LENGTH +
          this._header.readUInt32BE(BACKUP_MAGIC.length);
        if (
          this._header.readUInt32BE(BACKUP_MAGIC.length) === 0 ||
          this._headerLength > 16 * 1024
        ) {
          throw new Error('Invalid wrapped data key in backup header');
        }
      }
      if (
        this._headerLength !== null &&
        this._header.length >= this._headerLength
      ) {
        const iv = this._header.subarray(
          BACKUP_MAGIC.length + 4,
          BACKUP_MAGIC.length + 4 + AES_IV_LENGTH
        );
        const wrappedKey = this._header
          .subarray(BACKUP_MAGIC.length + 4 + AES_IV_LENGTH, this._headerLength)
          .toString('utf8');
        const key = await this._keyProvider.unwrap(wrappedKey);
        if (key.length !== AES_KEY_LENGTH) {
          key.fill(0);
          throw new Error('Unwrapped backup data key must be 32 bytes');
        }
        try {
          this._decipher = createDecipheriv(AES_ALGORITHM, key, iv);
        } finally {
          key.fill(0);
        }
        remaining = this._header.subarray(this._headerLength);
        this._header = null;
      }
    }

    if (remaining.length) {
      const combined = Buffer.concat([this._tail, remaining]);
      if (combined.length > AES_TAG_LENGTH) {
        const ciphertext = combined.subarray(0, combined.length - AES_TAG_LENGTH);
        this._tail = combined.subarray(combined.length - AES_TAG_LENGTH);
        const plaintext = this._decipher.update(ciphertext);
        if (plaintext.length) this.push(plaintext);
      } else {
        this._tail = combined;
      }
    }
  }

  _flush(callback) {
    try {
      if (!this._decipher || this._tail.length !== AES_TAG_LENGTH) {
        throw new Error('Backup is truncated or has an invalid encryption header');
      }
      this._decipher.setAuthTag(this._tail);
      const final = this._decipher.final();
      if (final.length) this.push(final);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    s3Bucket: process.env.BACKUP_S3_BUCKET,
    s3Prefix: process.env.BACKUP_S3_PREFIX || 'sqlite-backups/',
    s3Region: process.env.BACKUP_S3_REGION || 'us-east-1',
    kmsProvider: process.env.BACKUP_KMS_PROVIDER,
    tempDir:
      process.env.BACKUP_TEMP_DIR || path.join(os.tmpdir(), 'db-backups'),
  };
}

function assertConfigComplete(cfg) {
  const missing = [];
  if (!cfg.s3Bucket) missing.push('BACKUP_S3_BUCKET');
  if (!['aws-kms', 'vault'].includes(cfg.kmsProvider)) {
    missing.push('BACKUP_KMS_PROVIDER=aws-kms|vault');
  }
  if (missing.length) {
    throw new Error(
      `Backup service misconfigured — missing env vars: ${missing.join(', ')}`
    );
  }
}

function getBackupKeyProvider(cfg) {
  if (cfg.kmsProvider === 'aws-kms') {
    if (!process.env.AWS_KMS_KEY_ID) {
      throw new Error(
        'AWS_KMS_KEY_ID is required when BACKUP_KMS_PROVIDER=aws-kms'
      );
    }
    return new AwsKmsProvider({
      keyId: process.env.AWS_KMS_KEY_ID,
      region: process.env.AWS_REGION || cfg.s3Region,
    });
  }
  return new VaultTransitProvider({
    address: process.env.VAULT_ADDR,
    token: process.env.VAULT_TOKEN,
    mount: process.env.BACKUP_VAULT_TRANSIT_MOUNT || 'transit',
    keyName: process.env.BACKUP_VAULT_TRANSIT_KEY || 'soroban-backups',
  });
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
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key })
  );
  return { etag: head.ETag, contentLength: head.ContentLength };
}

async function pruneOldBackups(s3Client, bucket, prefix) {
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

  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const toDelete = objects
    .filter(
      (object) =>
        object.Key &&
        /\/?backup-[^/]+\.tar\.gz\.enc$/.test(object.Key) &&
        object.LastModified &&
        object.LastModified.getTime() < cutoff
    )
    .map((object) => ({ Key: object.Key }));

  if (!toDelete.length) return 0;

  for (let index = 0; index < toDelete.length; index += 1000) {
    const result = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: toDelete.slice(index, index + 1000),
          Quiet: true,
        },
      })
    );
    if (result.Errors?.length) {
      throw new Error(
        `Failed to prune ${result.Errors.length} expired backup object(s)`
      );
    }
  }

  return toDelete.length;
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _lastResult = null;

export async function runBackup() {
  const cfg = getConfig();
  assertConfigComplete(cfg);

  const timestamp = buildTimestamp();
  const snapshotDir = path.join(cfg.tempDir, `run-${timestamp}`);
  const snapshotFile = path.join(snapshotDir, `snapshot-${timestamp}.sqlite`);
  const s3Key = buildS3Key(cfg.s3Prefix, timestamp);
  const keyProvider = getBackupKeyProvider(cfg);
  const dataKey = randomBytes(AES_KEY_LENGTH);

  logger.info(
    JSON.stringify({ level: 'info', msg: 'backup:start', timestamp, s3Key })
  );

  let backupError;
  try {
    const wrappedKey = Buffer.from(await keyProvider.wrap(dataKey), 'utf8');
    if (!wrappedKey.length || wrappedKey.length > 16 * 1024) {
      throw new Error('KMS provider returned an invalid wrapped backup key');
    }

    await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
    await chmod(snapshotDir, 0o700);

    // 1. Point-in-time snapshot — non-blocking in WAL mode
    logger.info(
      JSON.stringify({
        level: 'info',
        msg: 'backup:snapshot',
        file: snapshotFile,
      })
    );
    await createDatabaseSnapshot(snapshotFile);
    await chmod(snapshotFile, 0o600);

    // 2. tar.gz → AES-256-GCM encrypt → S3 multipart upload (fully stream-based)
    const s3Client = new S3Client({ region: cfg.s3Region });
    const encryptTransform = new AES256GcmEncryptTransform(
      dataKey,
      randomBytes(AES_IV_LENGTH),
      wrappedKey
    );

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
      'backup-algorithm': AES_ALGORITHM,
      'backup-kms-provider': keyProvider.name,
      'backup-format': 'tar.gz.enc',
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

    // 4. Prune backups older than the retention window
    const deleted = await pruneOldBackups(
      s3Client,
      cfg.s3Bucket,
      cfg.s3Prefix
    );
    if (deleted > 0) {
      logger.info(
        JSON.stringify({ level: 'info', msg: 'backup:pruned', count: deleted })
      );
    }

    const result = {
      success: true,
      s3Key,
      timestamp,
      etag,
      contentLength,
      encrypted: true,
      algorithm: AES_ALGORITHM,
    };
    _lastResult = { ...result, completedAt: new Date().toISOString() };
    logger.info(
      JSON.stringify({ level: 'info', msg: 'backup:complete', ...result })
    );
    return result;
  } catch (err) {
    backupError = err;
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
    dataKey.fill(0);
    try {
      await unlink(snapshotFile);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(
          JSON.stringify({
            level: 'error',
            msg: 'backup:snapshot_cleanup_failed',
            error: err.message,
            snapshotFile,
          })
        );
        if (!backupError) {
          alertManager.alert('backup_cleanup_failed', {
            error: err.message,
            snapshotFile,
          });
          throw err;
        }
      }
    }

    try {
      await rmdir(snapshotDir);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(
          JSON.stringify({
            level: 'error',
            msg: 'backup:directory_cleanup_failed',
            error: err.message,
            snapshotDir,
          })
        );
        if (!backupError) {
          alertManager.alert('backup_cleanup_failed', {
            error: err.message,
            snapshotDir,
          });
          throw err;
        }
      }
    }
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
  if (!['aws-kms', 'vault'].includes(cfg.kmsProvider)) {
    throw new Error('BACKUP_KMS_PROVIDER must be aws-kms or vault for restore');
  }
  const keyProvider = getBackupKeyProvider(cfg);

  await mkdir(destDir, { recursive: true, mode: 0o700 });
  await chmod(destDir, 0o700);

  const decryptTransform = new AES256GcmDecryptTransform(keyProvider);
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
      'Unknown command. Available commands: restore, pg-base-backup, pg-pitr, pg-restore-drill, pg-wal-lag'
    );
    process.exit(1);
  }
}
