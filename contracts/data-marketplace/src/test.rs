#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env, String,
};

fn setup() -> (Env, Address, DataMarketplaceContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, DataMarketplaceContract);
    let client = DataMarketplaceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn b(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn register_provider(env: &Env, client: &DataMarketplaceContractClient, provider: &Address) {
    client.register_provider(
        provider,
        &String::from_str(env, "Acme Data"),
        &b(env, 0xAA),
    );
}

fn list_basic_dataset(
    env: &Env,
    client: &DataMarketplaceContractClient,
    provider: &Address,
) -> u64 {
    client.list_dataset(
        provider,
        &String::from_str(env, "Hourly weather"),
        &b(env, 0x01),
        &b(env, 0x02),
        &b(env, 0x03),
        &100_i128,
        &10_i128,
        &(7 * 24 * 60 * 60u64),
    )
}

#[test]
fn end_to_end_purchase_query_analytics() {
    let (env, _admin, client) = setup();
    let provider = Address::generate(&env);
    let buyer = Address::generate(&env);

    register_provider(&env, &client, &provider);
    let dataset_id = list_basic_dataset(&env, &client, &provider);

    let license = client.purchase_access(&buyer, &dataset_id, &5_u32);
    // 100 flat + 10 * 5 = 150
    assert_eq!(license.total_paid, 150);
    assert_eq!(license.queries_total, 5);
    assert_eq!(license.queries_used, 0);

    // Submit two privacy-preserving queries
    let r1 = client.submit_query(&buyer, &dataset_id, &b(&env, 0x10));
    assert_eq!(r1.sequence, 1);
    let r2 = client.submit_query(&buyer, &dataset_id, &b(&env, 0x11));
    assert_eq!(r2.sequence, 2);

    // Replay protection: same commitment cannot be reused
    assert_eq!(
        client
            .try_submit_query(&buyer, &dataset_id, &b(&env, 0x10))
            .err()
            .unwrap()
            .unwrap(),
        Error::CommitmentAlreadyUsed
    );

    // Stats rolled up
    let ds = client.get_dataset_stats(&dataset_id).unwrap();
    assert_eq!(ds.license_count, 1);
    assert_eq!(ds.active_buyers, 1);
    assert_eq!(ds.queries_executed, 2);
    assert_eq!(ds.revenue, 150);

    let bs = client.get_buyer_stats(&buyer).unwrap();
    assert_eq!(bs.licenses_purchased, 1);
    assert_eq!(bs.queries_executed, 2);
    assert_eq!(bs.total_spent, 150);

    // The receipt is queryable by commitment
    let receipt = client.get_query_receipt(&b(&env, 0x10)).unwrap();
    assert_eq!(receipt.dataset_id, dataset_id);
    assert_eq!(receipt.buyer, buyer);
}

#[test]
fn quota_exhausts_after_limit() {
    let (env, _admin, client) = setup();
    let provider = Address::generate(&env);
    let buyer = Address::generate(&env);
    register_provider(&env, &client, &provider);
    let id = list_basic_dataset(&env, &client, &provider);
    client.purchase_access(&buyer, &id, &2_u32);

    client.submit_query(&buyer, &id, &b(&env, 1));
    client.submit_query(&buyer, &id, &b(&env, 2));
    assert_eq!(
        client.try_submit_query(&buyer, &id, &b(&env, 3)).err().unwrap().unwrap(),
        Error::NoQuotaRemaining
    );
}

#[test]
fn license_expiry_blocks_queries() {
    let (env, _admin, client) = setup();
    let provider = Address::generate(&env);
    let buyer = Address::generate(&env);
    register_provider(&env, &client, &provider);
    let id = list_basic_dataset(&env, &client, &provider);
    client.purchase_access(&buyer, &id, &5_u32);
    env.ledger().with_mut(|li| li.timestamp += 30 * 24 * 60 * 60);
    assert_eq!(
        client.try_submit_query(&buyer, &id, &b(&env, 9)).err().unwrap().unwrap(),
        Error::LicenseExpired
    );
}

#[test]
fn provider_cannot_self_purchase_or_self_query() {
    let (env, _admin, client) = setup();
    let provider = Address::generate(&env);
    register_provider(&env, &client, &provider);
    let id = list_basic_dataset(&env, &client, &provider);

    assert_eq!(
        client.try_purchase_access(&provider, &id, &1_u32).err().unwrap().unwrap(),
        Error::SelfPurchaseForbidden
    );

    // Even with a fabricated license entry, the provider cannot self-query.
    let buyer = Address::generate(&env);
    client.purchase_access(&buyer, &id, &1_u32);
    assert_eq!(
        client.try_submit_query(&provider, &id, &b(&env, 5)).err().unwrap().unwrap(),
        Error::SelfQueryForbidden
    );
}

#[test]
fn renewal_extends_quota_and_expiry() {
    let (env, _admin, client) = setup();
    let provider = Address::generate(&env);
    let buyer = Address::generate(&env);
    register_provider(&env, &client, &provider);
    let id = list_basic_dataset(&env, &client, &provider);

    let l1 = client.purchase_access(&buyer, &id, &2_u32);
    let l2 = client.purchase_access(&buyer, &id, &3_u32);
    assert_eq!(l2.queries_total, 5);
    assert!(l2.expires_at > l1.expires_at);
    // Each purchase = flat (100) + price_per_query * quantity. Renewal charges
    // the flat fee again, by design — providers price the per-license overhead.
    assert_eq!(l2.total_paid, 120 + 130);

    let ds = client.get_dataset_stats(&id).unwrap();
    // license_count and active_buyers should not double when renewing an active license
    assert_eq!(ds.license_count, 1);
    assert_eq!(ds.active_buyers, 1);
    assert_eq!(ds.revenue, 250);
}

#[test]
fn delisted_dataset_blocks_new_purchases() {
    let (env, _admin, client) = setup();
    let provider = Address::generate(&env);
    let buyer = Address::generate(&env);
    register_provider(&env, &client, &provider);
    let id = list_basic_dataset(&env, &client, &provider);
    client.delist_dataset(&provider, &id);
    assert_eq!(
        client.try_purchase_access(&buyer, &id, &1_u32).err().unwrap().unwrap(),
        Error::DatasetDelisted
    );
    // active feed no longer surfaces it
    assert_eq!(client.list_active_datasets().len(), 0);
}

#[test]
fn pause_blocks_mutations_admin_can_unpause() {
    let (env, admin, client) = setup();
    let provider = Address::generate(&env);
    register_provider(&env, &client, &provider);
    client.set_paused(&admin, &true);
    assert_eq!(
        client
            .try_list_dataset(
                &provider,
                &String::from_str(&env, "x"),
                &b(&env, 1),
                &b(&env, 1),
                &b(&env, 1),
                &0,
                &0,
                &1,
            )
            .err()
            .unwrap()
            .unwrap(),
        Error::Paused
    );
    client.set_paused(&admin, &false);
    let id = list_basic_dataset(&env, &client, &provider);
    assert!(id > 0);
}

#[test]
fn non_admin_cannot_pause() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    assert_eq!(
        client.try_set_paused(&stranger, &true).err().unwrap().unwrap(),
        Error::Unauthorized
    );
}

#[test]
fn duplicate_initialize_fails() {
    let (_env, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin).err().unwrap().unwrap(),
        Error::AlreadyInitialized
    );
}

#[test]
fn verify_commitment_matches_sha256_of_preimage() {
    let (env, _admin, client) = setup();
    let preimage = Bytes::from_slice(&env, b"query=SELECT *|nonce=42|buyer=GA...");
    let computed = env.crypto().sha256(&preimage);
    let commitment = BytesN::<32>::from_array(&env, &computed.to_array());
    assert!(client.verify_commitment(&commitment, &preimage));
    let other = Bytes::from_slice(&env, b"different");
    assert!(!client.verify_commitment(&commitment, &other));
}
