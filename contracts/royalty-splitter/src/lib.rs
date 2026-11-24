#![no_std]

//! Intellectual Property Royalty Splitter — routes incoming revenue across
//! nested tiers of creators, producers and rights holders (issue #1836).
//!
//! ## Hierarchy
//!
//! The split configuration is a tree. An internal node is a splitter whose
//! children carry basis-point weights (10,000 bps = 100%); a leaf is a
//! beneficiary address. Nested sub-splitters model real-world arrangements
//! such as "20% to the Band, subdivided among 4 band members".
//!
//! ## Zero truncation loss
//!
//! At every splitter node the floor division of `amount * bps / 10,000`
//! leaves a remainder. The remainder is redistributed one unit at a time to
//! the first children in declaration order (largest-remainder method), so the
//! children's shares always sum *exactly* to what the node received. Because
//! each node conserves what it receives, the sum of all leaf credits always
//! equals the distributed amount — no matter how deep the tree is.
//!
//! ## Pull-over-push payments
//!
//! `distribute` never transfers to beneficiaries. It only credits internal
//! pull-payment balances keyed by `(beneficiary, token)`, so a malicious or
//! buggy recipient contract can never block a distribution — the worst it can
//! do is refuse its own `claim`, harming only itself. Beneficiaries withdraw
//! per token, at any time, via `claim`.
//!
//! ## Configuration terms
//!
//! The tree is set once at `initialize`. If the contract is initialised with
//! `updatable = true` the admin may later replace the tree (governance
//! upgrade); otherwise the configuration is immutable.
//!
//! ## Gas
//!
//! Distribution performs one storage read for the whole tree plus a single
//! in-memory walk: one token transfer in, O(nodes) arithmetic, O(leaves)
//! storage writes. Depth never multiplies storage accesses.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
    Vec,
};

/// Basis points representing 100% of a node's allocation.
pub const BPS_DENOMINATOR: u32 = 10_000;
/// Maximum nesting depth of the beneficiary tree (root = depth 1).
pub const MAX_DEPTH: u32 = 3;
/// Maximum children a single splitter node may have.
pub const MAX_CHILDREN: u32 = 32;
/// Maximum leaf beneficiaries in the whole tree.
pub const MAX_LEAVES: u32 = 256;
/// Largest distributable amount, chosen so `amount * BPS_DENOMINATOR`
/// cannot overflow `i128`.
pub const MAX_AMOUNT: i128 = i128::MAX / BPS_DENOMINATOR as i128;

/// One weighted edge of a splitter node.
#[contracttype]
#[derive(Clone)]
pub struct Child {
    /// Share of the parent node's receipt, in basis points.
    pub share_bps: u32,
    /// The destination: either a leaf beneficiary or another splitter.
    pub node: Node,
}

/// A node of the beneficiary hierarchy.
#[contracttype]
#[derive(Clone)]
pub enum Node {
    /// A terminal rights holder. Credits accumulate in their pull balance.
    Beneficiary(Address),
    /// An internal tier that subdivides its receipt among `children`.
    /// The children's `share_bps` must sum to exactly 10,000.
    Splitter(Vec<Child>),
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Updatable,
    Tree,
    /// Pull-payment balance of `Address` in token `Address`.
    Owed(Address, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    /// The config is immutable but an update was attempted.
    ImmutableConfig = 3,
    /// A splitter's children do not sum to 10,000 bps, or a child has 0 bps.
    InvalidBps = 4,
    /// A splitter node had no children.
    EmptySplitter = 5,
    /// The tree nests deeper than `MAX_DEPTH`.
    TooDeep = 6,
    ZeroAmount = 7,
    NoTree = 8,
    NothingToClaim = 9,
    ArithmeticOverflow = 10,
    TooManyLeaves = 11,
    TooManyChildren = 12,
    /// The amount exceeds `MAX_AMOUNT`.
    AmountTooLarge = 13,
    /// Circular dependency or duplicate beneficiary in hierarchy.
    CircularDependency = 14,
}

#[contract]
pub struct RoyaltySplitter;

#[contractimpl]
impl RoyaltySplitter {
    /// Initialise the splitter with an admin, the mutability flag, and the
    /// root of the beneficiary hierarchy. The tree is validated up front.
    pub fn initialize(env: Env, admin: Address, updatable: bool, tree: Node) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        Self::validate_tree(&env, &tree)?;
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Updatable, &updatable);
        env.storage().instance().set(&DataKey::Tree, &tree);

