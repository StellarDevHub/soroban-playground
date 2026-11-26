//! Canonical Merkle proof verification.
//!
//! * **Sorted pair hashing**: sibling nodes are ordered lexicographically
//!   (`left <= right`) before hashing, so a proof does not need to carry
//!   left/right flags and cannot be re-ordered to forge a different path.
//! * **Domain separation**: leaves are hashed with a `0x00` prefix and interior
//!   nodes with a `0x01` prefix, so an interior node can never be presented as
//!   a leaf (the classic second-preimage attack).

use soroban_sdk::{Bytes, BytesN, Env, Vec};

/// Prefix prepended to leaf data before hashing.
pub const LEAF_PREFIX: u8 = 0x00;
/// Prefix prepended to the concatenated children of an interior node.
pub const NODE_PREFIX: u8 = 0x01;
/// Maximum accepted proof length (a tree of 2^64 leaves).
pub const MAX_PROOF_DEPTH: u32 = 64;

/// `sha256(0x00 || data)`
pub fn hash_leaf(env: &Env, data: &Bytes) -> BytesN<32> {
    let mut buf = Bytes::from_array(env, &[LEAF_PREFIX]);
    buf.append(data);
    env.crypto().sha256(&buf).to_bytes()
}

/// `sha256(0x01 || min(a, b) || max(a, b))`
pub fn hash_node(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let (left, right) = if a <= b { (a, b) } else { (b, a) };
    let mut buf = Bytes::from_array(env, &[NODE_PREFIX]);
    buf.append(&Bytes::from_array(env, &left.to_array()));
    buf.append(&Bytes::from_array(env, &right.to_array()));
    env.crypto().sha256(&buf).to_bytes()
}

/// Verifies that `leaf_data` is committed to by `root` through `proof`.
///
/// The raw leaf data is hashed here (with the leaf prefix) rather than accepted
/// as a pre-computed hash, so callers cannot smuggle an interior node in as a leaf.
pub fn verify(env: &Env, root: &BytesN<32>, leaf_data: &Bytes, proof: &Vec<BytesN<32>>) -> bool {
    if proof.len() > MAX_PROOF_DEPTH {
        return false;
    }
    let mut current = hash_leaf(env, leaf_data);
    for sibling in proof.iter() {
        current = hash_node(env, &current, &sibling);
    }
    current == *root
}
