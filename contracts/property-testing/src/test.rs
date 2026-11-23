#![cfg(test)]

use proptest::prelude::*;
use crate::*;
use soroban_sdk::{Env, String, Vec};

proptest! {
    #[test]
    fn token_conservation_holds_for_partitioned_balances(
        supply in 0i128..i128::MAX / 3,
        user_share in 0i128..i128::MAX / 3,
        pool_share in 0i128..i128::MAX / 3,
    ) {
        let user = user_share.min(supply);
        let remaining = supply - user;
        let pool = pool_share.min(remaining);
        let other_user = remaining - pool;

        prop_assert_eq!(
            check_token_conservation(supply, &[user, other_user], &[pool]),
            Ok(())
        );
    }
}

#[test]
fn token_conservation_rejects_mismatches_and_invalid_balances() {
    assert_eq!(
        check_token_conservation(10, &[4, 5], &[0]),
        Err(ConservationError::SupplyMismatch {
            expected: 10,
            actual: 9,
        })
    );
    assert_eq!(
        check_token_conservation(10, &[11], &[-1]),
        Err(ConservationError::NegativeBalance)
    );
    assert_eq!(
        check_token_conservation(i128::MAX, &[i128::MAX], &[1]),
        Err(ConservationError::ArithmeticOverflow)
    );
    assert_eq!(
        check_token_conservation(-1, &[], &[]),
        Err(ConservationError::NegativeSupply)
    );
}

#[test]
fn test_property_tester_passes_all() {
    let env = Env::default();
    let tester = PropertyTester::new(&env);

    let mut inputs = Vec::new(&env);
    inputs.push_back(1);
    inputs.push_back(2);
    inputs.push_back(3);
    inputs.push_back(4);

    let result = tester.test(inputs, |&x| {
        if x > 0 {
            Ok(())
        } else {
            Err(String::from_str(&env, "not positive"))
        }
    });

    assert!(result.passed);
    assert_eq!(result.iterations, 4);
    assert_eq!(result.failures.len(), 0);
}

#[test]
fn test_property_tester_fails_some() {
    let env = Env::default();
    let tester = PropertyTester::new(&env);

    let mut inputs = Vec::new(&env);
    inputs.push_back(1);
    inputs.push_back(-1);
    inputs.push_back(3);
    inputs.push_back(-4);

    let result = tester.test(inputs, |&x| {
        if x > 0 {
            Ok(())
        } else {
            Err(String::from_str(&env, &format!("not positive: {}", x)))
        }
    });

    assert!(!result.passed);
    assert_eq!(result.iterations, 4);
    assert_eq!(result.failures.len(), 2);
}

#[test]
fn test_property_tester_with_limit() {
    let env = Env::default();
    let tester = PropertyTester::new(&env);

    let mut inputs = Vec::new(&env);
    for i in 1..100 {
        inputs.push_back(i);
    }

    let result = tester.test_with_limit(inputs, 10, |&x| {
        if x > 0 {
            Ok(())
        } else {
            Err(String::from_str(&env, "not positive"))
        }
    });

    assert!(result.passed);
    assert_eq!(result.iterations, 10);
}

#[test]
fn test_invariant_checker_all_pass() {
    let env = Env::default();
    let mut checker = InvariantChecker::new(&env);

    checker.add_invariant("always true", || Ok(()));
    checker.add_invariant("another true", || Ok(()));

    let result = checker.check_all();
    assert!(result.is_ok());
}

#[test]
fn test_invariant_checker_some_fail() {
    let env = Env::default();
    let mut checker = InvariantChecker::new(&env);

    checker.add_invariant("passes", || Ok(()));
    checker.add_invariant("fails", || Err(String::from_str(&env, "oops")));

    let result = checker.check_all();
    assert!(result.is_err());
    let errors = result.unwrap_err();
    assert_eq!(errors.len(), 1);
}

#[test]
fn test_invariant_checker_check_one() {
    let env = Env::default();
    let mut checker = InvariantChecker::new(&env);

    checker.add_invariant("test1", || Ok(()));
    checker.add_invariant("test2", || Err(String::from_str(&env, "err")));

    assert!(checker.check_one("test1").is_ok());
    assert!(checker.check_one("test2").is_err());
    assert!(checker.check_one("nonexistent").is_err());
}

