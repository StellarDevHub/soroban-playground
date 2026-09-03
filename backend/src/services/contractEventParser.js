import { xdr, scValToNative } from '@stellar/stellar-sdk';

/**
 * Custom error class for XDR parse failures, carrying the raw value
 * and a category tag so callers can handle it without re-inspecting the message.
 */
export class XdrParseError extends Error {
  constructor(message, rawXdr) {
    super(message);
    this.name = 'XdrParseError';
    this.rawXdr = rawXdr;
    this._category = 'parse';
  }
}

/**
 * Validates a raw Soroban RPC event object has the expected shape.
 * Returns { valid: true, error: null } or { valid: false, error: string }.
 */
export function validateRawEvent(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Event must be a non-null object' };
  }
  if (raw.contractId == null) {
    return { valid: false, error: 'Missing contractId' };
  }
  if (raw.ledger == null) {
    return { valid: false, error: 'Missing ledger sequence' };
  }
  return { valid: true, error: null };
}

/**
 * Decodes a base64-encoded Soroban XDR ScVal to a native JS value.
 * Throws an XdrParseError on invalid XDR — callers must catch to avoid
 * halting the indexer.
 */
export function decodeScVal(base64XdrStr) {
  if (typeof base64XdrStr !== 'string' || base64XdrStr.length === 0) {
    throw new XdrParseError(
      'XDR input must be a non-empty string',
      base64XdrStr
    );
  }
  try {
    return scValToNative(xdr.ScVal.fromXDR(base64XdrStr, 'base64'));
  } catch (e) {
    throw new XdrParseError(`Failed to decode XDR: ${e.message}`, base64XdrStr);
  }
}

/**
 * Parses a raw Soroban RPC event object into a flat, indexable record.
 * Returns null for events that fail validation instead of throwing.
 *
 * Raw event shape from SorobanRpc.Server.getEvents():
 *   { contractId, ledger, topic: string[], value: { xdr: string }, type }
 */
export function parseEvent(raw) {
  const validation = validateRawEvent(raw);
  if (!validation.valid) {
    const err = new Error(`Invalid event: ${validation.error}`);
    err._category = 'parse';
    throw err;
  }

  const topics = (raw.topic ?? []).map((t) => {
    try {
      return decodeScVal(t);
    } catch {
      return t;
    }
  });

  let value = null;
  if (raw.value?.xdr) {
    try {
      value = decodeScVal(raw.value.xdr);
    } catch {
      value = raw.value.xdr;
    }
  }

  return {
    contractId: raw.contractId,
    ledgerSequence: raw.ledger,
    topics,
    value,
    rawXdr: raw.value?.xdr ?? null,
    eventType: raw.type ?? 'contract',
  };
}

// Decoupled handler registry — register one handler per contract type.
// Use '*' as a wildcard to handle events from any unregistered contract type.
const handlers = new Map();

export function registerHandler(contractType, fn) {
  if (typeof contractType !== 'string' || contractType.length === 0) {
    throw new Error('contractType must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new Error('Handler must be a function');
  }
  handlers.set(contractType, fn);
}

function invokeHandler(fn, parsed, type) {
  if (typeof fn !== 'function') return;
  try {
    fn(parsed);
  } catch (e) {
    console.error(
      `[EventParser] Handler error for contract type "${type}":`,
      e.message
    );
  }
}

export function dispatchEvent(parsed) {
  const type = String(parsed.topics?.[0] ?? 'unknown');
  invokeHandler(handlers.get(type), parsed, type);
  const wildcard = handlers.get('*');
  if (wildcard && wildcard !== handlers.get(type)) {
    invokeHandler(wildcard, parsed, '*');
  }
}
