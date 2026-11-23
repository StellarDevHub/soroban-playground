use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
};

#[contract]
pub struct TestNft;

#[contracttype]
#[derive(Clone)]
enum NftKey {
    Owner(u64),
    Fail,
}

#[contractimpl]
impl TestNft {
    pub fn mint(env: Env, owner: Address, id: u64) {
        env.storage().instance().set(&NftKey::Owner(id), &owner);
    }

    pub fn owner_of(env: Env, token_id: u64) -> Address {
        env.storage()
            .instance()
            .get(&NftKey::Owner(token_id))
            .unwrap()
    }

    pub fn set_failure(env: Env, fail: bool) {
        env.storage().instance().set(&NftKey::Fail, &fail);
    }

    pub fn transfer_from(env: Env, caller: Address, from: Address, to: Address, token_id: u64) {
        caller.require_auth();
        assert!(!env.storage().instance().get(&NftKey::Fail).unwrap_or(false));
        assert_eq!(caller, from);
        assert_eq!(Self::owner_of(env.clone(), token_id), from);
        env.storage().instance().set(&NftKey::Owner(token_id), &to);
    }
}

struct Fixture {
    env: Env,
    id: Address,
    config: AuctionConfig,
}

impl Fixture {
    fn new(extensions: bool) -> Self {
        let f = Self::uninitialized(extensions);
        f.client().initialize(&f.config);
        f
    }

    fn uninitialized(extensions: bool) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|ledger| ledger.timestamp = 100);
        let id = env.register_contract(None, DutchAuction);
        let seller = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(seller.clone())
            .address();
        let nft = env.register_contract(None, TestNft);
        TestNftClient::new(&env, &nft).mint(&seller, &1);
        let config = AuctionConfig {
            seller,
            token,
            nft,
            nft_id: 1,
            reserve: 10,
            collateral: 100,
            start: 100,
            commit_duration: 100,
            reveal_duration: 100,
            extension_window: 10,
            extension_seconds: 15,
            max_extensions: if extensions { 2 } else { 0 },
        };
        Self { env, id, config }
    }

    fn client(&self) -> DutchAuctionClient<'_> {
        DutchAuctionClient::new(&self.env, &self.id)
    }

    fn bidder(&self) -> Address {
        let bidder = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.config.token).mint(&bidder, &100);
        bidder
    }

    fn time(&self, timestamp: u64) {
        self.env
            .ledger()
            .with_mut(|ledger| ledger.timestamp = timestamp);
    }

    fn balance(&self, address: &Address) -> i128 {
        TokenClient::new(&self.env, &self.config.token).balance(address)
    }

    fn hash(&self, bidder: &Address, amount: i128, seed: u8) -> BytesN<32> {
        self.env.as_contract(&self.id, || {
            bid_commitment(
                &self.env,
                bidder,
                amount,
                &BytesN::from_array(&self.env, &[seed; 32]),
            )
        })
    }

    fn commit(&self, bidder: &Address, amount: i128, seed: u8) {
        self.client()
            .commit_bid(bidder, &self.hash(bidder, amount, seed));
    }

    fn reveal(&self, bidder: &Address, amount: i128, seed: u8) {
        self.client()
            .reveal_bid(bidder, &amount, &BytesN::from_array(&self.env, &[seed; 32]));
    }
}

#[test]
fn escrow_settlement_and_pull_refunds_conserve_assets() {
    let f = Fixture::new(false);
    let a = f.bidder();
    let b = f.bidder();
    assert_eq!(TestNftClient::new(&f.env, &f.config.nft).owner_of(&1), f.id);
    f.commit(&a, 70, 1);
    f.commit(&b, 40, 2);
    assert_eq!(f.balance(&a), 0);
    assert_eq!(f.balance(&f.id), 200);
    assert_eq!(f.client().try_claim_bid(&a), Err(Ok(Error::NotSettled)));
    assert_eq!(f.client().try_settle(), Err(Ok(Error::WrongPhase)));
    f.time(200);
    f.reveal(&b, 40, 2);
    f.reveal(&a, 70, 1);
    assert_eq!(f.balance(&a), 0);
    assert_eq!(f.balance(&f.config.seller), 0);
    f.time(300);
    f.client().settle();
    assert_eq!(f.balance(&f.config.seller), 70);
    assert_eq!(TestNftClient::new(&f.env, &f.config.nft).owner_of(&1), a);
    // Claims need no caller authority; the destination cannot be redirected.
    f.env.set_auths(&[]);
    assert_eq!(f.client().claim_bid(&a), 30);
    assert_eq!(f.client().claim_bid(&b), 100);
    assert_eq!(f.balance(&f.id), 0);
    assert_eq!(
        f.balance(&a) + f.balance(&b) + f.balance(&f.config.seller),
        200
    );
    assert_eq!(f.client().try_claim_bid(&a), Err(Ok(Error::AlreadyClaimed)));
    assert_eq!(f.client().try_settle(), Err(Ok(Error::AlreadySettled)));
}

