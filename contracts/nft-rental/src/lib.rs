// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # NFT Rental Protocol with Collateral-Free Delegated Usage Rights
//!
//! Separates legal ownership from user rights (ERC-4907 style). The lender
//! (`ownerOf`) never loses custody: only the scoped `userOf` role is delegated.
//! User rights expire lazily at the stored ledger sequence, so no transaction is
//! required to revoke them, and a renter can never transfer, burn, or sub-lease
//! the asset. Upfront rental fees are escrowed until the lease starts, and an
//! already-leased or escrow-committed token cannot change hands.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    get_admin, get_balance, get_escrow, get_listing, get_nft, is_initialized, remove_escrow,
    remove_listing, remove_nft, set_admin, set_balance, set_escrow, set_initialized, set_listing,
    set_nft,
};
use crate::types::{Error, EscrowRecord, NFTRecord, RentalListing};

#[contract]
pub struct NFTRental;

#[contractimpl]
impl NFTRental {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        set_admin(&env, &admin);
        set_initialized(&env);

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn mint_nft(env: Env, owner: Address, token_id: u64) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        owner.require_auth();

        if get_nft(&env, token_id).is_ok() {
            return Err(Error::NFTAlreadyExists);
        }

        let nft = NFTRecord {
            token_id,
            owner: owner.clone(),
            user: None,
            expires_at_ledger: 0,
        };
        set_nft(&env, &nft);

