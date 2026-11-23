extern crate alloc;

use alloc::boxed::Box;
#[cfg(any(test, feature = "testutils"))]
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, IntoVal, String, TryFromVal, Val, Vec};

pub mod invariants;
pub use invariants::{check_token_conservation, ConservationError};

/// Result for property test execution
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyTestResult {
    pub passed: bool,
    pub iterations: u64,
    pub failures: Vec<String>,
}

/// PropertyTester - executes property tests with multiple inputs
pub struct PropertyTester<'a> {
    env: &'a Env,
}

impl<'a> PropertyTester<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self { env }
    }

    pub fn test<F, I>(&self, inputs: Vec<I>, property: F) -> PropertyTestResult
    where
        F: Fn(&I) -> Result<(), String>,
        I: IntoVal<Env, Val> + TryFromVal<Env, Val> + Clone,
    {
        let mut failures = Vec::new(self.env);
        let mut count = 0u64;

        for input in inputs.iter() {
            count += 1;
            if let Err(e) = property(&input) {
                failures.push_back(e);
            }
        }

        PropertyTestResult {
            passed: failures.is_empty(),
            iterations: count,
            failures,
        }
    }

    pub fn test_with_limit<F, I>(
        &self,
        inputs: Vec<I>,
        limit: u64,
        property: F,
    ) -> PropertyTestResult
    where
        F: Fn(&I) -> Result<(), String>,
        I: IntoVal<Env, Val> + TryFromVal<Env, Val> + Clone,
    {
        let mut failures = Vec::new(self.env);
        let mut count = 0u64;

        for input in inputs.iter() {
            if count >= limit {
                break;
            }
            count += 1;
            if let Err(e) = property(&input) {
                failures.push_back(e);
            }
        }

        PropertyTestResult {
            passed: failures.is_empty(),
            iterations: count,
            failures,
        }
    }
}

/// InvariantChecker - tracks and verifies state invariants
pub struct InvariantChecker<'a> {
    env: &'a Env,
    invariants: std::vec::Vec<(&'static str, Box<dyn Fn() -> Result<(), String> + 'a>)>,
}

impl<'a> InvariantChecker<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self {
            env,
            invariants: std::vec::Vec::new(),
        }
    }

    pub fn add_invariant<F>(&mut self, name: &'static str, invariant: F)
    where
        F: Fn() -> Result<(), String> + 'a,
    {
        self.invariants.push((name, Box::new(invariant)));
    }

    pub fn check_all(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new(self.env);

        for (name, inv) in self.invariants.iter() {
            if let Err(_e) = inv() {
                errors.push_back(String::from_str(self.env, name));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    pub fn check_one(&self, name: &str) -> Result<(), String> {
        for (inv_name, inv) in self.invariants.iter() {
            if *inv_name == name {
                return inv();
            }
        }
        Err(String::from_str(self.env, "invariant not found"))
    }
}

/// BoundaryTester - tests boundary conditions and overflow/underflow
pub struct BoundaryTester<'a> {
    env: &'a Env,
}

impl<'a> BoundaryTester<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self { env }
    }

    pub fn test_i128_boundaries<F>(&self, f: F) -> std::vec::Vec<(i128, Result<(), String>)>
    where
        F: Fn(i128) -> Result<(), String>,
    {
        let mut results = std::vec::Vec::new();
        let test_values = [
            i128::MIN,
            i128::MIN + 1,
            -1000,
            -1,
            0,
            1,
            1000,
            i128::MAX - 1,
            i128::MAX,
        ];

        for &v in &test_values {
            results.push((v, f(v)));
        }

        results
    }

    pub fn test_u128_boundaries<F>(&self, f: F) -> std::vec::Vec<(u128, Result<(), String>)>
    where
        F: Fn(u128) -> Result<(), String>,
    {
        let mut results = std::vec::Vec::new();
        let test_values = [u128::MIN, 1, 1000, u128::MAX / 2, u128::MAX - 1, u128::MAX];

        for &v in &test_values {
            results.push((v, f(v)));
        }

        results
    }

    pub fn checked_add_i128(&self, a: i128, b: i128) -> Result<i128, String> {
        a.checked_add(b)
            .ok_or_else(|| String::from_str(self.env, "overflow/underflow"))
    }

    pub fn checked_sub_i128(&self, a: i128, b: i128) -> Result<i128, String> {
        a.checked_sub(b)
            .ok_or_else(|| String::from_str(self.env, "overflow/underflow"))
    }

    pub fn checked_mul_i128(&self, a: i128, b: i128) -> Result<i128, String> {
        a.checked_mul(b)
            .ok_or_else(|| String::from_str(self.env, "overflow/underflow"))
    }

    pub fn is_in_range_i128(&self, value: i128, min: i128, max: i128) -> bool {
        value >= min && value <= max
    }

    pub fn is_in_range_u128(&self, value: u128, min: u128, max: u128) -> bool {
        value >= min && value <= max
    }
}