#[test]
fn commitments_bind_bidder_amount_salt_contract_and_network() {
    let f = Fixture::new(false);
    let a = f.bidder();
    let b = f.bidder();
    let hash = f.hash(&a, 70, 1);
    assert_ne!(hash, f.hash(&b, 70, 1));
    assert_ne!(hash, f.hash(&a, 71, 1));
    assert_ne!(hash, f.hash(&a, 70, 2));
    let other = f.env.register_contract(None, DutchAuction);
    let other_hash = f.env.as_contract(&other, || {
        bid_commitment(&f.env, &a, 70, &BytesN::from_array(&f.env, &[1; 32]))
    });
    assert_ne!(hash, other_hash);
    f.env
        .ledger()
        .with_mut(|ledger| ledger.network_id = [7; 32]);
    assert_ne!(hash, f.hash(&a, 70, 1));
}

#[test]
fn copied_commitment_cannot_be_revealed_by_another_bidder() {
    let f = Fixture::new(false);
    let a = f.bidder();
    let b = f.bidder();
    f.commit(&a, 70, 1);
    f.client().commit_bid(&b, &f.hash(&a, 70, 1));
    f.time(200);
    assert_eq!(
        f.client()
            .try_reveal_bid(&b, &70, &BytesN::from_array(&f.env, &[1; 32])),
        Err(Ok(Error::InvalidReveal))
    );
    f.reveal(&a, 70, 1);
    assert_eq!(f.client().get_auction().winner, Some(a));
}

#[test]
fn duplicate_and_invalid_reveals_cannot_change_winner_or_extend_time() {
    let f = Fixture::new(true);
    let a = f.bidder();
    f.commit(&a, 70, 1);
    assert_eq!(
        f.client().try_commit_bid(&a, &f.hash(&a, 80, 2)),
        Err(Ok(Error::AlreadyCommitted))
    );
    assert_eq!(f.balance(&f.id), 100);
    f.time(299);
    let before = f.client().get_auction();
    for amount in [-1, 0, 9, 71, 101] {
        assert_eq!(
            f.client()
                .try_reveal_bid(&a, &amount, &BytesN::from_array(&f.env, &[1; 32])),
            Err(Ok(Error::InvalidReveal))
        );
        assert_eq!(f.client().get_auction(), before);
    }
    f.reveal(&a, 70, 1);
    let after = f.client().get_auction();
    assert_eq!(after.reveal_end, 315);
    assert_eq!(
        f.client()
            .try_reveal_bid(&a, &70, &BytesN::from_array(&f.env, &[1; 32])),
        Err(Ok(Error::AlreadyRevealed))
    );
    assert_eq!(f.client().get_auction(), after);
}

#[test]
fn phase_boundaries_are_disjoint_and_authenticated() {
    let f = Fixture::uninitialized(false);
    let mut config = f.config.clone();
    config.start = 110;
    f.client().initialize(&config);
    let a = f.bidder();
    assert_eq!(
        f.client().try_commit_bid(&a, &f.hash(&a, 70, 1)),
        Err(Ok(Error::WrongPhase))
    );
    f.time(110);
    f.env.set_auths(&[]);
    assert!(f.client().try_commit_bid(&a, &f.hash(&a, 70, 1)).is_err());
    f.env.mock_all_auths();
    f.commit(&a, 70, 1);
    f.time(209);
    assert_eq!(
        f.client()
            .try_reveal_bid(&a, &70, &BytesN::from_array(&f.env, &[1; 32])),
        Err(Ok(Error::WrongPhase))
    );
    f.time(210);
    assert_eq!(
        f.client().try_commit_bid(&f.bidder(), &f.hash(&a, 70, 1)),
        Err(Ok(Error::WrongPhase))
    );
    f.env.set_auths(&[]);
    assert!(f
        .client()
        .try_reveal_bid(&a, &70, &BytesN::from_array(&f.env, &[1; 32]))
        .is_err());
    f.env.mock_all_auths();
    f.reveal(&a, 70, 1);
    f.time(310);
    assert_eq!(
        f.client()
            .try_reveal_bid(&a, &70, &BytesN::from_array(&f.env, &[1; 32])),
        Err(Ok(Error::WrongPhase))
    );
    f.env.set_auths(&[]);
    f.client().settle();
}

