import crypto from 'crypto';

let auditChain = [];

/**
 * Calculates SHA-256 hash for a tamper-evident audit log entry.
 */
export function computeAuditHash(entry, previousHash = 'GENESIS') {
  const payloadStr = JSON.stringify({
    action: entry.action,
    contract_id: entry.contract_id || entry.contractId || null,
    function_name: entry.function_name || entry.functionName || null,
    ledger_sequence: entry.ledger_sequence ?? entry.ledgerSequence ?? null,
    session_id: entry.session_id || entry.sessionId || null,
    user_id: entry.user_id || entry.userId || null,
    timestamp: entry.timestamp,
    metadata: entry.metadata || null,
  });

  return crypto
    .createHash('sha256')
    .update(`${previousHash}:${payloadStr}`)
    .digest('hex');
}

/**
 * Records a tamper-evident audit log entry linking contract deployments & invocations,
 * ledger sequence numbers, and user session IDs in a cryptographically hashed hash chain.
 */
export async function recordTamperEvidentAuditLog(data, db = null) {
  const timestamp = data.timestamp || new Date().toISOString();
  const previousHash =
    auditChain.length > 0
      ? auditChain[auditChain.length - 1].hash
      : 'GENESIS';

  const entry = {
    id: auditChain.length + 1,
    action: data.action || 'contract_action',
    contract_id: data.contract_id || data.contractId || null,
    function_name: data.function_name || data.functionName || null,
    ledger_sequence: data.ledger_sequence ?? data.ledgerSequence ?? null,
    session_id: data.session_id || data.sessionId || null,
    user_id: data.user_id || data.userId || null,
    timestamp,
    metadata:
      typeof data.metadata === 'object'
        ? JSON.stringify(data.metadata)
        : data.metadata || null,
    previous_hash: previousHash,
  };

  entry.hash = computeAuditHash(entry, previousHash);
  auditChain.push(entry);

  if (db && typeof db.run === 'function') {
    try {
      await db.run(
        `INSERT INTO audit_log (action, endpoint, ip_address, status_code, timestamp, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          entry.action,
          entry.contract_id ? `/contract/${entry.contract_id}` : null,
          entry.session_id,
          200,
          entry.timestamp,
          JSON.stringify({
            contractId: entry.contract_id,
            functionName: entry.function_name,
            ledgerSequence: entry.ledger_sequence,
            sessionId: entry.session_id,
            previousHash: entry.previous_hash,
            hash: entry.hash,
          }),
        ]
      );
    } catch (err) {
      // Database logging is best-effort
    }
  }

  return entry;
}

export function getAuditChain() {
  return auditChain;
}

export function resetAuditChain() {
  auditChain = [];
}

/**
 * Verifies the integrity of the audit log hash chain to detect tampering.
 */
export function verifyAuditChain(chain = auditChain) {
  let expectedPrevHash = 'GENESIS';
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    if (entry.previous_hash !== expectedPrevHash) {
      return {
        valid: false,
        errorIndex: i,
        reason: `Previous hash mismatch at index ${i}. Expected ${expectedPrevHash}, got ${entry.previous_hash}`,
      };
    }

    const calculatedHash = computeAuditHash(entry, expectedPrevHash);
    if (entry.hash !== calculatedHash) {
      return {
        valid: false,
        errorIndex: i,
        reason: `Hash mismatch at index ${i}. Calculated ${calculatedHash}, got ${entry.hash}`,
      };
    }

    expectedPrevHash = entry.hash;
  }

  return { valid: true, count: chain.length };
}