        env.events()
            .publish((symbol_short!("splitter"), symbol_short!("init")), admin);

        Ok(())
    }

    /// Replace the beneficiary tree. Only the admin, and only when the
    /// contract was initialised as updatable (governance-upgradable terms).
    pub fn update_tree(env: Env, caller: Address, tree: Node) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NoTree)?;
        if caller != admin {
            return Err(Error::NotAuthorized);
        }
        caller.require_auth();

        let updatable: bool = env
            .storage()
            .instance()
            .get(&DataKey::Updatable)
            .unwrap_or(false);
        if !updatable {
            return Err(Error::ImmutableConfig);
        }

        Self::validate_tree(&env, &tree)?;
        env.storage().instance().set(&DataKey::Tree, &tree);

        env.events()
            .publish((symbol_short!("splitter"), symbol_short!("update")), caller);

        Ok(())
    }

    /// Route `amount` of `token` through the stored hierarchy into
    /// beneficiaries' pull-payment balances.
    ///
    /// The payer must have approved this contract as a token spender; the
    /// tokens are pulled in one transfer, then only internal balances are
    /// credited — no beneficiary code is ever invoked.
    pub fn distribute(env: Env, payer: Address, token: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if amount > MAX_AMOUNT {
            return Err(Error::AmountTooLarge);
        }
        payer.require_auth();

        let tree: Node = env
            .storage()
            .instance()
            .get(&DataKey::Tree)
            .ok_or(Error::NoTree)?;

        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &payer,
            &env.current_contract_address(),
            &amount,
        );

        let mut credits: Vec<(Address, i128)> = Vec::new(&env);
        Self::apply(&env, &tree, amount, &mut credits)?;

        for (beneficiary, share) in credits.iter() {
            let key = DataKey::Owed(beneficiary.clone(), token.clone());
            let prior: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            let total = prior.checked_add(share).ok_or(Error::ArithmeticOverflow)?;
            env.storage().persistent().set(&key, &total);
        }

        env.events()
            .publish((Symbol::new(&env, "distribute"), token), (payer, amount));

        Ok(())
    }

    /// Withdraw the caller's accumulated balance in `token` (pull payment).
    pub fn claim(env: Env, beneficiary: Address, token: Address) -> Result<i128, Error> {
        beneficiary.require_auth();

        let key = DataKey::Owed(beneficiary.clone(), token.clone());
        let amount: i128 = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NothingToClaim)?;
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }
        env.storage().persistent().remove(&key);

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &beneficiary,
            &amount,
        );

        env.events()
            .publish((symbol_short!("claim"), token), (beneficiary, amount));

        Ok(amount)
    }

    /// The caller's claimable balance in `token`.
    pub fn claimable(env: Env, beneficiary: Address, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Owed(beneficiary, token))
            .unwrap_or(0)
    }

    /// The current beneficiary tree, if one has been stored.
    pub fn get_tree(env: Env) -> Option<Node> {
        env.storage().instance().get(&DataKey::Tree)
    }

    /// Compute the leaf credits for `amount` under `tree` without moving any
    /// funds. The returned credits sum to exactly `amount`. Exposed so the
    /// zero-truncation property is verifiable off chain.
    pub fn preview_split(
        env: Env,
        tree: Node,
        amount: i128,
    ) -> Result<Vec<(Address, i128)>, Error> {
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if amount > MAX_AMOUNT {
            return Err(Error::AmountTooLarge);
        }
        Self::validate_tree(&env, &tree)?;
        let mut credits: Vec<(Address, i128)> = Vec::new(&env);
        Self::apply(&env, &tree, amount, &mut credits)?;
        Ok(credits)
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /// Depth-first walk that credits leaves. Every splitter node redistributes
    /// its floor-division remainder, so each node passes exactly its full
    /// receipt down the tree.
    fn apply(
        env: &Env,
        node: &Node,
        amount: i128,
        credits: &mut Vec<(Address, i128)>,
    ) -> Result<(), Error> {
        match node {
            Node::Beneficiary(address) => {
                Self::accumulate(credits, address.clone(), amount);
                Ok(())
            }
            Node::Splitter(children) => {
                let n = children.len();
                let mut shares: Vec<i128> = Vec::new(env);
                let mut allocated: i128 = 0;
                for child in children.iter() {
                    let share = amount
                        .checked_mul(child.share_bps as i128)
                        .ok_or(Error::ArithmeticOverflow)?
                        / BPS_DENOMINATOR as i128;
                    shares.push_back(share);
                    allocated = allocated
                        .checked_add(share)
                        .ok_or(Error::ArithmeticOverflow)?;
                }

                // Largest-remainder correction: give the floor dust to the
                // first children, one unit each, so the node conserves value.
                let mut leftover = amount
                    .checked_sub(allocated)
                    .ok_or(Error::ArithmeticOverflow)?;
                for i in 0..n {
                    if leftover <= 0 {
                        break;
                    }
                    let bumped = shares
                        .get(i)
                        .unwrap()
                        .checked_add(1)
                        .ok_or(Error::ArithmeticOverflow)?;
                    shares.set(i, bumped);
                    leftover -= 1;
                }

                for (i, child) in children.iter().enumerate() {
                    let share = shares.get(i as u32).unwrap();
                    if share > 0 {
                        Self::apply(env, &child.node, share, credits)?;
                    }
                }
                Ok(())
            }
        }
    }

    /// Add `amount` to `address`'s entry, preserving first-seen order so the
    /// preview output is deterministic.
    fn accumulate(credits: &mut Vec<(Address, i128)>, address: Address, amount: i128) {
        for i in 0..credits.len() {
            let mut entry = credits.get(i).unwrap();
            if entry.0 == address {
                entry.1 = entry.1.saturating_add(amount);
                credits.set(i, entry);
                return;
            }
        }
        credits.push_back((address, amount));
    }

    /// Structural validation of a tree: per-node bps sums, child/leaf/depth
    /// bounds, and cycle detection. Runs once at set time so the distribution walk never re-checks.
    fn validate_tree(env: &Env, node: &Node) -> Result<(), Error> {
        let mut leaves: u32 = 0;
        let mut visited: Vec<Address> = Vec::new(env);
        Self::validate_node(env, node, 1, &mut leaves, &mut visited)
    }

    fn validate_node(
        env: &Env,
        node: &Node,
        depth: u32,
        leaves: &mut u32,
        visited: &mut Vec<Address>,
    ) -> Result<(), Error> {
        if depth > MAX_DEPTH {
            return Err(Error::TooDeep);
        }
        match node {
            Node::Beneficiary(addr) => {
                for v in visited.iter() {
                    if v == *addr {
                        return Err(Error::CircularDependency);
                    }
                }
                visited.push_back(addr.clone());
                *leaves = leaves.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
                if *leaves > MAX_LEAVES {
                    return Err(Error::TooManyLeaves);
                }
                Ok(())
            }
            Node::Splitter(children) => {
                if children.is_empty() {
                    return Err(Error::EmptySplitter);
                }
                if children.len() > MAX_CHILDREN {
                    return Err(Error::TooManyChildren);
                }
                let mut total: u32 = 0;
                for child in children.iter() {
                    if child.share_bps == 0 {
                        return Err(Error::InvalidBps);
                    }
                    total = total
                        .checked_add(child.share_bps)
                        .ok_or(Error::ArithmeticOverflow)?;
                    Self::validate_node(env, &child.node, depth + 1, leaves, visited)?;
                }
                if total != BPS_DENOMINATOR {
                    return Err(Error::InvalidBps);
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod test;
