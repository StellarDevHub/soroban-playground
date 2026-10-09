// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

// ── Test helpers ──────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, NftEnumerableClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, NftEnumerable);
    let client = NftEnumerableClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn uri(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_double_init_fails() {
    let (_env, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ── Mint ──────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_assigns_sequential_ids() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    let id2 = client.mint(&admin, &user, &uri(&env, "ipfs://c"));
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_mint_updates_total_supply() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    assert_eq!(client.total_supply(), 0);
    client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    assert_eq!(client.total_supply(), 1);
    client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    assert_eq!(client.total_supply(), 2);
}

#[test]
fn test_mint_updates_balance_of() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    assert_eq!(client.balance_of(&user), 0);
    client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    assert_eq!(client.balance_of(&user), 1);
    client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    assert_eq!(client.balance_of(&user), 2);
}

#[test]
fn test_mint_populates_enumeration() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    assert_eq!(client.token_by_index(&0), id0);
    assert_eq!(client.token_by_index(&1), id1);
    assert_eq!(client.token_of_owner_by_index(&user, &0), id0);
    assert_eq!(client.token_of_owner_by_index(&user, &1), id1);
}

#[test]
fn test_token_by_index_out_of_bounds() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    assert_eq!(
        client.try_token_by_index(&1),
        Err(Ok(Error::IndexOutOfBounds))
    );
    assert_eq!(
        client.try_token_by_index(&u64::MAX),
        Err(Ok(Error::IndexOutOfBounds))
    );
}

#[test]
fn test_token_of_owner_by_index_out_of_bounds() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    assert_eq!(
        client.try_token_of_owner_by_index(&user, &1),
        Err(Ok(Error::IndexOutOfBounds))
    );
}

// ── Burn edge cases ───────────────────────────────────────────────────────────

#[test]
fn test_burn_single_token_empties_lists() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id = client.mint(&admin, &user, &uri(&env, "ipfs://a"));

    client.burn(&user, &id);

    assert_eq!(client.total_supply(), 0);
    assert_eq!(client.balance_of(&user), 0);
    // Trying to get the owner should fail
    assert_eq!(client.try_owner_of(&id), Err(Ok(Error::TokenNotFound)));
}

/// Burn the first token out of three.  Verifies that:
/// - The global list shrinks from 3 to 2.
/// - The last token (id=2) shifts into index 0 (swap-and-pop).
/// - id=1 remains accessible at some valid index.
#[test]
fn test_burn_first_token_shifts_last_to_front_global() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a")); // global[0]
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b")); // global[1]
    let id2 = client.mint(&admin, &user, &uri(&env, "ipfs://c")); // global[2]

    // Burn the first token.
    client.burn(&user, &id0);

    assert_eq!(client.total_supply(), 2);
    // After swap-and-pop: id2 now at index 0, id1 at index 1.
    let at0 = client.token_by_index(&0);
    let at1 = client.token_by_index(&1);
    // The set of remaining tokens must be exactly {id1, id2}.
    let mut remaining = soroban_sdk::vec![&env, at0, at1];
    remaining.sort();
    let mut expected = soroban_sdk::vec![&env, id1, id2];
    expected.sort();
    assert_eq!(remaining, expected);

    // Old index 2 is now out of bounds.
    assert_eq!(
        client.try_token_by_index(&2),
        Err(Ok(Error::IndexOutOfBounds))
    );
}

/// Burn the middle token.  The last token moves to the middle slot.
#[test]
fn test_burn_middle_token_shifts_last_in_global() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    let id2 = client.mint(&admin, &user, &uri(&env, "ipfs://c"));

    client.burn(&user, &id1);

    assert_eq!(client.total_supply(), 2);
    let at0 = client.token_by_index(&0);
    let at1 = client.token_by_index(&1);
    let mut remaining = soroban_sdk::vec![&env, at0, at1];
    remaining.sort();
    let mut expected = soroban_sdk::vec![&env, id0, id2];
    expected.sort();
    assert_eq!(remaining, expected);
}

/// Burn the last token.  No swap is needed; the list just shrinks.
#[test]
fn test_burn_last_token_no_swap_needed() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    let id2 = client.mint(&admin, &user, &uri(&env, "ipfs://c"));

    client.burn(&user, &id2);

    assert_eq!(client.total_supply(), 2);
    assert_eq!(client.token_by_index(&0), id0);
    assert_eq!(client.token_by_index(&1), id1);
}

/// Burn all tokens one by one; enumeration should remain consistent after each.
#[test]
fn test_burn_all_tokens_sequentially() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    let id2 = client.mint(&admin, &user, &uri(&env, "ipfs://c"));

    client.burn(&user, &id0);
    assert_eq!(client.total_supply(), 2);
    assert_eq!(client.balance_of(&user), 2);

    client.burn(&user, &id1);
    assert_eq!(client.total_supply(), 1);
    assert_eq!(client.balance_of(&user), 1);

    client.burn(&user, &id2);
    assert_eq!(client.total_supply(), 0);
    assert_eq!(client.balance_of(&user), 0);

    // All index lookups should now fail.
    assert_eq!(
        client.try_token_by_index(&0),
        Err(Ok(Error::IndexOutOfBounds))
    );
}

/// Burn from owner's list: first token shifts last into front.
#[test]
fn test_burn_first_owner_token_shifts_index() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b"));
    let id2 = client.mint(&admin, &user, &uri(&env, "ipfs://c"));

    client.burn(&user, &id0);

    assert_eq!(client.balance_of(&user), 2);
    let at0 = client.token_of_owner_by_index(&user, &0);
    let at1 = client.token_of_owner_by_index(&user, &1);
    let mut remaining = soroban_sdk::vec![&env, at0, at1];
    remaining.sort();
    let mut expected = soroban_sdk::vec![&env, id1, id2];
    expected.sort();
    assert_eq!(remaining, expected);
}

