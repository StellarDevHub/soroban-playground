// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, String, Symbol, Vec};

use crate::storage::{
    get_admin, get_conditional_market, get_liquidity_balance, get_market, get_market_count,
    get_outcome_balance, get_position, get_resolution, has_conditional_market,
    increment_market_count, is_initialized, set_admin, set_conditional_market,
    set_liquidity_balance, set_market, set_outcome_balance, set_position, set_resolution,
};
use crate::types::{
    ConditionalMarket, Error, Market, MarketStatus, MarketType, Position, ResolutionProposal,
};

const MIN_OUTCOMES: u32 = 2;
const MAX_OUTCOMES: u32 = 16;
const MAX_DISPUTE_WINDOW: u64 = 30 * 24 * 60 * 60;

// ── Event topic symbols ────────────────────────────────────────────────────────
// Published via env.events().publish((topic,), data)
const EVT_INIT: Symbol = symbol_short!("init");
const EVT_CREATED: Symbol = symbol_short!("mkt_crt");
const EVT_BET: Symbol = symbol_short!("bet");
const EVT_RESOLVED: Symbol = symbol_short!("resolved");
const EVT_CANCELLED: Symbol = symbol_short!("mkt_can");
const EVT_LIQUIDITY: Symbol = symbol_short!("liquidity");
const EVT_SHARES: Symbol = symbol_short!("shares");
const EVT_PROPOSED: Symbol = symbol_short!("proposed");
const EVT_DISPUTED: Symbol = symbol_short!("disputed");
const EVT_REDEEMED: Symbol = symbol_short!("redeemed");
const EVT_MINT: Symbol = symbol_short!("ct_mint");
const EVT_SELL: Symbol = symbol_short!("ct_sell");

#[contract]
pub struct PredictionMarket;

