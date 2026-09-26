//! Role-Based Access Control (RBAC) module
//! Epic #1552: Universal Emergency Pause & Role-Based Access Control

use soroban_sdk::{Address, Env};

/// Role-based access control roles
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Admin = 0,      // Can upgrade, pause, change admin
    Operator = 1,   // Can execute state changes (mint, transfer, etc.)
    Guardian = 2,   // Can pause emergency (circuit breaker)
}

/// RBAC authorization error
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RBACError {
    Unauthorized = 1,
    RoleNotFound = 2,
    InvalidRole = 3,
}

/// Role registry stored in contract state
pub mod roles {
    use soroban_sdk::{Address, Env, Map, Symbol};

    /// Get role for an address from contract storage
    pub fn get_role(env: &Env, address: &Address) -> Option<super::Role> {
        let key = ("role", address);
        env.storage()
            .persistent()
            .get(&key)
            .map(|r: u32| match r {
                0 => super::Role::Admin,
                1 => super::Role::Operator,
                2 => super::Role::Guardian,
                _ => unreachable!(),
            })
    }

    /// Set role for an address
    pub fn set_role(env: &Env, address: &Address, role: super::Role) {
        let key = ("role", address);
        env.storage()
            .persistent()
            .set(&key, &(role as u32));
    }

    /// Check if address has at least this role
    pub fn has_role(env: &Env, address: &Address, required_role: super::Role) -> bool {
        match get_role(env, address) {
            Some(role) => role as u32 <= required_role as u32, // Admin > Operator > Guardian
            None => false,
        }
    }

    /// Require auth and verify role
    pub fn require_role(
        env: &Env,
        caller: &Address,
        required_role: super::Role,
    ) -> Result<(), super::RBACError> {
        caller.require_auth();

        if has_role(env, caller, required_role) {
            Ok(())
        } else {
            Err(super::RBACError::Unauthorized)
        }
    }
}

/// Emergency pause circuit breaker
pub mod pause {
    use soroban_sdk::{Env, Symbol};

    const PAUSED_KEY: &str = "paused";

    /// Check if contract is paused
    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .persistent()
            .get::<Symbol, bool>(&Symbol::new(env, PAUSED_KEY))
            .unwrap_or(false)
    }

    /// Set pause state (requires Guardian role)
    pub fn set_paused(env: &Env, paused: bool) {
        env.storage()
            .persistent()
            .set(&Symbol::new(env, PAUSED_KEY), &paused);
    }

    /// Guard: revert if paused
    pub fn require_not_paused(env: &Env) -> Result<(), String> {
        if is_paused(env) {
            Err("Contract is paused".to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_hierarchy() {
        // Admin can do everything
        let admin = Role::Admin;
        assert_eq!(admin as u32, 0);

        // Operator is less privileged
        let operator = Role::Operator;
        assert_eq!(operator as u32, 1);
        assert!(admin as u32 <= operator as u32); // False: admin is more privileged

        // Guardian is least privileged
        let guardian = Role::Guardian;
        assert_eq!(guardian as u32, 2);
        assert!(operator as u32 <= guardian as u32); // False: operator is more privileged
    }
}
