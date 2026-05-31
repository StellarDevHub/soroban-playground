#![no_std]

mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Env, String, Val, Vec, Map, Symbol,
};

const ADMIN: Symbol = symbol_short!("ADMIN");
const MAX_ARGS: u32 = 20;
const MAX_RETRIES: u32 = 5;
const MAX_BATCH_SIZE: u32 = 10;
const MAX_REGISTRY_SIZE: u32 = 100;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    InvalidInput = 2,
    NotFound = 3,
    CapExceeded = 4,
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

fn is_valid_name_char(c: u8) -> bool {
    (c >= b'a' && c <= b'z') || (c >= b'A' && c <= b'Z') || (c >= b'0' && c <= b'9') || c == b'-'
}

#[contract]
pub struct CrossContractUtils;

#[contractimpl]
impl CrossContractUtils {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.instance().has::<Address>(&ADMIN) {
            return Err(Error::CapExceeded);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    // ── CrossContractCaller ───────────────────────────────────────────────────────

    pub fn call(env: Env, _contract: Address, fn_name: String, args: Vec<Val>) -> Result<Val, Error> {
        ensure_initialized(&env)?;
        if fn_name.is_empty() || fn_name.to_bytes().len() > 64 {
            return Err(Error::InvalidInput);
        }
        if args.len() > MAX_ARGS {
            return Err(Error::InvalidInput);
        }
        Ok(Val::VOID)
    }

    pub fn call_with_retry(
        env: Env,
        _contract: Address,
        fn_name: String,
        args: Vec<Val>,
        max_retries: u32,
    ) -> Result<Result<Val, Error>, Error> {
        ensure_initialized(&env)?;
        if fn_name.is_empty() || fn_name.to_bytes().len() > 64 {
            return Err(Error::InvalidInput);
        }
        if args.len() > MAX_ARGS {
            return Err(Error::InvalidInput);
        }
        if max_retries > MAX_RETRIES {
            return Err(Error::InvalidInput);
        }
        Ok(Ok(Val::VOID))
    }

    pub fn call_readonly(env: Env, _contract: Address, fn_name: String, args: Vec<Val>) -> Result<Val, Error> {
        ensure_initialized(&env)?;
        if fn_name.is_empty() || fn_name.to_bytes().len() > 64 {
            return Err(Error::InvalidInput);
        }
        if args.len() > MAX_ARGS {
            return Err(Error::InvalidInput);
        }
        Ok(Val::VOID)
    }

    // ── ContractRegistry ─────────────────────────────────────────────────────────

    pub fn register(env: Env, admin: Address, name: String, address: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }
        if name.is_empty() || name.to_bytes().len() > 64 {
            return Err(Error::InvalidInput);
        }
        let name_bytes = name.to_bytes();
        for b in name_bytes.iter() {
            if !is_valid_name_char(*b) {
                return Err(Error::InvalidInput);
            }
        }
        
        let count_key: Symbol = symbol_short!("reg_count");
        let count: u32 = env.instance().get(&count_key).unwrap_or(0);
        if count >= MAX_REGISTRY_SIZE {
            return Err(Error::CapExceeded);
        }
        
        let key: Symbol = symbol_short!("reg", name);
        env.instance().set(&key, &address);
        env.instance().set(&count_key, &(count + 1));
        Ok(())
    }

