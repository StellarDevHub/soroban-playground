// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! NFT custody vault with a SEP-41-compatible fractional token and an
//! escrowed, ascending buyout auction.
//!
//! The depositor approves this contract on the NFT contract before calling
//! `initialize`. Fractions are minted once, to the depositor. A buyout begins
//! with a reserve-price bid; later bids refund the previous bidder atomically.
//! After settlement, holders burn fractions through `claim` to receive their
//! proportional share of the winning bid.

#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, Env, String, U256,
};

const INSTANCE_TTL_THRESHOLD: u32 = 120_960;
const INSTANCE_TTL_EXTEND_TO: u32 = 518_400;
const MAX_BPS: u32 = 10_000;
const MAX_METADATA_LEN: u32 = 64;

#[contractclient(name = "NftClient")]
pub trait NftInterface {
    fn transfer_from(env: Env, caller: Address, from: Address, to: Address, token_id: u64);
    fn owner_of(env: Env, token_id: u64) -> Address;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidConfig = 4,
    InsufficientBalance = 5,
    InsufficientAllowance = 6,
    AllowanceExpired = 7,
    AuctionActive = 8,
    AuctionNotActive = 9,
    AuctionEnded = 10,
    AuctionNotEnded = 11,
    BidTooLow = 12,
    NotSettled = 13,
    NothingToClaim = 14,
    ArithmeticOverflow = 15,
    CustodyFailed = 16,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultStatus {
    Fractionalized,
    Auction,
    Settled,
}

#[contracttype]
#[derive(Clone)]
pub struct InitConfig {
    pub nft_contract: Address,
    pub nft_id: u64,
    pub payment_token: Address,
    pub total_supply: i128,
    pub name: String,
    pub symbol: String,
    pub reserve_price: i128,
    pub auction_duration: u64,
    pub min_increment_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultInfo {
    pub curator: Address,
    pub nft_contract: Address,
    pub nft_id: u64,
    pub payment_token: Address,
    pub reserve_price: i128,
    pub auction_duration: u64,
    pub min_increment_bps: u32,
    pub status: VaultStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionInfo {
    pub bidder: Address,
    pub bid: i128,
    pub end_time: u64,
}

#[contracttype]
#[derive(Clone)]
struct Allowance {
    amount: i128,
    expiration_ledger: u32,
}

#[contracttype]
enum InstanceKey {
    Curator,
    NftContract,
    NftId,
    PaymentToken,
    ReservePrice,
    AuctionDuration,
    MinIncrementBps,
    Status,
    Name,
    Symbol,
    Supply,
    Auction,
    Proceeds,
}

#[contracttype]
enum DataKey {
    Balance(Address),
    Allowance(Address, Address),
}

#[contract]
pub struct NftFractionalVault;

fn bump(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&InstanceKey::Curator) {
        return Err(Error::NotInitialized);
    }
    bump(env);
    Ok(())
}

fn balance(env: &Env, owner: &Address) -> i128 {
    let key = DataKey::Balance(owner.clone());
    let value = env.storage().persistent().get(&key).unwrap_or(0);
    if value != 0 {
        env.storage()
            .persistent()
            .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }
    value
}

fn set_balance(env: &Env, owner: &Address, value: i128) {
    let key = DataKey::Balance(owner.clone());
    if value == 0 {
        env.storage().persistent().remove(&key);
    } else {
        env.storage().persistent().set(&key, &value);
        env.storage()
            .persistent()
            .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }
}

fn status(env: &Env) -> VaultStatus {
    env.storage()
        .instance()
        .get(&InstanceKey::Status)
        .unwrap_or(VaultStatus::Fractionalized)
}

fn payment_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&InstanceKey::PaymentToken)
        .unwrap()
}

fn transfer_payment(env: &Env, from: &Address, to: &Address, amount: i128) {
    token::Client::new(env, &payment_token(env)).transfer(from, to, &amount);
}

