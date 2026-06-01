#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

use crate::{Erc721, Erc721Client, Error};

fn setup() -> (Env, Address, Erc721Client<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, Erc721);
    let client = Erc721Client::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn make_string(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn make_address(env: &Env) -> Address {
    Address::generate(env)
}

fn zero_address() -> Address {
    Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000")
}

// ── Initialize Tests ─────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    assert_eq!(client.get_admin(&env).unwrap(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.initialize(&admin).unwrap_err();
    assert_eq!(err, Error::CapExceeded);
}

// ── Total Supply Tests ───────────────────────────────────────────────────────

#[test]
fn test_total_supply_initial() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    assert_eq!(client.total_supply(&env).unwrap(), 0);
}

#[test]
fn test_total_supply_after_mint() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    client.mint(&to, &1).unwrap();
    assert_eq!(client.total_supply(&env).unwrap(), 1);
}

// ── Balance Tests ───────────────────────────────────────────────────────────

#[test]
fn test_balance_of_new_address() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let addr = make_address(&env);
    assert_eq!(client.balance_of(&env, &addr).unwrap(), 0);
}

#[test]
fn test_balance_of_after_mint() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    client.mint(&to, &1).unwrap();
    assert_eq!(client.balance_of(&env, &to).unwrap(), 1);
}

#[test]
fn test_balance_after_transfer() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    client.mint(&alice, &1).unwrap();
    
    env.mock_all_auths();
    client.transfer_from(&alice, &bob, &1).unwrap();
    
    assert_eq!(client.balance_of(&env, &alice).unwrap(), 0);
    assert_eq!(client.balance_of(&env, &bob).unwrap(), 1);
}

// ── Owner Of Tests ─────────────────────────────────────────────────────────

#[test]
fn test_owner_of_valid() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    client.mint(&to, &1).unwrap();
    assert_eq!(client.owner_of(&env, &1).unwrap(), to);
}

#[test]
fn test_owner_of_nonexistent_token() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.owner_of(&env, &999).unwrap_err();
    assert_eq!(err, Error::TokenNotFound);
}

// ── Mint/Burn Lifecycle Tests ───────────────────────────────────────────────

#[test]
fn test_mint_burn_lifecycle() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    
    client.mint(&to, &1).unwrap();
    assert_eq!(client.balance_of(&env, &to).unwrap(), 1);
    assert_eq!(client.total_supply(&env).unwrap(), 1);
    
    client.burn(&to, &1).unwrap();
    assert_eq!(client.balance_of(&env, &to).unwrap(), 0);
    assert_eq!(client.total_supply(&env).unwrap(), 0);
    let err = client.owner_of(&env, &1).unwrap_err();
    assert_eq!(err, Error::TokenNotFound);
}

#[test]
fn test_multiple_mints() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    
    for i in 1..=5 {
        client.mint(&to, &i).unwrap();
    }
    
    assert_eq!(client.balance_of(&env, &to).unwrap(), 5);
    assert_eq!(client.total_supply(&env).unwrap(), 5);
}

#[test]
fn test_double_mint_same_token_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    client.mint(&to, &1).unwrap();
    let err = client.mint(&to, &1).unwrap_err();
    assert_eq!(err, Error::CapExceeded);
}

// ── Transfer Tests ─────────────────────────────────────────────────────────

#[test]
fn test_transfer_from_owner() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    env.mock_all_auths();
    client.transfer_from(&alice, &bob, &1).unwrap();
    
    assert_eq!(client.owner_of(&env, &1).unwrap(), bob);
}

#[test]
fn test_transfer_from_approved() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    let charlie = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    client.approve(&bob, &1).unwrap();
    env.mock_all_auths();
    client.transfer_from(&alice, &charlie, &1).unwrap();
    
    assert_eq!(client.owner_of(&env, &1).unwrap(), charlie);
}

#[test]
fn test_safe_transfer_to_zero_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    let err = client.safe_transfer_from(&alice, &zero_address(), &1).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_transfer_nonexistent_token_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    env.mock_all_auths();
    let err = client.transfer_from(&alice, &bob, &999).unwrap_err();
    assert_eq!(err, Error::TokenNotFound);
}

