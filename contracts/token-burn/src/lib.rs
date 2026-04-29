#![cfg_attr(not(test), no_std)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract has not been initialized.
    NotInitialized = 1,
    /// Caller is not the admin.
    Unauthorized = 2,
    /// Burn amount must be greater than zero.
    ZeroAmount = 3,
    /// Burn amount exceeds circulating supply.
    InsufficientSupply = 4,
    /// Contract is paused.
    Paused = 5,
    /// Burn rate must be 0–10000 (basis points).
    InvalidBurnRate = 6,
    /// Already initialized.
    AlreadyInitialized = 7,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    TotalSupply,
    TotalBurned,
    BurnRate,   // basis points (0–10000); e.g. 200 = 2%
    Paused,
    Balance(Address),
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TokenBurn;

#[contractimpl]
impl TokenBurn {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract.
    ///
    /// * `admin`        – address that controls admin functions
    /// * `initial_supply` – tokens minted to admin on init
    /// * `burn_rate`    – deflationary burn rate in basis points (0–10000)
    pub fn init(
        env: Env,
        admin: Address,
        initial_supply: i128,
        burn_rate: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if burn_rate > 10_000 {
            return Err(Error::InvalidBurnRate);
        }
        if initial_supply <= 0 {
            return Err(Error::ZeroAmount);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &initial_supply);
        env.storage().instance().set(&DataKey::TotalBurned, &0_i128);
        env.storage().instance().set(&DataKey::BurnRate, &burn_rate);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().persistent().set(&DataKey::Balance(admin.clone()), &initial_supply);

        env.events().publish(
            (symbol_short!("init"),),
            (admin, initial_supply, burn_rate),
        );

        Ok(())
    }

    // ── Burn ──────────────────────────────────────────────────────────────────