        env.events()
            .publish((symbol_short!("mint_nft"), token_id), owner);
        Ok(())
    }

    /// Owner delegates user role to renter address with an explicit expiration ledger sequence
    pub fn set_user(
        env: Env,
        owner: Address,
        token_id: u64,
        user: Address,
        expires_at_ledger: u32,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        owner.require_auth();

        let mut nft = get_nft(&env, token_id)?;
        if nft.owner != owner {
            return Err(Error::Unauthorized);
        }
        // A paid lease is immutable for its term: the lender cannot overwrite
        // the renter's user rights while they are still active.
        if Self::is_lease_active(&env, &nft) {
            return Err(Error::TokenCurrentlyLeased);
        }

        let current_ledger = env.ledger().sequence();
        if expires_at_ledger <= current_ledger {
            return Err(Error::InvalidExpirationLedger);
        }

        nft.user = Some(user.clone());
        nft.expires_at_ledger = expires_at_ledger;
        set_nft(&env, &nft);

        env.events().publish(
            (symbol_short!("set_user"), token_id),
            (user, expires_at_ledger),
        );
        Ok(())
    }

    /// Returns the temporary user of the NFT, or `None` when no lease is active.
    /// Expiration is evaluated against the current ledger sequence on read, so
    /// user rights revert to `None` automatically without any transaction.
    pub fn user_of(env: Env, token_id: u64) -> Option<Address> {
        let nft = match get_nft(&env, token_id) {
            Ok(n) => n,
            Err(_) => return None,
        };

        if Self::is_lease_active(&env, &nft) {
            nft.user
        } else {
            None
        }
    }

    /// Returns expiration ledger sequence for the user rights. Reverts to 0 if expired.
    pub fn user_expires(env: Env, token_id: u64) -> u32 {
        let nft = match get_nft(&env, token_id) {
            Ok(n) => n,
            Err(_) => return 0,
        };

        if Self::is_lease_active(&env, &nft) {
            nft.expires_at_ledger
        } else {
            0
        }
    }

    /// Returns the legal owner of the NFT
    pub fn owner_of(env: Env, token_id: u64) -> Result<Address, Error> {
        let nft = get_nft(&env, token_id)?;
        Ok(nft.owner)
    }

    /// Transfer legal ownership. Renters cannot transfer or sub-lease, and the
    /// lender is immutable while a lease is active (the renter paid for it).
    pub fn transfer_ownership(
        env: Env,
        from: Address,
        to: Address,
        token_id: u64,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        from.require_auth();

        let mut nft = get_nft(&env, token_id)?;
        if nft.owner != from {
            return Err(Error::Unauthorized);
        }
        if Self::is_lease_active(&env, &nft) {
            return Err(Error::TokenCurrentlyLeased);
        }

        nft.owner = to.clone();
        nft.user = None;
        nft.expires_at_ledger = 0;
        set_nft(&env, &nft);

        env.events()
            .publish((symbol_short!("transfer"), token_id), (from, to));
        Ok(())
    }

    /// Burn the NFT permanently. Only the legal owner may burn, never a renter,
    /// and only when no lease or escrow commitment is outstanding.
    pub fn burn_nft(env: Env, owner: Address, token_id: u64) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        owner.require_auth();

        let nft = get_nft(&env, token_id)?;
        if nft.owner != owner {
            return Err(Error::Unauthorized);
        }
        if Self::is_lease_active(&env, &nft) {
            return Err(Error::TokenCurrentlyLeased);
        }
        if get_escrow(&env, token_id).is_ok() {
            return Err(Error::ActiveEscrow);
        }

        remove_nft(&env, token_id);
        remove_listing(&env, token_id);

        env.events()
            .publish((symbol_short!("burn"), token_id), owner);
        Ok(())
    }

    /// List NFT for rental with upfront fee per ledger
    pub fn list_rental(
        env: Env,
        owner: Address,
        token_id: u64,
        price_per_ledger: i128,
        min_duration: u32,
        max_duration: u32,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        owner.require_auth();

        let nft = get_nft(&env, token_id)?;
        if nft.owner != owner {
            return Err(Error::Unauthorized);
        }
        if price_per_ledger <= 0 {
            return Err(Error::InvalidAmount);
        }
        if min_duration == 0 || min_duration > max_duration {
            return Err(Error::InvalidDuration);
        }

        if Self::is_lease_active(&env, &nft) {
            return Err(Error::TokenCurrentlyLeased);
        }

        let listing = RentalListing {
            token_id,
            owner: owner.clone(),
            price_per_ledger,
            min_duration,
            max_duration,
            is_active: true,
        };
        set_listing(&env, &listing);

        env.events().publish(
            (symbol_short!("list_rent"), token_id),
            (owner, price_per_ledger),
        );
        Ok(())
    }

    /// Instant rental listing cancellation if token has not yet been leased
    pub fn cancel_listing(env: Env, owner: Address, token_id: u64) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        owner.require_auth();

        let listing = get_listing(&env, token_id)?;
        if listing.owner != owner {
            return Err(Error::Unauthorized);
        }
        if !listing.is_active {
            return Err(Error::ListingNotActive);
        }
        // A renter has already locked the fee; the owner cannot pull the offer.
        if get_escrow(&env, token_id).is_ok() {
            return Err(Error::ActiveEscrow);
        }

        remove_listing(&env, token_id);

        env.events()
            .publish((symbol_short!("canc_list"), token_id), owner);
        Ok(())
    }

    /// Deposit upfront rental fee in escrow until lease starts
    pub fn deposit_escrow(
        env: Env,
        renter: Address,
        token_id: u64,
        duration_ledgers: u32,
        upfront_fee: i128,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        renter.require_auth();

        let listing = get_listing(&env, token_id)?;
        if !listing.is_active {
            return Err(Error::ListingNotActive);
        }
        // One escrow per token: a second reservation would overwrite the first
        // renter's locked fee and strand their funds.
        if get_escrow(&env, token_id).is_ok() {
            return Err(Error::ActiveEscrow);
        }
        if duration_ledgers < listing.min_duration || duration_ledgers > listing.max_duration {
            return Err(Error::InvalidDuration);
        }

        let required_fee = listing.price_per_ledger * (duration_ledgers as i128);
        if upfront_fee < required_fee {
            return Err(Error::InsufficientPayment);
        }

        // Deduct from renter's balance and lock into escrow
        let renter_balance = get_balance(&env, &renter);
        if renter_balance < upfront_fee {
            return Err(Error::InsufficientPayment);
        }
        set_balance(&env, &renter, renter_balance - upfront_fee);

        let escrow = EscrowRecord {
            token_id,
            renter: renter.clone(),
            owner: listing.owner.clone(),
            amount: upfront_fee,
            duration_ledgers,
            is_active: true,
        };
        set_escrow(&env, &escrow);

        env.events()
            .publish((symbol_short!("dep_escr"), token_id), (renter, upfront_fee));
        Ok(())
    }

    /// Start lease from locked escrow: delivers rental fee accurately to owner and sets user role
    pub fn start_lease(env: Env, token_id: u64) -> Result<(), Error> {
        Self::assert_initialized(&env)?;

        let escrow = get_escrow(&env, token_id)?;
        if !escrow.is_active {
            return Err(Error::EscrowNotFound);
        }

        let mut nft = get_nft(&env, token_id)?;
        // The escrowed fee belongs to the owner recorded at reservation time;
        // refuse to settle against a token that changed hands or is leased.
        if nft.owner != escrow.owner {
            return Err(Error::Unauthorized);
        }
        if Self::is_lease_active(&env, &nft) {
            return Err(Error::TokenCurrentlyLeased);
        }
        let current_ledger = env.ledger().sequence();
        let expires_at_ledger = current_ledger + escrow.duration_ledgers;

        // Deliver upfront fee payment accurately to owner
        let owner_bal = get_balance(&env, &escrow.owner);
        set_balance(&env, &escrow.owner, owner_bal + escrow.amount);

        // Delegate user role to renter with automated expiration
        nft.user = Some(escrow.renter.clone());
        nft.expires_at_ledger = expires_at_ledger;
        set_nft(&env, &nft);

        // Remove active escrow and listing
        remove_escrow(&env, token_id);
        remove_listing(&env, token_id);

        env.events().publish(
            (symbol_short!("lease_st"), token_id),
            (escrow.renter, escrow.amount, expires_at_ledger),
        );
        Ok(())
    }

    /// Convenient one-step rent: locks escrow and initiates lease immediately
    pub fn rent_nft(
        env: Env,
        renter: Address,
        token_id: u64,
        duration_ledgers: u32,
        upfront_fee: i128,
    ) -> Result<(), Error> {
        Self::deposit_escrow(env.clone(), renter, token_id, duration_ledgers, upfront_fee)?;
        Self::start_lease(env, token_id)
    }

    /// Deposit balance into protocol for simulated stablecoin fee escrow
    pub fn deposit_balance(env: Env, account: Address, amount: i128) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        account.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let updated = get_balance(&env, &account) + amount;
        set_balance(&env, &account, updated);
        Ok(updated)
    }

    pub fn get_balance(env: Env, account: Address) -> i128 {
        get_balance(&env, &account)
    }

    pub fn get_listing(env: Env, token_id: u64) -> Result<RentalListing, Error> {
        get_listing(&env, token_id)
    }

    pub fn get_escrow(env: Env, token_id: u64) -> Result<EscrowRecord, Error> {
        get_escrow(&env, token_id)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// A lease is active only while a user is set and the current ledger has not
    /// passed the stored expiration. This read-time check is what makes expiry
    /// automatic and transaction-free.
    fn is_lease_active(env: &Env, nft: &NFTRecord) -> bool {
        nft.user.is_some() && env.ledger().sequence() <= nft.expires_at_ledger
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }
}