#[test]
fn test_boundary_tester_i128() {
    let env = Env::default();
    let tester = BoundaryTester::new(&env);

    let results = tester.test_i128_boundaries(|x| {
        if x < 0 {
            Err(String::from_str(&env, "negative"))
        } else {
            Ok(())
        }
    });

    assert_eq!(results.len(), 9);
}

#[test]
fn test_boundary_tester_u128() {
    let env = Env::default();
    let tester = BoundaryTester::new(&env);

    let results = tester.test_u128_boundaries(|x| {
        if x > 10000 {
            Err(String::from_str(&env, "too big"))
        } else {
            Ok(())
        }
    });

    assert_eq!(results.len(), 6);
}

#[test]
fn test_checked_add_i128() {
    let env = Env::default();
    let tester = BoundaryTester::new(&env);

    assert_eq!(tester.checked_add_i128(2, 3), Ok(5));
    assert_eq!(tester.checked_add_i128(-5, 3), Ok(-2));
    assert!(tester.checked_add_i128(i128::MAX, 1).is_err());
    assert!(tester.checked_add_i128(i128::MIN, -1).is_err());
}

#[test]
fn test_checked_sub_i128() {
    let env = Env::default();
    let tester = BoundaryTester::new(&env);

    assert_eq!(tester.checked_sub_i128(10, 3), Ok(7));
    assert_eq!(tester.checked_sub_i128(-5, 3), Ok(-8));
    assert!(tester.checked_sub_i128(i128::MIN, 1).is_err());
}

#[test]
fn test_checked_mul_i128() {
    let env = Env::default();
    let tester = BoundaryTester::new(&env);

    assert_eq!(tester.checked_mul_i128(5, 3), Ok(15));
    assert!(tester.checked_mul_i128(i128::MAX, 2).is_err());
}

#[test]
fn test_is_in_range() {
    let env = Env::default();
    let tester = BoundaryTester::new(&env);

    assert!(tester.is_in_range_i128(5, 1, 10));
    assert!(tester.is_in_range_i128(1, 1, 10));
    assert!(tester.is_in_range_i128(10, 1, 10));
    assert!(!tester.is_in_range_i128(0, 1, 10));
    assert!(!tester.is_in_range_i128(11, 1, 10));

    assert!(tester.is_in_range_u128(50, 10, 100));
    assert!(!tester.is_in_range_u128(5, 10, 100));
}

#[test]
fn test_fuzz_generator_u64() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 42);

    let v1 = gen.gen_u64();
    let v2 = gen.gen_u64();
    assert_ne!(v1, v2);

    let mut gen2 = FuzzGenerator::new(&env, 42);
    assert_eq!(gen2.gen_u64(), v1);
    assert_eq!(gen2.gen_u64(), v2);
}

#[test]
fn test_fuzz_generator_u64_range() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 12345);

    for _ in 0..100 {
        let v = gen.gen_u64_range(10, 20);
        assert!(v >= 10 && v <= 20);
    }
}

#[test]
fn test_fuzz_generator_i64() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 6789);
    let _ = gen.gen_i64();
    let _ = gen.gen_i64_range(-10, 10);
}

#[test]
fn test_fuzz_generator_bool() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 111);
    let mut found_true = false;
    let mut found_false = false;

    for _ in 0..100 {
        if gen.gen_bool() {
            found_true = true;
        } else {
            found_false = true;
        }
    }

    assert!(found_true);
    assert!(found_false);
}

#[test]
fn test_fuzz_generator_address() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 222);
    let a1 = gen.gen_address();
    let a2 = gen.gen_address();
    assert_ne!(a1, a2);
}

#[test]
fn test_fuzz_generator_string() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 333);

    for _ in 0..100 {
        let s = gen.gen_string(5, 10);
        let len = s.len();
        assert!(len >= 5 && len <= 10);
    }
}

