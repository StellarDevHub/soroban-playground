#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

use crate::{auction::AuctionPhase, Error, LendingPool, LendingPoolClient};

fn setup() -> (Env, LendingPoolClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LendingPool);
    let client = LendingPoolClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

// ── Basic lifecycle ───────────────────────────────────────────────────────────

#[test]
fn test_deposit_and_borrow() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &10_000_i128);
    // 10_000 deposited * 80% CF = 8_000 effective; borrow up to that.
    client.borrow(&user, &8_000_i128);
    let pos = client.get_user_position(&user);
    assert_eq!(pos.deposited, 10_000);
    assert_eq!(pos.borrowed, 8_000);
}

#[test]
fn test_borrow_beyond_collateral_factor_rejected() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &10_000_i128);
    // 10_000 * 80% = 8_000; borrowing 8_001 should fail.
    let res = client.try_borrow(&user, &8_001_i128);
    assert!(res.is_err());
}

#[test]
fn test_repay() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &10_000_i128);
    client.borrow(&user, &5_000_i128);
    let repaid = client.repay(&user, &2_000_i128);
    assert_eq!(repaid, 2_000);
    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 3_000);
}

// ── Health factor ─────────────────────────────────────────────────────────────

#[test]
fn test_health_factor_healthy() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &10_000_i128);
    client.borrow(&user, &4_000_i128);
    // HF = 10_000 * 8_000 / 4_000 = 20_000 (scaled by 10_000) => > 10_000 => healthy
    let hf = client.get_health_factor(&user);
    assert!(hf >= 10_000);
}

#[test]
fn test_health_factor_undercollateralized() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &10_000_i128);
    client.borrow(&user, &8_000_i128);
    let hf = client.get_health_factor(&user);
    assert_eq!(hf, 10_000);
}

// ── Liquidation ───────────────────────────────────────────────────────────────

#[test]
fn test_liquidation_rejected_when_healthy() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    client.deposit(&borrower, &10_000_i128);
    client.borrow(&borrower, &4_000_i128); // HF = 2.0 — healthy
    let res = client.try_liquidate(&liquidator, &borrower, &1_000_i128);
    assert!(res.is_err());
}

#[test]
fn test_self_liquidation_rejected() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &10_000_i128);
    client.borrow(&user, &4_000_i128);
    let res = client.try_liquidate(&user, &user, &1_000_i128);
    assert!(res.is_err());
}

#[test]
fn test_liquidation_nothing_to_liquidate() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    client.deposit(&borrower, &10_000_i128);
    let res = client.try_liquidate(&liquidator, &borrower, &1_000_i128);
    assert!(res.is_err());
}

// ── Bad-debt socialization ────────────────────────────────────────────────────

#[test]
fn test_socialize_bad_debt_admin_only() {
    let (env, client, admin) = setup();
    let stranger = Address::generate(&env);
    let res = client.try_socialize_bad_debt(&admin, &0_i128);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
    let res_stranger = client.try_socialize_bad_debt(&stranger, &100_i128);
    assert!(res_stranger.is_err());
}

// ── Pause gate ────────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_all_mutations() {
    let (env, client, admin) = setup();
    let user = Address::generate(&env);
    client.pause(&admin);
    assert!(client.try_deposit(&user, &1_000_i128).is_err());
    assert!(client.try_borrow(&user, &500_i128).is_err());
    assert!(client.try_repay(&user, &100_i128).is_err());
    client.unpause(&admin);
    client.deposit(&user, &1_000_i128);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pool_stats() {
    let (env, client, _) = setup();
    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    client.deposit(&u1, &5_000_i128);
    client.deposit(&u2, &3_000_i128);
    client.borrow(&u1, &2_000_i128);
    let stats = client.get_stats();
    assert_eq!(stats.total_deposited, 8_000);
    assert_eq!(stats.total_borrowed, 2_000);
    assert_eq!(stats.bad_debt, 0);
}

// ── Two-Phase Collateralized Debt Auction Tests ───────────────────────────────

