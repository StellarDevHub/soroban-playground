import v8 from 'v8';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import config from '../config/index.js';
import { alertManager } from '../utils/alerting.js';

class MemoryLeakDetector {
  constructor() {
    const {
      heapLimitMb,
      heapThresholdPct,
      heapDumpDir,
      heapDumpIntervalMs,
      heapDumpS3Bucket,
    } = config.memory;

    this._limitBytes = heapLimitMb * 1024 * 1024;
    this._thresholdPct = heapThresholdPct;
    this._dumpDir = heapDumpDir;
    this._intervalMs = heapDumpIntervalMs;
    this._s3Bucket = heapDumpS3Bucket;
    this._timer = null;
    this._lastDumpAt = -Infinity;

    // 0o700: owner-only — heap snapshots may contain secrets from process memory.
    fs.mkdirSync(this._dumpDir, { recursive: true, mode: 0o700 });
    // mkdirSync does not change the mode of a pre-existing directory.
    try {
      fs.chmodSync(this._dumpDir, 0o700);
    } catch {
      /* best-effort */
    }
  }

  start() {
    const t = setInterval(() => this._check(), this._intervalMs);
    t.unref();
    this._timer = t;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _check() {
    const { rss } = process.memoryUsage();
    const threshold = this._limitBytes * (this._thresholdPct / 100);
    const cooldown = this._intervalMs * 2;

    if (rss > threshold && Date.now() - this._lastDumpAt > cooldown) {
      this._captureSnapshot(rss).catch((e) =>
        console.error('Heap snapshot error:', e.message)
      );
    }
  }

  async _captureSnapshot(rssBytes) {
    const outPath = path.join(
      this._dumpDir,
      `heap-${Date.now()}.heapsnapshot.gz`
    );

    const snapshotStream = v8.getHeapSnapshot();
    // 0o600: owner read/write only — prevents other system users from reading memory dumps.
    const out = fs.createWriteStream(outPath, { mode: 0o600 });
    await pipeline(snapshotStream, zlib.createGzip(), out);

    this._lastDumpAt = Date.now();

    if (this._s3Bucket) {
      try {
        const { S3Client, PutObjectCommand } =
          await import('@aws-sdk/client-s3');
        const s3 = new S3Client({});
        const fileStream = fs.createReadStream(outPath);
        await s3.send(
          new PutObjectCommand({
            Bucket: this._s3Bucket,
            Key: path.basename(outPath),
            Body: fileStream,
          })
        );
      } catch (err) {
        if (
          err.code !== 'ERR_MODULE_NOT_FOUND' &&
          err.code !== 'MODULE_NOT_FOUND'
        ) {
          console.warn('S3 upload failed:', err.message);
        }
      }
    }

    alertManager.alert('heap_snapshot_captured', {
      rssBytes,
      limitMb: this._limitBytes / (1024 * 1024),
      thresholdPct: this._thresholdPct,
      path: outPath,
    });
  }
}

const memoryLeakDetector = new MemoryLeakDetector();

export function startMemoryLeakDetector() {
  memoryLeakDetector.start();
}

export default memoryLeakDetector;