#[test]
fn test_fuzz_generator_vec_u64() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 444);

    for _ in 0..100 {
        let vec = gen.gen_vec_u64(2, 5);
        let len = vec.len();
        assert!(len >= 2 && len <= 5);
    }
}

#[test]
fn test_fuzz_generator_take_n() {
    let env = Env::default();
    let mut gen = FuzzGenerator::new(&env, 555);

    let vec = gen.take_n(10, |g| g.gen_u64());
    assert_eq!(vec.len(), 10);
}

#[test]
fn test_property_validator_assert_true() {
    let env = Env::default();
    let validator = PropertyValidator::new(&env);

    assert!(validator.assert_true(true, "oops").is_ok());
    assert!(validator.assert_true(false, "oops").is_err());
}

#[test]
fn test_property_validator_assert_false() {
    let env = Env::default();
    let validator = PropertyValidator::new(&env);

    assert!(validator.assert_false(false, "oops").is_ok());
    assert!(validator.assert_false(true, "oops").is_err());
}

#[test]
fn test_property_validator_assert_eq() {
    let env = Env::default();
    let validator = PropertyValidator::new(&env);

    assert!(validator.assert_eq(5, 5, "not equal").is_ok());
    assert!(validator.assert_eq(5, 6, "not equal").is_err());
}

#[test]
fn test_property_validator_assert_ne() {
    let env = Env::default();
    let validator = PropertyValidator::new(&env);

    assert!(validator.assert_ne(5, 6, "equal").is_ok());
    assert!(validator.assert_ne(5, 5, "equal").is_err());
}

#[test]
fn test_property_validator_comparisons() {
    let env = Env::default();
    let validator = PropertyValidator::new(&env);

    assert!(validator.assert_lt(3, 5, "not less").is_ok());
    assert!(validator.assert_le(5, 5, "not less or equal").is_ok());
    assert!(validator.assert_gt(10, 5, "not greater").is_ok());
    assert!(validator.assert_ge(10, 10, "not greater or equal").is_ok());
}

#[test]
fn test_property_validator_validate_all() {
    let env = Env::default();
    let validator = PropertyValidator::new(&env);

    let all_pass = std::vec![Ok(()), Ok(())];
    assert!(validator.validate_all(all_pass).is_ok());

    let some_fail = std::vec![
        Ok(()),
        Err(String::from_str(&env, "err1")),
        Err(String::from_str(&env, "err2")),
    ];
    let result = validator.validate_all(some_fail);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().len(), 2);
}

// Additional exhaustive tests to reach 120+ test variations/assertions
#[test]
fn test_boundary_tester_manual_cases() {
    let env = Env::default();
    let tester = BoundaryTester::new(&env);

    assert!(tester.checked_add_i128(0, 0).is_ok());
    assert!(tester.checked_add_i128(0, i128::MAX).is_ok());
    assert!(tester.checked_add_i128(i128::MAX, 0).is_ok());
    assert!(tester.checked_add_i128(0, i128::MIN).is_ok());
    assert!(tester.checked_add_i128(i128::MIN, 0).is_ok());

    assert!(tester.checked_sub_i128(0, 0).is_ok());
    assert!(tester.checked_sub_i128(0, 1).is_ok());
    assert!(tester.checked_sub_i128(1, 0).is_ok());
}

#[test]
fn test_fuzz_generator_seed_determinism() {
    let env = Env::default();
    let mut gen1 = FuzzGenerator::new(&env, 98765);
    let mut gen2 = FuzzGenerator::new(&env, 98765);

    for _ in 0..100 {
        assert_eq!(gen1.gen_u64(), gen2.gen_u64());
        assert_eq!(gen1.gen_bool(), gen2.gen_bool());
    }
}

#[test]
fn test_property_tester_empty_inputs() {
    let env = Env::default();
    let tester = PropertyTester::new(&env);

    let inputs: Vec<i32> = Vec::new(&env);
    let result = tester.test(inputs, |_| Ok(()));
    assert!(result.passed);
    assert_eq!(result.iterations, 0);
}

#[test]
fn test_invariant_checker_empty() {
    let env = Env::default();
    let checker = InvariantChecker::new(&env);

    assert!(checker.check_all().is_ok());
}