#[contractimpl]
impl PredictionMarket {
    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);

        // Event: (init,) => admin
        env.events().publish((EVT_INIT,), admin);
        Ok(())
    }

    /// Create a new prediction market.
    /// market_type: 0 = Binary, 1 = Scalar
    pub fn create_market(
        env: Env,
        creator: Address,
        question: String,
        market_type: u32,
        resolution_deadline: u64,
        oracle: Address,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        creator.require_auth();

        if resolution_deadline <= env.ledger().timestamp() {
            return Err(Error::MarketExpired);
        }

        let mtype = match market_type {
            0 => MarketType::Binary,
            1 => MarketType::Scalar,
            _ => return Err(Error::InvalidMarketType),
        };

        let id = increment_market_count(&env);

        let market = Market {
            id,
            creator: creator.clone(),
            question,
            market_type: mtype,
            status: MarketStatus::Open,
            resolution_deadline,
            oracle,
            winning_outcome: None,
            total_yes_stake: 0,
            total_no_stake: 0,
            created_at: env.ledger().timestamp(),
        };

        set_market(&env, &market);

        // Event: (mkt_crt,) => [id, creator, deadline]
        env.events()
            .publish((EVT_CREATED,), (id, creator, resolution_deadline));

        Ok(id)
    }

    /// Create a collateral-backed binary market with YES and NO outcomes.
    ///
    /// `initial_liquidity` is transferred from the creator and mints an equal
    /// complete set of YES/NO conditional shares into the market maker.
    #[allow(clippy::too_many_arguments)]
    pub fn create_binary_market(
        env: Env,
        creator: Address,
        question: String,
        resolution_deadline: u64,
        oracle: Address,
        dispute_resolver: Address,
        collateral_token: Address,
        dispute_window: u64,
        initial_liquidity: i128,
    ) -> Result<u32, Error> {
        let outcomes = Vec::from_array(
            &env,
            [String::from_str(&env, "NO"), String::from_str(&env, "YES")],
        );
        create_conditional_market(
            &env,
            creator,
            question,
            MarketType::Binary,
            outcomes,
            resolution_deadline,
            oracle,
            dispute_resolver,
            collateral_token,
            dispute_window,
            initial_liquidity,
        )
    }

    /// Create a collateral-backed market with 2 to 16 named outcomes.
    #[allow(clippy::too_many_arguments)]
    pub fn create_categorical_market(
        env: Env,
        creator: Address,
        question: String,
        outcomes: Vec<String>,
        resolution_deadline: u64,
        oracle: Address,
        dispute_resolver: Address,
        collateral_token: Address,
        dispute_window: u64,
        initial_liquidity: i128,
    ) -> Result<u32, Error> {
        create_conditional_market(
            &env,
            creator,
            question,
            MarketType::Categorical,
            outcomes,
            resolution_deadline,
            oracle,
            dispute_resolver,
            collateral_token,
            dispute_window,
            initial_liquidity,
        )
    }

    /// Quote the number of conditional outcome shares received for a buy.
    pub fn quote_buy(
        env: Env,
        market_id: u32,
        outcome: u32,
        collateral_amount: i128,
    ) -> Result<i128, Error> {
        let conditional = get_conditional_market(&env, market_id)?;
        quote_buy_shares(&conditional, outcome, collateral_amount)
    }

    /// Deposit collateral and buy conditional shares from the fixed-product pool.
    /// `min_shares` protects the caller from price movement before execution.
    pub fn buy_shares(
        env: Env,
        buyer: Address,
        market_id: u32,
        outcome: u32,
        collateral_amount: i128,
        min_shares: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        buyer.require_auth();
        let market = get_market(&env, market_id)?;
        ensure_trading_open(&env, &market)?;
        let mut conditional = get_conditional_market(&env, market_id)?;
        let shares = quote_buy_shares(&conditional, outcome, collateral_amount)?;
        if shares < min_shares {
            return Err(Error::SlippageExceeded);
        }

        token::Client::new(&env, &conditional.collateral_token).transfer(
            &buyer,
            &env.current_contract_address(),
            &collateral_amount,
        );

        for index in 0..conditional.pool_balances.len() {
            let reserve = conditional
                .pool_balances
                .get(index)
                .ok_or(Error::InsufficientLiquidity)?;
            let next = checked_add(reserve, collateral_amount)?;
            conditional.pool_balances.set(index, next);
        }
        let selected = conditional
            .pool_balances
            .get(outcome)
            .ok_or(Error::InsufficientLiquidity)?;
        conditional.pool_balances.set(outcome, checked_sub(selected, shares)?);
        conditional.collateral_locked =
            checked_add(conditional.collateral_locked, collateral_amount)?;

        let balance = get_outcome_balance(&env, market_id, &buyer, outcome);
        set_outcome_balance(
            &env,
            market_id,
            &buyer,
            outcome,
            checked_add(balance, shares)?,
        );
        set_conditional_market(&env, &conditional);
        env.events().publish(
            (EVT_SHARES, market_id, outcome),
            (buyer, collateral_amount, shares),
        );
        Ok(shares)
    }

    /// Quote collateral returned for selling conditional shares into the pool.
    pub fn quote_sell(
        env: Env,
        market_id: u32,
        outcome: u32,
        shares: i128,
    ) -> Result<i128, Error> {
        let conditional = get_conditional_market(&env, market_id)?;
        quote_sell_shares(&conditional, outcome, shares)
    }

    /// Sell conditional shares back into the fixed-product pool.
    /// `min_collateral` protects the caller from price movement before execution.
    pub fn sell_shares(
        env: Env,
        seller: Address,
        market_id: u32,
        outcome: u32,
        shares: i128,
        min_collateral: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        seller.require_auth();
        let market = get_market(&env, market_id)?;
        ensure_trading_open(&env, &market)?;
        let mut conditional = get_conditional_market(&env, market_id)?;
        let collateral = quote_sell_shares(&conditional, outcome, shares)?;
        if collateral < min_collateral {
            return Err(Error::SlippageExceeded);
        }
        let held = get_outcome_balance(&env, market_id, &seller, outcome);
        if held < shares {
            return Err(Error::InsufficientShares);
        }

        let selected = conditional
            .pool_balances
            .get(outcome)
            .ok_or(Error::InsufficientLiquidity)?;
        conditional
            .pool_balances
            .set(outcome, checked_add(selected, shares)?);
        for index in 0..conditional.pool_balances.len() {
            let reserve = conditional
                .pool_balances
                .get(index)
                .ok_or(Error::InsufficientLiquidity)?;
            conditional
                .pool_balances
                .set(index, checked_sub(reserve, collateral)?);
        }
        conditional.collateral_locked = checked_sub(conditional.collateral_locked, collateral)?;
        set_outcome_balance(
            &env,
            market_id,
            &seller,
            outcome,
            checked_sub(held, shares)?,
        );
        set_conditional_market(&env, &conditional);
        token::Client::new(&env, &conditional.collateral_token).transfer(
            &env.current_contract_address(),
            &seller,
            &collateral,
        );
        env.events().publish(
            (EVT_SELL, market_id, outcome),
            (seller, shares, collateral),
        );
        Ok(collateral)
    }

    /// Split collateral into one unit of every outcome token (complete set).
    /// The minted tokens are credited to the caller, not the AMM pool.
    pub fn mint_complete_set(
        env: Env,
        minter: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        minter.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let market = get_market(&env, market_id)?;
        ensure_trading_open(&env, &market)?;
        let mut conditional = get_conditional_market(&env, market_id)?;
        token::Client::new(&env, &conditional.collateral_token).transfer(
            &minter,
            &env.current_contract_address(),
            &amount,
        );
        for outcome in 0..conditional.outcomes.len() {
            let balance = get_outcome_balance(&env, market_id, &minter, outcome);
            set_outcome_balance(
                &env,
                market_id,
                &minter,
                outcome,
                checked_add(balance, amount)?,
            );
        }
        conditional.collateral_locked = checked_add(conditional.collateral_locked, amount)?;
        set_conditional_market(&env, &conditional);
        env.events()
            .publish((EVT_MINT, market_id), (minter, amount));
        Ok(())
    }

    /// Add a complete set of collateral-backed outcome shares to the pool.
    /// Returns newly minted liquidity shares.
    pub fn add_liquidity(
        env: Env,
        provider: Address,
        market_id: u32,
        collateral_amount: i128,
        min_liquidity_shares: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        provider.require_auth();
        let market = get_market(&env, market_id)?;
        ensure_trading_open(&env, &market)?;
        if collateral_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut conditional = get_conditional_market(&env, market_id)?;
        let mut minted = i128::MAX;
        for reserve in conditional.pool_balances.iter() {
            if reserve <= 0 {
                return Err(Error::InsufficientLiquidity);
            }
            let candidate = mul_div_floor(
                collateral_amount,
                conditional.total_liquidity_shares,
                reserve,
            )?;
            if candidate < minted {
                minted = candidate;
            }
        }
        if minted <= 0 || minted < min_liquidity_shares {
            return Err(Error::SlippageExceeded);
        }

        token::Client::new(&env, &conditional.collateral_token).transfer(
            &provider,
            &env.current_contract_address(),
            &collateral_amount,
        );
        for index in 0..conditional.pool_balances.len() {
            let reserve = conditional
                .pool_balances
                .get(index)
                .ok_or(Error::InsufficientLiquidity)?;
            let next = checked_add(reserve, collateral_amount)?;
            conditional.pool_balances.set(index, next);
        }
        conditional.total_liquidity_shares =
            checked_add(conditional.total_liquidity_shares, minted)?;
        conditional.collateral_locked =
            checked_add(conditional.collateral_locked, collateral_amount)?;
        let balance = get_liquidity_balance(&env, market_id, &provider);
        set_liquidity_balance(&env, market_id, &provider, checked_add(balance, minted)?);
        set_conditional_market(&env, &conditional);
        env.events().publish(
            (EVT_LIQUIDITY, market_id),
            (provider, collateral_amount, minted),
        );
        Ok(minted)
    }

    /// Burn liquidity shares and receive the corresponding basket of outcome
    /// shares. Those shares can be merged into collateral before settlement or
    /// redeemed according to the final result afterwards.
    pub fn remove_liquidity(
        env: Env,
        provider: Address,
        market_id: u32,
        liquidity_shares: i128,
    ) -> Result<Vec<i128>, Error> {
        ensure_initialized(&env)?;
        provider.require_auth();
        let market = get_market(&env, market_id)?;
        if market.status == MarketStatus::Cancelled {
            return Err(Error::MarketAlreadyResolved);
        }
        if liquidity_shares <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut conditional = get_conditional_market(&env, market_id)?;
        let provider_balance = get_liquidity_balance(&env, market_id, &provider);
        if liquidity_shares > provider_balance {
            return Err(Error::InsufficientLiquidity);
        }

        let mut withdrawn = Vec::new(&env);
        for outcome in 0..conditional.pool_balances.len() {
            let reserve = conditional
                .pool_balances
                .get(outcome)
                .ok_or(Error::InsufficientLiquidity)?;
            let amount = mul_div_floor(
                reserve,
                liquidity_shares,
                conditional.total_liquidity_shares,
            )?;
            if amount <= 0 {
                return Err(Error::InvalidAmount);
            }
            conditional.pool_balances.set(outcome, checked_sub(reserve, amount)?);
            let balance = get_outcome_balance(&env, market_id, &provider, outcome);
            set_outcome_balance(
                &env,
                market_id,
                &provider,
                outcome,
                checked_add(balance, amount)?,
            );
            withdrawn.push_back(amount);
        }
        conditional.total_liquidity_shares = checked_sub(conditional.total_liquidity_shares, liquidity_shares)?;
        set_liquidity_balance(
            &env,
            market_id,
            &provider,
            checked_sub(provider_balance, liquidity_shares)?,
        );
        set_conditional_market(&env, &conditional);
        env.events()
            .publish((EVT_LIQUIDITY, market_id), (provider, liquidity_shares));
        Ok(withdrawn)
    }

    /// Burn equal quantities of every outcome token and unlock collateral.
    pub fn redeem_complete_set(
        env: Env,
        owner: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let market = get_market(&env, market_id)?;
        if market.status != MarketStatus::Open || get_resolution(&env, market_id).is_some() {
            return Err(Error::MarketAlreadyResolved);
        }
        let mut conditional = get_conditional_market(&env, market_id)?;
        for outcome in 0..conditional.outcomes.len() {
            if get_outcome_balance(&env, market_id, &owner, outcome) < amount {
                return Err(Error::InsufficientShares);
            }
        }
        for outcome in 0..conditional.outcomes.len() {
            let balance = get_outcome_balance(&env, market_id, &owner, outcome);
            set_outcome_balance(&env, market_id, &owner, outcome, checked_sub(balance, amount)?);
        }
        conditional.collateral_locked = checked_sub(conditional.collateral_locked, amount)?;
        set_conditional_market(&env, &conditional);
        token::Client::new(&env, &conditional.collateral_token).transfer(
            &env.current_contract_address(),
            &owner,
            &amount,
        );
        env.events()
            .publish((EVT_REDEEMED, market_id), (owner, amount));
        Ok(())
    }

    /// Propose the result after the market deadline. The result remains
    /// challengeable for the configured dispute window.
    pub fn propose_resolution(env: Env, market_id: u32, outcome: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let market = get_market(&env, market_id)?;
        market.oracle.require_auth();
        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        let conditional = get_conditional_market(&env, market_id)?;
        validate_outcome(&conditional, outcome)?;
        if env.ledger().timestamp() < market.resolution_deadline {
            return Err(Error::ResolutionTooEarly);
        }
        if get_resolution(&env, market_id).is_some() {
            return Err(Error::MarketAlreadyResolved);
        }
        let dispute_deadline = env
            .ledger()
            .timestamp()
            .checked_add(conditional.dispute_window)
            .ok_or(Error::ArithmeticOverflow)?;
        let proposal = ResolutionProposal {
            outcome,
            proposed_at: env.ledger().timestamp(),
            dispute_deadline,
            disputer: None,
            dispute_bond: 0,
        };
        set_resolution(&env, market_id, &proposal);
        env.events()
            .publish((EVT_PROPOSED, market_id), (outcome, dispute_deadline));
        Ok(())
    }

    /// Challenge an oracle result by escrowing a collateral bond. The resolver
    /// returns the bond if the result is overturned; otherwise it awards the
    /// bond to the oracle.
    pub fn dispute_resolution(
        env: Env,
        challenger: Address,
        market_id: u32,
        bond: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        challenger.require_auth();
        if bond <= 0 {
            return Err(Error::InvalidAmount);
        }
        let market = get_market(&env, market_id)?;
        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        let conditional = get_conditional_market(&env, market_id)?;
        let mut proposal = get_resolution(&env, market_id).ok_or(Error::ResolutionNotProposed)?;
        if env.ledger().timestamp() >= proposal.dispute_deadline {
            return Err(Error::DisputeWindowClosed);
        }
        if proposal.disputer.is_some() {
            return Err(Error::ResolutionAlreadyDisputed);
        }
        if bond < conditional.minimum_dispute_bond {
            return Err(Error::DisputeBondTooSmall);
        }
        token::Client::new(&env, &conditional.collateral_token).transfer(
            &challenger,
            &env.current_contract_address(),
            &bond,
        );
        proposal.disputer = Some(challenger.clone());
        proposal.dispute_bond = bond;
        set_resolution(&env, market_id, &proposal);
        env.events()
            .publish((EVT_DISPUTED, market_id), (challenger, bond));
        Ok(())
    }

    /// Finalize an undisputed result once its challenge window has elapsed.
    pub fn finalize_resolution(env: Env, market_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let mut market = get_market(&env, market_id)?;
        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        get_conditional_market(&env, market_id)?;
        let proposal = get_resolution(&env, market_id).ok_or(Error::ResolutionNotProposed)?;
        if proposal.disputer.is_some() {
            return Err(Error::ResolutionAlreadyDisputed);
        }
        if env.ledger().timestamp() < proposal.dispute_deadline {
            return Err(Error::DisputeWindowActive);
        }
        finalize_market(&env, &mut market, proposal.outcome);
        Ok(())
    }

    /// Rule on a challenged result. Only the configured dispute resolver may
    /// call this function.
    pub fn resolve_dispute(env: Env, market_id: u32, final_outcome: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let mut market = get_market(&env, market_id)?;
        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        let conditional = get_conditional_market(&env, market_id)?;
        conditional.dispute_resolver.require_auth();
        validate_outcome(&conditional, final_outcome)?;
        let proposal = get_resolution(&env, market_id).ok_or(Error::ResolutionNotProposed)?;
        let challenger = proposal
            .disputer
            .clone()
            .ok_or(Error::ResolutionNotDisputed)?;

        finalize_market(&env, &mut market, final_outcome);
        let bond_recipient = if final_outcome == proposal.outcome {
            market.oracle
        } else {
            challenger
        };
        token::Client::new(&env, &conditional.collateral_token).transfer(
            &env.current_contract_address(),
            &bond_recipient,
            &proposal.dispute_bond,
        );
        Ok(())
    }

    /// Burn winning conditional shares for collateral after final settlement.
    pub fn redeem_winnings(
        env: Env,
        owner: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let market = get_market(&env, market_id)?;
        if market.status != MarketStatus::Resolved {
            return Err(Error::MarketNotResolved);
        }
        let outcome = market.winning_outcome.ok_or(Error::MarketNotResolved)?;
        let mut conditional = get_conditional_market(&env, market_id)?;
        let balance = get_outcome_balance(&env, market_id, &owner, outcome);
        if balance < amount {
            return Err(Error::InsufficientShares);
        }
        set_outcome_balance(&env, market_id, &owner, outcome, checked_sub(balance, amount)?);
        conditional.collateral_locked = checked_sub(conditional.collateral_locked, amount)?;
        set_conditional_market(&env, &conditional);
        token::Client::new(&env, &conditional.collateral_token).transfer(
            &env.current_contract_address(),
            &owner,
            &amount,
        );
        env.events()
            .publish((EVT_REDEEMED, market_id), (owner, outcome, amount));
        Ok(())
    }

    /// Return the current fixed-product implied probability in basis points.
    pub fn spot_price(env: Env, market_id: u32, outcome: u32) -> Result<u32, Error> {
        let conditional = get_conditional_market(&env, market_id)?;
        validate_outcome(&conditional, outcome)?;
        const RATIO_SCALE: i128 = 1_000_000_000;
        let selected = conditional
            .pool_balances
            .get(outcome)
            .ok_or(Error::InsufficientLiquidity)?;
        if selected <= 0 {
            return Err(Error::InsufficientLiquidity);
        }
        let mut ratio_sum = 0i128;
        for reserve in conditional.pool_balances.iter() {
            if reserve <= 0 {
                return Err(Error::InsufficientLiquidity);
            }
            ratio_sum = checked_add(ratio_sum, mul_div_floor(selected, RATIO_SCALE, reserve)?)?;
        }
        if ratio_sum == 0 {
            return Err(Error::ArithmeticOverflow);
        }
        Ok(mul_div_floor(RATIO_SCALE, 10_000, ratio_sum)? as u32)
    }

    /// Place a position on a market outcome.
    /// outcome: 1 = YES, 0 = NO
    pub fn place_bet(
        env: Env,
        trader: Address,
        market_id: u32,
        outcome: u32,
        stake: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        trader.require_auth();

        if stake <= 0 {
            return Err(Error::ZeroStake);
        }
        if outcome > 1 {
            return Err(Error::InvalidOutcome);
        }

        let mut market = get_market(&env, market_id)?;

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if env.ledger().timestamp() >= market.resolution_deadline {
            return Err(Error::MarketExpired);
        }

        // Update or create position
        let position = match get_position(&env, market_id, &trader) {
            Some(mut pos) => {
                // Allow accumulating stake on same outcome; reject switching sides
                if pos.outcome != outcome {
                    return Err(Error::InvalidOutcome);
                }
                pos.stake = checked_add(pos.stake, stake)?;
                pos
            }
            None => Position {
                market_id,
                trader: trader.clone(),
                outcome,
                stake,
            },
        };

        // Update market totals
        if outcome == 1 {
            market.total_yes_stake = checked_add(market.total_yes_stake, stake)?;
        } else {
            market.total_no_stake = checked_add(market.total_no_stake, stake)?;
        }

        set_position(&env, &position);
        set_market(&env, &market);

        // Event: (bet,) => (market_id, trader, outcome, stake)
        env.events()
            .publish((EVT_BET,), (market_id, trader, outcome, stake));

        Ok(())
    }

    /// Resolve a market (oracle only).
    /// winning_outcome: 1 = YES, 0 = NO
    pub fn resolve_market(env: Env, market_id: u32, winning_outcome: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;

        let mut market = get_market(&env, market_id)?;

        // Collateralized markets use propose/dispute/finalize settlement.
        if has_conditional_market(&env, market_id) {
            return Err(Error::ConditionalMarketRequired);
        }

        // Only the designated oracle can resolve
        market.oracle.require_auth();

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if winning_outcome > 1 {
            return Err(Error::InvalidOutcome);
        }

        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(winning_outcome);
        set_market(&env, &market);

        // Event: (resolved,) => (market_id, winning_outcome)
        env.events()
            .publish((EVT_RESOLVED,), (market_id, winning_outcome));

        Ok(())
    }

    /// Cancel a market (admin or creator only, before resolution).
    pub fn cancel_market(env: Env, market_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;

        let admin = get_admin(&env)?;
        let mut market = get_market(&env, market_id)?;

        // Conditional shares are collateral liabilities and cannot be safely
        // cancelled through the legacy stake-refund path.
        if has_conditional_market(&env, market_id) {
            return Err(Error::ConditionalMarketRequired);
        }

        // Admin or creator can cancel
        if admin == market.creator {
            market.creator.require_auth();
        } else {
            // Try admin auth first, then creator
            admin.require_auth();
        }

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }

        market.status = MarketStatus::Cancelled;
        set_market(&env, &market);

        // Event: (mkt_can,) => market_id
        env.events().publish((EVT_CANCELLED,), market_id);

        Ok(())
    }

    /// Calculate payout for a trader on a resolved market.
    /// Returns the payout amount (stake * total_pool / winning_pool).
    /// On cancellation returns the full stake (refund).
    pub fn calculate_payout(env: Env, market_id: u32, trader: Address) -> Result<i128, Error> {
        let market = get_market(&env, market_id)?;

        if market.status == MarketStatus::Cancelled {
            // Full refund on cancellation
            let pos = get_position(&env, market_id, &trader).ok_or(Error::PositionNotFound)?;
            return Ok(pos.stake);
        }

        if market.status != MarketStatus::Resolved {
            return Err(Error::MarketNotResolved);
        }

        let winning_outcome = market.winning_outcome.ok_or(Error::MarketNotResolved)?;
        let pos = get_position(&env, market_id, &trader).ok_or(Error::PositionNotFound)?;

        if pos.outcome != winning_outcome {
            return Ok(0); // Lost — no payout
        }

        let total_pool = checked_add(market.total_yes_stake, market.total_no_stake)?;
        let winning_pool = if winning_outcome == 1 {
            market.total_yes_stake
        } else {
            market.total_no_stake
        };

        if winning_pool == 0 {
            return Ok(0);
        }

        // payout = stake * total_pool / winning_pool  (proportional share)
        mul_div_floor(pos.stake, total_pool, winning_pool)
    }

    // ── Read-only queries ──────────────────────────────────────────────────────

    pub fn get_market(env: Env, market_id: u32) -> Result<Market, Error> {
        get_market(&env, market_id)
    }

    pub fn get_position(env: Env, market_id: u32, trader: Address) -> Result<Position, Error> {
        get_position(&env, market_id, &trader).ok_or(Error::PositionNotFound)
    }

    pub fn get_conditional_market(env: Env, market_id: u32) -> Result<ConditionalMarket, Error> {
        get_conditional_market(&env, market_id)
    }

    pub fn outcome_balance(env: Env, market_id: u32, owner: Address, outcome: u32) -> i128 {
        get_outcome_balance(&env, market_id, &owner, outcome)
    }

    pub fn liquidity_balance(env: Env, market_id: u32, provider: Address) -> i128 {
        get_liquidity_balance(&env, market_id, &provider)
    }

    pub fn get_resolution(env: Env, market_id: u32) -> Result<ResolutionProposal, Error> {
        get_resolution(&env, market_id).ok_or(Error::ResolutionNotProposed)
    }

    pub fn market_count(env: Env) -> u32 {
        get_market_count(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn create_conditional_market(
    env: &Env,
    creator: Address,
    question: String,
    market_type: MarketType,
    outcomes: Vec<String>,
    resolution_deadline: u64,
    oracle: Address,
    dispute_resolver: Address,
    collateral_token: Address,
    dispute_window: u64,
    initial_liquidity: i128,
) -> Result<u32, Error> {
    ensure_initialized(env)?;
    creator.require_auth();
    if resolution_deadline <= env.ledger().timestamp() {
        return Err(Error::MarketExpired);
    }
    if outcomes.len() < MIN_OUTCOMES || outcomes.len() > MAX_OUTCOMES {
        return Err(Error::InvalidOutcomeCount);
    }
    for left in 0..outcomes.len() {
        let label = outcomes.get(left).ok_or(Error::InvalidOutcome)?;
        if label.is_empty() {
            return Err(Error::InvalidOutcome);
        }
        for right in (left + 1)..outcomes.len() {
            if label == outcomes.get(right).ok_or(Error::InvalidOutcome)? {
                return Err(Error::InvalidOutcome);
            }
        }
    }
    if dispute_window == 0 || dispute_window > MAX_DISPUTE_WINDOW {
        return Err(Error::InvalidDisputeWindow);
    }
    if initial_liquidity <= 0 {
        return Err(Error::InvalidAmount);
    }

    token::Client::new(env, &collateral_token).transfer(
        &creator,
        &env.current_contract_address(),
        &initial_liquidity,
    );

    let id = increment_market_count(env);
    let market = Market {
        id,
        creator: creator.clone(),
        question,
        market_type,
        status: MarketStatus::Open,
        resolution_deadline,
        oracle,
        winning_outcome: None,
        total_yes_stake: 0,
        total_no_stake: 0,
        created_at: env.ledger().timestamp(),
    };
    let mut pool_balances = Vec::new(env);
    for _ in 0..outcomes.len() {
        pool_balances.push_back(initial_liquidity);
    }
    let conditional = ConditionalMarket {
        market_id: id,
        outcomes,
        collateral_token,
        dispute_resolver,
        dispute_window,
        minimum_dispute_bond: core::cmp::max(initial_liquidity / 100, 1),
        pool_balances,
        total_liquidity_shares: initial_liquidity,
        collateral_locked: initial_liquidity,
    };
    set_market(env, &market);
    set_conditional_market(env, &conditional);
    set_liquidity_balance(env, id, &creator, initial_liquidity);
    env.events()
        .publish((EVT_CREATED,), (id, creator, resolution_deadline));
    Ok(id)
}

fn ensure_trading_open(env: &Env, market: &Market) -> Result<(), Error> {
    if market.status != MarketStatus::Open || get_resolution(env, market.id).is_some() {
        return Err(Error::MarketAlreadyResolved);
    }
    if env.ledger().timestamp() >= market.resolution_deadline {
        return Err(Error::MarketExpired);
    }
    Ok(())
}

fn validate_outcome(conditional: &ConditionalMarket, outcome: u32) -> Result<(), Error> {
    if outcome >= conditional.outcomes.len() {
        return Err(Error::InvalidOutcome);
    }
    Ok(())
}

fn quote_buy_shares(
    conditional: &ConditionalMarket,
    outcome: u32,
    collateral_amount: i128,
) -> Result<i128, Error> {
    validate_outcome(conditional, outcome)?;
    if collateral_amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let selected_reserve = conditional
        .pool_balances
        .get(outcome)
        .ok_or(Error::InsufficientLiquidity)?;
    if selected_reserve <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let mut ending_selected = selected_reserve;
    for index in 0..conditional.pool_balances.len() {
        if index == outcome {
            continue;
        }
        let reserve = conditional
            .pool_balances
            .get(index)
            .ok_or(Error::InsufficientLiquidity)?;
        ending_selected = mul_div_ceil(
            ending_selected,
            reserve,
            checked_add(reserve, collateral_amount)?,
        )?;
    }
    let shares = checked_sub(checked_add(selected_reserve, collateral_amount)?, ending_selected)?;
    if shares <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(shares)
}

/// Largest collateral payout that preserves the fixed-product invariant after
/// `shares` of `outcome` are sold into the pool.
fn quote_sell_shares(
    conditional: &ConditionalMarket,
    outcome: u32,
    shares: i128,
) -> Result<i128, Error> {
    validate_outcome(conditional, outcome)?;
    if shares <= 0 {
        return Err(Error::InvalidAmount);
    }
    let mut max_extractable = i128::MAX;
    for index in 0..conditional.pool_balances.len() {
        let reserve = conditional
            .pool_balances
            .get(index)
            .ok_or(Error::InsufficientLiquidity)?;
        let after_sale = if index == outcome {
            checked_add(reserve, shares)?
        } else {
            reserve
        };
        if after_sale <= 1 {
            return Err(Error::InsufficientLiquidity);
        }
        let candidate = checked_sub(after_sale, 1)?;
        if candidate < max_extractable {
            max_extractable = candidate;
        }
    }
    if max_extractable <= 0 {
        return Err(Error::InsufficientLiquidity);
    }

    let mut low = 1i128;
    let mut high = max_extractable;
    let mut best = 0i128;
    while low <= high {
        let mid = low + (high - low) / 2;
        if sell_invariant_holds(conditional, outcome, shares, mid)? {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    if best <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(best)
}

fn sell_invariant_holds(
    conditional: &ConditionalMarket,
    outcome: u32,
    shares: i128,
    collateral: i128,
) -> Result<bool, Error> {
    const RATIO_SCALE: i128 = 1_000_000_000;
    let mut ratio = RATIO_SCALE;
    for index in 0..conditional.pool_balances.len() {
        let original = conditional
            .pool_balances
            .get(index)
            .ok_or(Error::InsufficientLiquidity)?;
        if original <= 0 {
            return Err(Error::InsufficientLiquidity);
        }
        let after_sale = if index == outcome {
            checked_add(original, shares)?
        } else {
            original
        };
        let remaining = checked_sub(after_sale, collateral)?;
        if remaining <= 0 {
            return Ok(false);
        }
        ratio = mul_div_floor(ratio, remaining, original)?;
    }
    Ok(ratio >= RATIO_SCALE)
}

fn finalize_market(env: &Env, market: &mut Market, outcome: u32) {
    market.status = MarketStatus::Resolved;
    market.winning_outcome = Some(outcome);
    set_market(env, market);
    env.events().publish((EVT_RESOLVED,), (market.id, outcome));
}

fn checked_add(left: i128, right: i128) -> Result<i128, Error> {
    left.checked_add(right).ok_or(Error::ArithmeticOverflow)
}

fn checked_sub(left: i128, right: i128) -> Result<i128, Error> {
    left.checked_sub(right).ok_or(Error::ArithmeticOverflow)
}

fn mul_div_floor(left: i128, right: i128, denominator: i128) -> Result<i128, Error> {
    if left < 0 || right < 0 || denominator <= 0 {
        return Err(Error::InvalidAmount);
    }
    let first_gcd = gcd(left, denominator);
    let reduced_left = left / first_gcd;
    let remaining_denominator = denominator / first_gcd;
    let second_gcd = gcd(right, remaining_denominator);
    let reduced_right = right / second_gcd;
    let divisor = remaining_denominator / second_gcd;
    reduced_left
        .checked_mul(reduced_right)
        .ok_or(Error::ArithmeticOverflow)
        .map(|value| value / divisor)
}

fn mul_div_ceil(left: i128, right: i128, denominator: i128) -> Result<i128, Error> {
    if left < 0 || right < 0 || denominator <= 0 {
        return Err(Error::InvalidAmount);
    }
    let first_gcd = gcd(left, denominator);
    let reduced_left = left / first_gcd;
    let remaining_denominator = denominator / first_gcd;
    let second_gcd = gcd(right, remaining_denominator);
    let numerator = reduced_left
        .checked_mul(right / second_gcd)
        .ok_or(Error::ArithmeticOverflow)?;
    let divisor = remaining_denominator / second_gcd;
    let floor = numerator / divisor;
    if numerator % divisor == 0 {
        Ok(floor)
    } else {
        checked_add(floor, 1)
    }
}

fn gcd(mut left: i128, mut right: i128) -> i128 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}
