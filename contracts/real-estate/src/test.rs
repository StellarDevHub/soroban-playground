// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, RealEstateContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, RealEstateContract);
    let client = RealEstateContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn add_property(env: &Env, client: &RealEstateContractClient, admin: &Address) -> u32 {
    client.list_property(
        admin,
        &String::from_str(env, "123 Main St"),
        &1000,
        &1_000_000,
    )
}

/// Create a whitelisted investor for use in tests.
fn approved_investor(env: &Env, client: &RealEstateContractClient, admin: &Address) -> Address {
    let investor = Address::generate(env);
    client.approve_investor(admin, &investor);
    investor
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ── KYC / AML whitelist management ───────────────────────────────────────────

#[test]
fn test_default_kyc_status_is_pending() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    assert_eq!(client.kyc_status(&stranger), KycStatus::Pending);
}

#[test]
fn test_approve_investor_sets_approved() {
    let (env, admin, client) = setup();
    let investor = Address::generate(&env);
    client.approve_investor(&admin, &investor);
    assert_eq!(client.kyc_status(&investor), KycStatus::Approved);
}

#[test]
fn test_revoke_investor_sets_revoked() {
    let (env, admin, client) = setup();
    let investor = Address::generate(&env);
    client.approve_investor(&admin, &investor);
    client.revoke_investor(&admin, &investor);
    assert_eq!(client.kyc_status(&investor), KycStatus::Revoked);
}

#[test]
fn test_approve_after_revoke_restores_approved() {
    let (env, admin, client) = setup();
    let investor = Address::generate(&env);
    client.approve_investor(&admin, &investor);
    client.revoke_investor(&admin, &investor);
    client.approve_investor(&admin, &investor);
    assert_eq!(client.kyc_status(&investor), KycStatus::Approved);
}

#[test]
fn test_non_admin_cannot_approve_investor() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    let victim = Address::generate(&env);
    assert_eq!(
        client.try_approve_investor(&stranger, &victim),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_non_admin_cannot_revoke_investor() {
    let (env, admin, client) = setup();
    let investor = Address::generate(&env);
    client.approve_investor(&admin, &investor);
    let attacker = Address::generate(&env);
    assert_eq!(
        client.try_revoke_investor(&attacker, &investor),
        Err(Ok(Error::Unauthorized))
    );
}

// ── Property management ───────────────────────────────────────────────────────

#[test]
fn test_list_property_stores_data() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let p = client.get_property(&id);
    assert_eq!(p.total_shares, 1000);
    assert_eq!(p.price_per_share, 1_000_000);
    assert!(p.is_listed);
    assert_eq!(p.shares_sold, 0);
}

#[test]
fn test_list_property_sequential_ids() {
    let (env, admin, client) = setup();
    assert_eq!(add_property(&env, &client, &admin), 1);
    assert_eq!(add_property(&env, &client, &admin), 2);
}

#[test]
fn test_list_property_empty_name_fails() {
    let (env, admin, client) = setup();
    let r = client.try_list_property(&admin, &String::from_str(&env, ""), &1000, &1_000_000);
    assert_eq!(r, Err(Ok(Error::EmptyName)));
}

#[test]
fn test_list_property_zero_shares_fails() {
    let (env, admin, client) = setup();
    let r = client.try_list_property(&admin, &String::from_str(&env, "House"), &0, &1_000_000);
    assert_eq!(r, Err(Ok(Error::ZeroTotalShares)));
}

#[test]
fn test_list_property_zero_price_fails() {
    let (env, admin, client) = setup();
    let r = client.try_list_property(&admin, &String::from_str(&env, "House"), &1000, &0);
    assert_eq!(r, Err(Ok(Error::ZeroPrice)));
}

#[test]
fn test_list_property_non_admin_fails() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    let r = client.try_list_property(
        &stranger,
        &String::from_str(&env, "House"),
        &1000,
        &1_000_000,
    );
    assert_eq!(r, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_delist_property() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    client.delist_property(&admin, &id);
    assert!(!client.get_property(&id).is_listed);
}

// ── buy_shares – KYC/AML enforcement ─────────────────────────────────────────

#[test]
fn test_buy_shares_pending_investor_blocked() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = Address::generate(&env); // status = Pending, never approved
    assert_eq!(
        client.try_buy_shares(&investor, &id, &10),
        Err(Ok(Error::NotWhitelisted))
    );
}

