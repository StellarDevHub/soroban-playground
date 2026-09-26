#![no_std]

use soroban_sdk::Env;

pub const DEFAULT_INSTANCE_TTL_THRESHOLD: u32 = 518_400;   // ~6 days
pub const DEFAULT_INSTANCE_TTL_BUMP: u32 = 1_555_200;      // ~18 days
pub const DEFAULT_PERSISTENT_TTL_THRESHOLD: u32 = 2_592_000; // ~30 days
pub const DEFAULT_PERSISTENT_TTL_BUMP: u32 = 7_776_000;    // ~90 days

pub trait TTLExtender {
    fn extend_instance_ttl(env: &Env);
    fn extend_instance_ttl_custom(env: &Env, threshold: u32, bump: u32);
    fn extend_persistent_ttl(env: &Env);
    fn extend_persistent_ttl_custom(env: &Env, threshold: u32, bump: u32);
}

pub struct AutoTTL;

impl TTLExtender for AutoTTL {
    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(DEFAULT_INSTANCE_TTL_THRESHOLD, DEFAULT_INSTANCE_TTL_BUMP);
    }

    fn extend_instance_ttl_custom(env: &Env, threshold: u32, bump: u32) {
        env.storage()
            .instance()
            .extend_ttl(threshold, bump);
    }

    fn extend_persistent_ttl(env: &Env) {
        // Extend all persistent keys with default values
        // Note: Soroban v22+ has refined TTL extension patterns
        env.storage()
            .persistent()
            .extend_ttl(DEFAULT_PERSISTENT_TTL_THRESHOLD, DEFAULT_PERSISTENT_TTL_BUMP);
    }

    fn extend_persistent_ttl_custom(env: &Env, threshold: u32, bump: u32) {
        env.storage()
            .persistent()
            .extend_ttl(threshold, bump);
    }
}

#[macro_export]
macro_rules! with_ttl {
    ($env:expr, $block:expr) => {{
        let result = $block;
        $crate::AutoTTL::extend_instance_ttl($env);
        result
    }};
}

#[macro_export]
macro_rules! with_ttl_custom {
    ($env:expr, $threshold:expr, $bump:expr, $block:expr) => {{
        let result = $block;
        $crate::AutoTTL::extend_instance_ttl_custom($env, $threshold, $bump);
        result
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constants_are_reasonable() {
        assert!(DEFAULT_INSTANCE_TTL_THRESHOLD < DEFAULT_INSTANCE_TTL_BUMP);
        assert!(DEFAULT_PERSISTENT_TTL_THRESHOLD < DEFAULT_PERSISTENT_TTL_BUMP);
        assert!(DEFAULT_INSTANCE_TTL_THRESHOLD > 0);
        assert!(DEFAULT_PERSISTENT_TTL_THRESHOLD > 0);
    }
}