    pub fn deregister(env: Env, admin: Address, name: String) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }
        let key: Symbol = symbol_short!("reg", name);
        let _ = env.instance().get::<Address>(&key);
        env.instance().remove(&key);
        Ok(())
    }

    pub fn lookup(env: Env, name: String) -> Result<Address, Error> {
        ensure_initialized(&env)?;
        if name.is_empty() || name.to_bytes().len() > 64 {
            return Err(Error::InvalidInput);
        }
        let key: Symbol = symbol_short!("reg", name);
        Ok(env.instance().get(&key).ok_or(Error::NotFound)?)
    }

    pub fn list_all(_env: Env) -> Vec<String> {
        Vec::new(&_env)
    }

    pub fn verify_interface(env: Env, _address: Address, _fn_names: Vec<String>) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(true)
    }

    // ── CallValidator ───────────────────────────────────────────────────────────

    pub fn validate_address(env: Env, address: Address) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        let zero = Address::from_literal("0000000000000000000000000000000000000000000000000000000000000000");
        Ok(address != zero)
    }

    pub fn validate_function_signature(env: Env, fn_name: String, arg_count: u32) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        if arg_count > MAX_ARGS {
            return Ok(false);
        }
        Ok(!fn_name.is_empty() && fn_name.to_bytes().len() <= 64)
    }

    pub fn validate_return_type_fn(env: Env, _value: Val, expected_type: String) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        let valid_types = vec![
            &env,
            String::from_str(&env, "u64"),
            String::from_str(&env, "i128"),
            String::from_str(&env, "bool"),
            String::from_str(&env, "string"),
            String::from_str(&env, "address"),
        ];
        Ok(valid_types.contains(&expected_type))
    }

    // ── BatchCaller ─────────────────────────────────────────────────────────────

    pub fn batch_call(env: Env, calls: Vec<(Address, String, Vec<Val>)>) -> Result<Vec<Result<Val, Error>>, Error> {
        ensure_initialized(&env)?;
        if calls.len() > MAX_BATCH_SIZE {
            return Err(Error::InvalidInput);
        }
        let mut results: Vec<Result<Val, Error>> = Vec::new(&env);
        for i in 0..calls.len() {
            let call = calls.get(i).unwrap();
            let (contract, fn_name, args) = call;
            let res = Self::call(env.clone(), *contract, fn_name.clone(), args);
            results.push_back(res);
        }
        Ok(results)
    }

    pub fn atomic_batch_call(env: Env, calls: Vec<(Address, String, Vec<Val>)>) -> Result<Vec<Val>, Error> {
        ensure_initialized(&env)?;
        if calls.len() > MAX_BATCH_SIZE {
            return Err(Error::InvalidInput);
        }
        let mut results: Vec<Val> = Vec::new(&env);
        for i in 0..calls.len() {
            let call = calls.get(i).unwrap();
            let (contract, fn_name, args) = call;
            let res = Self::call(env.clone(), *contract, fn_name.clone(), args)?;
            results.push_back(res);
        }
        Ok(results)
    }

    // ── FallbackHandler ─────────────────────────────────────────────────────────

    pub fn call_with_fallback(
        env: Env,
        _primary: Address,
        _fallback: Address,
        fn_name: String,
        args: Vec<Val>,
    ) -> Result<Val, Error> {
        ensure_initialized(&env)?;
        let _result = Self::call(env.clone(), _primary, fn_name.clone(), args.clone());
        match _result {
            Ok(v) => Ok(v),
            Err(_) => {
                let _primary_clone = _primary;
                let _fallback_clone = _fallback;
                let fn_name_clone = fn_name;
                env.events().publish(
                    (symbol_short!("FallbackInvoked"), &_primary_clone, &_fallback_clone, &fn_name_clone),
                    &(),
                );
                Self::call(env, _fallback, fn_name, args)
            }
        }
    }

    pub fn register_fallback(env: Env, admin: Address, contract: Address, fallback: Address) -> Result<(), Error> {
        admin.require_auth();
        if admin != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        let key: Symbol = symbol_short!("fallback", contract);
        env.instance().set(&key, &fallback);
        Ok(())
    }

    pub fn get_fallback(env: Env, contract: Address) -> Result<Option<Address>, Error> {
        ensure_initialized(&env)?;
        let key: Symbol = symbol_short!("fallback", contract);
        Ok(env.instance().get(&key))
    }

    pub fn remove_fallback(env: Env, admin: Address, contract: Address) -> Result<(), Error> {
        admin.require_auth();
        if admin != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        let key: Symbol = symbol_short!("fallback", contract);
        env.instance().remove(&key);
        Ok(())
    }
}