#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
};

#[contracttype]
enum NftKey {
    Owner(u64),
    Approval(u64),
}

#[contract]
struct MockNft;

#[contractimpl]
impl MockNft {
    pub fn mint(env: Env, owner: Address, token_id: u64) {
        env.storage()
            .instance()
            .set(&NftKey::Owner(token_id), &owner);
    }

    pub fn approve(env: Env, owner: Address, spender: Address, token_id: u64) {
        owner.require_auth();
        assert_eq!(Self::owner_of(env.clone(), token_id), owner);
        env.storage()
            .instance()
            .set(&NftKey::Approval(token_id), &spender);
    }

    pub fn transfer_from(env: Env, caller: Address, from: Address, to: Address, token_id: u64) {
        caller.require_auth();
        assert_eq!(Self::owner_of(env.clone(), token_id), from);
        let approved: Option<Address> = env.storage().instance().get(&NftKey::Approval(token_id));
        assert!(caller == from || approved == Some(caller));
        env.storage().instance().set(&NftKey::Owner(token_id), &to);
        env.storage().instance().remove(&NftKey::Approval(token_id));
    }

    pub fn owner_of(env: Env, token_id: u64) -> Address {
        env.storage()
            .instance()
            .get(&NftKey::Owner(token_id))
            .unwrap()
    }
}

struct Fixture {
    env: Env,
    vault: NftFractionalVaultClient<'static>,
    vault_id: Address,
    nft: MockNftClient<'static>,
    payment: TokenClient<'static>,
    payment_admin: StellarAssetClient<'static>,
    curator: Address,
    depositor: Address,
}

fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
        ledger.sequence_number = 100;
    });

    let curator = Address::generate(&env);
    let depositor = Address::generate(&env);
    let nft_id = env.register_contract(None, MockNft);
    let nft = MockNftClient::new(&env, &nft_id);
    nft.mint(&depositor, &7);

    let payment_issuer = Address::generate(&env);
    let payment_id = env
        .register_stellar_asset_contract_v2(payment_issuer)
        .address();
    let payment = TokenClient::new(&env, &payment_id);
    let payment_admin = StellarAssetClient::new(&env, &payment_id);

    let vault_id = env.register_contract(None, NftFractionalVault);
    let vault = NftFractionalVaultClient::new(&env, &vault_id);
    nft.approve(&depositor, &vault_id, &7);
    vault.initialize(
        &curator,
        &depositor,
        &InitConfig {
            nft_contract: nft_id,
            nft_id: 7,
            payment_token: payment_id,
            total_supply: 1_000_000,
            name: String::from_str(&env, "Fractional Art"),
            symbol: String::from_str(&env, "FART"),
            reserve_price: 10_000,
            auction_duration: 100,
            min_increment_bps: 500,
        },
    );

    Fixture {
        env,
        vault,
        vault_id,
        nft,
        payment,
        payment_admin,
        curator,
        depositor,
    }
}

#[test]
fn initialization_locks_nft_and_mints_fixed_supply() {
    let f = fixture();
    assert_eq!(f.nft.owner_of(&7), f.vault_id);
    assert_eq!(f.vault.balance(&f.depositor), 1_000_000);
    assert_eq!(f.vault.total_supply(), 1_000_000);
    assert_eq!(f.vault.decimals(), 7);
    assert_eq!(f.vault.name(), String::from_str(&f.env, "Fractional Art"));
    assert_eq!(f.vault.symbol(), String::from_str(&f.env, "FART"));
    let info = f.vault.vault_info();
    assert_eq!(info.curator, f.curator);
    assert_eq!(info.status, VaultStatus::Fractionalized);
}

#[test]
fn fraction_transfers_and_expiring_allowances_follow_sep41() {
    let f = fixture();
    let alice = Address::generate(&f.env);
    let broker = Address::generate(&f.env);
    f.vault.transfer(&f.depositor, &alice, &400_000);
    f.vault.approve(&alice, &broker, &150_000, &200);
    f.vault
        .transfer_from(&broker, &alice, &f.depositor, &100_000);
    assert_eq!(f.vault.balance(&alice), 300_000);
    assert_eq!(f.vault.allowance(&alice, &broker), 50_000);

    f.env
        .ledger()
        .with_mut(|ledger| ledger.sequence_number = 201);
    assert_eq!(f.vault.allowance(&alice, &broker), 0);
    assert!(matches!(
        f.vault.try_transfer_from(&broker, &alice, &f.depositor, &1),
        Err(Ok(Error::AllowanceExpired))
    ));
}

#[test]
fn auction_escrows_bids_refunds_previous_bidder_and_settles() {
    let f = fixture();
    let first = Address::generate(&f.env);
    let winner = Address::generate(&f.env);
    f.payment_admin.mint(&first, &20_000);
    f.payment_admin.mint(&winner, &20_000);

    f.vault.start_auction(&first, &10_000);
    assert_eq!(f.payment.balance(&f.vault_id), 10_000);
    assert!(matches!(
        f.vault.try_bid(&winner, &10_499),
        Err(Ok(Error::BidTooLow))
    ));
    f.vault.bid(&winner, &10_500);
    assert_eq!(f.payment.balance(&first), 20_000);
    assert_eq!(f.payment.balance(&f.vault_id), 10_500);

    assert!(matches!(
        f.vault.try_settle(),
        Err(Ok(Error::AuctionNotEnded))
    ));
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 1_100);
    f.vault.settle();
    assert_eq!(f.nft.owner_of(&7), winner);
    assert_eq!(f.vault.vault_info().status, VaultStatus::Settled);
    assert_eq!(f.vault.remaining_proceeds(), 10_500);
}

#[test]
fn holders_burn_fractions_for_all_proceeds_including_rounding_remainder() {
    let f = fixture();
    let holder = Address::generate(&f.env);
    let buyer = Address::generate(&f.env);
    f.vault.transfer(&f.depositor, &holder, &333_333);
    f.payment_admin.mint(&buyer, &20_000);
    f.vault.start_auction(&buyer, &10_001);
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 1_100);
    f.vault.settle();

    assert_eq!(f.vault.claim(&holder, &333_333), 3_333);
    assert_eq!(f.vault.claim(&f.depositor, &666_667), 6_668);
    assert_eq!(f.payment.balance(&holder), 3_333);
    assert_eq!(f.payment.balance(&f.depositor), 6_668);
    assert_eq!(f.vault.total_supply(), 0);
    assert_eq!(f.vault.remaining_proceeds(), 0);
}

#[test]
fn invalid_configuration_and_early_claim_are_rejected() {
    let f = fixture();
    assert!(matches!(
        f.vault.try_claim(&f.depositor, &1),
        Err(Ok(Error::NotSettled))
    ));
    let bidder = Address::generate(&f.env);
    f.payment_admin.mint(&bidder, &20_000);
    assert!(matches!(
        f.vault.try_start_auction(&bidder, &9_999),
        Err(Ok(Error::BidTooLow))
    ));
}