/// Computes `(a * b) / denominator` without overflowing i128. All contract
/// call sites pass positive values. `round_up` is used for minimum bids.
fn mul_div(env: &Env, a: i128, b: i128, denominator: i128, round_up: bool) -> Result<i128, Error> {
    let product = U256::from_u128(env, a as u128).mul(&U256::from_u128(env, b as u128));
    let divisor = U256::from_u128(env, denominator as u128);
    let adjusted = if round_up {
        product.add(&U256::from_u128(env, denominator as u128 - 1))
    } else {
        product
    };
    let result = adjusted
        .div(&divisor)
        .to_u128()
        .ok_or(Error::ArithmeticOverflow)?;
    if result > i128::MAX as u128 {
        return Err(Error::ArithmeticOverflow);
    }
    Ok(result as i128)
}

#[contractimpl]
impl NftFractionalVault {
    /// Locks an approved NFT and mints the fixed fraction supply to `depositor`.
    pub fn initialize(
        env: Env,
        curator: Address,
        depositor: Address,
        config: InitConfig,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&InstanceKey::Curator) {
            return Err(Error::AlreadyInitialized);
        }
        if config.total_supply <= 0
            || config.reserve_price <= 0
            || config.auction_duration == 0
            || config.min_increment_bps == 0
            || config.min_increment_bps > MAX_BPS
            || config.name.is_empty()
            || config.name.len() > MAX_METADATA_LEN
            || config.symbol.is_empty()
            || config.symbol.len() > MAX_METADATA_LEN
        {
            return Err(Error::InvalidConfig);
        }
        depositor.require_auth();

        let vault = env.current_contract_address();
        let nft = NftClient::new(&env, &config.nft_contract);
        nft.transfer_from(&vault, &depositor, &vault, &config.nft_id);
        if nft.owner_of(&config.nft_id) != vault {
            return Err(Error::CustodyFailed);
        }

