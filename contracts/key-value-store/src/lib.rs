// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Bytes, Env};

/// Errors that the key-value store contract can return.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The requested key does not exist in storage.
    KeyNotFound = 1,
    /// The key provided is empty.
    EmptyKey = 2,
}

/// Storage key wrapper.
///
/// Soroban requires all storage keys to implement `contracttype`.
/// Wrapping the user-supplied key in an enum variant namespaces it
/// cleanly and prevents collisions if this pattern is extended later.
#[contracttype]
pub enum DataKey {
    Entry(Bytes),
}

#[contract]
pub struct KeyValueStore;

#[contractimpl]
impl KeyValueStore {
    /// Stores a value under the given key.
    ///
    /// Both key and value are raw `Bytes`, keeping the contract
    /// generic — callers decide how to encode their data.
    ///
    /// # Arguments
    /// * `key`   - The key to store the value under. Must not be empty.
    /// * `value` - The value to store.
    ///
    /// # Errors
    /// Returns [`Error::EmptyKey`] if `key` has zero length.
    pub fn set(env: Env, key: Bytes, value: Bytes) -> Result<(), Error> {
        if key.is_empty() {
            return Err(Error::EmptyKey);
        }

        env.storage().persistent().set(&DataKey::Entry(key), &value);

        Ok(())
    }

    /// Retrieves the value stored under the given key.
    ///
    /// # Arguments
    /// * `key` - The key to look up.
    ///
    /// # Errors
    /// Returns [`Error::KeyNotFound`] if the key has never been set
    /// or has expired from persistent storage.
    /// Returns [`Error::EmptyKey`] if `key` has zero length.
    pub fn get(env: Env, key: Bytes) -> Result<Bytes, Error> {
        if key.is_empty() {
            return Err(Error::EmptyKey);
        }

        env.storage()
            .persistent()
            .get(&DataKey::Entry(key))
            .ok_or(Error::KeyNotFound)
    }

    /// Returns `true` if a value exists for the given key, `false` otherwise.
    ///
    /// Useful for existence checks without fetching the full value.
    pub fn has(env: Env, key: Bytes) -> bool {
        if key.is_empty() {
            return false;
        }

        env.storage().persistent().has(&DataKey::Entry(key))
    }

    /// Removes the value stored under the given key.
    ///
    /// No-ops silently if the key does not exist, matching the
    /// behaviour of most key-value stores.
    ///
    /// # Errors
    /// Returns [`Error::EmptyKey`] if `key` has zero length.
    pub fn remove(env: Env, key: Bytes) -> Result<(), Error> {
        if key.is_empty() {
            return Err(Error::EmptyKey);
        }

        env.storage().persistent().remove(&DataKey::Entry(key));

        Ok(())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{bytes, Env};

    fn setup() -> (Env, KeyValueStoreClient<'static>) {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);
        // Leak env so client lifetime is satisfied — standard pattern in
        // Soroban test helpers when returning both from a setup function.
        let env = Box::leak(Box::new(env));
        (env.clone(), KeyValueStoreClient::new(env, &id))
    }

    #[test]
    fn test_set_and_get_roundtrip() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key = bytes!(&env, 0x68656c6c6f); // "hello"
        let value = bytes!(&env, 0x776f726c64); // "world"

        client.set(&key, &value);
        let result = client.get(&key);
        assert_eq!(result, value);
    }

    #[test]
    fn test_get_missing_key_returns_error() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key = bytes!(&env, 0x6d697373696e67); // "missing"
        let result = client.try_get(&key);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::KeyNotFound as u32
            )))
        );
    }

    #[test]
    fn test_has_returns_false_before_set() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key = bytes!(&env, 0x6b6579); // "key"
        assert!(!client.has(&key));
    }

    #[test]
    fn test_has_returns_true_after_set() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key = bytes!(&env, 0x6b6579); // "key"
        let value = bytes!(&env, 0x76616c); // "val"
        client.set(&key, &value);
        assert!(client.has(&key));
    }

    #[test]
    fn test_remove_deletes_entry() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key = bytes!(&env, 0x6b6579); // "key"
        let value = bytes!(&env, 0x76616c); // "val"

        client.set(&key, &value);
        assert!(client.has(&key));

        client.remove(&key);
        assert!(!client.has(&key));
    }

    #[test]
    fn test_remove_nonexistent_key_is_noop() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key = bytes!(&env, 0x6e6f6e65); // "none"
                                            // Should not panic
        client.remove(&key);
    }

    #[test]
    fn test_overwrite_existing_key() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key = bytes!(&env, 0x6b6579);
        let value1 = bytes!(&env, 0x76616c31); // "val1"
        let value2 = bytes!(&env, 0x76616c32); // "val2"

        client.set(&key, &value1);
        assert_eq!(client.get(&key), value1);

        client.set(&key, &value2);
        assert_eq!(client.get(&key), value2, "second set must overwrite first");
    }

    #[test]
    fn test_empty_key_rejected_on_set() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let empty = Bytes::new(&env);
        let value = bytes!(&env, 0x76616c);
        let result = client.try_set(&empty, &value);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::EmptyKey as u32
            )))
        );
    }

    #[test]
    fn test_empty_key_rejected_on_get() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let empty = Bytes::new(&env);
        let result = client.try_get(&empty);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::EmptyKey as u32
            )))
        );
    }

    #[test]
    fn test_different_keys_are_independent() {
        let env = Env::default();
        let id = env.register_contract(None, KeyValueStore);
        let client = KeyValueStoreClient::new(&env, &id);

        let key_a = bytes!(&env, 0x61); // "a"
        let key_b = bytes!(&env, 0x62); // "b"
        let val_a = bytes!(&env, 0x0001);
        let val_b = bytes!(&env, 0x0002);

        client.set(&key_a, &val_a);
        client.set(&key_b, &val_b);

        assert_eq!(client.get(&key_a), val_a);
        assert_eq!(client.get(&key_b), val_b);

        client.remove(&key_a);
        // key_b must be unaffected
        assert!(client.has(&key_b));
        assert_eq!(client.get(&key_b), val_b);
    }
}
