#![cfg(test)]

//! Tests for the hierarchical IP royalty splitter (issue #1836).
//!
//! The suite is organised around the contract's guarantees: exact
//! conservation across nested tiers, pull-payment isolation from beneficiary
//! contracts, multi-token withdrawal, and immutable vs updatable terms.

use crate::{Child, Error, Node, RoyaltySplitter, RoyaltySplitterClient, MAX_AMOUNT};
use soroban_sdk::{
    contract, contractimpl,
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, Vec,
};

// ── Harness ─────────────────────────────────────────────────────────────────

struct Harness {
    admin: Address,
    payer: Address,
    token_id: Address,
    client: RoyaltySplitterClient<'static>,
    token: TokenClient<'static>,
}

impl Harness {
    /// Deploy with `tree`, mint `funds` to the payer and approve the
    /// splitter to pull them.
    fn new(updatable: bool, tree: &Node, funds: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        let token = TokenClient::new(&env, &token_id);

        let contract_id = env.register_contract(None, RoyaltySplitter);
        let client = RoyaltySplitterClient::new(&env, &contract_id);
        client.initialize(&admin, &updatable, tree);

        StellarAssetClient::new(&env, &token_id).mint(&payer, &funds);
        token.approve(&payer, &contract_id, &i128::MAX, &0);

        Self {
            admin,
            payer,
            token_id,
            client,
            token,
        }
    }

    fn distribute(&self, amount: i128) {
        self.client.distribute(&self.payer, &self.token_id, &amount);
    }

    /// Claim for `who`, returning 0 when nothing is owed. Keeps the
    /// conservation-sweep loops readable.
    fn claim_if_any(&self, who: &Address) -> i128 {
        match self.client.try_claim(who, &self.token_id) {
            Ok(Ok(amount)) => amount,
            _ => 0,
        }
    }

    fn balance(&self, who: &Address) -> i128 {
        self.token.balance(who)
    }

    fn contract_balance(&self) -> i128 {
        self.token.balance(&self.client.address)
    }
}

// ── Tree builders ───────────────────────────────────────────────────────────

/// Root: 40% to a 4-member band (2500 bps each), 60% to the producer.
fn band_tree(env: &Env) -> (Node, Vec<Address>, Address) {
    let mut members = Vec::new(env);
    let mut band_children = Vec::new(env);
    for _ in 0..4 {
        let member = Address::generate(env);
        members.push_back(member.clone());
        band_children.push_back(Child {
            share_bps: 2500,
            node: Node::Beneficiary(member),
        });
    }
    let producer = Address::generate(env);
    let root = Node::Splitter(vec![
        env,
        Child {
            share_bps: 4000,
            node: Node::Splitter(band_children),
        },
        Child {
            share_bps: 6000,
            node: Node::Beneficiary(producer.clone()),
        },
    ]);
    (root, members, producer)
}

// ── Zero truncation across multi-tier hierarchies ───────────────────────────

#[test]
fn nested_split_has_zero_truncation_loss() {
    let env = Env::default();
    let (root, members, producer) = band_tree(&env);
    let h = Harness::new(true, &root, 2_000_000);

    // 1_000_001 * 40% = 400_000.4 -> band gets 400_001 (remainder +1);
    // band pays 4 members 100_000.25 each -> first member +1 dust unit.
    // 1_000_001 * 60% = 600_000.6 -> producer floor 600_000.
    h.distribute(1_000_001);

    assert_eq!(
        h.client.claimable(&members.get(0).unwrap(), &h.token_id),
        100_001
    );
    for i in 1..4 {
        assert_eq!(
            h.client.claimable(&members.get(i).unwrap(), &h.token_id),
            100_000
        );
    }
    assert_eq!(h.client.claimable(&producer, &h.token_id), 600_000);

    let distributed_total: i128 = (0..4)
        .map(|i| h.client.claimable(&members.get(i).unwrap(), &h.token_id))
        .sum::<i128>()
        + h.client.claimable(&producer, &h.token_id);
    assert_eq!(distributed_total, 1_000_001, "every stroop must be routed");
    assert_eq!(h.contract_balance(), 1_000_001);
}