#[test]
fn test_kick_liquidation_auction_and_queries() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let vault_id = 42_u64;

    client.deposit(&borrower, &10_000_i128);
    client.create_vault(&borrower, &vault_id);

    let auction_id = client.kick_liquidation_auction(&vault_id, &5_000_i128);
    assert_eq!(auction_id, 1);

    let auction = client.get_auction(&auction_id);
    assert_eq!(auction.id, 1);
    assert_eq!(auction.vault_id, vault_id);
    assert_eq!(auction.borrower, borrower);
    assert_eq!(auction.debt_amount, 5_000);
    assert_eq!(auction.collateral_amount, 6_000); // 120% of 5000 = 6000
    assert_eq!(auction.start_price, 6_000);
    assert_eq!(auction.reserve_price, 3_000);
    assert_eq!(auction.highest_bidder, None);
    assert_eq!(auction.highest_bid, 0);
    assert_eq!(auction.phase, AuctionPhase::English);

    let initial_phase = client.get_auction_phase(&auction_id);
    assert_eq!(initial_phase, AuctionPhase::English);

    let initial_price = client.get_auction_price(&auction_id);
    assert_eq!(initial_price, 6_000);
}

#[test]
fn test_english_auction_bidding_and_settlement() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let bidder1 = Address::generate(&env);
    let bidder2 = Address::generate(&env);
    let vault_id = 100_u64;

    client.deposit(&borrower, &10_000_i128);
    client.borrow(&borrower, &5_000_i128);
    client.create_vault(&borrower, &vault_id);

    let auction_id = client.kick_liquidation_auction(&vault_id, &5_000_i128);

    client.deposit(&bidder1, &10_000_i128);
    client.deposit(&bidder2, &15_000_i128);

    // Bidder 1 bids starting price (6000)
    client.bid_english(&bidder1, &auction_id, &6_000_i128);

    let auct_after_b1 = client.get_auction(&auction_id);
    assert_eq!(auct_after_b1.highest_bidder, Some(bidder1.clone()));
    assert_eq!(auct_after_b1.highest_bid, 6_000);
    assert_eq!(client.get_user_position(&bidder1).deposited, 4_000); // 10000 - 6000 locked

    // Bidder 2 tries bidding too low (< 5% increment = 6300)
    let low_bid_res = client.try_bid_english(&bidder2, &auction_id, &6_200_i128);
    assert_eq!(low_bid_res, Err(Ok(Error::BidTooLow)));

    // Bidder 2 outbids with 7000
    client.bid_english(&bidder2, &auction_id, &7_000_i128);

    // Bidder 1 was refunded locked bid
    assert_eq!(client.get_user_position(&bidder1).deposited, 10_000);
    assert_eq!(client.get_user_position(&bidder2).deposited, 8_000); // 15000 - 7000

    // Cannot settle before English duration expires
    let early_settle = client.try_settle_english_auction(&auction_id);
    assert_eq!(early_settle, Err(Ok(Error::AuctionNotExpired)));

    // Advance ledger time past English duration (1800s)
    env.ledger().with_mut(|l| l.timestamp += 1801);

    // Settle English auction
    client.settle_english_auction(&auction_id);

    let settled_auction = client.get_auction(&auction_id);
    assert_eq!(settled_auction.phase, AuctionPhase::Settled);

    // Bidder 2 received collateral (8000 remaining + 6000 collateral = 14000)
    assert_eq!(client.get_user_position(&bidder2).deposited, 14_000);

    // Borrower debt is atomically burned
    assert_eq!(client.get_user_position(&borrower).borrowed, 0);
    assert_eq!(client.get_stats().total_borrowed, 0);
}