#[test]
fn late_commits_and_reveals_extend_only_to_the_configured_cap() {
    let f = Fixture::new(true);
    let a = f.bidder();
    let b = f.bidder();
    let c = f.bidder();
    f.time(190);
    f.commit(&a, 70, 1);
    assert_eq!(f.client().get_auction().commit_end, 215);
    assert_eq!(f.client().get_auction().reveal_end, 315);
    f.time(205);
    f.commit(&b, 80, 2);
    f.time(225);
    f.commit(&c, 90, 3);
    assert_eq!(f.client().get_auction().commit_end, 230);
    assert_eq!(f.client().get_auction().reveal_end, 330);
    assert_eq!(
        f.client()
            .try_reveal_bid(&a, &70, &BytesN::from_array(&f.env, &[1; 32])),
        Err(Ok(Error::WrongPhase))
    );
    f.time(230);
    assert_eq!(
        f.client().try_commit_bid(&f.bidder(), &f.hash(&a, 70, 1)),
        Err(Ok(Error::WrongPhase))
    );
    f.time(320);
    f.reveal(&a, 70, 1);
    f.time(335);
    f.reveal(&b, 80, 2);
    f.time(355);
    f.reveal(&c, 90, 3);
    let auction = f.client().get_auction();
    assert_eq!(
        (auction.commit_extensions, auction.reveal_extensions),
        (2, 2)
    );
    assert_eq!(auction.reveal_end, 360);
    f.time(359);
    assert_eq!(f.client().try_settle(), Err(Ok(Error::WrongPhase)));
    f.time(360);
    f.client().settle();
}

#[test]
fn ties_follow_commit_order_not_reveal_order() {
    let f = Fixture::new(false);
    let first = f.bidder();
    let second = f.bidder();
    f.commit(&first, 70, 1);
    f.commit(&second, 70, 2);
    f.time(200);
    f.reveal(&second, 70, 2);
    f.reveal(&first, 70, 1);
    assert_eq!(f.client().get_auction().winner, Some(first));
}

#[test]
fn non_revealers_are_slashed_and_unsold_nft_returns_to_seller() {
    let f = Fixture::new(false);
    let a = f.bidder();
    f.commit(&a, 70, 1);
    f.time(300);
    f.client().settle();
    assert_eq!(
        TestNftClient::new(&f.env, &f.config.nft).owner_of(&1),
        f.config.seller
    );
    assert_eq!(f.client().get_auction().winner, None);
    f.env.set_auths(&[]);
    assert_eq!(f.client().claim_bid(&a), 0);
    assert_eq!(f.balance(&f.config.seller), 100);
    assert_eq!(f.balance(&a), 0);
    assert_eq!(f.balance(&f.id), 0);
}

#[test]
fn no_bids_can_be_settled_without_seller_participation() {
    let f = Fixture::new(false);
    f.time(300);
    f.env.set_auths(&[]);
    f.client().settle();
    assert_eq!(
        TestNftClient::new(&f.env, &f.config.nft).owner_of(&1),
        f.config.seller
    );
}

#[test]
fn failed_deposit_rolls_back_commitment_count_and_extension() {
    let f = Fixture::new(true);
    let unfunded = Address::generate(&f.env);
    f.time(199);
    let before = f.client().get_auction();
    assert!(f
        .client()
        .try_commit_bid(&unfunded, &f.hash(&unfunded, 70, 1))
        .is_err());
    assert_eq!(f.client().get_auction(), before);
    assert_eq!(
        f.client().try_get_bid(&unfunded),
        Err(Ok(Error::NoCommitment))
    );
    assert_eq!(f.balance(&f.id), 0);
}

#[test]
fn failed_nft_transfer_rolls_back_settlement_and_payment() {
    let f = Fixture::new(false);
    let a = f.bidder();
    f.commit(&a, 70, 1);
    f.time(200);
    f.reveal(&a, 70, 1);
    f.time(300);
    TestNftClient::new(&f.env, &f.config.nft).set_failure(&true);
    assert!(f.client().try_settle().is_err());
    assert!(!f.client().get_auction().settled);
    assert_eq!(f.balance(&f.config.seller), 0);
    assert_eq!(f.balance(&f.id), 100);
    TestNftClient::new(&f.env, &f.config.nft).set_failure(&false);
    f.client().settle();
    assert_eq!(f.balance(&f.config.seller), 70);
}

