import { describe, expect, it } from "@jest/globals";
import { generateMerkleProof, verifyMerkleProof, verifyProof } from "../merkle";

describe("mock Merkle proofs", () => {
  it("verifies proofs for each leaf", () => {
    const events = ["lock:1", "lock:2", "lock:3"];
    events.forEach((event, index) => {
      const proof = generateMerkleProof(events, index);
      expect(verifyProof(proof)).toBe(true);
      expect(proof.leaf).toBeTruthy();
      expect(proof.root).toBeTruthy();
    });
  });

  it("rejects a tampered leaf, root, or sibling path", () => {
    const proof = generateMerkleProof(["lock:1", "lock:2", "lock:3"], 1);
    expect(verifyMerkleProof(`${proof.leaf}x`, proof.root, proof.siblings, proof.index)).toBe(false);
    expect(verifyMerkleProof(proof.leaf, `${proof.root}x`, proof.siblings, proof.index)).toBe(false);
    const siblings = proof.siblings.map((sibling, index) => index === 0 ? { ...sibling, hash: "0xdeadbeef" } : sibling);
    expect(verifyMerkleProof(proof.leaf, proof.root, siblings, proof.index)).toBe(false);
  });

  it("rejects empty trees and out-of-range indices", () => {
    expect(() => generateMerkleProof([], 0)).toThrow(/at least one/i);
    expect(() => generateMerkleProof(["event"], 1)).toThrow(/outside/i);
  });
});