#[test]
fn test_buy_shares_revoked_investor_blocked() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = Address::generate(&env);
    client.approve_investor(&admin, &investor);
    client.revoke_investor(&admin, &investor);
    assert_eq!(
        client.try_buy_shares(&investor, &id, &10),
        Err(Ok(Error::Blacklisted))
    );
}

#[test]
fn test_buy_shares_approved_investor_succeeds() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    let cost = client.buy_shares(&investor, &id, &100);
    assert_eq!(cost, 100 * 1_000_000);
    assert_eq!(client.get_ownership(&investor, &id).shares, 100);
    assert_eq!(client.get_property(&id).shares_sold, 100);
}

#[test]
fn test_buy_shares_on_delisted_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    client.delist_property(&admin, &id);
    let investor = approved_investor(&env, &client, &admin);
    assert_eq!(
        client.try_buy_shares(&investor, &id, &10),
        Err(Ok(Error::NotForSale))
    );
}

#[test]
fn test_buy_shares_zero_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    assert_eq!(
        client.try_buy_shares(&investor, &id, &0),
        Err(Ok(Error::ZeroShares))
    );
}

#[test]
fn test_buy_shares_exceeds_supply_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    assert_eq!(
        client.try_buy_shares(&investor, &id, &1001),
        Err(Ok(Error::ExceedsTotalSupply))
    );
}

#[test]
fn test_multiple_whitelisted_investors_accumulate_shares_sold() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &300);
    client.buy_shares(&bob, &id, &500);
    assert_eq!(client.get_property(&id).shares_sold, 800);
}

#[test]
fn test_buy_more_shares_accumulates() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    client.buy_shares(&investor, &id, &100);
    client.buy_shares(&investor, &id, &200);
    assert_eq!(client.get_ownership(&investor, &id).shares, 300);
}

// ── transfer_shares – KYC/AML enforcement ────────────────────────────────────

#[test]
fn test_transfer_shares_both_approved_succeeds() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &400);
    client.transfer_shares(&alice, &bob, &id, &150);
    assert_eq!(client.get_ownership(&alice, &id).shares, 250);
    assert_eq!(client.get_ownership(&bob, &id).shares, 150);
}

#[test]
fn test_transfer_shares_pending_sender_blocked() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    // alice owns shares (added directly via internal state won't work, so we
    // first approve, buy, then revoke to simulate a revoked owner trying to transfer)
    let alice = approved_investor(&env, &client, &admin);
    let bob = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &100);
    // Revoke alice after purchase
    client.revoke_investor(&admin, &alice);
    assert_eq!(
        client.try_transfer_shares(&alice, &bob, &id, &50),
        Err(Ok(Error::Blacklisted))
    );
}

#[test]
fn test_transfer_shares_pending_recipient_blocked() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = Address::generate(&env); // Pending – never approved
    client.buy_shares(&alice, &id, &100);
    assert_eq!(
        client.try_transfer_shares(&alice, &bob, &id, &50),
        Err(Ok(Error::NotWhitelisted))
    );
}

#[test]
fn test_transfer_shares_revoked_recipient_blocked() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = Address::generate(&env);
    client.approve_investor(&admin, &bob);
    client.revoke_investor(&admin, &bob); // revoked after approval
    client.buy_shares(&alice, &id, &100);
    assert_eq!(
        client.try_transfer_shares(&alice, &bob, &id, &50),
        Err(Ok(Error::Blacklisted))
    );
}

#[test]
fn test_transfer_all_shares_removes_sender() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &100);
    client.transfer_shares(&alice, &bob, &id, &100);
    assert_eq!(
        client.try_get_ownership(&alice, &id),
        Err(Ok(Error::NoShares))
    );
}

#[test]
fn test_transfer_exceeds_shares_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &100);
    assert_eq!(
        client.try_transfer_shares(&alice, &bob, &id, &101),
        Err(Ok(Error::InsufficientShares))
    );
}

#[test]
fn test_transfer_zero_shares_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &100);
    assert_eq!(
        client.try_transfer_shares(&alice, &bob, &id, &0),
        Err(Ok(Error::ZeroShares))
    );
}

