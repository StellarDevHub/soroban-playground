#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    xdr::ToXdr, Address, BytesN, Env,
};

const MAX_DURATION: u64 = 30 * 24 * 60 * 60;
const MAX_EXTENSIONS: u32 = 10;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidConfig = 3,
    WrongPhase = 4,
    InvalidBidder = 5,
    AlreadyCommitted = 6,
    NoCommitment = 7,
    AlreadyRevealed = 8,
    InvalidReveal = 9,
    NotSettled = 10,
    AlreadyClaimed = 11,
    AlreadySettled = 12,
    TooManyBids = 13,
}

/// One immutable auction per deployment. Times are ledger timestamps in seconds.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionConfig {
    pub seller: Address,
    pub token: Address,
    pub nft: Address,
    pub nft_id: u64,
    pub reserve: i128,
    pub collateral: i128,
    pub start: u64,
    pub commit_duration: u64,
    pub reveal_duration: u64,
    pub extension_window: u64,
    pub extension_seconds: u64,
    pub max_extensions: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Auction {
    pub config: AuctionConfig,
    pub commit_end: u64,
    pub reveal_end: u64,
    pub commit_extensions: u32,
    pub reveal_extensions: u32,
    pub bid_count: u32,
    pub winner: Option<Address>,
    pub winning_bid: i128,
    pub winning_order: u32,
    pub settled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bid {
    pub commitment: BytesN<32>,
    pub order: u32,
    pub revealed: bool,
    pub amount: i128,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Auction,
    Bid(Address),
}

/// Compatible with contracts/erc-721. Successful transfer returns void on-chain.
#[contractclient(name = "NftClient")]
pub trait NftInterface {
    fn owner_of(env: Env, token_id: u64) -> Address;
    fn transfer_from(env: Env, caller: Address, from: Address, to: Address, token_id: u64);
}

fn save_auction(env: &Env, auction: &Auction) {
    env.storage().instance().set(&DataKey::Auction, auction);
    let ttl = env.storage().max_ttl();
    env.storage().instance().extend_ttl(ttl / 2, ttl);
}

fn load_auction(env: &Env) -> Result<Auction, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Auction)
        .ok_or(Error::NotInitialized)
}

fn save_bid(env: &Env, bidder: &Address, bid: &Bid) {
    let key = DataKey::Bid(bidder.clone());
    env.storage().persistent().set(&key, bid);
    let ttl = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(&key, ttl / 2, ttl);
}

fn load_bid(env: &Env, bidder: &Address) -> Result<Bid, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Bid(bidder.clone()))
        .ok_or(Error::NoCommitment)
}

/// SHA-256 of the XDR ScVal tuple (domain, network, contract, bidder, amount, salt).
/// Clients construct this locally without publishing the amount or salt.
pub fn bid_commitment(env: &Env, bidder: &Address, amount: i128, salt: &BytesN<32>) -> BytesN<32> {
    let preimage = (
        symbol_short!("bid_v1"),
        env.ledger().network_id(),
        env.current_contract_address(),
        bidder.clone(),
        amount,
        salt.clone(),
    )
        .to_xdr(env);
    env.crypto().sha256(&preimage).into()
}

#[contract]
pub struct DutchAuction;

