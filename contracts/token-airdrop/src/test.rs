#![cfg(test)]

use super::{hash_leaf, hash_pair, Error, ProofNode, TokenAirdrop, TokenAirdropClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, Vec as SorobanVec,
};
use std::vec::Vec as StdVec;

struct Setup<'a> {
    env: Env,
    admin: Address,
    contract_id: Address,
    client: TokenAirdropClient<'a>,
    token: Address,
    token_client: TokenClient<'a>,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TokenAirdrop);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token.address();

    let admin = Address::generate(&env);

    let env = Box::leak(Box::new(env));
    let client = TokenAirdropClient::new(env, &contract_id);
    let token_client = TokenClient::new(env, &token_addr);

    Setup {
        env: env.clone(),
        admin,
        contract_id,
        client,
        token: token_addr,
        token_client,
    }
}

fn build_tree(env: &Env, leaves: &[BytesN<32>]) -> StdVec<StdVec<BytesN<32>>> {
    let mut layers: StdVec<StdVec<BytesN<32>>> = StdVec::new();
    layers.push(leaves.to_vec());

    while layers.last().unwrap().len() > 1 {
        let prev = layers.last().unwrap();
        let mut next: StdVec<BytesN<32>> = StdVec::new();
        let mut i = 0;
        while i < prev.len() {
            let left = &prev[i];
            let right = if i + 1 < prev.len() { &prev[i + 1] } else { &prev[i] };
            next.push(hash_pair(env, left, right));
            i += 2;
        }
        layers.push(next);
    }

    layers
}

fn build_proof(env: &Env, leaves: &[BytesN<32>], index: usize) -> SorobanVec<ProofNode> {
    let layers = build_tree(env, leaves);
    let mut idx = index;
    let mut proof = SorobanVec::new(env);

    for layer in layers.iter().take(layers.len() - 1) {
        let is_right = idx % 2 == 1;
        let sibling_idx = if is_right { idx - 1 } else { idx + 1 };
        let sibling = if sibling_idx < layer.len() {
            layer[sibling_idx].clone()
        } else {
            layer[idx].clone()
        };
        proof.push_back(ProofNode {
            hash: sibling,
            is_left: is_right,
        });
        idx /= 2;
    }

    proof
}

#[test]
fn test_initialize_sets_config() {
    let s = setup();
    let root = BytesN::from_array(&s.env, &[7u8; 32]);

    s.client.initialize(&s.admin, &s.token, &root);

    assert_eq!(s.client.get_admin(), s.admin);
    assert_eq!(s.client.get_token(), s.token);
    assert_eq!(s.client.get_root(), root);
    assert_eq!(s.client.total_claimed(), 0);
}

#[test]
fn test_claim_success() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    let carol = Address::generate(&s.env);

    let amounts = [100i128, 250i128, 400i128];
    let leaves = [
        hash_leaf(&s.env, &alice, amounts[0]),
        hash_leaf(&s.env, &bob, amounts[1]),
        hash_leaf(&s.env, &carol, amounts[2]),
    ];

    let layers = build_tree(&s.env, &leaves);
    let root = layers.last().unwrap()[0].clone();
    s.client.initialize(&s.admin, &s.token, &root);

    let total = amounts.iter().sum::<i128>();
    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.mint(&s.contract_id, &total);

    let proof = build_proof(&s.env, &leaves, 1);
    s.client.claim(&bob, &amounts[1], &proof);

    assert_eq!(s.token_client.balance(&bob), amounts[1]);
    assert!(s.client.has_claimed(&bob));
    assert_eq!(s.client.total_claimed(), amounts[1]);
}

#[test]
fn test_claim_rejects_invalid_proof() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);

    let leaves = [
        hash_leaf(&s.env, &alice, 100),
        hash_leaf(&s.env, &bob, 200),
    ];

    let layers = build_tree(&s.env, &leaves);
    let root = layers.last().unwrap()[0].clone();
    s.client.initialize(&s.admin, &s.token, &root);

    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.mint(&s.contract_id, &500);

    let proof = build_proof(&s.env, &leaves, 0);
    let result = s.client.try_claim(&bob, &200, &proof);
    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}

#[test]
fn test_claim_twice_fails() {
    let s = setup();
    let alice = Address::generate(&s.env);

    let leaves = [hash_leaf(&s.env, &alice, 100)];
    let root = leaves[0].clone();
    s.client.initialize(&s.admin, &s.token, &root);

    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.mint(&s.contract_id, &100);

    let proof = build_proof(&s.env, &leaves, 0);
    s.client.claim(&alice, &100, &proof);

    let result = s.client.try_claim(&alice, &100, &proof);
    assert_eq!(result, Err(Ok(Error::AlreadyClaimed)));
}

#[test]
fn test_pause_blocks_claim() {
    let s = setup();
    let alice = Address::generate(&s.env);

    let leaves = [hash_leaf(&s.env, &alice, 100)];
    let root = leaves[0].clone();
    s.client.initialize(&s.admin, &s.token, &root);

    let sac = StellarAssetClient::new(&s.env, &s.token);
    sac.mint(&s.contract_id, &100);

    s.client.pause(&s.admin);

    let proof = build_proof(&s.env, &leaves, 0);
    let result = s.client.try_claim(&alice, &100, &proof);
    assert_eq!(result, Err(Ok(Error::Paused)));
}
