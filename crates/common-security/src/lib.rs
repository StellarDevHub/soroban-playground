#![no_std]

use soroban_sdk::{Env, Symbol};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ReentrancyError {
    Locked,
    Unlocked,
}

pub trait ReentrancyKey {
    fn lock_key() -> Symbol;
}

pub struct ReentrancyGuard;

impl ReentrancyGuard {
    pub fn acquire_lock<K: ReentrancyKey>(env: &Env) -> Result<(), ReentrancyError> {
        let key = K::lock_key();
        
        let locked: bool = env.storage()
            .temporary()
            .get::<Symbol, bool>(&key)
            .unwrap_or(false);
        
        if locked {
            return Err(ReentrancyError::Locked);
        }
        
        env.storage().temporary().set(&key, &true);
        Ok(())
    }

    pub fn release_lock<K: ReentrancyKey>(env: &Env) -> Result<(), ReentrancyError> {
        let key = K::lock_key();
        
        let locked: bool = env.storage()
            .temporary()
            .get::<Symbol, bool>(&key)
            .unwrap_or(false);
        
        if !locked {
            return Err(ReentrancyError::Unlocked);
        }
        
        env.storage().temporary().remove(&key);
        Ok(())
    }
}

pub struct AtomicGuard<'a, K: ReentrancyKey> {
    env: &'a Env,
    _marker: std::marker::PhantomData<K>,
}

impl<'a, K: ReentrancyKey> AtomicGuard<'a, K> {
    pub fn new(env: &'a Env) -> Result<Self, ReentrancyError> {
        ReentrancyGuard::acquire_lock::<K>(env)?;
        Ok(AtomicGuard {
            env,
            _marker: std::marker::PhantomData,
        })
    }
}

impl<'a, K: ReentrancyKey> Drop for AtomicGuard<'a, K> {
    fn drop(&mut self) {
        let _ = ReentrancyGuard::release_lock::<K>(self.env);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Symbol;

    struct TestKey;
    impl ReentrancyKey for TestKey {
        fn lock_key() -> Symbol {
            Symbol::new(&soroban_sdk::Env::default(), "test_lock")
        }
    }

    #[test]
    fn test_acquire_and_release() {
        let env = soroban_sdk::Env::default();
        
        assert!(ReentrancyGuard::acquire_lock::<TestKey>(&env).is_ok());
        assert!(ReentrancyGuard::acquire_lock::<TestKey>(&env).is_err());
        assert!(ReentrancyGuard::release_lock::<TestKey>(&env).is_ok());
        assert!(ReentrancyGuard::acquire_lock::<TestKey>(&env).is_ok());
    }
}
