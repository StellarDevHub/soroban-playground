// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contributor1 = Address::generate(&env);
    let sale_token = Address::generate(&env);
    let payment_token = Address::generate(&env);
    (env, admin, contributor1, sale_token, payment_token)
}

fn init_contract(env: &Env, admin: &Address, sale: &Address, pay: &Address) -> Address {
    let contract = env.register_contract(None, CrowdfundingLaunchpad);
    let client = CrowdfundingLaunchpadClient::new(env, &contract);
    client
        .initialize(
            admin,
            sale,
            pay,
            &5_000_000,  // soft_cap
            &20_000_000, // hard_cap
            &1_000_000,  // base_price (1 token = 1_000_000 units)
            &1_000_000,  // price_step
            &10_000,     // price_increment
            &10,         // wl_start_ledger
            &20,         // public_start_ledger
            &200,        // deadline_ledger
            &5,          // cooldown_ledgers
        )
        .unwrap();
    contract
}

#[test]
fn test_initialize_and_config() {
    let (env, admin, _c, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    let config = client.get_config().unwrap();
    assert_eq!(config.soft_cap, 5_000_000);
    assert_eq!(config.hard_cap, 20_000_000);
    assert_eq!(config.base_price, 1_000_000);

    let state = client.get_state().unwrap();
    assert_eq!(state.phase, Phase::Whitelist);
    assert_eq!(state.total_raised, 0);
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, _c, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    let result = client.try_initialize(
        &admin, &sale, &pay, &5_000_000, &20_000_000, &1_000_000, &1_000_000, &10_000, &10, &20,
        &200, &5,
    );
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_whitelist_gate() {
    let (env, admin, contributor, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    // Advance to WL phase
    env.ledger().set(LedgerInfo {
        sequence_number: 15,
        timestamp: 1_000,
        ..env.ledger().get()
    });

    // Contributor not yet whitelisted
    let result = client.try_contribute(&contributor, &100_000);
    assert_eq!(result, Err(Ok(Error::NotWhitelisted)));

    // Whitelist the contributor
    client.set_whitelist(&admin, &contributor, &true).unwrap();
    assert!(client.is_whitelisted(&contributor));

    // Now contribution should succeed
    let tokens = client.contribute(&contributor, &100_000).unwrap();
    assert!(tokens > 0);
    assert_eq!(client.get_contribution(&contributor), 100_000);
}

#[test]
fn test_anti_bot_cooldown() {
    let (env, admin, contributor, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    // Whitelist and advance to WL open
    client.set_whitelist(&admin, &contributor, &true).unwrap();
    env.ledger().set(LedgerInfo {
        sequence_number: 15,
        timestamp: 1_000,
        ..env.ledger().get()
    });

    client.contribute(&contributor, &10_000).unwrap();

    // Second immediate purchase blocked by cooldown (ledger 16 < 15+5=20)
    env.ledger().set(LedgerInfo {
        sequence_number: 16,
        timestamp: 1_100,
        ..env.ledger().get()
    });
    let result = client.try_contribute(&contributor, &10_000);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));

    // After cooldown passes it works again
    env.ledger().set(LedgerInfo {
        sequence_number: 21,
        timestamp: 2_000,
        ..env.ledger().get()
    });
    client.contribute(&contributor, &10_000).unwrap();
}

#[test]
fn test_allocation_cap_enforced() {
    let (env, admin, contributor, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    // Public phase
    env.ledger().set(LedgerInfo {
        sequence_number: 25,
        timestamp: 2_000,
        ..env.ledger().get()
    });

    // Hard-cap = 20_000_000; PUBLIC_CAP_BPS = 500 bps → max 1_000_000
    let result = client.try_contribute(&contributor, &2_000_000);
    assert_eq!(result, Err(Ok(Error::AllocationCapExceeded)));

    // Within cap succeeds
    client.contribute(&contributor, &500_000).unwrap();
}

#[test]
fn test_successful_campaign_finalization() {
    let (env, admin, contributor, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    // Public phase; contribute enough to clear soft cap (5_000_000) using multiple contributors
    env.ledger().set(LedgerInfo {
        sequence_number: 25,
        timestamp: 2_000,
        ..env.ledger().get()
    });
    // 5 contributors × 1_000_000 = 5_000_000 = soft_cap
    for _ in 0..5 {
        let c = Address::generate(&env);
        client.contribute(&c, &1_000_000).unwrap();
    }

    let state = client.get_state().unwrap();
    assert_eq!(state.phase, Phase::LiquiditySeed);

    // Admin finalizes after deadline
    env.ledger().set(LedgerInfo {
        sequence_number: 201,
        timestamp: 20_000,
        ..env.ledger().get()
    });
    let phase = client.finalize(&admin).unwrap();
    assert_eq!(phase, Phase::Finalized);
}

#[test]
fn test_refund_on_soft_cap_failure() {
    let (env, admin, contributor, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    // Public phase
    env.ledger().set(LedgerInfo {
        sequence_number: 25,
        timestamp: 2_000,
        ..env.ledger().get()
    });
    client.contribute(&contributor, &100_000).unwrap();
    assert_eq!(client.get_contribution(&contributor), 100_000);

    // Soft-cap not reached; finalize after deadline → Refunding
    env.ledger().set(LedgerInfo {
        sequence_number: 201,
        timestamp: 20_000,
        ..env.ledger().get()
    });
    let phase = client.finalize(&admin).unwrap();
    assert_eq!(phase, Phase::Refunding);

    // Refund returns exact amount
    let refunded = client.refund(&contributor).unwrap();
    assert_eq!(refunded, 100_000);

    // Second refund attempt fails (already zeroed)
    let result = client.try_refund(&contributor);
    assert_eq!(result, Err(Ok(Error::NothingToRefund)));
}

#[test]
fn test_refund_rejected_when_soft_cap_met() {
    let (env, admin, _c, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    env.ledger().set(LedgerInfo {
        sequence_number: 25,
        timestamp: 2_000,
        ..env.ledger().get()
    });
    // Reach soft cap
    for _ in 0..5 {
        let c = Address::generate(&env);
        client.contribute(&c, &1_000_000).unwrap();
    }

    env.ledger().set(LedgerInfo {
        sequence_number: 201,
        timestamp: 20_000,
        ..env.ledger().get()
    });
    client.finalize(&admin).unwrap();

    // Contributor who contributed tries to refund → soft cap was met
    let late_c = Address::generate(&env);
    let result = client.try_refund(&late_c);
    assert_eq!(result, Err(Ok(Error::SoftCapMet)));
}

#[test]
fn test_dynamic_price_view() {
    let (env, admin, _c, sale, pay) = setup();
    let contract = init_contract(&env, &admin, &sale, &pay);
    let client = CrowdfundingLaunchpadClient::new(&env, &contract);

    let price = client.current_price_view().unwrap();
    // Initial price = base_price = 1_000_000
    assert_eq!(price, 1_000_000);
}
