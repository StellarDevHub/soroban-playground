#![cfg(test)]
use super::{AllowlistContract, AllowlistContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_allowlist() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AllowlistContract);
    let client = AllowlistContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // 1. Initialize the contract.
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);

    // 2. Add user1 to allowlist as admin.
    env.mock_all_auths();
    client.add(&admin, &user1);
    assert!(client.is_allowed(&user1));
    assert!(!client.is_allowed(&user2));

    // 3. Add user2 to allowlist.
    client.add(&admin, &user2);
    assert!(client.is_allowed(&user2));

    // 4. Remove user1 from allowlist.
    client.remove(&admin, &user1);
    assert!(!client.is_allowed(&user1));
    assert!(client.is_allowed(&user2));
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_unauthorized_add() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AllowlistContract);
    let client = AllowlistContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    env.mock_all_auths();
    client.add(&non_admin, &user); // Should panic
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_already_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AllowlistContract);
    let client = AllowlistContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}

// ── Merkle proof verification ───────────────────────────────────────────────

use soroban_sdk::{xdr::ToXdr, Bytes, BytesN, Vec};

// Test vectors generated independently with Python's hashlib:
//   leaf(d) = sha256(0x00 || d), node(a, b) = sha256(0x01 || min(a, b) || max(a, b))
//   leaves are the data b"leaf-0" .. b"leaf-3" in a 4-leaf tree.
const L0: [u8; 32] = [
    0x30, 0x5d, 0xf5, 0x9f, 0x95, 0x90, 0xc3, 0xc9, 0xac, 0x63, 0xd2, 0xb2, 0x74, 0x3c, 0x38, 0x8e,
    0x37, 0x92, 0x44, 0x90, 0x78, 0xce, 0xbf, 0x7f, 0xb3, 0xdb, 0xe6, 0x47, 0x16, 0x43, 0xb2, 0xb7,
];
const L1: [u8; 32] = [
    0x31, 0x45, 0xc4, 0x09, 0xf2, 0x59, 0xb7, 0xc5, 0x3e, 0x32, 0x03, 0x60, 0x90, 0xff, 0x76, 0x75,
    0x10, 0x25, 0xa2, 0x49, 0x8b, 0xa9, 0x82, 0x3e, 0xf7, 0x18, 0xca, 0xc5, 0x0b, 0x4e, 0x61, 0x6f,
];
const L2: [u8; 32] = [
    0xfc, 0xa8, 0x9f, 0x57, 0xc9, 0xf8, 0xc8, 0xeb, 0x40, 0x47, 0xa7, 0xff, 0x9d, 0x33, 0x3a, 0xcf,
    0x9e, 0x0f, 0x33, 0x84, 0xb2, 0x0b, 0x25, 0x5b, 0xce, 0xab, 0x0f, 0x21, 0x6d, 0xcc, 0xa2, 0x67,
];
const L3: [u8; 32] = [
    0xf7, 0x68, 0x36, 0x32, 0x5a, 0xec, 0x56, 0x99, 0xd8, 0xd7, 0x1f, 0x8e, 0x42, 0xe9, 0xd4, 0x7c,
    0x5c, 0x29, 0xb0, 0x80, 0x59, 0xba, 0x29, 0x63, 0x84, 0xf7, 0xca, 0x40, 0xad, 0x3a, 0x40, 0xae,
];
const N01: [u8; 32] = [
    0x60, 0xa5, 0x3e, 0xed, 0x0d, 0xe8, 0x7a, 0x90, 0xc8, 0xe5, 0x94, 0x27, 0xc5, 0x9c, 0x46, 0x25,
    0x3c, 0x33, 0xa7, 0x6a, 0x09, 0x50, 0x2a, 0x51, 0x80, 0x13, 0x00, 0x92, 0x7b, 0x7e, 0x6b, 0xdc,
];
const N23: [u8; 32] = [
    0xfa, 0x54, 0xd7, 0xc7, 0x31, 0xc9, 0x99, 0x63, 0x4f, 0xd9, 0x2d, 0x30, 0x8f, 0x5a, 0xbd, 0x08,
    0xd7, 0x14, 0xab, 0xcd, 0xdd, 0x6b, 0xc5, 0xae, 0x84, 0x9d, 0x12, 0xdd, 0x4f, 0x24, 0x82, 0x62,
];
const ROOT: [u8; 32] = [
    0x50, 0xb7, 0x1e, 0x59, 0xcb, 0x57, 0x95, 0x39, 0x0f, 0xc9, 0x41, 0x54, 0x55, 0x14, 0x1e, 0xbf,
    0xb5, 0x75, 0x5d, 0xbf, 0xd3, 0x2b, 0xc1, 0x50, 0xee, 0xe9, 0x06, 0xeb, 0x1a, 0x29, 0xd5, 0x94,
];

fn bn(env: &Env, a: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, a)
}

fn proof(env: &Env, nodes: &[[u8; 32]]) -> Vec<BytesN<32>> {
    let mut v = Vec::new(env);
    for n in nodes {
        v.push_back(bn(env, n));
    }
    v
}

fn leaf_data(env: &Env, i: u8) -> Bytes {
    Bytes::from_slice(env, &[b'l', b'e', b'a', b'f', b'-', b'0' + i])
}

fn client(env: &Env) -> AllowlistContractClient<'_> {
    let id = env.register_contract(None, AllowlistContract);
    AllowlistContractClient::new(env, &id)
}