        env.storage()
            .instance()
            .set(&InstanceKey::Curator, &curator);
        env.storage()
            .instance()
            .set(&InstanceKey::NftContract, &config.nft_contract);
        env.storage()
            .instance()
            .set(&InstanceKey::NftId, &config.nft_id);
        env.storage()
            .instance()
            .set(&InstanceKey::PaymentToken, &config.payment_token);
        env.storage()
            .instance()
            .set(&InstanceKey::ReservePrice, &config.reserve_price);
        env.storage()
            .instance()
            .set(&InstanceKey::AuctionDuration, &config.auction_duration);
        env.storage()
            .instance()
            .set(&InstanceKey::MinIncrementBps, &config.min_increment_bps);
        env.storage()
            .instance()
            .set(&InstanceKey::Status, &VaultStatus::Fractionalized);
        env.storage()
            .instance()
            .set(&InstanceKey::Name, &config.name);
        env.storage()
            .instance()
            .set(&InstanceKey::Symbol, &config.symbol);
        env.storage()
            .instance()
            .set(&InstanceKey::Supply, &config.total_supply);
        env.storage().instance().set(&InstanceKey::Proceeds, &0i128);
        set_balance(&env, &depositor, config.total_supply);
        bump(&env);
        env.events().publish(
            (symbol_short!("fraction"), depositor),
            (config.nft_contract, config.nft_id, config.total_supply),
        );
        Ok(())
    }

    // SEP-41 token interface. The supply is fixed except when claims burn it.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        require_initialized(&env)?;
        from.require_auth();
        Self::move_balance(&env, &from, &to, amount)
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        from.require_auth();
        if amount < 0 || (amount > 0 && expiration_ledger < env.ledger().sequence()) {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Allowance(from.clone(), spender.clone());
        if amount == 0 {
            env.storage().temporary().remove(&key);
        } else {
            env.storage().temporary().set(
                &key,
                &Allowance {
                    amount,
                    expiration_ledger,
                },
            );
            let live_for = expiration_ledger - env.ledger().sequence();
            if live_for > 0 {
                env.storage()
                    .temporary()
                    .extend_ttl(&key, live_for, live_for);
            }
        }
        env.events().publish(
            (symbol_short!("approve"), from),
            (spender, amount, expiration_ledger),
        );
        Ok(())
    }

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        spender.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Allowance(from.clone(), spender.clone());
        let mut approved: Allowance = env.storage().temporary().get(&key).unwrap_or(Allowance {
            amount: 0,
            expiration_ledger: 0,
        });
        if env.ledger().sequence() > approved.expiration_ledger {
            return Err(Error::AllowanceExpired);
        }
        if approved.amount < amount {
            return Err(Error::InsufficientAllowance);
        }
        approved.amount -= amount;
        if approved.amount == 0 {
            env.storage().temporary().remove(&key);
        } else {
            env.storage().temporary().set(&key, &approved);
        }
        Self::move_balance(&env, &from, &to, amount)
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let value: Option<Allowance> = env
            .storage()
            .temporary()
            .get(&DataKey::Allowance(from, spender));
        match value {
            Some(a) if env.ledger().sequence() <= a.expiration_ledger => a.amount,
            _ => 0,
        }
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        balance(&env, &owner)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&InstanceKey::Supply)
            .unwrap_or(0)
    }

    pub fn decimals(_env: Env) -> u32 {
        7
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&InstanceKey::Name)
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&InstanceKey::Symbol)
            .unwrap_or(String::from_str(&env, ""))
    }

    /// Opens the auction and escrows the reserve-price bid.
    pub fn start_auction(env: Env, bidder: Address, bid: i128) -> Result<(), Error> {
        require_initialized(&env)?;
        if status(&env) != VaultStatus::Fractionalized {
            return Err(Error::AuctionActive);
        }
        let reserve: i128 = env
            .storage()
            .instance()
            .get(&InstanceKey::ReservePrice)
            .unwrap();
        if bid < reserve {
            return Err(Error::BidTooLow);
        }
        bidder.require_auth();
        transfer_payment(&env, &bidder, &env.current_contract_address(), bid);
        let duration: u64 = env
            .storage()
            .instance()
            .get(&InstanceKey::AuctionDuration)
            .unwrap();
        let end_time = env
            .ledger()
            .timestamp()
            .checked_add(duration)
            .ok_or(Error::ArithmeticOverflow)?;
        let auction = AuctionInfo {
            bidder: bidder.clone(),
            bid,
            end_time,
        };
        env.storage()
            .instance()
            .set(&InstanceKey::Auction, &auction);
        env.storage()
            .instance()
            .set(&InstanceKey::Status, &VaultStatus::Auction);
        env.events()
            .publish((symbol_short!("auc_start"), bidder), (bid, end_time));
        Ok(())
    }

    /// Replaces the high bid and atomically refunds the previous bidder.
    pub fn bid(env: Env, bidder: Address, amount: i128) -> Result<(), Error> {
        require_initialized(&env)?;
        if status(&env) != VaultStatus::Auction {
            return Err(Error::AuctionNotActive);
        }
        let current: AuctionInfo = env.storage().instance().get(&InstanceKey::Auction).unwrap();
        if env.ledger().timestamp() >= current.end_time {
            return Err(Error::AuctionEnded);
        }
        let bps: u32 = env
            .storage()
            .instance()
            .get(&InstanceKey::MinIncrementBps)
            .unwrap();
        let increment = mul_div(&env, current.bid, bps as i128, MAX_BPS as i128, true)?;
        let minimum = current
            .bid
            .checked_add(increment)
            .ok_or(Error::ArithmeticOverflow)?;
        if amount < minimum {
            return Err(Error::BidTooLow);
        }
        bidder.require_auth();
        let vault = env.current_contract_address();
        transfer_payment(&env, &bidder, &vault, amount);
        transfer_payment(&env, &vault, &current.bidder, current.bid);
        env.storage().instance().set(
            &InstanceKey::Auction,
            &AuctionInfo {
                bidder: bidder.clone(),
                bid: amount,
                end_time: current.end_time,
            },
        );
        env.events().publish((symbol_short!("bid"), bidder), amount);
        Ok(())
    }

    /// Finalizes after the deadline and transfers the NFT to the winner.
    pub fn settle(env: Env) -> Result<(), Error> {
        require_initialized(&env)?;
        if status(&env) != VaultStatus::Auction {
            return Err(Error::AuctionNotActive);
        }
        let auction: AuctionInfo = env.storage().instance().get(&InstanceKey::Auction).unwrap();
        if env.ledger().timestamp() < auction.end_time {
            return Err(Error::AuctionNotEnded);
        }
        // State is set before the external call; Soroban rolls the invocation back
        // atomically if the NFT transfer fails.
        env.storage()
            .instance()
            .set(&InstanceKey::Status, &VaultStatus::Settled);
        env.storage()
            .instance()
            .set(&InstanceKey::Proceeds, &auction.bid);
        let nft_address: Address = env
            .storage()
            .instance()
            .get(&InstanceKey::NftContract)
            .unwrap();
        let nft_id: u64 = env.storage().instance().get(&InstanceKey::NftId).unwrap();
        let vault = env.current_contract_address();
        NftClient::new(&env, &nft_address).transfer_from(&vault, &vault, &auction.bidder, &nft_id);
        env.events()
            .publish((symbol_short!("settled"), auction.bidder), auction.bid);
        Ok(())
    }

    /// Burns fractions and pays their share of the unclaimed auction proceeds.
    pub fn claim(env: Env, holder: Address, amount: i128) -> Result<i128, Error> {
        require_initialized(&env)?;
        if status(&env) != VaultStatus::Settled {
            return Err(Error::NotSettled);
        }
        holder.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let holder_balance = balance(&env, &holder);
        if holder_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        let supply: i128 = env.storage().instance().get(&InstanceKey::Supply).unwrap();
        let proceeds: i128 = env
            .storage()
            .instance()
            .get(&InstanceKey::Proceeds)
            .unwrap();
        let payout = if amount == supply {
            proceeds
        } else {
            mul_div(&env, amount, proceeds, supply, false)?
        };
        if payout <= 0 {
            return Err(Error::NothingToClaim);
        }
        set_balance(&env, &holder, holder_balance - amount);
        env.storage()
            .instance()
            .set(&InstanceKey::Supply, &(supply - amount));
        env.storage()
            .instance()
            .set(&InstanceKey::Proceeds, &(proceeds - payout));
        transfer_payment(&env, &env.current_contract_address(), &holder, payout);
        env.events()
            .publish((symbol_short!("claim"), holder), (amount, payout));
        Ok(payout)
    }

    pub fn vault_info(env: Env) -> Result<VaultInfo, Error> {
        require_initialized(&env)?;
        Ok(VaultInfo {
            curator: env.storage().instance().get(&InstanceKey::Curator).unwrap(),
            nft_contract: env
                .storage()
                .instance()
                .get(&InstanceKey::NftContract)
                .unwrap(),
            nft_id: env.storage().instance().get(&InstanceKey::NftId).unwrap(),
            payment_token: payment_token(&env),
            reserve_price: env
                .storage()
                .instance()
                .get(&InstanceKey::ReservePrice)
                .unwrap(),
            auction_duration: env
                .storage()
                .instance()
                .get(&InstanceKey::AuctionDuration)
                .unwrap(),
            min_increment_bps: env
                .storage()
                .instance()
                .get(&InstanceKey::MinIncrementBps)
                .unwrap(),
            status: status(&env),
        })
    }

    pub fn auction_info(env: Env) -> Result<AuctionInfo, Error> {
        require_initialized(&env)?;
        env.storage()
            .instance()
            .get(&InstanceKey::Auction)
            .ok_or(Error::AuctionNotActive)
    }

    pub fn remaining_proceeds(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&InstanceKey::Proceeds)
            .unwrap_or(0)
    }

    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let from_balance = balance(env, from);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(env, from, from_balance - amount);
        let to_balance = balance(env, to);
        let new_balance = to_balance
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        set_balance(env, to, new_balance);
        env.events().publish(
            (symbol_short!("transfer"), from.clone()),
            (to.clone(), amount),
        );
        Ok(())
    }
}

#[cfg(test)]
mod test;
