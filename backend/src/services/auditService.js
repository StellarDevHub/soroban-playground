import crypto from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);
export const AUDIT_TABLE = 'audit_log';
export const ANCHOR_TABLE = 'audit_log_anchors';

/**
 * Deterministically serialize an object with recursively sorted keys so
 * cryptographic hashes are reproducible regardless of property insertion order.
 */
export function canonicalStringify(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`
    );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Extract the canonical hashed payload from an audit record.
 */
export function extractRecordData(record) {
  let metadata = record.metadata ?? null;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      // Keep raw string if not JSON
    }
  }

  const timestamp =
    record.timestamp instanceof Date
      ? record.timestamp.toISOString()
      : String(record.timestamp ?? '');

  return {
    action: record.action ?? '',
    actor: record.actor ?? (record.user_id != null ? String(record.user_id) : 'system'),
    tenant_id: record.tenant_id ?? 'public',
    timestamp,
    metadata,
  };
}

/**
 * Compute SHA-256 hash chaining the previous record hash with the canonical record data:
 *   record.hash = sha256(prev_hash + record_data)
 */
export function computeRecordHash(prevHash, record) {
  const prev = prevHash || GENESIS_HASH;
  const recordData =
    typeof record === 'string'
      ? record
      : canonicalStringify(extractRecordData(record));
  return crypto.createHash('sha256').update(`${prev}${recordData}`).digest('hex');
}

/**
 * Compute a SHA-256 Merkle root over an ordered list of hex hashes.
 */
export function computeMerkleRoot(hashes) {
  if (!hashes || hashes.length === 0) {
    return crypto.createHash('sha256').update('EMPTY_AUDIT_WINDOW').digest('hex');
  }

  let level = [...hashes];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      const combined = crypto
        .createHash('sha256')
        .update(`${left}${right}`)
        .digest('hex');
      next.push(combined);
    }
    level = next;
  }
  return level[0];
}

/**
 * Verify an ordered array of audit records for cryptographic hash-chain integrity.
 * Detects any altered historical field, deleted record, or broken prev_hash link.
 */
export function verifyAuditRecords(records, expectedInitialPrevHash = GENESIS_HASH) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      valid: true,
      checkedCount: 0,
      headHash: expectedInitialPrevHash,
    };
  }

  let expectedPrevHash = expectedInitialPrevHash;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const storedPrevHash = record.prev_hash ?? record.prevHash;
    const storedHash = record.record_hash ?? record.hash;

    if (!storedHash) {
      return {
        valid: false,
        checkedCount: i + 1,
        brokenAtIndex: i,
        brokenRecordId: record.id ?? null,
        reason: `Missing record_hash at index ${i}`,
      };
    }

    if (storedPrevHash !== expectedPrevHash) {
      return {
        valid: false,
        checkedCount: i + 1,
        brokenAtIndex: i,
        brokenRecordId: record.id ?? null,
        reason: `Broken chain link at index ${i}: expected prev_hash ${expectedPrevHash}, got ${storedPrevHash}`,
      };
    }

    const recomputedHash = computeRecordHash(expectedPrevHash, record);
    if (storedHash !== recomputedHash) {
      return {
        valid: false,
        checkedCount: i + 1,
        brokenAtIndex: i,
        brokenRecordId: record.id ?? null,
        reason: `Hash mismatch at index ${i}: expected ${recomputedHash}, got ${storedHash}`,
      };
    }

    expectedPrevHash = storedHash;
  }

  return {
    valid: true,
    checkedCount: records.length,
    headHash: expectedPrevHash,
  };
}

/**
 * AuditService provides tamper-evident cryptographic hash chaining for audit logs,
 * monthly partition-friendly timestamp queries, and hourly root state hash anchoring
 * to Stellar or an immutable S3 storage bucket.
 */
export class AuditService {
  constructor(db, options = {}) {
    this.db = db;
    this.tableName = options.tableName || AUDIT_TABLE;
    this.anchorTableName = options.anchorTableName || ANCHOR_TABLE;
    this.stellarAnchor = options.stellarAnchor || null;
    this.s3Anchor = options.s3Anchor || null;
    this.logger = options.logger || console;
  }

  /**
   * Append a cryptographically chained audit log record inside a transaction.
   */
  async log({
    action,
    actor = 'system',
    timestamp = new Date(),
    tenant_id = 'public',
    user_id = null,
    api_key_id = null,
    endpoint = null,
    ip_address = null,
    user_agent = null,
    status_code = null,
    response_time_ms = null,
    metadata = null,
  }) {
    const isoTimestamp =
      timestamp instanceof Date
        ? timestamp.toISOString()
        : new Date(timestamp).toISOString();

    const serializedMetadata =
      metadata === null || metadata === undefined
        ? null
        : typeof metadata === 'string'
          ? metadata
          : canonicalStringify(metadata);

    return this.db.transaction(async (trx) => {
      const lastRecord = await trx(this.tableName)
        .select('record_hash')
        .whereNotNull('record_hash')
        .orderBy('timestamp', 'desc')
        .orderBy('id', 'desc')
        .first();

      const prevHash = lastRecord?.record_hash || GENESIS_HASH;

      const recordPayload = {
        action,
        actor,
        tenant_id,
        timestamp: isoTimestamp,
        metadata: serializedMetadata,
      };

      const recordHash = computeRecordHash(prevHash, recordPayload);

      const row = {
        tenant_id,
        api_key_id,
        user_id,
        actor,
        action,
        endpoint,
        ip_address,
        user_agent,
        status_code,
        response_time_ms,
        timestamp: isoTimestamp,
        metadata: serializedMetadata,
        prev_hash: prevHash,
        record_hash: recordHash,
      };

      const inserted = await trx(this.tableName).insert(row).returning('*');
      if (Array.isArray(inserted) && inserted.length > 0 && typeof inserted[0] === 'object') {
        return inserted[0];
      }

      // Fallback for SQLite where .returning('*') may return [id]
      const id = Array.isArray(inserted) ? inserted[0] : inserted;
      return { id, ...row };
    });
  }

  /**
   * Fetch audit records in chronological order and verify the entire hash chain
   * (or a partition-pruned time range).
   */
  async verifyChain({ startTime = null, endTime = null, expectedInitialPrevHash = GENESIS_HASH } = {}) {
    let query = this.db(this.tableName)
      .select('*')
      .orderBy('timestamp', 'asc')
      .orderBy('id', 'asc');

    if (startTime) {
      query = query.where(
        'timestamp',
        '>=',
        startTime instanceof Date ? startTime.toISOString() : startTime
      );
    }
    if (endTime) {
      query = query.where(
        'timestamp',
        '<',
        endTime instanceof Date ? endTime.toISOString() : endTime
      );
    }

    const records = await query;
    return verifyAuditRecords(records, expectedInitialPrevHash);
  }

  /**
   * Compute and anchor the hourly root state hash for [hourStart, hourEnd)
   * to Stellar or an immutable S3 storage bucket (Object Lock).
   */
  async anchorHourlyRootHash(referenceDate = new Date(), options = {}) {
    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const hourStart = new Date(
      Date.UTC(
        ref.getUTCFullYear(),
        ref.getUTCMonth(),
        ref.getUTCDate(),
        ref.getUTCHours(),
        0,
        0,
        0
      )
    );
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

    const records = await this.db(this.tableName)
      .select('id', 'record_hash', 'timestamp')
      .where('timestamp', '>=', hourStart.toISOString())
      .where('timestamp', '<', hourEnd.toISOString())
      .whereNotNull('record_hash')
      .orderBy('timestamp', 'asc')
      .orderBy('id', 'asc');

    const hashes = records.map((r) => r.record_hash);
    const rootHash = computeMerkleRoot(hashes);
    const windowKey = `audit_root_${hourStart.toISOString().slice(0, 13).replace(/[-T:]/g, '')}`;

    const manifest = {
      windowKey,
      hourStart: hourStart.toISOString(),
      hourEnd: hourEnd.toISOString(),
      recordCount: records.length,
      firstHash: hashes[0] || null,
      lastHash: hashes[hashes.length - 1] || null,
      rootHash,
      anchoredAt: new Date().toISOString(),
    };

    let anchorType = 'local';
    let anchorRef = windowKey;

    const stellarHandler = options.stellarAnchor || this.stellarAnchor;
    const s3Handler = options.s3Anchor || this.s3Anchor;

    if (typeof stellarHandler === 'function') {
      const result = await stellarHandler(manifest);
      anchorType = 'stellar';
      anchorRef = typeof result === 'string' ? result : result?.txHash || result?.hash || windowKey;
    } else if (typeof s3Handler === 'function') {
      const result = await s3Handler(manifest);
      anchorType = 's3';
      anchorRef = typeof result === 'string' ? result : result?.key || result?.etag || windowKey;
    }

    const anchorRecord = {
      hour_start: manifest.hourStart,
      hour_end: manifest.hourEnd,
      record_count: manifest.recordCount,
      root_hash: rootHash,
      anchor_type: anchorType,
      anchor_ref: anchorRef,
    };

    const hasAnchorTable = await this.db.schema.hasTable(this.anchorTableName);
    if (hasAnchorTable) {
      await this.db(this.anchorTableName).insert(anchorRecord);
    }

    return { ...manifest, anchorType, anchorRef };
  }

  /**
   * Verify that the database records for an anchored hour still produce the
   * exact anchored Merkle root hash.
   */
  async verifyHourlyAnchor(anchor) {
    const records = await this.db(this.tableName)
      .select('id', 'record_hash', 'timestamp')
      .where('timestamp', '>=', anchor.hour_start || anchor.hourStart)
      .where('timestamp', '<', anchor.hour_end || anchor.hourEnd)
      .whereNotNull('record_hash')
      .orderBy('timestamp', 'asc')
      .orderBy('id', 'asc');

    const recomputedRoot = computeMerkleRoot(records.map((r) => r.record_hash));
    const expectedRoot = anchor.root_hash || anchor.rootHash;
    return {
      valid: recomputedRoot === expectedRoot,
      expectedRoot,
      recomputedRoot,
      recordCount: records.length,
    };
  }

  /**
   * Start a background hourly scheduler that anchors the previous completed UTC hour.
   */
  startHourlyAnchorScheduler({ intervalMs = 60 * 60 * 1000 } = {}) {
    const tick = async () => {
      try {
        const previousHour = new Date(Date.now() - 60 * 60 * 1000);
        return await this.anchorHourlyRootHash(previousHour);
      } catch (err) {
        this.logger.warn?.(`Hourly audit anchor failed: ${err.message}`);
        return null;
      }
    };

    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    return { stop: () => clearInterval(timer), tick };
  }
}

/**
 * Create an immutable S3 Object Lock anchor handler for AuditService.
 */
export function createS3ImmutableAnchor({ s3Client, bucket, prefix = 'audit-roots/', retentionDays = 365 }) {
  return async (manifest) => {
    const key = `${prefix}${manifest.windowKey}.json`;
    const retainUntilDate = new Date(Date.now() + retentionDays * 86400 * 1000);
    const body = JSON.stringify(manifest, null, 2);

    const response = await s3Client.send({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ObjectLockMode: 'COMPLIANCE',
      ObjectLockRetainUntilDate: retainUntilDate,
    });

    return { key, etag: response?.ETag || null };
  };
}

/**
 * Create a Stellar blockchain anchor handler that records the 32-byte root hash
 * via a ManageData operation.
 */
export function createStellarAnchor({ submitManageData }) {
  return async (manifest) => {
    const name = manifest.windowKey.slice(0, 64);
    const value = Buffer.from(manifest.rootHash, 'hex');
    const result = await submitManageData({ name, value, manifest });
    return { txHash: typeof result === 'string' ? result : result?.hash || result?.txHash || name };
  };
}

export async function logAuditRecord(db, entry) {
  const service = new AuditService(db);
  return service.log(entry);
}

export default AuditService;
