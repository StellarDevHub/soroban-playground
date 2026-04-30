// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Vote authenticity. HMAC-SHA256 with a per-node shared secret. Real
// deployments would use ed25519 with on-chain registered public keys;
// HMAC is the playground stand-in that proves the wiring works without
// dragging in tweetnacl/sodium.
//
// Canonical payload format: `${proofId}|${nodeId}|${stableJSON(vote)}`
// stableJSON sorts object keys so two clients never disagree on bytes.

import crypto from 'crypto';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function canonicalPayload(proofId, nodeId, vote) {
  return `${proofId}|${nodeId}|${stableStringify(vote)}`;
}

export class VoteSigner {
  // keys: { [nodeId]: secretString }
  constructor({ keys = {}, required = false } = {}) {
    this.keys = new Map(Object.entries(keys));
    this.required = required;
  }

  registerNode(nodeId, secret) {
    this.keys.set(nodeId, secret);
  }

  hasKey(nodeId) {
    return this.keys.has(nodeId);
  }

  sign({ proofId, nodeId, vote }) {
    const secret = this.keys.get(nodeId);
    if (!secret) {
      if (this.required) throw new Error(`No signing key for node ${nodeId}`);
      return null;
    }
    return crypto
      .createHmac('sha256', secret)
      .update(canonicalPayload(proofId, nodeId, vote))
      .digest('hex');
  }

  // Returns { ok, reason }. If signing isn't required and no signature
  // is supplied, ok=true (caller decides whether to trust).
  verify({ proofId, nodeId, vote, signature }) {
    if (!signature) {
      if (this.required) return { ok: false, reason: 'signature_required' };
      return { ok: true, reason: 'unsigned_allowed' };
    }
    const secret = this.keys.get(nodeId);
    if (!secret) return { ok: false, reason: 'unknown_node' };
    const expected = crypto
      .createHmac('sha256', secret)
      .update(canonicalPayload(proofId, nodeId, vote))
      .digest('hex');
    // timingSafeEqual guards against timing attacks; lengths must match.
    if (expected.length !== signature.length) return { ok: false, reason: 'bad_signature' };
    const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  }
}