#[test]
fn conserves_value_for_every_remainder_across_three_levels() {
    let env = Env::default();
    let (root, leaves) = three_level_tree(&env);
    let h = Harness::new(true, &root, 100_000);

    for amount in 1..=60i128 {
        h.distribute(amount);

        let owed: i128 = leaves
            .iter()
            .map(|leaf| h.client.claimable(&leaf, &h.token_id))
            .sum();
        assert_eq!(owed, amount, "preview credit mismatch for {amount}");

        let claimed: i128 = leaves.iter().map(|leaf| h.claim_if_any(&leaf)).sum();
        assert_eq!(claimed, amount, "claim mismatch for {amount}");
        assert_eq!(h.contract_balance(), 0, "escrow drained for {amount}");
    }
}

#[test]
fn preview_split_matches_actual_distribution() {
    let env = Env::default();
    let (root, members, producer) = band_tree(&env);
    let h = Harness::new(true, &root, 1_000_000);

    let credits = h.client.preview_split(&root, &99_999);
    let preview_total: i128 = credits.iter().map(|(_, amount)| amount).sum();
    assert_eq!(preview_total, 99_999);

    h.distribute(99_999);
    for (address, amount) in credits.iter() {
        assert_eq!(h.client.claimable(&address, &h.token_id), amount);
    }
    let _ = (members, producer);
}

#[test]
fn single_leaf_receives_everything() {
    let env = Env::default();
    let leaf = Address::generate(&env);
    let root = Node::Beneficiary(leaf.clone());
    let h = Harness::new(true, &root, 1_000);

    h.distribute(777);
    assert_eq!(h.client.claimable(&leaf, &h.token_id), 777);
}

#[test]
fn successive_distributions_accumulate() {
    let env = Env::default();
    let (root, members, producer) = band_tree(&env);
    let h = Harness::new(true, &root, 10_000);

    h.distribute(1_000);
    h.distribute(500);
    let total: i128 = (0..4)
        .map(|i| h.client.claimable(&members.get(i).unwrap(), &h.token_id))
        .sum::<i128>()
        + h.client.claimable(&producer, &h.token_id);
    assert_eq!(total, 1_500);
}

/// root → 3 groups (3334/3333/3333 bps), each group → 3 leaves
/// (3334/3333/3333 bps). Worst-case remainder nesting.
fn three_level_tree(env: &Env) -> (Node, Vec<Address>) {
    let group_bps = [3334u32, 3333, 3333];
    let leaf_bps = [3334u32, 3333, 3333];
    let mut groups = Vec::new(env);
    let mut leaves = Vec::new(env);
    for g in 0..3 {
        let mut children = Vec::new(env);
        for l in 0..3 {
            let leaf = Address::generate(env);
            leaves.push_back(leaf.clone());
            children.push_back(Child {
                share_bps: leaf_bps[l],
                node: Node::Beneficiary(leaf),
            });
        }
        groups.push_back(Child {
            share_bps: group_bps[g],
            node: Node::Splitter(children),
        });
    }
    (Node::Splitter(groups), leaves)
}

// ── Pull-payment model ──────────────────────────────────────────────────────

/// A contract that traps on any call. If `distribute` ever tried to push
/// funds to beneficiaries, this leaf would abort the whole distribution.
#[allow(dead_code)]
#[contract]
pub struct Trap;

#[allow(dead_code)]
#[contractimpl]
impl Trap {
    pub fn never() -> i32 {
        panic!("beneficiary must never be invoked by distribute")
    }
}