#[test]
fn test_leaf_and_node_hashes_match_known_vectors() {
    let env = Env::default();
    let c = client(&env);

    assert_eq!(c.hash_leaf(&leaf_data(&env, 0)), bn(&env, &L0));
    assert_eq!(c.hash_leaf(&leaf_data(&env, 3)), bn(&env, &L3));
    assert_eq!(c.hash_node(&bn(&env, &L0), &bn(&env, &L1)), bn(&env, &N01));
    assert_eq!(
        c.hash_node(&bn(&env, &N01), &bn(&env, &N23)),
        bn(&env, &ROOT)
    );
}

#[test]
fn test_pair_hashing_is_canonical_regardless_of_argument_order() {
    let env = Env::default();
    let c = client(&env);

    assert_eq!(
        c.hash_node(&bn(&env, &L0), &bn(&env, &L1)),
        c.hash_node(&bn(&env, &L1), &bn(&env, &L0))
    );
    assert_eq!(
        c.hash_node(&bn(&env, &N23), &bn(&env, &N01)),
        bn(&env, &ROOT)
    );
}

#[test]
fn test_valid_proofs_verify_for_every_leaf() {
    let env = Env::default();
    let c = client(&env);
    let root = bn(&env, &ROOT);

    assert!(c.verify_merkle_proof(&root, &leaf_data(&env, 0), &proof(&env, &[L1, N23])));
    assert!(c.verify_merkle_proof(&root, &leaf_data(&env, 1), &proof(&env, &[L0, N23])));
    assert!(c.verify_merkle_proof(&root, &leaf_data(&env, 2), &proof(&env, &[L3, N01])));
    assert!(c.verify_merkle_proof(&root, &leaf_data(&env, 3), &proof(&env, &[L2, N01])));
}

#[test]
fn test_invalid_proofs_are_rejected() {
    let env = Env::default();
    let c = client(&env);
    let root = bn(&env, &ROOT);

    // Wrong leaf for the proof.
    assert!(!c.verify_merkle_proof(&root, &leaf_data(&env, 2), &proof(&env, &[L1, N23])));
    // Wrong sibling.
    assert!(!c.verify_merkle_proof(&root, &leaf_data(&env, 0), &proof(&env, &[L2, N23])));
    // Truncated proof.
    assert!(!c.verify_merkle_proof(&root, &leaf_data(&env, 0), &proof(&env, &[L1])));
    // Empty proof for a non-single-leaf tree.
    assert!(!c.verify_merkle_proof(&root, &leaf_data(&env, 0), &proof(&env, &[])));
    // Wrong root.
    assert!(!c.verify_merkle_proof(
        &bn(&env, &N01),
        &leaf_data(&env, 0),
        &proof(&env, &[L1, N23])
    ));
}

#[test]
fn test_interior_node_cannot_be_forged_as_a_leaf() {
    let env = Env::default();
    let c = client(&env);
    let root = bn(&env, &ROOT);

    // Second-preimage attempt: present the two children of the root (N01 || N23,
    // sorted) as "leaf data" with an empty proof. Without domain separation the
    // 64-byte concatenation would hash to the root; with prefixes it must not.
    let mut forged = Bytes::new(&env);
    forged.append(&Bytes::from_array(&env, &N01));
    forged.append(&Bytes::from_array(&env, &N23));
    assert!(!c.verify_merkle_proof(&root, &forged, &proof(&env, &[])));

    // Presenting an interior node's hash itself as leaf data also fails.
    assert!(!c.verify_merkle_proof(&root, &Bytes::from_array(&env, &N01), &proof(&env, &[N23])));
}

#[test]
fn test_overlong_proof_is_rejected() {
    let env = Env::default();
    let c = client(&env);

    let mut long = Vec::new(&env);
    for _ in 0..65 {
        long.push_back(bn(&env, &L1));
    }
    assert!(!c.verify_merkle_proof(&bn(&env, &ROOT), &leaf_data(&env, 0), &long));
}

#[test]
fn test_merkle_allowlist_for_addresses() {
    let env = Env::default();
    env.mock_all_auths();
    let c = client(&env);
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let mallory = Address::generate(&env);
    c.initialize(&admin);

    // Build a two-leaf tree over (alice, bob) using the contract's own helpers.
    let la = c.hash_leaf(&alice.clone().to_xdr(&env));
    let lb = c.hash_leaf(&bob.clone().to_xdr(&env));
    let root = c.hash_node(&la, &lb);

    assert_eq!(c.get_merkle_root(), None);
    assert!(!c.is_allowed_by_proof(&alice, &Vec::from_array(&env, [lb.clone()])));

    c.set_merkle_root(&admin, &root);
    assert_eq!(c.get_merkle_root(), Some(root));

    assert!(c.is_allowed_by_proof(&alice, &Vec::from_array(&env, [lb.clone()])));
    assert!(c.is_allowed_by_proof(&bob, &Vec::from_array(&env, [la.clone()])));
    // An address outside the tree cannot reuse another member's proof.
    assert!(!c.is_allowed_by_proof(&mallory, &Vec::from_array(&env, [lb])));
    // Direct allowlist entries still work without a proof.
    c.add(&admin, &mallory);
    assert!(c.is_allowed_by_proof(&mallory, &Vec::new(&env)));
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_set_merkle_root_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let c = client(&env);
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    c.initialize(&admin);
    c.set_merkle_root(&attacker, &bn(&env, &ROOT));
}
