import crypto from 'crypto';

export interface AuditEntry {
  id?: number;
  timestamp: string;
  action: string;
  payload?: unknown;
  previousHash?: string;
  hash?: string;
  [key: string]: unknown;
}

const GENESIS = 'GENESIS';
let chain: AuditEntry[] = [];

function canonicalPayload(entry: AuditEntry): string {
  const { hash, previousHash, ...rest } = entry as any;
  return JSON.stringify(rest);
}

export function computeHash(previousHash: string, timestamp: string, action: string, payload: unknown): string {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const data = `${previousHash || GENESIS}${timestamp}${action}${payloadStr}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function computeAuditHash(entry: AuditEntry, previousHash?: string): string {
  const prev = previousHash ?? entry.previousHash ?? (chain.length ? chain[chain.length - 1].hash : GENESIS) ?? GENESIS;
  return computeHash(prev, entry.timestamp, entry.action, entry.payload ?? entry);
}

export function appendEntry(entry: Omit<AuditEntry, 'hash' | 'previousHash'> & { previousHash?: string }): AuditEntry {
  const previousHash = entry.previousHash ?? (chain.length ? chain[chain.length - 1].hash! : GENESIS);
  const hash = computeHash(previousHash, entry.timestamp, entry.action, entry.payload ?? entry);
  const full: AuditEntry = { ...entry, previousHash, hash };
  chain.push(full);
  return full;
}

export function recordHashChainEntry(data: any, db?: any): AuditEntry {
  const timestamp = data?.timestamp || new Date().toISOString();
  const entry = appendEntry({
    timestamp,
    action: data?.action || 'contract_action',
    payload: data?.payload ?? data,
  } as any);
  if (db && typeof db.run === 'function') {
    try {
      db.run('INSERT INTO audit_hash_chain (timestamp, action, payload, previous_hash, hash) VALUES (?,?,?,?,?)', [
        entry.timestamp,
        entry.action,
        JSON.stringify(entry.payload ?? null),
        entry.previousHash,
        entry.hash,
      ]);
    } catch (e) {
      // best-effort
    }
  }
  return entry;
}

export function getChain(): AuditEntry[] {
  return chain;
}

export function getAuditChain(): AuditEntry[] {
  return chain;
}

export function resetChain(): void {
  chain = [];
}

export function resetAuditChain(): void {
  chain = [];
}

export function verifyChain(entries?: AuditEntry[]): { valid: boolean; count: number; errorIndex?: number; reason?: string } {
  const list = entries ?? chain;
  if (!list || list.length === 0) return { valid: true, count: 0 };
  let prev = GENESIS;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const expectedPrev = i === 0 ? GENESIS : list[i - 1].hash!;
    if ((e.previousHash ?? GENESIS) !== (i === 0 ? GENESIS : list[i - 1].hash)) {
      // allow missing previousHash? require match
      if (e.previousHash !== undefined && e.previousHash !== expectedPrev) {
        return { valid: false, count: list.length, errorIndex: i, reason: 'Previous hash mismatch' };
      }
    }
    const recomputed = computeHash(e.previousHash ?? prev, e.timestamp, e.action, e.payload ?? e);
    // If stored hash differs from recomputed, mismatch
    if (e.hash && e.hash !== recomputed) {
      // maybe hash stored without payload canonical; try full entry payload
      const alt = computeAuditHash(e, e.previousHash ?? prev);
      if (e.hash !== alt) {
        return { valid: false, count: list.length, errorIndex: i, reason: 'Hash mismatch' };
      }
    }
    // previous hash pointer check
    if (i > 0 && e.previousHash !== list[i - 1].hash) {
      return { valid: false, count: list.length, errorIndex: i, reason: 'Previous hash mismatch' };
    }
    prev = e.hash ?? recomputed;
  }
  return { valid: true, count: list.length };
}

export function verifyAuditChain(entries?: AuditEntry[]) {
  return verifyChain(entries);
}

export default {
  computeHash,
  computeAuditHash,
  appendEntry,
  recordHashChainEntry,
  getChain,
  getAuditChain,
  resetChain,
  resetAuditChain,
  verifyChain,
  verifyAuditChain,
  GENESIS,
};
