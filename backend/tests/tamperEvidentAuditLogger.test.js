import {
  recordTamperEvidentAuditLog,
  verifyAuditChain,
  resetAuditChain,
  computeAuditHash,
  getAuditChain,
} from '../src/services/tamperEvidentAuditLogger.js';

describe('Tamper-Evident Audit Logger', () => {
  beforeEach(() => {
    resetAuditChain();
  });

  it('records tamper-evident audit logs linking contract deployments and invocations to ledger sequence numbers and session IDs', async () => {
    const deployEntry = await recordTamperEvidentAuditLog({
      action: 'contract_deploy',
      contractId: 'C1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567',
      ledgerSequence: 12345,
      sessionId: 'sess_user_999',
      userId: 1,
      metadata: { name: 'TokenContract' },
    });

    const invokeEntry = await recordTamperEvidentAuditLog({
      action: 'contract_invoke',
      contractId: 'C1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567',
      functionName: 'transfer',
      ledgerSequence: 12346,
      sessionId: 'sess_user_999',
      userId: 1,
      metadata: { to: 'bob', amount: 500 },
    });

    expect(deployEntry.action).toBe('contract_deploy');
    expect(deployEntry.ledger_sequence).toBe(12345);
    expect(deployEntry.session_id).toBe('sess_user_999');
    expect(deployEntry.previous_hash).toBe('GENESIS');
    expect(deployEntry.hash).toBeDefined();

    expect(invokeEntry.action).toBe('contract_invoke');
    expect(invokeEntry.ledger_sequence).toBe(12346);
    expect(invokeEntry.session_id).toBe('sess_user_999');
    expect(invokeEntry.previous_hash).toBe(deployEntry.hash);
    expect(invokeEntry.hash).toBeDefined();
  });

  it('verifies that a valid hash chain passes integrity checks', async () => {
    await recordTamperEvidentAuditLog({
      action: 'contract_deploy',
      contractId: 'C111',
      ledgerSequence: 100,
      sessionId: 'sess_1',
    });
    await recordTamperEvidentAuditLog({
      action: 'contract_invoke',
      contractId: 'C111',
      functionName: 'initialize',
      ledgerSequence: 101,
      sessionId: 'sess_1',
    });

    const verification = verifyAuditChain();
    expect(verification.valid).toBe(true);
    expect(verification.count).toBe(2);
  });

  it('detects tampering when an audit log entry payload is altered', async () => {
    await recordTamperEvidentAuditLog({
      action: 'contract_deploy',
      contractId: 'C111',
      ledgerSequence: 100,
      sessionId: 'sess_1',
    });
    await recordTamperEvidentAuditLog({
      action: 'contract_invoke',
      contractId: 'C111',
      functionName: 'mint',
      ledgerSequence: 101,
      sessionId: 'sess_1',
    });

    const chain = getAuditChain();
    // Tamper with the function name in the second entry
    chain[1].function_name = 'unauthorized_admin_mint';

    const verification = verifyAuditChain(chain);
    expect(verification.valid).toBe(false);
    expect(verification.errorIndex).toBe(1);
    expect(verification.reason).toContain('Hash mismatch');
  });

  it('detects tampering when an audit log hash chain link is broken', async () => {
    await recordTamperEvidentAuditLog({
      action: 'contract_deploy',
      contractId: 'C111',
      ledgerSequence: 100,
      sessionId: 'sess_1',
    });
    await recordTamperEvidentAuditLog({
      action: 'contract_invoke',
      contractId: 'C111',
      functionName: 'mint',
      ledgerSequence: 101,
      sessionId: 'sess_1',
    });

    const chain = getAuditChain();
    // Corrupt previous hash reference
    chain[1].previous_hash = 'CORRUPTED_HASH';

    const verification = verifyAuditChain(chain);
    expect(verification.valid).toBe(false);
    expect(verification.errorIndex).toBe(1);
    expect(verification.reason).toContain('Previous hash mismatch');
  });
});