#[contractimpl]
impl DutchAuction {
    /// Escrow the NFT and freeze the schedule, reserve, and uniform collateral.
    pub fn initialize(env: Env, config: AuctionConfig) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Auction) {
            return Err(Error::AlreadyInitialized);
        }
        config.seller.require_auth();
        let now = env.ledger().timestamp();
        let address = env.current_contract_address();
        if config.reserve <= 0
            || config.collateral < config.reserve
            || config.start < now
            || config.start - now > MAX_DURATION
            || config.commit_duration == 0
            || config.reveal_duration == 0
            || config.max_extensions > MAX_EXTENSIONS
            || config.seller == address
            || config.token == address
            || config.nft == address
            || (config.max_extensions > 0
                && (config.extension_window == 0
                    || config.extension_seconds == 0
                    || config.extension_window > config.commit_duration
                    || config.extension_window > config.reveal_duration))
        {
            return Err(Error::InvalidConfig);
        }
        let commit_end = config
            .start
            .checked_add(config.commit_duration)
            .ok_or(Error::InvalidConfig)?;
        let reveal_end = commit_end
            .checked_add(config.reveal_duration)
            .ok_or(Error::InvalidConfig)?;
        let extensions = config
            .extension_seconds
            .checked_mul(u64::from(config.max_extensions) * 2)
            .ok_or(Error::InvalidConfig)?;
        let latest_end = reveal_end
            .checked_add(extensions)
            .ok_or(Error::InvalidConfig)?;
        if latest_end - config.start > MAX_DURATION {
            return Err(Error::InvalidConfig);
        }
        let nft = NftClient::new(&env, &config.nft);
        if nft.owner_of(&config.nft_id) != config.seller {
            return Err(Error::InvalidConfig);
        }
        let auction = Auction {
            config: config.clone(),
            commit_end,
            reveal_end,
            commit_extensions: 0,
            reveal_extensions: 0,
            bid_count: 0,
            winner: None,
            winning_bid: 0,
            winning_order: u32::MAX,
            settled: false,
        };
        save_auction(&env, &auction);
        nft.transfer_from(&config.seller, &config.seller, &address, &config.nft_id);
        env.events().publish((symbol_short!("opened"),), config);
        Ok(())
    }

    /// Commit once, paying identical collateral irrespective of the hidden bid.
    pub fn commit_bid(env: Env, bidder: Address, commitment: BytesN<32>) -> Result<(), Error> {
        bidder.require_auth();
        let mut auction = load_auction(&env)?;
        let now = env.ledger().timestamp();
        if auction.settled || now < auction.config.start || now >= auction.commit_end {
            return Err(Error::WrongPhase);
        }
        if bidder == auction.config.seller || bidder == env.current_contract_address() {
            return Err(Error::InvalidBidder);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Bid(bidder.clone()))
        {
            return Err(Error::AlreadyCommitted);
        }
        let order = auction.bid_count;
        auction.bid_count = order.checked_add(1).ok_or(Error::TooManyBids)?;
        if auction.commit_end - now <= auction.config.extension_window
            && auction.commit_extensions < auction.config.max_extensions
        {
            auction.commit_end += auction.config.extension_seconds;
            // Never open reveals while new commitments are still accepted.
            auction.reveal_end += auction.config.extension_seconds;
            auction.commit_extensions += 1;
        }
        save_bid(
            &env,
            &bidder,
            &Bid {
                commitment: commitment.clone(),
                order,
                revealed: false,
                amount: 0,
                claimed: false,
            },
        );
        save_auction(&env, &auction);
        token::Client::new(&env, &auction.config.token).transfer(
            &bidder,
            &env.current_contract_address(),
            &auction.config.collateral,
        );
        env.events()
            .publish((symbol_short!("committed"), bidder), commitment);
        Ok(())
    }

    pub fn reveal_bid(
        env: Env,
        bidder: Address,
        amount: i128,
        salt: BytesN<32>,
    ) -> Result<(), Error> {
        bidder.require_auth();
        let mut auction = load_auction(&env)?;
        let now = env.ledger().timestamp();
        if auction.settled || now < auction.commit_end || now >= auction.reveal_end {
            return Err(Error::WrongPhase);
        }
        let mut bid = load_bid(&env, &bidder)?;
        if bid.revealed {
            return Err(Error::AlreadyRevealed);
        }
        if amount < auction.config.reserve
            || amount > auction.config.collateral
            || bid.commitment != bid_commitment(&env, &bidder, amount, &salt)
        {
            return Err(Error::InvalidReveal);
        }
        bid.revealed = true;
        bid.amount = amount;
        if amount > auction.winning_bid
            || (amount == auction.winning_bid && bid.order < auction.winning_order)
        {
            auction.winner = Some(bidder.clone());
            auction.winning_bid = amount;
            auction.winning_order = bid.order;
        }
        if auction.reveal_end - now <= auction.config.extension_window
            && auction.reveal_extensions < auction.config.max_extensions
        {
            auction.reveal_end += auction.config.extension_seconds;
            auction.reveal_extensions += 1;
        }
        save_bid(&env, &bidder, &bid);
        save_auction(&env, &auction);
        env.events()
            .publish((symbol_short!("revealed"), bidder), amount);
        Ok(())
    }

    /// Anyone can settle after the final reveal deadline. No bidder can cancel.
    pub fn settle(env: Env) -> Result<(), Error> {
        let mut auction = load_auction(&env)?;
        if auction.settled {
            return Err(Error::AlreadySettled);
        }
        if env.ledger().timestamp() < auction.reveal_end {
            return Err(Error::WrongPhase);
        }
        auction.settled = true;
        save_auction(&env, &auction);
        let address = env.current_contract_address();
        let recipient = auction
            .winner
            .clone()
            .unwrap_or(auction.config.seller.clone());
        if auction.winner.is_some() {
            token::Client::new(&env, &auction.config.token).transfer(
                &address,
                &auction.config.seller,
                &auction.winning_bid,
            );
        }
        NftClient::new(&env, &auction.config.nft).transfer_from(
            &address,
            &address,
            &recipient,
            &auction.config.nft_id,
        );
        env.events().publish(
            (symbol_short!("settled"),),
            (auction.winner, auction.winning_bid),
        );
        Ok(())
    }

    /// Permissionless pull settlement, always paying the recorded recipient.
    /// Unrevealed collateral goes to the seller even if the bidder never calls.
    pub fn claim_bid(env: Env, bidder: Address) -> Result<i128, Error> {
        let auction = load_auction(&env)?;
        if !auction.settled {
            return Err(Error::NotSettled);
        }
        let mut bid = load_bid(&env, &bidder)?;
        if bid.claimed {
            return Err(Error::AlreadyClaimed);
        }
        let refund = if !bid.revealed {
            0
        } else if auction.winner == Some(bidder.clone()) {
            auction.config.collateral - auction.winning_bid
        } else {
            auction.config.collateral
        };
        bid.claimed = true;
        save_bid(&env, &bidder, &bid);
        let recipient = if bid.revealed {
            bidder.clone()
        } else {
            auction.config.seller.clone()
        };
        let amount = if bid.revealed {
            refund
        } else {
            auction.config.collateral
        };
        if amount > 0 {
            token::Client::new(&env, &auction.config.token).transfer(
                &env.current_contract_address(),
                &recipient,
                &amount,
            );
        }
        env.events()
            .publish((symbol_short!("claimed"), bidder), (recipient, amount));
        Ok(refund)
    }

    pub fn get_auction(env: Env) -> Result<Auction, Error> {
        load_auction(&env)
    }

    pub fn get_bid(env: Env, bidder: Address) -> Result<Bid, Error> {
        load_bid(&env, &bidder)
    }
}

#[cfg(test)]
mod test;