#[test]
fn test_unauthorized_transfer_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    let charlie = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    env.mock_all_auths();
    let err = client.transfer_from(&alice, &bob, &1).unwrap_err();
    assert_eq!(err, Error::NotApproved);
}

// ── Burn Tests ─────────────────────────────────────────────────────────────

#[test]
fn test_burn_by_owner() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    client.burn(&alice, &1).unwrap();
    
    let err = client.owner_of(&env, &1).unwrap_err();
    assert_eq!(err, Error::TokenNotFound);
}

#[test]
fn test_burn_nonexistent_token_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    
    let err = client.burn(&alice, &999).unwrap_err();
    assert_eq!(err, Error::TokenNotFound);
}

// ── Approval Tests ───────────────────────────────────────────────────────────

#[test]
fn test_approve_and_get_approved() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    client.approve(&bob, &1).unwrap();
    
    assert!(client.get_approved(&env, &1).unwrap().is_some());
}

#[test]
fn test_approve_not_owner_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    let charlie = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    // Bob (not owner) cannot approve
    env.mock_all_auths();
    let err = client.approve(&charlie, &1).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_set_approval_for_all() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    client.set_approval_for_all(&alice, &bob, &true).unwrap();
    assert!(client.is_approved_for_all(&env, &alice, &bob).unwrap());
}

#[test]
fn test_set_approval_for_all_false() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    client.set_approval_for_all(&alice, &bob, &true).unwrap();
    client.set_approval_for_all(&alice, &bob, &false).unwrap();
    assert!(!client.is_approved_for_all(&env, &alice, &bob).unwrap());
}

// ── Metadata Tests ───────────────────────────────────────────────────────────

#[test]
fn test_token_uri_not_set() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    
    client.mint(&to, &1).unwrap();
    let uri = client.token_uri(&env, &1).unwrap();
    assert_eq!(uri, make_string(&env, ""));
}

#[test]
fn test_set_token_uri_owner() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    
    client.mint(&to, &1).unwrap();
    client.set_token_uri(&to, &1, &make_string(&env, "https://example.com/token/1")).unwrap();
    
    let uri = client.token_uri(&env, &1).unwrap();
    assert_eq!(uri, make_string(&env, "https://example.com/token/1"));
}

#[test]
fn test_set_token_uri_uri_too_long() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let to = make_address(&env);
    
    client.mint(&to, &1).unwrap();
    
    let mut long_uri = String::from_str(&env, "");
    for _ in 0..513 {
        long_uri.push_str(&make_string(&env, "x"));
    }
    
    let err = client.set_token_uri(&to, &1, &long_uri).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

// ── Enumerable Tests ───────────────────────────────────────────────────────

#[test]
fn test_token_by_index() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let _ = client.token_by_index(&env, &0).unwrap();
}

#[test]
fn test_token_of_owner_by_index() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    let _ = client.token_of_owner_by_index(&env, &owner, &0).unwrap();
}

// ── Non-Initialized Tests ─────────────────────────────────────────────────

#[test]
fn test_total_supply_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.total_supply(&env).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_mint_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.mint(&make_address(&env), &1).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_burn_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.burn(&_admin, &1).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_approve_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.approve(&make_address(&env), &1).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

// ── Transfer Clear Approval Test ───────────────────────────────────────────

#[test]
fn test_transfer_clears_approval() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    let charlie = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    client.approve(&bob, &1).unwrap();
    
    env.mock_all_auths();
    client.transfer_from(&alice, &charlie, &1).unwrap();
    
    // Approval should be cleared
    assert!(client.get_approved(&env, &1).unwrap().is_none());
}

// ── Additional Transfer Tests ─────────────────────────────────────────────────

#[test]
fn test_transfer_multiple_tokens() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    for i in 1..=5 {
        client.mint(&alice, &i).unwrap();
    }
    
    for i in 1..=5 {
        env.mock_all_auths();
        client.transfer_from(&alice, &bob, &i).unwrap();
    }
    
    assert_eq!(client.balance_of(&env, &alice).unwrap(), 0);
    assert_eq!(client.balance_of(&env, &bob).unwrap(), 5);
}