/// FuzzGenerator - generates test inputs for Soroban types
pub struct FuzzGenerator<'a> {
    env: &'a Env,
    seed: u64,
}

impl<'a> FuzzGenerator<'a> {
    pub fn new(env: &'a Env, seed: u64) -> Self {
        Self { env, seed }
    }

    fn next_seed(&mut self) -> u64 {
        self.seed = self.seed.wrapping_mul(1103515245).wrapping_add(12345);
        self.seed
    }

    pub fn gen_u64(&mut self) -> u64 {
        self.next_seed()
    }

    pub fn gen_u64_range(&mut self, min: u64, max: u64) -> u64 {
        let range = max - min + 1;
        (self.gen_u64() % range) + min
    }

    pub fn gen_i64(&mut self) -> i64 {
        self.gen_u64() as i64
    }

    pub fn gen_i64_range(&mut self, min: i64, max: i64) -> i64 {
        let range = (max - min) as u64 + 1;
        (self.gen_u64() % range) as i64 + min
    }

    pub fn gen_u128(&mut self) -> u128 {
        let a = self.gen_u64() as u128;
        let b = self.gen_u64() as u128;
        (a << 64) | b
    }

    pub fn gen_i128(&mut self) -> i128 {
        self.gen_u128() as i128
    }

    pub fn gen_bool(&mut self) -> bool {
        self.gen_u64() % 2 == 0
    }

    #[cfg(any(test, feature = "testutils"))]
    pub fn gen_address(&mut self) -> Address {
        Address::generate(self.env)
    }

    pub fn gen_string(&mut self, len_min: u64, len_max: u64) -> String {
        let len = self.gen_u64_range(len_min, len_max) as usize;
        let charset = b"abcdefghijklmnopqrstuvwxyz0123456789";
        let mut bytes = std::vec::Vec::with_capacity(len);

        for _ in 0..len {
            let idx = self.gen_u64_range(0, charset.len() as u64 - 1) as usize;
            bytes.push(charset[idx]);
        }

        let s = core::str::from_utf8(&bytes).unwrap_or("");
        String::from_str(self.env, s)
    }

    pub fn gen_vec_u64(&mut self, len_min: u64, len_max: u64) -> Vec<u64> {
        let len = self.gen_u64_range(len_min, len_max);
        let mut vec = Vec::new(self.env);
        for _ in 0..len {
            vec.push_back(self.gen_u64());
        }
        vec
    }

    pub fn take_n<T, F>(&mut self, n: u64, mut gen: F) -> Vec<T>
    where
        F: FnMut(&mut Self) -> T,
        T: IntoVal<Env, Val> + TryFromVal<Env, Val>,
    {
        let mut vec = Vec::new(self.env);
        for _ in 0..n {
            vec.push_back(gen(self));
        }
        vec
    }
}

/// PropertyValidator - validates runtime behaviors against conditions
pub struct PropertyValidator<'a> {
    env: &'a Env,
}

impl<'a> PropertyValidator<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self { env }
    }

    pub fn assert_true(&self, condition: bool, message: &str) -> Result<(), String> {
        if condition {
            Ok(())
        } else {
            Err(String::from_str(self.env, message))
        }
    }

    pub fn assert_false(&self, condition: bool, message: &str) -> Result<(), String> {
        self.assert_true(!condition, message)
    }

    pub fn assert_eq<T: PartialEq>(&self, a: T, b: T, message: &str) -> Result<(), String> {
        self.assert_true(a == b, message)
    }

    pub fn assert_ne<T: PartialEq>(&self, a: T, b: T, message: &str) -> Result<(), String> {
        self.assert_true(a != b, message)
    }

    pub fn assert_lt<T: PartialOrd>(&self, a: T, b: T, message: &str) -> Result<(), String> {
        self.assert_true(a < b, message)
    }

    pub fn assert_le<T: PartialOrd>(&self, a: T, b: T, message: &str) -> Result<(), String> {
        self.assert_true(a <= b, message)
    }

    pub fn assert_gt<T: PartialOrd>(&self, a: T, b: T, message: &str) -> Result<(), String> {
        self.assert_true(a > b, message)
    }

    pub fn assert_ge<T: PartialOrd>(&self, a: T, b: T, message: &str) -> Result<(), String> {
        self.assert_true(a >= b, message)
    }

    pub fn validate_all(
        &self,
        validations: std::vec::Vec<Result<(), String>>,
    ) -> Result<(), Vec<String>> {
        let mut errors = Vec::new(self.env);
        for v in validations {
            if let Err(e) = v {
                errors.push_back(e);
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[cfg(test)]
mod test;
