#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Nft,
    NftId,
    StartingPrice,
    FloorPrice,
    DiscountRate,
    StartTime,
    Sold,
}

#[contract]
pub struct DutchAuction;

#[contractimpl]
impl DutchAuction {
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        nft: Address,
        nft_id: i128,
        starting_price: i128,
        floor_price: i128,
        discount_rate: i128,
        start_time: u64,
    ) {
        admin.require_auth();
        assert!(
            !env.storage().instance().has(&DataKey::Admin),
            "already initialized"
        );
        assert!(
            starting_price >= floor_price,
            "starting price must be >= floor price"
        );

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Nft, &nft);
        env.storage().instance().set(&DataKey::NftId, &nft_id);
        env.storage()
            .instance()
            .set(&DataKey::StartingPrice, &starting_price);
        env.storage()
            .instance()
            .set(&DataKey::FloorPrice, &floor_price);
        env.storage()
            .instance()
            .set(&DataKey::DiscountRate, &discount_rate);
        env.storage()
            .instance()
            .set(&DataKey::StartTime, &start_time);
        env.storage().instance().set(&DataKey::Sold, &false);
    }

    pub fn get_price(env: Env) -> i128 {
        let sold: bool = env.storage().instance().get(&DataKey::Sold).unwrap();
        if sold {
            return 0;
        }

        let start_time: u64 = env.storage().instance().get(&DataKey::StartTime).unwrap();
        let current_time = env.ledger().timestamp();

        if current_time < start_time {
            return env
                .storage()
                .instance()
                .get(&DataKey::StartingPrice)
                .unwrap();
        }

        let elapsed = current_time - start_time;
        let discount_rate: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DiscountRate)
            .unwrap();
        let discount = (elapsed as i128) * discount_rate;

        let starting_price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::StartingPrice)
            .unwrap();
        let floor_price: i128 = env.storage().instance().get(&DataKey::FloorPrice).unwrap();

        let current_price = starting_price - discount;
        if current_price < floor_price {
            floor_price
        } else {
            current_price
        }
    }

    pub fn buy(env: Env, buyer: Address) {
        buyer.require_auth();

        let sold: bool = env
            .storage()
            .instance()
            .get(&DataKey::Sold)
            .unwrap_or(false);
        assert!(!sold, "auction already sold out");

        let _price = Self::get_price(env.clone());

        // In a complete implementation, this would handle the actual token transfer using
        // soroban_sdk::token::Client. For MVP price discovery, we mark as sold.

        env.storage().instance().set(&DataKey::Sold, &true);
    }
}

mod test;
