#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec, token, Map};

#[cfg(test)]
mod test;


#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Property(u64),
    PropertyCount,
    Shares(u64, Address), // (property_id, shareholder) -> shares_count
    GlobalRentPerShare(u64), // property_id -> accumulated_rent_per_share
    LastClaimedRent(u64, Address), // (property_id, shareholder) -> last_global_rent_per_share
    Paused,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Property {
    pub id: u64,
    pub owner: Address,
    pub name: Symbol,
    pub total_shares: i128,
    pub price_per_share: i128,
    pub sold_shares: i128,
    pub metadata_url: Symbol,
    pub active: bool,
}

#[contract]
pub struct RealEstateTokenization;

#[contractimpl]
impl RealEstateTokenization {
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PropertyCount, &0u64);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    pub fn list_property(
        env: Env,
        owner: Address,
        name: Symbol,
        total_shares: i128,
        price_per_share: i128,
        metadata_url: Symbol,
    ) -> u64 {
        owner.require_auth();
        Self::ensure_not_paused(&env);

        let mut count: u64 = env.storage().instance().get(&DataKey::PropertyCount).unwrap_or(0);
        count += 1;

        let property = Property {
            id: count,
            owner: owner.clone(),
            name,
            total_shares,
            price_per_share,
            sold_shares: 0,
            metadata_url,
            active: true,
        };

        env.storage().persistent().set(&DataKey::Property(count), &property);
        env.storage().instance().set(&DataKey::PropertyCount, &count);
        env.storage().persistent().set(&DataKey::GlobalRentPerShare(count), &0i128);

        env.events().publish(
            (symbol_short!("prop_lst"), owner),
            (count, total_shares, price_per_share),
        );

        count
    }

    pub fn buy_shares(env: Env, buyer: Address, property_id: u64, amount: i128, payment_token: Address) {
        buyer.require_auth();
        Self::ensure_not_paused(&env);

        let mut property: Property = env.storage().persistent().get(&DataKey::Property(property_id)).expect("Property not found");
        if !property.active {
            panic!("Property not active");
        }
        if property.sold_shares + amount > property.total_shares {
            panic!("Not enough shares available");
        }

        // Handle payment
        let total_cost = amount * property.price_per_share;
        let token_client = token::Client::new(&env, &payment_token);
        token_client.transfer(&buyer, &property.owner, &total_cost);

        // Before updating shares, claim any outstanding rent to avoid dilution issues
        Self::claim_rent_internal(&env, &buyer, property_id, payment_token.clone());

        // Update ownership
        let key = DataKey::Shares(property_id, buyer.clone());
        let current_shares: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current_shares + amount));

        property.sold_shares += amount;
        env.storage().persistent().set(&DataKey::Property(property_id), &property);

        // Update last claimed rent to current global to start fresh with new shares
        let global_rent: i128 = env.storage().persistent().get(&DataKey::GlobalRentPerShare(property_id)).unwrap_or(0);
        env.storage().persistent().set(&DataKey::LastClaimedRent(property_id, buyer.clone()), &global_rent);

        env.events().publish(
            (symbol_short!("shr_buy"), buyer),
            (property_id, amount),
        );
    }

    pub fn deposit_rent(env: Env, property_id: u64, amount: i128, payment_token: Address) {
        let property: Property = env.storage().persistent().get(&DataKey::Property(property_id)).expect("Property not found");
        property.owner.require_auth();

        let token_client = token::Client::new(&env, &payment_token);
        token_client.transfer(&property.owner, &env.current_contract_address(), &amount);

        let mut global_rent: i128 = env.storage().persistent().get(&DataKey::GlobalRentPerShare(property_id)).unwrap_or(0);
        
        // Use a high precision multiplier to avoid rounding issues (e.g., 1e12)
        let multiplier = 1_000_000_000_000i128;
        global_rent += (amount * multiplier) / property.total_shares;

        env.storage().persistent().set(&DataKey::GlobalRentPerShare(property_id), &global_rent);

        env.events().publish(
            (symbol_short!("rnt_dep"), property_id),
            amount,
        );
    }

    pub fn claim_rent(env: Env, shareholder: Address, property_id: u64, payment_token: Address) {
        shareholder.require_auth();
        Self::claim_rent_internal(&env, &shareholder, property_id, payment_token);
    }

    fn claim_rent_internal(env: &Env, shareholder: &Address, property_id: u64, payment_token: Address) {
        let shares: i128 = env.storage().persistent().get(&DataKey::Shares(property_id, shareholder.clone())).unwrap_or(0);
        if shares == 0 {
            return;
        }

        let global_rent: i128 = env.storage().persistent().get(&DataKey::GlobalRentPerShare(property_id)).unwrap_or(0);
        let last_claimed: i128 = env.storage().persistent().get(&DataKey::LastClaimedRent(property_id, shareholder.clone())).unwrap_or(0);

        if global_rent > last_claimed {
            let multiplier = 1_000_000_000_000i128;
            let claimable = (shares * (global_rent - last_claimed)) / multiplier;

            if claimable > 0 {
                let token_client = token::Client::new(&env, &payment_token);
                token_client.transfer(&env.current_contract_address(), shareholder, &claimable);
            }

            env.storage().persistent().set(&DataKey::LastClaimedRent(property_id, shareholder.clone()), &global_rent);
            
            env.events().publish(
                (symbol_short!("rnt_clm"), shareholder.clone()),
                (property_id, claimable),
            );
        }
    }

    pub fn set_paused(env: Env, admin: Address, paused: bool) {
        admin.require_auth();
        let contract_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != contract_admin {
            panic!("Not admin");
        }
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    pub fn get_property(env: Env, property_id: u64) -> Property {
        env.storage().persistent().get(&DataKey::Property(property_id)).expect("Property not found")
    }

    pub fn get_shares(env: Env, property_id: u64, shareholder: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Shares(property_id, shareholder)).unwrap_or(0)
    }

    fn ensure_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("Contract is paused");
        }
    }
}