// ── Rental distribution ───────────────────────────────────────────────────────

#[test]
fn test_deposit_rental_updates_property() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    client.deposit_rental(&admin, &id, &10_000_000);
    let p = client.get_property(&id);
    assert_eq!(p.pending_rental, 10_000_000);
    assert_eq!(p.total_rental_deposited, 10_000_000);
}

#[test]
fn test_deposit_rental_zero_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    assert_eq!(
        client.try_deposit_rental(&admin, &id, &0),
        Err(Ok(Error::ZeroRental))
    );
}

#[test]
fn test_claim_rental_pro_rata() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    let bob = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &250);
    client.buy_shares(&bob, &id, &750);
    client.deposit_rental(&admin, &id, &1_000_000);
    assert_eq!(client.claim_rental(&alice, &id), 250_000);
    assert_eq!(client.claim_rental(&bob, &id), 750_000);
}

#[test]
fn test_claim_rental_nothing_to_claim_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    client.buy_shares(&investor, &id, &100);
    assert_eq!(
        client.try_claim_rental(&investor, &id),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn test_claim_rental_twice_second_fails() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    client.buy_shares(&investor, &id, &1000);
    client.deposit_rental(&admin, &id, &5_000_000);
    client.claim_rental(&investor, &id);
    assert_eq!(
        client.try_claim_rental(&investor, &id),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn test_new_investor_does_not_claim_old_rental() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let early = approved_investor(&env, &client, &admin);
    let late = approved_investor(&env, &client, &admin);
    client.buy_shares(&early, &id, &500);
    client.deposit_rental(&admin, &id, &1_000_000);
    client.buy_shares(&late, &id, &500);
    // late investor's rental_claimed is snapshotted at the current
    // total_rental_deposited, so they get nothing from before their purchase.
    assert_eq!(
        client.try_claim_rental(&late, &id),
        Err(Ok(Error::NothingToClaim))
    );
    // early owns 500/1000 shares → 50% of 1_000_000 = 500_000
    assert_eq!(client.claim_rental(&early, &id), 500_000);
}

#[test]
fn test_claimable_rental_view() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    client.buy_shares(&investor, &id, &1000);
    client.deposit_rental(&admin, &id, &2_000_000);
    assert_eq!(client.claimable_rental(&investor, &id), 2_000_000);
}

// ── Revoked investor cannot claim new shares but retains rental rights ────────

#[test]
fn test_revoked_investor_can_still_claim_rental() {
    // Revoking KYC does not forfeit accumulated rental income – only
    // new share-acquisition and incoming transfers are blocked.
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    client.buy_shares(&investor, &id, &1000);
    client.deposit_rental(&admin, &id, &3_000_000);
    // Admin revokes the investor (e.g., sanction update)
    client.revoke_investor(&admin, &investor);
    // Investor still holds shares and can claim their earned income.
    assert_eq!(client.claim_rental(&investor, &id), 3_000_000);
}

#[test]
fn test_revoked_investor_cannot_buy_more_shares() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let investor = approved_investor(&env, &client, &admin);
    client.buy_shares(&investor, &id, &100);
    client.revoke_investor(&admin, &investor);
    assert_eq!(
        client.try_buy_shares(&investor, &id, &1),
        Err(Ok(Error::Blacklisted))
    );
}

// ── Edge-case: self-transfer between same address ─────────────────────────────

#[test]
fn test_self_transfer_approved_succeeds() {
    let (env, admin, client) = setup();
    let id = add_property(&env, &client, &admin);
    let alice = approved_investor(&env, &client, &admin);
    client.buy_shares(&alice, &id, &200);
    // transferring to yourself should not error
    client.transfer_shares(&alice, &alice, &id, &100);
    assert_eq!(client.get_ownership(&alice, &id).shares, 200);
}

// ── Misc / miscellaneous ──────────────────────────────────────────────────────

#[test]
fn test_property_count_increments() {
    let (env, admin, client) = setup();
    assert_eq!(client.property_count(), 0);
    add_property(&env, &client, &admin);
    add_property(&env, &client, &admin);
    assert_eq!(client.property_count(), 2);
}

#[test]
fn test_is_initialized_returns_true() {
    let (_env, _admin, client) = setup();
    assert!(client.is_initialized());
}