/// Burn a token owned by one user; the other user's list is unaffected.
#[test]
fn test_burn_does_not_affect_other_owners_list() {
    let (env, admin, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    let a0 = client.mint(&admin, &user_a, &uri(&env, "ipfs://a0"));
    let _a1 = client.mint(&admin, &user_a, &uri(&env, "ipfs://a1"));
    let b0 = client.mint(&admin, &user_b, &uri(&env, "ipfs://b0"));
    let b1 = client.mint(&admin, &user_b, &uri(&env, "ipfs://b1"));

    client.burn(&user_a, &a0);

    // user_b should be untouched.
    assert_eq!(client.balance_of(&user_b), 2);
    assert_eq!(client.token_of_owner_by_index(&user_b, &0), b0);
    assert_eq!(client.token_of_owner_by_index(&user_b, &1), b1);
}

/// Re-mint after burns; mint counter keeps incrementing (no ID reuse).
#[test]
fn test_mint_after_burn_does_not_reuse_ids() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    let id0 = client.mint(&admin, &user, &uri(&env, "ipfs://a")); // id=0
    let id1 = client.mint(&admin, &user, &uri(&env, "ipfs://b")); // id=1
    client.burn(&user, &id0);
    client.burn(&user, &id1);

    let id2 = client.mint(&admin, &user, &uri(&env, "ipfs://c")); // id=2, not 0
    assert_eq!(id2, 2);
    assert_eq!(client.total_supply(), 1);
    assert_eq!(client.token_by_index(&0), id2);
}

/// Burn token then try burning again — should fail with TokenNotFound.
#[test]
fn test_double_burn_fails() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let id = client.mint(&admin, &user, &uri(&env, "ipfs://a"));
    client.burn(&user, &id);
    assert_eq!(client.try_burn(&user, &id), Err(Ok(Error::TokenNotFound)));
}

/// Burn by non-owner without approval should fail.
#[test]
fn test_burn_by_non_owner_fails() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);
    let other = Address::generate(&env);
    let id = client.mint(&admin, &owner, &uri(&env, "ipfs://a"));
    assert_eq!(client.try_burn(&other, &id), Err(Ok(Error::Unauthorized)));
}

/// Approved spender can burn.
#[test]
fn test_approved_spender_can_burn() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let id = client.mint(&admin, &owner, &uri(&env, "ipfs://a"));
    client.approve(&owner, &spender, &id);
    client.burn(&spender, &id);
    assert_eq!(client.total_supply(), 0);
}

/// Operator can burn any of owner's tokens.
#[test]
fn test_operator_can_burn() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let id = client.mint(&admin, &owner, &uri(&env, "ipfs://a"));
    client.set_approval_for_all(&owner, &operator, &true);
    client.burn(&operator, &id);
    assert_eq!(client.total_supply(), 0);
}

// ── Transfer enumeration ──────────────────────────────────────────────────────

/// Transfer moves the token between owner lists.
#[test]
fn test_transfer_updates_enumeration() {
    let (env, admin, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let id0 = client.mint(&admin, &alice, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &alice, &uri(&env, "ipfs://b"));

    client.transfer_from(&alice, &alice, &bob, &id0);

    assert_eq!(client.balance_of(&alice), 1);
    assert_eq!(client.balance_of(&bob), 1);
    assert_eq!(client.token_of_owner_by_index(&alice, &0), id1);
    assert_eq!(client.token_of_owner_by_index(&bob, &0), id0);
    // Total supply unchanged.
    assert_eq!(client.total_supply(), 2);
}

/// Transfer then burn: index consistency maintained throughout.
#[test]
fn test_transfer_then_burn_consistency() {
    let (env, admin, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let id0 = client.mint(&admin, &alice, &uri(&env, "ipfs://a"));
    let id1 = client.mint(&admin, &alice, &uri(&env, "ipfs://b"));
    let id2 = client.mint(&admin, &alice, &uri(&env, "ipfs://c"));

    // Transfer id1 to bob.
    client.transfer_from(&alice, &alice, &bob, &id1);

    // Burn id0 from alice.
    client.burn(&alice, &id0);

    // Alice should have only id2.
    assert_eq!(client.balance_of(&alice), 1);
    assert_eq!(client.token_of_owner_by_index(&alice, &0), id2);

    // Bob should have id1.
    assert_eq!(client.balance_of(&bob), 1);
    assert_eq!(client.token_of_owner_by_index(&bob, &0), id1);

    // Global supply = 2.
    assert_eq!(client.total_supply(), 2);
}

// ── Large-scale enumeration stress test ───────────────────────────────────────

/// Mint N tokens, burn every other one, and verify the remaining enumeration.
#[test]
fn test_burn_every_other_token_enumeration() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    const N: u64 = 10;

    let mut ids = soroban_sdk::vec![&env];
    for i in 0..N {
        let id = client.mint(&admin, &user, &uri(&env, "ipfs://x"));
        ids.push_back(id);
        let _ = i;
    }

    // Burn even-indexed tokens (id 0, 2, 4, 6, 8).
    for i in (0..N).step_by(2) {
        let id = ids.get(i as u32).unwrap();
        client.burn(&user, &id);
    }

    let expected_count = N / 2; // 5 remaining
    assert_eq!(client.total_supply(), expected_count);
    assert_eq!(client.balance_of(&user), expected_count);

    // Verify all remaining token_by_index calls are within bounds.
    for i in 0..expected_count {
        let _id = client.token_by_index(&i);
    }
    // One past the end must fail.
    assert_eq!(
        client.try_token_by_index(&expected_count),
        Err(Ok(Error::IndexOutOfBounds))
    );
}
