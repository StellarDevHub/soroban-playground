import {
  VoteSigner,
  canonicalPayload,
} from '../../src/services/oracle/voteSigner.js';

describe('VoteSigner', () => {
  it('signs and verifies a vote with the correct key', () => {
    const s = new VoteSigner({ keys: { A: 'secret' }, required: true });
    const sig = s.sign({ proofId: 'p', nodeId: 'A', vote: { v: 1 } });
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(s.verify({ proofId: 'p', nodeId: 'A', vote: { v: 1 }, signature: sig }).ok).toBe(true);
  });

  it('rejects a signature with a tampered vote', () => {
    const s = new VoteSigner({ keys: { A: 'secret' }, required: true });
    const sig = s.sign({ proofId: 'p', nodeId: 'A', vote: { v: 1 } });
    const result = s.verify({ proofId: 'p', nodeId: 'A', vote: { v: 2 }, signature: sig });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects a node we have no key for', () => {
    const s = new VoteSigner({ keys: {}, required: true });
    const result = s.verify({ proofId: 'p', nodeId: 'X', vote: 1, signature: 'a'.repeat(64) });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_node');
  });

  it('requires a signature when required=true', () => {
    const s = new VoteSigner({ keys: { A: 'secret' }, required: true });
    const result = s.verify({ proofId: 'p', nodeId: 'A', vote: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_required');
  });

  it('allows unsigned votes when required=false', () => {
    const s = new VoteSigner({ required: false });
    expect(s.verify({ proofId: 'p', nodeId: 'A', vote: 1 }).ok).toBe(true);
  });

  it('canonical payload sorts object keys', () => {
    const a = canonicalPayload('p', 'n', { b: 2, a: 1 });
    const b = canonicalPayload('p', 'n', { a: 1, b: 2 });
    expect(a).toBe(b);
  });
});
