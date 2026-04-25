#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, symbol_short, log, vec, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Issuers(Address),
    Balances(Address),
    TotalSupply,
    VerifiedIssuersCount,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct IssuerInfo {
    pub name: String,
    pub verified: bool,
    pub total_minted: i128,
}

#[contract]
pub struct CarbonCreditContract;

#[contractimpl]
impl CarbonCreditContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::VerifiedIssuersCount, &0u32);
    }

    pub fn register_issuer(env: Env, issuer: Address, name: String) {
        issuer.require_auth();
        let key = DataKey::Issuers(issuer.clone());
        if env.storage().instance().has(&key) {
            panic!("Issuer already registered");
        }

        let info = IssuerInfo {
            name,
            verified: false,
            total_minted: 0,
        };
        env.storage().instance().set(&key, &info);
    }

    pub fn verify_issuer(env: Env, issuer: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();

        let key = DataKey::Issuers(issuer.clone());
        let mut info: IssuerInfo = env.storage().instance().get(&key).expect("Issuer not found");
        
        if !info.verified {
            info.verified = true;
            env.storage().instance().set(&key, &info);
            
            let mut count: u32 = env.storage().instance().get(&DataKey::VerifiedIssuersCount).unwrap_or(0);
            count += 1;
            env.storage().instance().set(&DataKey::VerifiedIssuersCount, &count);
        }
    }

    pub fn mint(env: Env, issuer: Address, to: Address, amount: i128) {
        issuer.require_auth();
        
        let key = DataKey::Issuers(issuer.clone());
        let mut info: IssuerInfo = env.storage().instance().get(&key).expect("Issuer not registered");
        
        if !info.verified {
            panic!("Issuer not verified");
        }

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        // Update user balance
        let balance_key = DataKey::Balances(to.clone());
        let mut balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        balance += amount;
        env.storage().instance().set(&balance_key, &balance);

        // Update issuer stats
        info.total_minted += amount;
        env.storage().instance().set(&key, &info);

        // Update total supply
        let mut total_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        total_supply += amount;
        env.storage().instance().set(&DataKey::TotalSupply, &total_supply);

        log!(&env, "Minted {} credits to {}", amount, to);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let from_key = DataKey::Balances(from.clone());
        let mut from_balance: i128 = env.storage().instance().get(&from_key).unwrap_or(0);

        if from_balance < amount {
            panic!("Insufficient balance");
        }

        from_balance -= amount;
        env.storage().instance().set(&from_key, &from_balance);

        let to_key = DataKey::Balances(to.clone());
        let mut to_balance: i128 = env.storage().instance().get(&to_key).unwrap_or(0);
        to_balance += amount;
        env.storage().instance().set(&to_key, &to_balance);

        log!(&env, "Transferred {} credits from {} to {}", amount, from, to);
    }

    pub fn retire(env: Env, user: Address, amount: i128) {
        user.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let balance_key = DataKey::Balances(user.clone());
        let mut balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);

        if balance < amount {
            panic!("Insufficient balance to retire");
        }

        balance -= amount;
        env.storage().instance().set(&balance_key, &balance);

        // Update total supply (burn)
        let mut total_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        total_supply -= amount;
        env.storage().instance().set(&DataKey::TotalSupply, &total_supply);

        log!(&env, "Retired {} credits by {}", amount, user);
        
        // Emit verification event for retirement
        env.events().publish(
            (symbol_short!("retire"), user),
            amount
        );
    }

    pub fn get_balance(env: Env, user: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balances(user)).unwrap_or(0)
    }

    pub fn get_issuer_info(env: Env, issuer: Address) -> Option<IssuerInfo> {
        env.storage().instance().get(&DataKey::Issuers(issuer))
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }
}

mod test;
