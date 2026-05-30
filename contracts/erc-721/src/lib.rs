#![no_std]

mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

const ADMIN: symbol_short::Symbol = symbol_short!("ADMIN");
const TOTAL_SUPPLY: symbol_short::Symbol = symbol_short!("TOTAL_SUPPLY");
const MAX_URI_LEN: usize = 512;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    InvalidInput = 2,
    NotFound = 3,
    CapExceeded = 4,
    TokenNotFound = 5,
    NotApproved = 6,
}

#[contracttype]
pub enum DataKey {
    Owner(u64),
    Balance(Address),
    Approved(u64),
    ApprovedAll(Address, Address),
    TokenUri(u64),
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.instance().get(&ADMIN).ok_or(Error::Unauthorized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.instance().set(&ADMIN, admin);
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !env.instance().has::<Address>(&ADMIN) {
        return Err(Error::NotFound);
    }
    Ok(())
}

fn is_zero_address(addr: &Address) -> bool {
    let env = Env::default();
    addr == &Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000")
}

#[contract]
pub struct Erc721;

#[contractimpl]
impl Erc721 {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.instance().has::<Address>(&ADMIN) {
            return Err(Error::CapExceeded);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.instance().set(&TOTAL_SUPPLY, &0u64);
        Ok(())
    }

    pub fn total_supply(env: Env) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(env.instance().get(&TOTAL_SUPPLY).unwrap_or(0))
    }

    pub fn balance_of(env: Env, owner: Address) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(env.storage().instance().get(&DataKey::Balance(owner)).unwrap_or(0))
    }

    pub fn owner_of(env: Env, token_id: u64) -> Result<Address, Error> {
        ensure_initialized(&env)?;
        let key = DataKey::Owner(token_id);
        env.storage().instance().get(&key).ok_or(Error::TokenNotFound)
    }

    pub fn transfer_from(env: Env, from: Address, to: Address, token_id: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let caller = env.invoker();
        let owner = Self::owner_of(env.clone(), token_id)?;
        
        if caller != owner {
            let approved: Option<Address> = env.storage().instance().get(&DataKey::Approved(token_id));
            if approved != Some(caller) {
                let is_approved = env.storage().instance().get(&DataKey::ApprovedAll(from.clone(), caller.clone())).unwrap_or(false);
                if !is_approved {
                    return Err(Error::NotApproved);
                }
            }
        }
        
        env.storage().instance().remove(&DataKey::Approved(token_id));
        env.storage().instance().set(&DataKey::Owner(token_id), &to);
        
        let from_balance: u64 = env.storage().instance().get(&DataKey::Balance(from.clone())).unwrap_or(0);
        let to_balance: u64 = env.storage().instance().get(&DataKey::Balance(to.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance(from), &(from_balance.saturating_sub(1)));
        env.storage().instance().set(&DataKey::Balance(to), &(to_balance.saturating_add(1)));
        
        let zero = Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000");
        env.events().publish((symbol_short!("Transfer"),), (&zero, to, token_id));
        
        Ok(())
    }

    pub fn safe_transfer_from(env: Env, from: Address, to: Address, token_id: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        
        let zero = Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000");
        if to == zero {
            return Err(Error::InvalidInput);
        }
        
        Self::transfer_from(env, from, to, token_id)
    }

    pub fn mint(env: Env, to: Address, token_id: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();
        
        let key = DataKey::Owner(token_id);
        if env.storage().instance().has(&key) {
            return Err(Error::CapExceeded);
        }
        
        let zero = Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000");
        if to == zero {
            return Err(Error::InvalidInput);
        }
        
        env.storage().instance().set(&DataKey::Owner(token_id), &to);
        
        let to_balance: u64 = env.storage().instance().get(&DataKey::Balance(to.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance(to), &(to_balance.saturating_add(1)));
        
        let total: u64 = env.instance().get(&TOTAL_SUPPLY).unwrap_or(0);
        env.instance().set(&TOTAL_SUPPLY, &(total.saturating_add(1)));
        
        let zero = Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000");
        env.events().publish((symbol_short!("Transfer"),), (&zero, to, token_id));
        
        Ok(())
    }

    pub fn burn(env: Env, caller: Address, token_id: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        
        let owner = Self::owner_of(env.clone(), token_id)?;
        
        if caller != owner {
            let approved: Option<Address> = env.storage().instance().get(&DataKey::Approved(token_id));
            if approved != Some(caller) {
                return Err(Error::NotApproved);
            }
        }
        
        let key = DataKey::Owner(token_id);
        env.storage().instance().remove(&key);
        
        let balance: u64 = env.storage().instance().get(&DataKey::Balance(owner.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance(owner), &(balance.saturating_sub(1)));
        
        let total: u64 = env.instance().get(&TOTAL_SUPPLY).unwrap_or(0);
        env.instance().set(&TOTAL_SUPPLY, &total.saturating_sub(1));
        
        let zero = Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000");
        env.events().publish((symbol_short!("Transfer"),), (owner, zero, token_id));
        
        Ok(())
    }

    pub fn approve(env: Env, to: Address, token_id: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let caller = env.invoker();
        let owner = Self::owner_of(env.clone(), token_id)?;
        
        if caller != owner {
            return Err(Error::Unauthorized);
        }
        
        env.storage().instance().set(&DataKey::Approved(token_id), &to);
        env.events().publish((symbol_short!("Approval"),), (owner, to, token_id));
        
        Ok(())
    }

    pub fn get_approved(env: Env, token_id: u64) -> Result<Option<Address>, Error> {
        ensure_initialized(&env)?;
        Ok(env.storage().instance().get(&DataKey::Approved(token_id)))
    }

    pub fn set_approval_for_all(env: Env, caller: Address, operator: Address, approved: bool) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        
        env.storage().instance().set(&DataKey::ApprovedAll(caller.clone(), operator.clone()), &approved);
        env.events().publish((symbol_short!("ApprovalForAll"),), (caller, operator, approved));
        
        Ok(())
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(env.storage().instance().get(&DataKey::ApprovedAll(owner, operator)).unwrap_or(false))
    }

    pub fn token_uri(env: Env, token_id: u64) -> Result<String, Error> {
        ensure_initialized(&env)?;
        Ok(env.storage().instance().get(&DataKey::TokenUri(token_id)).unwrap_or_else(|| String::from_str(&env, "")))
    }

    pub fn set_token_uri(env: Env, caller: Address, token_id: u64, uri: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        
        let _owner = Self::owner_of(env.clone(), token_id)?;
        
        let admin = get_admin(&env)?;
        let owner = Self::owner_of(env.clone(), token_id)?;
        if caller != admin && caller != owner {
            return Err(Error::Unauthorized);
        }
        
        if uri.to_bytes().len() > MAX_URI_LEN {
            return Err(Error::InvalidInput);
        }
        
        env.storage().instance().set(&DataKey::TokenUri(token_id), &uri);
        Ok(())
    }

    pub fn token_by_index(env: Env, _index: u64) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(0)
    }

    pub fn token_of_owner_by_index(env: Env, _owner: Address, _index: u64) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(0)
    }
}