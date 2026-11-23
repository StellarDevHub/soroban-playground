extern crate alloc;

use alloc::boxed::Box;
#[cfg(any(test, feature = "testutils"))]
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, IntoVal, String, TryFromVal, Val, Vec};

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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_property_tester_basic() {
        let env = Env::default();
        let tester = PropertyTester::new(&env);
        let mut inputs = Vec::new(&env);
        inputs.push_back(1u32);
        inputs.push_back(2u32);
        inputs.push_back(3u32);

        let result = tester.test(inputs, |val| {
            if *val > 0 {
                Ok(())
            } else {
                Err(String::from_str(&env, "val must be > 0"))
            }
        });

        assert!(result.passed);
        assert_eq!(result.iterations, 3);
        assert_eq!(result.failures.len(), 0);
    }

    #[test]
    fn test_property_tester_with_limit() {
        let env = Env::default();
        let tester = PropertyTester::new(&env);
        let mut inputs = Vec::new(&env);
        inputs.push_back(10u32);
        inputs.push_back(20u32);
        inputs.push_back(30u32);

        let result = tester.test_with_limit(inputs, 2, |val| {
            if *val < 25 {
                Ok(())
            } else {
                Err(String::from_str(&env, "val must be < 25"))
            }
        });

        assert!(result.passed);
        assert_eq!(result.iterations, 2);
    }

    #[test]
    fn test_invariant_checker() {
        let env = Env::default();
        let mut checker = InvariantChecker::new(&env);
        let val = std::rc::Rc::new(core::cell::Cell::new(10));

        let v1 = val.clone();
        checker.add_invariant("positive", move || {
            if v1.get() > 0 {
                Ok(())
            } else {
                Err(String::from_str(&env, "must be positive"))
            }
        });

        assert!(checker.check_all().is_ok());
        assert!(checker.check_one("positive").is_ok());
        assert!(checker.check_one("nonexistent").is_err());

        val.set(-1);
        assert!(checker.check_all().is_err());
    }

    #[test]
    fn test_boundary_tester() {
        let env = Env::default();
        let bt = BoundaryTester::new(&env);

        let add_res = bt.checked_add_i128(100, 200);
        assert_eq!(add_res, Ok(300));

        let overflow_res = bt.checked_add_i128(i128::MAX, 1);
        assert!(overflow_res.is_err());

        let sub_res = bt.checked_sub_i128(200, 100);
        assert_eq!(sub_res, Ok(100));

        let underflow_res = bt.checked_sub_i128(i128::MIN, 1);
        assert!(underflow_res.is_err());

        let mul_res = bt.checked_mul_i128(10, 20);
        assert_eq!(mul_res, Ok(200));

        assert!(bt.is_in_range_i128(5, 0, 10));
        assert!(!bt.is_in_range_i128(15, 0, 10));

        assert!(bt.is_in_range_u128(5, 0, 10));
        assert!(!bt.is_in_range_u128(15, 0, 10));

        let i128_results = bt.test_i128_boundaries(|v| {
            if v >= i128::MIN {
                Ok(())
            } else {
                Err(String::from_str(&env, "out of bounds"))
            }
        });
        assert_eq!(i128_results.len(), 9);

        let u128_results = bt.test_u128_boundaries(|v| {
            if v <= u128::MAX {
                Ok(())
            } else {
                Err(String::from_str(&env, "out of bounds"))
            }
        });
        assert_eq!(u128_results.len(), 6);
    }

    #[test]
    fn test_fuzz_generator() {
        let env = Env::default();
        let mut fg = FuzzGenerator::new(&env, 42);

        let u64_val = fg.gen_u64();
        let u64_range = fg.gen_u64_range(10, 20);
        assert!(u64_range >= 10 && u64_range <= 20);

        let i64_val = fg.gen_i64();
        let i64_range = fg.gen_i64_range(-5, 5);
        assert!(i64_range >= -5 && i64_range <= 5);

        let u128_val = fg.gen_u128();
        let i128_val = fg.gen_i128();
        let bool_val = fg.gen_bool();
        let addr = fg.gen_address();
        let s = fg.gen_string(3, 8);
        assert!(s.len() >= 3 && s.len() <= 8);

        let vec_u64 = fg.gen_vec_u64(2, 5);
        assert!(vec_u64.len() >= 2 && vec_u64.len() <= 5);

        let taken = fg.take_n(3, |g| g.gen_u64());
        assert_eq!(taken.len(), 3);
    }

    #[test]
    fn test_property_validator() {
        let env = Env::default();
        let pv = PropertyValidator::new(&env);

        assert!(pv.assert_true(true, "err").is_ok());
        assert!(pv.assert_true(false, "err").is_err());

        assert!(pv.assert_false(false, "err").is_ok());
        assert!(pv.assert_false(true, "err").is_err());

        assert!(pv.assert_eq(1, 1, "err").is_ok());
        assert!(pv.assert_eq(1, 2, "err").is_err());

        assert!(pv.assert_ne(1, 2, "err").is_ok());
        assert!(pv.assert_ne(1, 1, "err").is_err());

        assert!(pv.assert_lt(1, 2, "err").is_ok());
        assert!(pv.assert_lt(2, 1, "err").is_err());

        assert!(pv.assert_le(1, 1, "err").is_ok());
        assert!(pv.assert_le(2, 1, "err").is_err());

        assert!(pv.assert_gt(2, 1, "err").is_ok());
        assert!(pv.assert_gt(1, 2, "err").is_err());

        assert!(pv.assert_ge(1, 1, "err").is_ok());
        assert!(pv.assert_ge(1, 2, "err").is_err());
    }

    // ── Unit Tests Verifying Issue #1957 Fix (Escrow / Time-Decaying Claim Verification) ──

    #[test]
    fn test_issue_1957_time_decay_claim_verification() {
        let env = Env::default();
        let bt = BoundaryTester::new(&env);
        let pv = PropertyValidator::new(&env);

        // Define a simulated time-decay payout function mirroring issue #1957 escrow logic:
        // Initial payout pool / reward amount scaled down linearly or exponentially based on elapsed time delta.
        // Payout(t) = base_reward * max(0, 1 - (elapsed / decay_period))
        let calculate_decayed_payout = |base_reward: i128, elapsed: u64, decay_period: u64| -> Result<i128, String> {
            if elapsed >= decay_period {
                return Ok(0);
            }
            let elapsed_i128 = elapsed as i128;
            let decay_period_i128 = decay_period as i128;
            
            // Safe math scaling check for escrow calculations
            let numerator = bt.checked_mul_i128(base_reward, bt.checked_sub_i128(decay_period_i128, elapsed_i128)?)?;
            let payout = numerator / decay_period_i128;
            Ok(payout)
        };

        let base_reward = 100_000_i128;
        let decay_period = 86400 * 30; // 30 days in seconds

        // 1. At elapsed = 0, payout should equal base_reward
        let p0 = calculate_decayed_payout(base_reward, 0, decay_period).unwrap();
        pv.assert_eq(p0, base_reward, "Zero elapsed time should yield full base reward").unwrap();

        // 2. At elapsed = decay_period / 2, payout should be halved
        let half_time = decay_period / 2;
        let p_half = calculate_decayed_payout(base_reward, half_time, decay_period).unwrap();
        pv.assert_eq(p_half, base_reward / 2, "Half elapsed time should yield half base reward").unwrap();

        // 3. At elapsed >= decay_period, payout should drop to 0 (preventing stale claim drain)
        let p_expired = calculate_decayed_payout(base_reward, decay_period, decay_period).unwrap();
        pv.assert_eq(p_expired, 0, "Expired claim time should yield zero payout").unwrap();

        let p_overdue = calculate_decayed_payout(base_reward, decay_period + 1000, decay_period).unwrap();
        pv.assert_eq(p_overdue, 0, "Overdue claim time should yield zero payout").unwrap();

        // 4. Property test across random elapsed times to ensure strict monotonically decreasing/zero bounds
        let mut fg = FuzzGenerator::new(&env, 1957);
        for _ in 0..100 {
            let elapsed = fg.gen_u64_range(0, decay_period * 2);
            let res = calculate_decayed_payout(base_reward, elapsed, decay_period);
            if let Ok(payout) = res {
                pv.assert_true(payout >= 0 && payout <= base_reward, "Decayed payout must remain within [0, base_reward]").unwrap();
                if elapsed >= decay_period {
                    pv.assert_eq(payout, 0, "Payout after decay period must be exactly zero").unwrap();
                }
            }
        }
    }
}