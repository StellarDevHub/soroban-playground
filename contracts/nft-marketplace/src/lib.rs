#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, token};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Listing(u64),
    ListingCount,
    Admin,
    FeeRecipient,
}

#[contracttype]
#[derive(Clone)]
pub struct Listing {
    pub seller: Address,
    pub nft_contract: Address,
    pub price: i128,
    pub is_auction: bool,
    pub end_time: u64, 
    pub highest_bidder: Option<Address>,
    pub highest_bid: i128,
    pub royalty_recipient: Address,
    pub royalty_percent: u32, // Out of 1000 (e.g. 25 = 2.5%)
    pub active: bool,
}

#[contract]
pub struct NftMarketplace;

#[contractimpl]
impl NftMarketplace {
    pub fn init(env: Env, admin: Address, fee_recipient: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage().instance().set(&DataKey::ListingCount, &0u64);
    }

    pub fn list_nft(
        env: Env,
        seller: Address,
        nft_contract: Address,
        price: i128,
        is_auction: bool,
        duration: u64,
        royalty_recipient: Address,
        royalty_percent: u32,
    ) -> u64 {
        seller.require_auth();
        if royalty_percent > 100 {
            panic!("Royalty cannot exceed 10%");
        }

        // Transfer NFT to this contract
        let nft_client = token::Client::new(&env, &nft_contract);
        nft_client.transfer(&seller, &env.current_contract_address(), &1);

        let mut count: u64 = env.storage().instance().get(&DataKey::ListingCount).unwrap_or(0);
        count += 1;

        let end_time = env.ledger().timestamp() + duration;

        let listing = Listing {
            seller,
            nft_contract,
            price,
            is_auction,
            end_time,
            highest_bidder: None,
            highest_bid: 0,
            royalty_recipient,
            royalty_percent,
            active: true,
        };

        env.storage().persistent().set(&DataKey::Listing(count), &listing);
        env.storage().instance().set(&DataKey::ListingCount, &count);

        count
    }

    pub fn buy_or_bid(env: Env, buyer: Address, listing_id: u64, payment_token: Address, bid_amount: i128) {
        buyer.require_auth();
        let mut listing: Listing = env.storage().persistent().get(&DataKey::Listing(listing_id)).unwrap();
        if !listing.active {
            panic!("Listing is not active");
        }

        let token_client = token::Client::new(&env, &payment_token);

        if !listing.is_auction {
            if bid_amount < listing.price {
                panic!("Insufficient payment");
            }
            // Execute fixed price sale
            let fee_recipient: Address = env.storage().instance().get(&DataKey::FeeRecipient).unwrap();
            let marketplace_fee = bid_amount * 25 / 1000; // 2.5% fee
            let royalty = bid_amount * (listing.royalty_percent as i128) / 1000;
            let seller_revenue = bid_amount - marketplace_fee - royalty;

            token_client.transfer(&buyer, &fee_recipient, &marketplace_fee);
            if royalty > 0 {
                token_client.transfer(&buyer, &listing.royalty_recipient, &royalty);
            }
            token_client.transfer(&buyer, &listing.seller, &seller_revenue);

            // Transfer NFT to buyer
            let nft_client = token::Client::new(&env, &listing.nft_contract);
            nft_client.transfer(&env.current_contract_address(), &buyer, &1);

            listing.active = false;
        } else {
            // Auction bid
            if env.ledger().timestamp() >= listing.end_time {
                panic!("Auction ended");
            }
            if bid_amount <= listing.highest_bid || bid_amount < listing.price {
                panic!("Bid too low");
            }

            // Refund previous bidder
            if let Some(prev_bidder) = &listing.highest_bidder {
                token_client.transfer(&env.current_contract_address(), prev_bidder, &listing.highest_bid);
            }

            // Escrow new bid
            token_client.transfer(&buyer, &env.current_contract_address(), &bid_amount);

            listing.highest_bidder = Some(buyer);
            listing.highest_bid = bid_amount;

            // Bid extension (10 minutes)
            if listing.end_time - env.ledger().timestamp() < 600 {
                listing.end_time += 600;
            }
        }

        env.storage().persistent().set(&DataKey::Listing(listing_id), &listing);
    }

    pub fn settle_auction(env: Env, listing_id: u64, payment_token: Address) {
        let mut listing: Listing = env.storage().persistent().get(&DataKey::Listing(listing_id)).unwrap();
        if !listing.is_auction || !listing.active {
            panic!("Not an active auction");
        }
        if env.ledger().timestamp() < listing.end_time {
            panic!("Auction not ended yet");
        }

        let nft_client = token::Client::new(&env, &listing.nft_contract);

        if let Some(winner) = listing.highest_bidder {
            let token_client = token::Client::new(&env, &payment_token);
            let fee_recipient: Address = env.storage().instance().get(&DataKey::FeeRecipient).unwrap();
            let marketplace_fee = listing.highest_bid * 25 / 1000;
            let royalty = listing.highest_bid * (listing.royalty_percent as i128) / 1000;
            let seller_revenue = listing.highest_bid - marketplace_fee - royalty;

            token_client.transfer(&env.current_contract_address(), &fee_recipient, &marketplace_fee);
            if royalty > 0 {
                token_client.transfer(&env.current_contract_address(), &listing.royalty_recipient, &royalty);
            }
            token_client.transfer(&env.current_contract_address(), &listing.seller, &seller_revenue);

            nft_client.transfer(&env.current_contract_address(), &winner, &1);
        } else {
            // No bids, return to seller
            nft_client.transfer(&env.current_contract_address(), &listing.seller, &1);
        }

        listing.active = false;
        env.storage().persistent().set(&DataKey::Listing(listing_id), &listing);
    }

    pub fn cancel_listing(env: Env, seller: Address, listing_id: u64) {
        seller.require_auth();
        let mut listing: Listing = env.storage().persistent().get(&DataKey::Listing(listing_id)).unwrap();
        if !listing.active {
            panic!("Not active");
        }
        if listing.seller != seller {
            panic!("Not the seller");
        }
        if listing.is_auction && listing.highest_bidder.is_some() {
            panic!("Cannot cancel auction with bids");
        }

        let nft_client = token::Client::new(&env, &listing.nft_contract);
        nft_client.transfer(&env.current_contract_address(), &seller, &1);

        listing.active = false;
        env.storage().persistent().set(&DataKey::Listing(listing_id), &listing);
    }
}