    /// Burn `amount` tokens from `from`'s balance.
    ///
    /// The caller must be `from` (self-burn) or the admin.
    /// Emits a `burn` event with `(from, amount, new_supply)`.
    pub fn burn(env: Env, from: Address, amount: i128) -> Result<i128, Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);

        if balance < amount {
            return Err(Error::InsufficientSupply);
        }

        let new_balance = balance - amount;
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &new_balance);

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        let new_supply = supply - amount;
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        let burned: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalBurned)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalBurned, &(burned + amount));

        env.events()
            .publish((symbol_short!("burn"),), (from, amount, new_supply));

        Ok(new_supply)
    }

    /// Apply the deflationary burn rate to `amount` and burn the computed
    /// portion from `from`. Returns the net amount after burn.
    ///
    /// `net = amount - floor(amount * burn_rate / 10000)`
    pub fn deflationary_transfer(
        env: Env,
        from: Address,
        amount: i128,
    ) -> Result<i128, Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let rate: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BurnRate)
            .unwrap_or(0);

        let burn_amount = (amount * rate as i128) / 10_000;
        let net = amount - burn_amount;

        if burn_amount > 0 {
            Self::burn(env, from, burn_amount)?;
        }

        Ok(net)
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Update the deflationary burn rate (admin only).
    pub fn set_burn_rate(env: Env, caller: Address, new_rate: u32) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_admin(&env, &caller)?;
        if new_rate > 10_000 {
            return Err(Error::InvalidBurnRate);
        }
        env.storage().instance().set(&DataKey::BurnRate, &new_rate);
        env.events()
            .publish((symbol_short!("rate"),), (caller, new_rate));
        Ok(())
    }

    /// Pause all burn operations (admin only).
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), caller);
        Ok(())
    }

    /// Resume burn operations (admin only).
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), caller);
        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn total_burned(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalBurned)
            .unwrap_or(0)
    }

    pub fn burn_rate(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::BurnRate)
            .unwrap_or(0)
    }

    pub fn balance(env: Env, account: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(account))
            .unwrap_or(0)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(())
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

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(Error::Paused);
        }
        Ok(())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    const SUPPLY: i128 = 1_000_000;
    const RATE: u32 = 200; // 2%

    fn setup() -> (Env, Address, TokenBurnClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, TokenBurn);
        let client = TokenBurnClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.init(&admin, &SUPPLY, &RATE).unwrap();
        let env = std::boxed::Box::leak(std::boxed::Box::new(env));
        let client = TokenBurnClient::new(env, &id);
        (env.clone(), admin, client)
    }

    #[test]
    fn test_init_sets_supply_and_rate() {
        let (_, admin, client) = setup();
        assert_eq!(client.total_supply(), SUPPLY);
        assert_eq!(client.total_burned(), 0);
        assert_eq!(client.burn_rate(), RATE);
        assert_eq!(client.balance(&admin), SUPPLY);
    }

    #[test]
    fn test_init_twice_fails() {
        let (env, _, client) = setup();
        let other = Address::generate(&env);
        assert_eq!(
            client.try_init(&other, &SUPPLY, &RATE),
            Err(Ok(Error::AlreadyInitialized))
        );
    }

    #[test]
    fn test_burn_reduces_supply_and_balance() {
        let (_, admin, client) = setup();
        let new_supply = client.burn(&admin, &1000).unwrap();
        assert_eq!(new_supply, SUPPLY - 1000);
        assert_eq!(client.total_burned(), 1000);
        assert_eq!(client.balance(&admin), SUPPLY - 1000);
    }

    #[test]
    fn test_burn_zero_fails() {
        let (_, admin, client) = setup();
        assert_eq!(client.try_burn(&admin, &0), Err(Ok(Error::ZeroAmount)));
    }

    #[test]
    fn test_burn_exceeds_balance_fails() {
        let (_, admin, client) = setup();
        assert_eq!(
            client.try_burn(&admin, &(SUPPLY + 1)),
            Err(Ok(Error::InsufficientSupply))
        );
    }

    #[test]
    fn test_deflationary_transfer_burns_correct_amount() {
        let (_, admin, client) = setup();
        // 2% of 10_000 = 200 burned
        let net = client.deflationary_transfer(&admin, &10_000).unwrap();
        assert_eq!(net, 9_800);
        assert_eq!(client.total_burned(), 200);
    }

    #[test]
    fn test_set_burn_rate_by_admin() {
        let (_, admin, client) = setup();
        client.set_burn_rate(&admin, &500).unwrap();
        assert_eq!(client.burn_rate(), 500);
    }

    #[test]
    fn test_set_burn_rate_by_non_admin_fails() {
        let (env, _, client) = setup();
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_set_burn_rate(&stranger, &500),
            Err(Ok(Error::Unauthorized))
        );
    }

    #[test]
    fn test_invalid_burn_rate_fails() {
        let (_, admin, client) = setup();
        assert_eq!(
            client.try_set_burn_rate(&admin, &10_001),
            Err(Ok(Error::InvalidBurnRate))
        );
    }

    #[test]
    fn test_pause_blocks_burn() {
        let (_, admin, client) = setup();
        client.pause(&admin).unwrap();
        assert!(client.is_paused());
        assert_eq!(client.try_burn(&admin, &100), Err(Ok(Error::Paused)));
    }

    #[test]
    fn test_unpause_allows_burn() {
        let (_, admin, client) = setup();
        client.pause(&admin).unwrap();
        client.unpause(&admin).unwrap();
        assert!(!client.is_paused());
        client.burn(&admin, &100).unwrap();
    }

    #[test]
    fn test_full_deflationary_cycle() {
        let (_, admin, client) = setup();
        // Burn 5% of 100_000 = 5_000
        client.set_burn_rate(&admin, &500).unwrap();
        let net = client.deflationary_transfer(&admin, &100_000).unwrap();
        assert_eq!(net, 95_000);
        assert_eq!(client.total_burned(), 5_000);
        assert_eq!(client.total_supply(), SUPPLY - 5_000);
    }
}