#[test]
fn test_transfer_chain() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    let charlie = make_address(&env);
    let dave = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    env.mock_all_auths();
    client.transfer_from(&alice, &bob, &1).unwrap();
    client.transfer_from(&bob, &charlie, &1).unwrap();
    client.transfer_from(&charlie, &dave, &1).unwrap();
    
    assert_eq!(client.owner_of(&env, &1).unwrap(), dave);
}

#[test]
fn test_safe_transfer_from_owner() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    env.mock_all_auths();
    client.safe_transfer_from(&alice, &bob, &1).unwrap();
    
    assert_eq!(client.owner_of(&env, &1).unwrap(), bob);
}

// ── Additional Burn Tests ───────────────────────────────────────────────────

#[test]
fn test_burn_by_approved() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    client.approve(&bob, &1).unwrap();
    
    env.mock_all_auths();
    client.burn(&bob, &1).unwrap();
    
    let err = client.owner_of(&env, &1).unwrap_err();
    assert_eq!(err, Error::TokenNotFound);
}

#[test]
fn test_burn_not_owner_or_approved_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    let charlie = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    
    env.mock_all_auths();
    let err = client.burn(&charlie, &1).unwrap_err();
    assert_eq!(err, Error::NotApproved);
}

// ── Additional Mint Tests ─────────────────────────────────────────────────────

#[test]
fn test_mint_to_zero_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.mint(&zero_address(), &1).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_mint_multiple_owners() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let alice = make_address(&env);
    let bob = make_address(&env);
    
    client.mint(&alice, &1).unwrap();
    client.mint(&bob, &2).unwrap();
    client.mint(&alice, &3).unwrap();
    client.mint(&bob, &4).unwrap();
    
    assert_eq!(client.balance_of(&env, &alice).unwrap(), 2);
    assert_eq!(client.balance_of(&env, &bob).unwrap(), 2);
}

// ── Additional Approval Tests ─────────────────────────────────────────────────

#[test]
fn test_get_approved_nonexistent_token() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let result = client.get_approved(&env, &999).unwrap();
    assert!(result.is_none());
}

#[test]
fn test_multiple_approvals() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    
    for i in 1..=5 {
        client.mint(&owner, &i).unwrap();
    }
    
    for i in 1..=5 {
        let spender = make_address(&env);
        client.approve(&spender, &i).unwrap();
    }
}

#[test]
fn test_set_approval_for_all_different_operators() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    
    for _ in 0..3 {
        let operator = make_address(&env);
        client.set_approval_for_all(&owner, &operator, &true).unwrap();
    }
    
    for _ in 0..3 {
        let operator = make_address(&env);
        assert!(!client.is_approved_for_all(&env, &owner, &operator).unwrap());
    }
}

// ── Additional Metadata Tests ───────────────────────────────────────────────────

#[test]
fn test_set_token_uri_admin() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    let other = make_address(&env);
    
    client.mint(&owner, &1).unwrap();
    admin.require_auth();
    client.set_token_uri(&admin, &1, &make_string(&env, "ipfs://Qm...")).unwrap();
}

#[test]
fn test_set_token_uri_non_admin_non_owner_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    let other = make_address(&env);
    
    client.mint(&owner, &1).unwrap();
    
    env.mock_all_auths();
    let err = client.set_token_uri(&other, &1, &make_string(&env, "uri")).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_token_uri_multiple_tokens() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    
    for i in 1..=3 {
        client.mint(&owner, &i).unwrap();
        let mut uri = String::from_str(&env, "https://example.com/");
        uri.push_str(&i.to_string(&env));
        client.set_token_uri(&owner, &i, &uri).unwrap();
    }
    
    for i in 1..=3 {
        let uri = client.token_uri(&env, &i).unwrap();
        assert!(uri.to_string().contains(&i.to_string(&env)));
    }
}

// ── Additional Enumerable Tests ─────────────────────────────────────────────────

#[test]
fn test_token_by_index_minted() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    
    for i in 1..=10 {
        client.mint(&owner, &i).unwrap();
    }
    
    for i in 0..10 {
        let _ = client.token_by_index(&env, &i).unwrap();
    }
}

