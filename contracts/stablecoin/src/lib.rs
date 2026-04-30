#![cfg_attr(not(test), no_std)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    ContractPaused = 2,
    AlreadyInState = 3,
    NotInitialized = 4,
    InvalidAmount = 5,
    InsufficientBalance = 6,
    PriceStale = 7,
    RebaseTooFrequent = 8,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    TargetPrice,
    CurrentPrice,
    TotalSupply,
    ShareSupply,
    UserShares(Address),
    UserTokens(Address),
    Paused,
    LastRebaseTime,
    ReserveBalance,
    OracleAddress,
    RebaseCooldown,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RebaseInfo {
    pub old_supply: i128,
    pub new_supply: i128,
    pub price: i128,
    pub timestamp: u64,
}

#[contract]
pub struct AlgorithmicStablecoin;

#[contractimpl]
impl AlgorithmicStablecoin {
    pub fn init(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInState);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OracleAddress, &oracle);
        env.storage().instance().set(&DataKey::TargetPrice, &10_000_000i128);
        env.storage().instance().set(&DataKey::CurrentPrice, &10_000_000i128);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::ShareSupply, &1_000_000_000i128);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::LastRebaseTime, &0u64);
        env.storage().instance().set(&DataKey::ReserveBalance, &0i128);
        env.storage().instance().set(&DataKey::RebaseCooldown, &3600u64);

        env.events().publish(
            (Symbol::new(&env, "initialized"),),
            (admin, oracle),
        );

        Ok(())
    }

    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_balance: i128 = env.storage().persistent().get(&DataKey::UserTokens(to.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::UserTokens(to.clone()), &(current_balance + amount));

        let total_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(total_supply + amount));

        env.events().publish(
            (Symbol::new(&env, "mint"),),
            (to, amount),
        );

        Ok(())
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_balance: i128 = env.storage().persistent().get(&DataKey::UserTokens(from.clone())).unwrap_or(0);
        if current_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        env.storage().persistent().set(&DataKey::UserTokens(from.clone()), &(current_balance - amount));

        let total_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(total_supply - amount));

        env.events().publish(
            (Symbol::new(&env, "burn"),),
            (from, amount),
        );

        Ok(())
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let from_balance: i128 = env.storage().persistent().get(&DataKey::UserTokens(from.clone())).unwrap_or(0);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let to_balance: i128 = env.storage().persistent().get(&DataKey::UserTokens(to.clone())).unwrap_or(0);

        env.storage().persistent().set(&DataKey::UserTokens(from.clone()), &(from_balance - amount));
        env.storage().persistent().set(&DataKey::UserTokens(to.clone()), &(to_balance + amount));

        env.events().publish(
            (Symbol::new(&env, "transfer"),),
            (from, to, amount),
        );

        Ok(())
    }

    pub fn set_price(env: Env, oracle: Address, new_price: i128) -> Result<(), Error> {
        oracle.require_auth();
        Self::assert_oracle(&env, &oracle)?;

        if new_price <= 0 {
            return Err(Error::InvalidAmount);
        }

        env.storage().instance().set(&DataKey::CurrentPrice, &new_price);

        env.events().publish(
            (Symbol::new(&env, "price_updated"),),
            (oracle, new_price, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn rebase(env: Env, caller: Address) -> Result<RebaseInfo, Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        let last_rebase: u64 = env.storage().instance().get(&DataKey::LastRebaseTime).unwrap_or(0);
        let cooldown: u64 = env.storage().instance().get(&DataKey::RebaseCooldown).unwrap_or(3600);
        let current_time = env.ledger().timestamp();

        if current_time < last_rebase + cooldown {
            return Err(Error::RebaseTooFrequent);
        }

        let current_price: i128 = env.storage().instance().get(&DataKey::CurrentPrice).unwrap();
        let target_price: i128 = env.storage().instance().get(&DataKey::TargetPrice).unwrap();
        let old_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);

        let new_supply = if current_price > target_price {
            let expansion_ratio = (current_price - target_price) * 1_000_000 / target_price;
            let expansion_amount = old_supply * expansion_ratio / 1_000_000;
            old_supply + expansion_amount
        } else if current_price < target_price {
            let contraction_ratio = (target_price - current_price) * 1_000_000 / target_price;
            let max_contraction = old_supply * contraction_ratio / 1_000_000;
            let reserve: i128 = env.storage().instance().get(&DataKey::ReserveBalance).unwrap_or(0);
            let actual_contraction = if max_contraction > reserve { reserve } else { max_contraction };
            old_supply - actual_contraction
        } else {
            old_supply
        };

        env.storage().instance().set(&DataKey::TotalSupply, &new_supply);
        env.storage().instance().set(&DataKey::LastRebaseTime, &current_time);

        let info = RebaseInfo {
            old_supply,
            new_supply,
            price: current_price,
            timestamp: current_time,
        };

        env.events().publish(
            (Symbol::new(&env, "rebase"),),
            info.clone(),
        );

        Ok(info)
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if Self::is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &true);

        env.events().publish(
            (Symbol::new(&env, "paused"),),
            admin,
        );

        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if !Self::is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &false);

        env.events().publish(
            (Symbol::new(&env, "unpaused"),),
            admin,
        );

        Ok(())
    }

    pub fn add_reserve(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_reserve: i128 = env.storage().instance().get(&DataKey::ReserveBalance).unwrap_or(0);
        env.storage().instance().set(&DataKey::ReserveBalance, &(current_reserve + amount));

        env.events().publish(
            (Symbol::new(&env, "reserve_added"),),
            (admin, amount),
        );

        Ok(())
    }

    pub fn withdraw_reserve(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_reserve: i128 = env.storage().instance().get(&DataKey::ReserveBalance).unwrap_or(0);
        if current_reserve < amount {
            return Err(Error::InsufficientBalance);
        }

        env.storage().instance().set(&DataKey::ReserveBalance, &(current_reserve - amount));

        env.events().publish(
            (Symbol::new(&env, "reserve_withdrawn"),),
            (admin, amount),
        );

        Ok(())
    }

    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::UserTokens(user)).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn get_price(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::CurrentPrice).unwrap_or(10_000_000)
    }

    pub fn get_target_price(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TargetPrice).unwrap_or(10_000_000)
    }

    pub fn get_reserve(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::ReserveBalance).unwrap_or(0)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if &admin != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_oracle(env: &Env, caller: &Address) -> Result<(), Error> {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .ok_or(Error::NotInitialized)?;

        if &oracle != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if Self::is_paused(env.clone()) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, Address, Address, Address, AlgorithmicStablecoinClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AlgorithmicStablecoin);
        let client = AlgorithmicStablecoinClient::new(&env, &id);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let user = Address::generate(&env);

        client.init(&admin, &oracle);

        let env = std::boxed::Box::leak(std::boxed::Box::new(env));
        let client = AlgorithmicStablecoinClient::new(env, &id);

        (env.clone(), admin, oracle, user, client)
    }

    #[test]
    fn test_init() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AlgorithmicStablecoin);
        let client = AlgorithmicStablecoinClient::new(&env, &id);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);

        client.init(&admin, &oracle);

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_price(), 10_000_000);
        assert_eq!(client.get_target_price(), 10_000_000);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_mint() {
        let (env, admin, _oracle, user, client) = setup();

        client.mint(&admin, &user, &1000);

        assert_eq!(client.balance(&user), 1000);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_burn() {
        let (env, admin, _oracle, user, client) = setup();

        client.mint(&admin, &user, &1000);
        client.burn(&user, &500);

        assert_eq!(client.balance(&user), 500);
        assert_eq!(client.total_supply(), 500);
    }

    #[test]
    fn test_transfer() {
        let (env, admin, _oracle, user, client) = setup();
        let recipient = Address::generate(&env);

        client.mint(&admin, &user, &1000);
        client.transfer(&user, &recipient, &300);

        assert_eq!(client.balance(&user), 700);
        assert_eq!(client.balance(&recipient), 300);
    }

    #[test]
    fn test_set_price() {
        let (env, admin, oracle, _user, client) = setup();

        client.set_price(&oracle, &12_000_000);

        assert_eq!(client.get_price(), 12_000_000);
    }

    #[test]
    fn test_rebase_expansion() {
        let (env, admin, oracle, _user, client) = setup();

        client.mint(&admin, &admin, &1_000_000);
        client.set_price(&oracle, &11_000_000);

        env.ledger().set_timestamp(4000);

        let info = client.rebase(&admin);

        assert!(info.new_supply > info.old_supply);
    }

    #[test]
    fn test_pause_and_unpause() {
        let (env, admin, _oracle, user, client) = setup();

        client.pause(&admin);
        assert!(client.is_paused());

        let result = client.try_mint(&admin, &user, &100);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));

        client.unpause(&admin);
        assert!(!client.is_paused());

        client.mint(&admin, &user, &100);
        assert_eq!(client.balance(&user), 100);
    }

    #[test]
    fn test_reserve_operations() {
        let (env, admin, _oracle, _user, client) = setup();

        client.add_reserve(&admin, &5000);
        assert_eq!(client.get_reserve(), 5000);

        client.withdraw_reserve(&admin, &2000);
        assert_eq!(client.get_reserve(), 3000);
    }
}
