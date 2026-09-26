#[cfg(test)]
mod tests {
    use crate::{VestingEngine, VestingEngineClient, VestingCurve, ScheduleId};
    use soroban_sdk::{Env, Address};

    fn create_env() -> Env {
        Env::default()
    }

    #[test]
    fn test_initialization() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        let result = client.initialize(&admin);
        assert!(result.is_ok());

        // Second init should fail
        let result = client.initialize(&admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_linear_schedule() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp();
        let end = start + 31536000;  // 1 year

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let result = client.create_schedule(&beneficiary, &curve, &None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0u32);
    }

    #[test]
    fn test_create_cliff_schedule() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let now = env.ledger().timestamp();
        let cliff = now + 15768000;  // 6 months
        let end = now + 31536000;    // 1 year

        let curve = VestingCurve::Cliff {
            initial_unlock: 250_000i128,
            cliff_time: cliff,
            remaining_amount: 750_000i128,
            vesting_end: end,
        };

        let result = client.create_schedule(&beneficiary, &curve, &None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_staged_schedule() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let now = env.ledger().timestamp();
        let mut stages = [(0u64, 0i128); 8];
        stages[0] = (now + 2592000, 250_000i128);    // Month 1
        stages[1] = (now + 5184000, 250_000i128);    // Month 2
        stages[2] = (now + 7776000, 250_000i128);    // Month 3
        stages[3] = (now + 10368000, 250_000i128);   // Month 4

        let curve = VestingCurve::Staged {
            stages,
            stage_count: 4u8,
        };

        let result = client.create_schedule(&beneficiary, &curve, &None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_schedule_with_clawback() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp();
        let end = start + 31536000;

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let result = client.create_schedule(
            &beneficiary,
            &curve,
            &Some(admin.clone()),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_vested_amount_linear() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp();
        let end = start + 31536000;

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let schedule_id = client.create_schedule(&beneficiary, &curve, &None).unwrap();

        let vested = client.get_vested_amount(&schedule_id).unwrap();
        assert!(vested >= 0);
        assert!(vested <= 1_000_000i128);
    }

    #[test]
    fn test_claim() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp() - 15768000;  // Started 6 months ago
        let end = start + 31536000;  // Ends 6 months from now

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let schedule_id = client.create_schedule(&beneficiary, &curve, &None).unwrap();

        let result = client.claim(&beneficiary, &schedule_id);
        assert!(result.is_ok());
        let claimed = result.unwrap();
        assert!(claimed > 0i128);
    }

    #[test]
    fn test_claim_nothing_to_claim() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp() + 31536000;  // Starts 1 year from now
        let end = start + 31536000;

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let schedule_id = client.create_schedule(&beneficiary, &curve, &None).unwrap();

        let result = client.claim(&beneficiary, &schedule_id);
        assert!(result.is_err());  // Nothing vested yet
    }

    #[test]
    fn test_clawback() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp() - 15768000;
        let end = start + 31536000;

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let schedule_id = client.create_schedule(
            &beneficiary,
            &curve,
            &Some(admin.clone()),
        ).unwrap();

        let result = client.clawback(&admin, &schedule_id, &100_000i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_clawback_unauthorized() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);
        let unauthorized = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp();
        let end = start + 31536000;

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let schedule_id = client.create_schedule(
            &beneficiary,
            &curve,
            &Some(admin.clone()),
        ).unwrap();

        let result = client.clawback(&unauthorized, &schedule_id, &100_000i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_schedule() {
        let env = create_env();
        let client = VestingEngineClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let beneficiary = Address::random(&env);

        client.initialize(&admin).ok();

        let start = env.ledger().timestamp();
        let end = start + 31536000;

        let curve = VestingCurve::Linear {
            total_amount: 1_000_000i128,
            start_time: start,
            end_time: end,
        };

        let schedule_id = client.create_schedule(&beneficiary, &curve, &None).unwrap();
        let result = client.get_schedule(&schedule_id);

        assert!(result.is_ok());
        let schedule = result.unwrap();
        assert_eq!(schedule.id, schedule_id);
        assert_eq!(schedule.beneficiary, beneficiary);
    }
}