#[test]
fn test_token_of_owner_by_index_minted() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    
    for i in 1..=5 {
        client.mint(&owner, &i).unwrap();
    }
    
    for i in 0..5 {
        let _ = client.token_of_owner_by_index(&env, &owner, &i).unwrap();
    }
}

// ── Property: Sequential Mint/Burn Invariant ─────────────────────────────────

#[test]
fn test_sequential_mint_burn_preserves_supply() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    
    for i in 1..=20 {
        client.mint(&owner, &i).unwrap();
        assert_eq!(client.total_supply(&env).unwrap(), i as u64);
    }
    
    for i in 1..=20 {
        client.burn(&owner, &i).unwrap();
        assert_eq!(client.total_supply(&env).unwrap(), (20 - i) as u64);
    }
    
    assert_eq!(client.total_supply(&env).unwrap(), 0);
}

// ── Additional Non-initialized Tests ───────────────────────────────────────────

#[test]
fn test_transfer_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.transfer_from(&make_address(&env), &make_address(&env), &1).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_safe_transfer_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.safe_transfer_from(&make_address(&env), &make_address(&env), &1).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_approved_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.get_approved(&env, &1).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_token_uri_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.token_uri(&env, &1).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_token_by_index_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.token_by_index(&env, &0).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_token_of_owner_by_index_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.token_of_owner_by_index(&env, &make_address(&env), &0).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

// ── Additional Burn Tests ───────────────────────────────────────────────────

#[test]
fn test_burn_already_burned_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    client.mint(&owner, &1).unwrap();
    client.burn(&owner, &1).unwrap();
    let err = client.burn(&owner, &1).unwrap_err();
    assert_eq!(err, Error::TokenNotFound);
}

#[test]
fn test_burn_by_admin() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    client.mint(&owner, &1).unwrap();
    admin.require_auth();
    client.burn(&admin, &1).unwrap();
}

// ── Additional Approval Edge Cases ───────────────────────────────────────────

#[test]
fn test_approve_nonexistent_token_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let spender = make_address(&env);
    let owner = make_address(&env);
    client.mint(&owner, &1).unwrap();
    // This should succeed because mint sets the owner which can approve
    // Actually the test should fail because spender (invoker) is not owner
    env.mock_all_auths();
    let err = client.approve(&spender, &1).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

// ── Additional Enumerable Tests ─────────────────────────────────────────────────

#[test]
fn test_enumerable_out_of_bounds() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let _ = client.token_by_index(&env, &100).unwrap();
    let _ = client.token_of_owner_by_index(&env, &make_address(&env), &100).unwrap();
}

// ── Additional Metadata Boundary Tests ───────────────────────────────────────

#[test]
fn test_uri_exactly_512_chars() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    client.mint(&owner, &1).unwrap();
    let mut uri = String::from_str(&env, "");
    for _ in 0..512 {
        uri.push_str(&make_string(&env, "a"));
    }
    client.set_token_uri(&owner, &1, &uri).unwrap();
}

// ── Additional Transfer Edge Cases ───────────────────────────────────────────

#[test]
fn test_transfer_to_self() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    client.mint(&owner, &1).unwrap();
    env.mock_all_auths();
    client.transfer_from(&owner, &owner, &1).unwrap();
    assert_eq!(client.owner_of(&env, &1).unwrap(), owner);
}

#[test]
fn test_safe_transfer_to_self() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    client.mint(&owner, &1).unwrap();
    env.mock_all_auths();
    client.safe_transfer_from(&owner, &owner, &1).unwrap();
    assert_eq!(client.owner_of(&env, &1).unwrap(), owner);
}

// ── Balance Edge Cases ───────────────────────────────────────────────────────

#[test]
fn test_balance_after_burn() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let owner = make_address(&env);
    client.mint(&owner, &1).unwrap();
    assert_eq!(client.balance_of(&env, &owner).unwrap(), 1);
    client.burn(&owner, &1).unwrap();
    assert_eq!(client.balance_of(&env, &owner).unwrap(), 0);
}