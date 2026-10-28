import type { MerkleProof, ProofSibling } from "./types";

const MASK_64 = (1n << 64n) - 1n;

export function deterministicHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & MASK_64;
  }
  return `0x${hash.toString(16).padStart(16, "0")}`;
}

function hashPair(left: string, right: string): string {
  return deterministicHash(`${left}:${right}`);
}

export function generateMerkleProof(events: readonly string[], index: number): MerkleProof {
  if (events.length === 0) throw new Error("At least one bridge event is required.");
  if (!Number.isInteger(index) || index < 0 || index >= events.length) {
    throw new Error("Proof index is outside the event list.");
  }

  const leafHashes = events.map(deterministicHash);
  const siblings: ProofSibling[] = [];
  let level = leafHashes;
  let position = index;

  while (level.length > 1) {
    const siblingIndex = position % 2 === 0 ? position + 1 : position - 1;
    const sibling = level[siblingIndex] ?? level[position];
    siblings.push({ hash: sibling, position: position % 2 === 0 ? "right" : "left" });

    const nextLevel: string[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      nextLevel.push(hashPair(level[cursor], level[cursor + 1] ?? level[cursor]));
    }
    position = Math.floor(position / 2);
    level = nextLevel;
  }

  return {
    leaf: leafHashes[index],
    root: level[0],
    siblings,
    index,
    leafCount: events.length,
  };
}

export function verifyMerkleProof(
  leaf: string,
  root: string,
  siblings: readonly ProofSibling[],
  index: number,
): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  let current = leaf;
  let position = index;

  for (const sibling of siblings) {
    const expectedPosition = position % 2 === 0 ? "right" : "left";
    if (sibling.position !== expectedPosition) return false;
    current =
      sibling.position === "left"
        ? hashPair(sibling.hash, current)
        : hashPair(current, sibling.hash);
    position = Math.floor(position / 2);
  }
  return current === root;
}

export function verifyProof(proof: MerkleProof): boolean {
  if (proof.index >= proof.leafCount) return false;
  return verifyMerkleProof(proof.leaf, proof.root, proof.siblings, proof.index);
}