#[test]
fn invalid_config_and_reinitialization_do_not_move_assets() {
    let f = Fixture::uninitialized(false);
    let mut config = f.config.clone();
    for reserve in [-1, 0, 101] {
        config.reserve = reserve;
        assert_eq!(
            f.client().try_initialize(&config),
            Err(Ok(Error::InvalidConfig))
        );
    }
    config = f.config.clone();
    config.commit_duration = u64::MAX;
    assert_eq!(
        f.client().try_initialize(&config),
        Err(Ok(Error::InvalidConfig))
    );
    config = f.config.clone();
    config.max_extensions = 11;
    assert_eq!(
        f.client().try_initialize(&config),
        Err(Ok(Error::InvalidConfig))
    );
    assert_eq!(
        TestNftClient::new(&f.env, &f.config.nft).owner_of(&1),
        f.config.seller
    );
    f.client().initialize(&f.config);
    assert_eq!(
        f.client().try_initialize(&f.config),
        Err(Ok(Error::AlreadyInitialized))
    );
    assert_eq!(
        f.client()
            .try_commit_bid(&f.config.seller, &f.hash(&f.config.seller, 70, 1)),
        Err(Ok(Error::InvalidBidder))
    );
}

#[test]
fn seller_auth_ownership_and_failed_escrow_are_checked() {
    let f = Fixture::uninitialized(false);
    f.env.set_auths(&[]);
    assert!(f.client().try_initialize(&f.config).is_err());
    f.env.mock_all_auths();
    let mut wrong_seller = f.config.clone();
    wrong_seller.seller = Address::generate(&f.env);
    assert_eq!(
        f.client().try_initialize(&wrong_seller),
        Err(Ok(Error::InvalidConfig))
    );
    TestNftClient::new(&f.env, &f.config.nft).set_failure(&true);
    assert!(f.client().try_initialize(&f.config).is_err());
    assert_eq!(f.client().try_get_auction(), Err(Ok(Error::NotInitialized)));
    assert_eq!(
        TestNftClient::new(&f.env, &f.config.nft).owner_of(&1),
        f.config.seller
    );
    TestNftClient::new(&f.env, &f.config.nft).set_failure(&false);
    f.client().initialize(&f.config);
}

/// Exhaust every pair of ring bids in {10,20,30} and every reveal/withhold subset.
/// With a fixed honest bid of 20, no ring strategy can reduce sale revenue below
/// 20, escape a withholding penalty, redirect a refund, or create token value.
/// This bounded model is not a proof against arbitrary off-chain collusion.
#[test]
fn exhaustive_ring_profiles_preserve_revenue_and_collateral_invariants() {
    for ring_a in [10_i128, 20, 30] {
        for ring_b in [10_i128, 20, 30] {
            for reveal_mask in 0..4 {
                let f = Fixture::new(false);
                let bidders = [f.bidder(), f.bidder(), f.bidder()];
                let amounts = [20, ring_a, ring_b];
                for (index, bidder) in bidders.iter().enumerate() {
                    f.commit(bidder, amounts[index], index as u8);
                }
                f.time(200);
                f.reveal(&bidders[0], 20, 0);
                let mut expected = 20;
                for index in 1..3 {
                    if reveal_mask & (1 << (index - 1)) != 0 {
                        f.reveal(&bidders[index], amounts[index], index as u8);
                        expected = expected.max(amounts[index]);
                    }
                }
                assert_eq!(f.client().get_auction().winning_bid, expected);
                f.time(300);
                f.client().settle();
                assert!(f.balance(&f.config.seller) >= 20);
                for bidder in &bidders {
                    f.client().claim_bid(bidder);
                }
                let forfeited = (2 - (reveal_mask as u32).count_ones()) as i128 * 100;
                assert_eq!(f.balance(&f.config.seller), expected + forfeited);
                assert_eq!(f.balance(&f.id), 0);
                assert_eq!(
                    f.balance(&f.config.seller)
                        + bidders.iter().map(|b| f.balance(b)).sum::<i128>(),
                    300
                );
                let winner = f.client().get_auction().winner.unwrap();
                // Transferable coalition value 50: forfeiting a deposit >= every
                // possible bid cannot improve joint payoff by withholding.
                let ring_wins = winner != bidders[0];
                let ring_cost = forfeited + if ring_wins { expected } else { 0 };
                let ring_utility = if ring_wins { 50 } else { 0 } - ring_cost;
                let baseline_bid = ring_a.max(ring_b);
                let baseline_utility = if baseline_bid > 20 {
                    50 - baseline_bid
                } else {
                    0
                };
                assert!(ring_utility <= baseline_utility);
                assert_eq!(
                    TestNftClient::new(&f.env, &f.config.nft).owner_of(&1),
                    winner
                );
            }
        }
    }
}