#[test]
fn distribution_never_invokes_beneficiary_contracts() {
    let env = Env::default();
    env.mock_all_auths();
    let (_old_root, members, _old_producer) = band_tree(&env);

    // Replace the producer leaf with the trapping contract's address.
    let trap_id = env.register_contract(None, Trap);
    let root = Node::Splitter(vec![
        &env,
        Child {
            share_bps: 4000,
            node: Node::Splitter({
                let mut children = Vec::new(&env);
                for member in members.iter() {
                    children.push_back(Child {
                        share_bps: 2500,
                        node: Node::Beneficiary(member),
                    });
                }
                children
            }),
        },
        Child {
            share_bps: 6000,
            node: Node::Beneficiary(trap_id.clone()),
        },
    ]);

    let h = Harness::new(true, &root, 1_000_000);
    h.distribute(1_000_000);

    // The trapped contract is merely credited, never called.
    assert_eq!(h.client.claimable(&trap_id, &h.token_id), 600_000);
}

#[test]
fn claim_pays_out_and_zeroes_balance() {
    let env = Env::default();
    let leaf = Address::generate(&env);
    let h = Harness::new(true, &Node::Beneficiary(leaf.clone()), 1_000);

    h.distribute(500);
    assert_eq!(h.client.claim(&leaf, &h.token_id), 500);
    assert_eq!(h.balance(&leaf), 500);
    assert_eq!(h.client.claimable(&leaf, &h.token_id), 0);
    assert_eq!(h.contract_balance(), 0);

    // Nothing is owed a second time.
    assert_eq!(
        h.client.try_claim(&leaf, &h.token_id),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn beneficiaries_withdraw_across_multiple_tokens() {
    let env = Env::default();
    let (root, members, producer) = band_tree(&env);
    let h = Harness::new(true, &root, 1_000_000);

    let usdc_admin = Address::generate(&env);
    let usdc_id = env.register_stellar_asset_contract_v2(usdc_admin).address();
    let usdc = TokenClient::new(&env, &usdc_id);
    StellarAssetClient::new(&env, &usdc_id).mint(&h.payer, &300_000);
    usdc.approve(&h.payer, &h.client.address, &i128::MAX, &0);

    // Same tree, two arbitrary tokens routed independently.
    h.distribute(100_000);
    h.client.distribute(&h.payer, &usdc_id, &300_000);

    let member = members.get(0).unwrap();
    assert_eq!(h.client.claimable(&member, &h.token_id), 10_000);
    assert_eq!(h.client.claimable(&member, &usdc_id), 30_000);

    // Claiming XLM leaves the USDC balance untouched.
    h.claim_if_any(&member);
    assert_eq!(h.client.claimable(&member, &h.token_id), 0);
    assert_eq!(h.client.claimable(&member, &usdc_id), 30_000);

    assert_eq!(h.client.claim(&member, &usdc_id), 30_000);
    assert_eq!(h.balance(&member), 40_000);
    let _ = producer;
}

// ── Configuration terms ─────────────────────────────────────────────────────

#[test]
fn immutable_config_rejects_tree_update() {
    let env = Env::default();
    let (root, ..) = band_tree(&env);
    let h = Harness::new(false, &root, 1_000);
    let new_root = Node::Beneficiary(Address::generate(&env));

    assert_eq!(
        h.client.try_update_tree(&h.admin, &new_root),
        Err(Ok(Error::ImmutableConfig))
    );
}

#[test]
fn updatable_config_replaces_tree() {
    let env = Env::default();
    let old_leaf = Address::generate(&env);
    let new_leaf = Address::generate(&env);
    let h = Harness::new(true, &Node::Beneficiary(old_leaf.clone()), 1_000);

    h.client
        .update_tree(&h.admin, &Node::Beneficiary(new_leaf.clone()));
    h.distribute(400);

    assert_eq!(h.client.claimable(&old_leaf, &h.token_id), 0);
    assert_eq!(h.client.claimable(&new_leaf, &h.token_id), 400);
}

#[test]
fn non_admin_cannot_update_tree() {
    let env = Env::default();
    let (root, ..) = band_tree(&env);
    let h = Harness::new(true, &root, 1_000);
    let stranger = Address::generate(&env);
    let new_root = Node::Beneficiary(Address::generate(&env));

    assert_eq!(
        h.client.try_update_tree(&stranger, &new_root),
        Err(Ok(Error::NotAuthorized))
    );
}

// ── Validation ──────────────────────────────────────────────────────────────

fn init_error(tree: &Node) -> Error {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, RoyaltySplitter);
    let client = RoyaltySplitterClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    match client.try_initialize(&admin, &true, tree) {
        Err(Ok(e)) => e,
        _ => panic!("expected initialization to fail"),
    }
}

#[test]
fn rejects_bps_not_summing_to_10000() {
    let env = Env::default();
    let tree = Node::Splitter(vec![
        &env,
        Child {
            share_bps: 5000,
            node: Node::Beneficiary(Address::generate(&env)),
        },
        Child {
            share_bps: 4999,
            node: Node::Beneficiary(Address::generate(&env)),
        },
    ]);
    assert_eq!(init_error(&tree), Error::InvalidBps);
}

#[test]
fn rejects_zero_bps_child() {
    let env = Env::default();
    let tree = Node::Splitter(vec![
        &env,
        Child {
            share_bps: 10_000,
            node: Node::Beneficiary(Address::generate(&env)),
        },
        Child {
            share_bps: 0,
            node: Node::Beneficiary(Address::generate(&env)),
        },
    ]);
    assert_eq!(init_error(&tree), Error::InvalidBps);
}

#[test]
fn rejects_empty_splitter() {
    let env = Env::default();
    let tree = Node::Splitter(Vec::new(&env));
    assert_eq!(init_error(&tree), Error::EmptySplitter);
}

#[test]
fn rejects_tree_deeper_than_max_depth() {
    let env = Env::default();
    let mut tree = Node::Beneficiary(Address::generate(&env));
    // 5 nested splitters exceeds MAX_DEPTH (3).
    for _ in 0..5 {
        tree = Node::Splitter(vec![
            &env,
            Child {
                share_bps: 10_000,
                node: tree,
            },
        ]);
    }
    assert_eq!(init_error(&tree), Error::TooDeep);
}

#[test]
fn test_circular_dependency_rejected() {
    let env = Env::default();
    let shared = Address::generate(&env);
    let tree = Node::Splitter(vec![
        &env,
        Child {
            share_bps: 5_000,
            node: Node::Beneficiary(shared.clone()),
        },
        Child {
            share_bps: 5_000,
            node: Node::Beneficiary(shared.clone()),
        },
    ]);
    assert_eq!(init_error(&tree), Error::CircularDependency);
}

#[test]
fn test_deeply_nested_10_party_split() {
    let env = Env::default();
    let mut children = Vec::new(&env);
    let mut addrs = Vec::new(&env);
    for _ in 0..10 {
        let addr = Address::generate(&env);
        addrs.push_back(addr.clone());
        children.push_back(Child {
            share_bps: 1_000,
            node: Node::Beneficiary(addr),
        });
    }
    let tree = Node::Splitter(children);
    let h = Harness::new(false, &tree, 100_000);
    h.distribute(100_000);
    for addr in addrs.iter() {
        assert_eq!(h.claim_if_any(&addr), 10_000);
    }
}

#[test]
fn initialize_is_once_only() {
    let env = Env::default();
    let (root, ..) = band_tree(&env);
    let h = Harness::new(true, &root, 1_000);

    assert_eq!(
        h.client
            .try_initialize(&h.admin, &true, &Node::Beneficiary(Address::generate(&env))),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn rejects_zero_negative_and_oversized_amounts() {
    let env = Env::default();
    let (root, ..) = band_tree(&env);
    let h = Harness::new(true, &root, 1_000);

    assert_eq!(
        h.client.try_distribute(&h.payer, &h.token_id, &0),
        Err(Ok(Error::ZeroAmount))
    );
    assert_eq!(
        h.client.try_distribute(&h.payer, &h.token_id, &-5),
        Err(Ok(Error::ZeroAmount))
    );
    assert_eq!(
        h.client
            .try_distribute(&h.payer, &h.token_id, &(MAX_AMOUNT + 1)),
        Err(Ok(Error::AmountTooLarge))
    );
}
