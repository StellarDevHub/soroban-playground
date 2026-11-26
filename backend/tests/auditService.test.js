import knexLib from 'knex';
import {
  AuditService,
  GENESIS_HASH,
  computeRecordHash,
  computeMerkleRoot,
  verifyAuditRecords,
  createS3ImmutableAnchor,
  createStellarAnchor,
} from '../src/services/auditService.js';
import { up as applyIntegrityChaining } from '../src/database/migrations/20261125000013_audit_log_integrity_chaining.js';

describe('AuditService cryptographic hash chaining and hourly root anchoring', () => {
  let db;
  let auditService;

  beforeEach(async () => {
    db = knexLib({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('audit_log', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.integer('api_key_id');
      table.integer('user_id');
      table.text('action').notNullable();
      table.text('endpoint');
      table.text('ip_address');
      table.text('user_agent');
      table.integer('status_code');
      table.integer('response_time_ms');
      table.timestamp('timestamp').defaultTo(db.fn.now());
      table.text('metadata');
    });

    await applyIntegrityChaining(db);
    auditService = new AuditService(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test('chains each record hash to the previous record hash using SHA-256', async () => {
    const t1 = new Date('2026-11-25T10:01:00.000Z');
    const t2 = new Date('2026-11-25T10:02:00.000Z');
    const t3 = new Date('2026-11-25T10:03:00.000Z');

    const r1 = await auditService.log({
      action: 'contract.deploy',
      actor: 'alice',
      timestamp: t1,
      metadata: { contractId: 'C_ALPHA', version: 1 },
    });
    const r2 = await auditService.log({
      action: 'contract.invoke',
      actor: 'bob',
      timestamp: t2,
      metadata: { fn: 'mint', amount: 100 },
    });
    const r3 = await auditService.log({
      action: 'role.grant',
      actor: 'admin',
      timestamp: t3,
      metadata: { target: 'bob', role: 'operator' },
    });

    expect(r1.prev_hash).toBe(GENESIS_HASH);
    expect(r1.record_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r2.prev_hash).toBe(r1.record_hash);
    expect(r3.prev_hash).toBe(r2.record_hash);

    expect(r1.record_hash).toBe(computeRecordHash(GENESIS_HASH, r1));
    expect(r2.record_hash).toBe(computeRecordHash(r1.record_hash, r2));

    const verification = await auditService.verifyChain();
    expect(verification.valid).toBe(true);
    expect(verification.checkedCount).toBe(3);
    expect(verification.headHash).toBe(r3.record_hash);
  });

  test('altering any historical record invalidates the audit chain', async () => {
    const r1 = await auditService.log({
      action: 'user.login',
      actor: 'alice',
      timestamp: new Date('2026-11-25T11:00:00.000Z'),
      metadata: { ip: '10.0.0.1' },
    });
    await auditService.log({
      action: 'contract.deploy',
      actor: 'alice',
      timestamp: new Date('2026-11-25T11:05:00.000Z'),
      metadata: { contractId: 'C_1' },
    });
    await auditService.log({
      action: 'contract.invoke',
      actor: 'bob',
      timestamp: new Date('2026-11-25T11:10:00.000Z'),
      metadata: { amount: 50 },
    });

    // Baseline is valid
    expect((await auditService.verifyChain()).valid).toBe(true);

    // Simulate a compromised DBA altering the first historical record
    await db('audit_log')
      .where({ id: r1.id })
      .update({ action: 'user.login_tampered' });

    const verification = await auditService.verifyChain();
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtIndex).toBe(0);
    expect(verification.brokenRecordId).toBe(r1.id);
    expect(verification.reason).toMatch(/Hash mismatch/i);
  });

  test('deleting a historical record invalidates the audit chain', async () => {
    await auditService.log({
      action: 'event.1',
      actor: 'alice',
      timestamp: new Date('2026-11-25T12:00:00.000Z'),
    });
    const r2 = await auditService.log({
      action: 'event.2',
      actor: 'alice',
      timestamp: new Date('2026-11-25T12:01:00.000Z'),
    });
    await auditService.log({
      action: 'event.3',
      actor: 'alice',
      timestamp: new Date('2026-11-25T12:02:00.000Z'),
    });

    // Simulate a compromised DBA deleting a middle record
    await db('audit_log').where({ id: r2.id }).del();

    const verification = await auditService.verifyChain();
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtIndex).toBe(1);
    expect(verification.reason).toMatch(/Broken chain link/i);
  });

  test('anchors hourly root state hash to Stellar and verifies integrity against it', async () => {
    const submitted = [];
    const stellarAnchor = createStellarAnchor({
      submitManageData: async ({ name, value, manifest }) => {
        submitted.push({ name, value, manifest });
        return { txHash: 'stellar_tx_abc123' };
      },
    });

    const service = new AuditService(db, { stellarAnchor });

    const r1 = await service.log({
      action: 'tx.submit',
      actor: 'alice',
      timestamp: new Date('2026-11-25T14:15:00.000Z'),
    });
    const r2 = await service.log({
      action: 'tx.confirm',
      actor: 'alice',
      timestamp: new Date('2026-11-25T14:45:00.000Z'),
    });

    const anchor = await service.anchorHourlyRootHash(
      new Date('2026-11-25T14:59:00.000Z')
    );

    expect(anchor.anchorType).toBe('stellar');
    expect(anchor.anchorRef).toBe('stellar_tx_abc123');
    expect(anchor.recordCount).toBe(2);
    expect(anchor.rootHash).toBe(
      computeMerkleRoot([r1.record_hash, r2.record_hash])
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0].name).toBe('audit_root_2026112514');
    expect(submitted[0].value).toEqual(Buffer.from(anchor.rootHash, 'hex'));

    const savedAnchors = await db('audit_log_anchors').select('*');
    expect(savedAnchors).toHaveLength(1);
    expect(savedAnchors[0].root_hash).toBe(anchor.rootHash);

    const checkValid = await service.verifyHourlyAnchor(savedAnchors[0]);
    expect(checkValid.valid).toBe(true);

    // Tamper with record_hash in DB -> anchor verification must fail
    await db('audit_log')
      .where({ id: r1.id })
      .update({ record_hash: 'f'.repeat(64) });
    const checkTampered = await service.verifyHourlyAnchor(savedAnchors[0]);
    expect(checkTampered.valid).toBe(false);
  });

  test('anchors hourly root state hash to immutable S3 Object Lock bucket', async () => {
    const sentCommands = [];
    const s3Anchor = createS3ImmutableAnchor({
      s3Client: {
        send: async (cmd) => {
          sentCommands.push(cmd);
          return { ETag: '"etag-immutable-1"' };
        },
      },
      bucket: 'soroban-audit-immutable',
      retentionDays: 365,
    });

    const service = new AuditService(db, { s3Anchor });
    await service.log({
      action: 'key.rotate',
      actor: 'security-bot',
      timestamp: new Date('2026-11-25T15:10:00.000Z'),
    });

    const anchor = await service.anchorHourlyRootHash(
      new Date('2026-11-25T15:30:00.000Z')
    );

    expect(anchor.anchorType).toBe('s3');
    expect(anchor.anchorRef).toBe('audit-roots/audit_root_2026112515.json');
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0].Bucket).toBe('soroban-audit-immutable');
    expect(sentCommands[0].ObjectLockMode).toBe('COMPLIANCE');
  });

  test('verifyAuditRecords rejects records with missing hashes', () => {
    const result = verifyAuditRecords([
      { id: 1, action: 'test', actor: 'alice', timestamp: '2026-11-25T00:00:00.000Z' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Missing record_hash/i);
  });
});