#[test]
fn test_dutch_continuous_price_decay_curve() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let caller = Address::generate(&env);
    let vault_id = 200_u64;

    client.deposit(&borrower, &20_000_i128);

    // Detailed kick with start_price = 10,000, reserve_price = 4,000, english_dur = 1800s, dutch_dur = 3600s
    let auction_id = client.kick_auction(
        &caller,
        &vault_id,
        &borrower,
        &8_000_i128,  // debt
        &12_000_i128, // collateral
        &10_000_i128, // start price
        &4_000_i128,  // reserve price
        &1800_u64,
        &3600_u64,
    );

    // During English phase (t = 100s)
    env.ledger().with_mut(|l| l.timestamp += 100);
    assert_eq!(client.get_auction_phase(&auction_id), AuctionPhase::English);
    assert_eq!(client.get_auction_price(&auction_id), 10_000);

    // At exact start of Dutch phase (t = 1800s)
    env.ledger().with_mut(|l| l.timestamp += 1700);
    assert_eq!(client.get_auction_phase(&auction_id), AuctionPhase::Dutch);
    assert_eq!(client.get_auction_price(&auction_id), 10_000);

    // At 25% through Dutch phase (t = 1800 + 900 = 2700s)
    // Decay = (10000 - 4000) * 900 / 3600 = 6000 * 0.25 = 1500 => price = 8500
    env.ledger().with_mut(|l| l.timestamp += 900);
    assert_eq!(client.get_auction_price(&auction_id), 8_500);

    // At 50% through Dutch phase (t = 1800 + 1800 = 3600s)
    // Decay = 6000 * 0.5 = 3000 => price = 7000
    env.ledger().with_mut(|l| l.timestamp += 900);
    assert_eq!(client.get_auction_price(&auction_id), 7_000);

    // At 75% through Dutch phase (t = 1800 + 2700 = 4500s)
    // Decay = 6000 * 0.75 = 4500 => price = 5500
    env.ledger().with_mut(|l| l.timestamp += 900);
    assert_eq!(client.get_auction_price(&auction_id), 5_500);

    // At end of Dutch phase (t = 1800 + 3600 = 5400s)
    // Price hits reserve price floor = 4000
    env.ledger().with_mut(|l| l.timestamp += 900);
    assert_eq!(client.get_auction_price(&auction_id), 4_000);

    // Past Dutch phase
    env.ledger().with_mut(|l| l.timestamp += 500);
    assert_eq!(client.get_auction_price(&auction_id), 4_000);
}

#[test]
fn test_dutch_buy_with_atomic_debt_burn() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let bidder = Address::generate(&env);
    let caller = Address::generate(&env);
    let vault_id = 300_u64;

    client.deposit(&borrower, &20_000_i128);
    client.borrow(&borrower, &8_000_i128);

    let auction_id = client.kick_auction(
        &caller,
        &vault_id,
        &borrower,
        &8_000_i128,
        &12_000_i128,
        &10_000_i128,
        &4_000_i128,
        &1800_u64,
        &3600_u64,
    );

    client.deposit(&bidder, &15_000_i128);

    // Advance to 50% into Dutch phase (price = 7000)
    env.ledger().with_mut(|l| l.timestamp += 1800 + 1800);

    // Slippage check: max_price < 7000 should fail
    let slippage_res = client.try_buy_dutch(&bidder, &auction_id, &6_500_i128);
    assert_eq!(slippage_res, Err(Ok(Error::PriceExceedsMax)));

    // Buy Dutch auction at 7000
    let price_paid = client.buy_dutch(&bidder, &auction_id, &7_500_i128);
    assert_eq!(price_paid, 7_000);

    // Verify bidder position: 15000 - 7000 + 12000 collateral = 20000
    assert_eq!(client.get_user_position(&bidder).deposited, 20_000);

    // Atomic debt burn: 7000 burned of 8000 debt
    assert_eq!(client.get_user_position(&borrower).borrowed, 1_000);
    assert_eq!(client.get_stats().total_borrowed, 1_000);

    // Deficit of 1000 written to bad debt
    assert_eq!(client.get_stats().bad_debt, 1_000);

    let auction = client.get_auction(&auction_id);
    assert_eq!(auction.phase, AuctionPhase::Settled);
}

// ── Stability Pool & Fallback Socialization Tests ──────────────────────────────

