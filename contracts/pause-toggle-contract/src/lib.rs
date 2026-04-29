#![cfg_attr(not(test), no_std)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Caller is not the admin.
    Unauthorized = 1,
    /// Action blocked because contract is paused.
    ContractPaused = 2,
    /// Contract is already in the requested state.
    AlreadyInState = 3,
    /// Contract has not been initialized yet.
    NotInitialized = 4,
}

#[contracttype]
pub enum DataKey {
    /// The admin address — only admin can pause/unpause.
    Admin,
    /// The current paused state.
    Paused,
}

#[contract]
pub struct PauseToggle;

#[contractimpl]
impl PauseToggle {
    /// Initializes the contract with an admin address.
    ///
    /// Can only be called once. Sets the contract to unpaused by default.
    ///
    /// # Errors
    /// Panics if already initialized.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);

        env.events().publish(
            (soroban_sdk::symbol_short!("init"),),
            admin,
        );
    }

    /// Pauses the contract.
    ///
    /// Only the admin can call this. Blocked actions will return
    /// [`Error::ContractPaused`] until [`unpause`] is called.
    ///
    /// # Errors
    /// Returns [`Error::Unauthorized`] if caller is not the admin.
    /// Returns [`Error::AlreadyInState`] if already paused.
    /// Returns [`Error::NotInitialized`] if init has not been called.
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_initialized(&env)?;
        Self::assert_admin(&env, &caller)?;

        if Self::is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &true);

        env.events().publish(
            (soroban_sdk::symbol_short!("paused"),),
            caller,
        );

        Ok(())
    }

    /// Unpauses the contract.
    ///
    /// Only the admin can call this.
    ///
    /// # Errors
    /// Returns [`Error::Unauthorized`] if caller is not the admin.
    /// Returns [`Error::AlreadyInState`] if already unpaused.
    /// Returns [`Error::NotInitialized`] if init has not been called.
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_initialized(&env)?;
        Self::assert_admin(&env, &caller)?;

        if !Self::is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &false);

        env.events().publish(
            (soroban_sdk::symbol_short!("unpaused"),),
            caller,
        );

        Ok(())
    }

    /// Returns `true` if the contract is currently paused.
    pub fn paused(env: Env) -> bool {
        Self::is_paused(&env)
    }

    /// Example of a guarded action — only runs when not paused.
    ///
    /// Replace this with your real business logic. This demonstrates
    /// how any function checks the pause state before proceeding.
    ///
    /// # Errors
    /// Returns [`Error::ContractPaused`] if the contract is paused.
    pub fn do_action(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        if Self::is_paused(&env) {
            return Err(Error::ContractPaused);
        }

        env.events().publish(
            (soroban_sdk::symbol_short!("action"),),
            caller,
        );

        Ok(())
    }

    /// Returns the current admin address.
    ///
    /// # Errors
    /// Returns [`Error::NotInitialized`] if init has not been called.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
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

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
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

    fn setup() -> (Env, Address, PauseToggleClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, PauseToggle);
        let client = PauseToggleClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.init(&admin);
        let env = std::boxed::Box::leak(std::boxed::Box::new(env));
        let client = PauseToggleClient::new(env, &id);
        (env.clone(), admin, client)
    }

    // ── init ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_init_sets_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, PauseToggle);
        let client = PauseToggleClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.init(&admin);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_init_starts_unpaused() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, PauseToggle);
        let client = PauseToggleClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.init(&admin);
        assert!(!client.paused());
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_init_twice_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, PauseToggle);
        let client = PauseToggleClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.init(&admin);
        client.init(&admin); // should panic
    }

    // ── pause ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_pause_sets_paused_state() {
        let (_, admin, client) = setup();
        client.pause(&admin);
        assert!(client.paused());
    }

    #[test]
    fn test_pause_by_non_admin_fails() {
        let (env, _, client) = setup();
        let stranger = Address::generate(&env);

        let result = client.try_pause(&stranger);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn test_pause_already_paused_fails() {
        let (_, admin, client) = setup();
        client.pause(&admin);

        let result = client.try_pause(&admin);
        assert_eq!(result, Err(Ok(Error::AlreadyInState)));
    }

    // ── unpause ───────────────────────────────────────────────────────────────

    #[test]
    fn test_unpause_clears_paused_state() {
        let (_, admin, client) = setup();
        client.pause(&admin);
        assert!(client.paused());

        client.unpause(&admin);
        assert!(!client.paused());
    }

    #[test]
    fn test_unpause_by_non_admin_fails() {
        let (env, admin, client) = setup();
        client.pause(&admin);
        let stranger = Address::generate(&env);

        let result = client.try_unpause(&stranger);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn test_unpause_already_active_fails() {
        let (_, admin, client) = setup();

        // Contract starts unpaused
        let result = client.try_unpause(&admin);
        assert_eq!(result, Err(Ok(Error::AlreadyInState)));
    }

    // ── do_action ─────────────────────────────────────────────────────────────

    #[test]
    fn test_action_succeeds_when_unpaused() {
        let (env, _, client) = setup();
        let user = Address::generate(&env);
        // Should not error
        client.do_action(&user);
    }

    #[test]
    fn test_action_blocked_when_paused() {
        let (env, admin, client) = setup();
        let user = Address::generate(&env);
        client.pause(&admin);

        let result = client.try_do_action(&user);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));
    }

    #[test]
    fn test_action_works_after_unpause() {
        let (env, admin, client) = setup();
        let user = Address::generate(&env);

        client.pause(&admin);
        client.unpause(&admin);

        // Should succeed again
        client.do_action(&user);
    }

    // ── full cycle ────────────────────────────────────────────────────────────

    #[test]
    fn test_full_pause_unpause_cycle() {
        let (env, admin, client) = setup();
        let user = Address::generate(&env);

        assert!(!client.paused());
        client.do_action(&user);

        client.pause(&admin);
        assert!(client.paused());
        assert!(client.try_do_action(&user).is_err());

        client.unpause(&admin);
        assert!(!client.paused());
        client.do_action(&user);
    }
}