#[test]
fn test_stability_pool_deposit_and_withdraw() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &10_000_i128);

    // Deposit 4000 into stability pool
    client.deposit_stability_pool(&user, &4_000_i128);
    assert_eq!(client.get_stability_pool_balance(), 4_000);
    assert_eq!(client.get_user_stability_deposit(&user), 4_000);
    assert_eq!(client.get_user_position(&user).deposited, 6_000);

    // Withdraw 1500 from stability pool
    client.withdraw_stability_pool(&user, &1_500_i128);
    assert_eq!(client.get_stability_pool_balance(), 2_500);
    assert_eq!(client.get_user_stability_deposit(&user), 2_500);
    assert_eq!(client.get_user_position(&user).deposited, 7_500);
}

#[test]
fn test_unbid_auction_fallback_covered_by_stability_pool() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let stab_provider = Address::generate(&env);
    let caller = Address::generate(&env);
    let vault_id = 400_u64;

    client.deposit(&borrower, &10_000_i128);
    client.borrow(&borrower, &3_000_i128);

    // Stability pool has 5000
    client.deposit(&stab_provider, &10_000_i128);
    client.deposit_stability_pool(&stab_provider, &5_000_i128);

    let auction_id = client.kick_auction(
        &caller,
        &vault_id,
        &borrower,
        &3_000_i128,
        &4_000_i128,
        &5_000_i128,
        &2_000_i128,
        &1800_u64,
        &3600_u64,
    );

    // Cannot socialize before expiration
    let early_soc = client.try_socialize_unbid_auction(&caller, &auction_id);
    assert_eq!(early_soc, Err(Ok(Error::AuctionNotExpired)));

    // Advance past total duration (1800 + 3600 + 1 = 5401s)
    env.ledger().with_mut(|l| l.timestamp += 5401);

    // Trigger fallback socialization
    client.socialize_unbid_auction(&caller, &auction_id);

    // Stability pool absorbed full 3000 debt
    assert_eq!(client.get_stability_pool_balance(), 2_000); // 5000 - 3000
    assert_eq!(client.get_stats().bad_debt, 0); // No global bad debt created

    // Borrower debt burned atomically
    assert_eq!(client.get_user_position(&borrower).borrowed, 0);
    assert_eq!(client.get_stats().total_borrowed, 0);

    let auction = client.get_auction(&auction_id);
    assert_eq!(auction.phase, AuctionPhase::Socialized);
}

#[test]
fn test_unbid_auction_fallback_with_partial_stability_and_socialization() {
    let (env, client, _) = setup();
    let borrower = Address::generate(&env);
    let stab_provider = Address::generate(&env);
    let caller = Address::generate(&env);
    let vault_id = 500_u64;

    client.deposit(&borrower, &10_000_i128);
    client.borrow(&borrower, &5_000_i128);

    // Stability pool only has 2000
    client.deposit(&stab_provider, &10_000_i128);
    client.deposit_stability_pool(&stab_provider, &2_000_i128);

    let auction_id = client.kick_auction(
        &caller,
        &vault_id,
        &borrower,
        &5_000_i128,
        &6_000_i128,
        &6_000_i128,
        &3_000_i128,
        &1800_u64,
        &3600_u64,
    );

    // Advance past expiration
    env.ledger().with_mut(|l| l.timestamp += 5401);

    // Trigger fallback socialization
    client.socialize_unbid_auction(&caller, &auction_id);

    // Stability pool drained to 0
    assert_eq!(client.get_stability_pool_balance(), 0);

    // Remaining deficit of 3000 (5000 - 2000) socialized into global bad debt
    assert_eq!(client.get_stats().bad_debt, 3_000);

    // Borrower debt burned atomically
    assert_eq!(client.get_user_position(&borrower).borrowed, 0);
    assert_eq!(client.get_stats().total_borrowed, 0);

    let auction = client.get_auction(&auction_id);
    assert_eq!(auction.phase, AuctionPhase::Socialized);
}
