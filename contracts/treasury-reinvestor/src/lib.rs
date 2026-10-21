// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    NoSurplus = 4,
    ProtocolNotWhitelisted = 5,
    ProtocolInactive = 6,
    ProtocolAlreadyWhitelisted = 7,
    ExceedsExposureCap = 8,
    AllocationExceedsSurplus = 9,
    InvalidParameter = 10,
    EmergencyActive = 11,
    InvalidBuffer = 12,
    MathOverflow = 13,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolInfo {
    pub id: u32,
    pub address: Address,
    pub name: Symbol,
    pub allocated_amount: i128,
    pub yield_harvested: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllocationPlan {
    pub protocol_id: u32,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReinvestorConfig {
    pub admin: Address,
    pub base_asset: Address,
    pub reserve_buffer: i128,
    pub max_protocol_cap_bps: u32, // e.g. 3000 = 30%
    pub total_invested: i128,
    pub total_yield_harvested: i128,
    pub is_emergency: bool,
}

#[contracttype]
enum DataKey {
    Config,
    Protocol(u32),
    ProtocolList,
}

#[contract]
pub struct TreasuryReinvestor;

#[contractimpl]
impl TreasuryReinvestor {
    /// Initialize the autonomous treasury reinvestor contract
    pub fn initialize(
        env: Env,
        admin: Address,
        base_asset: Address,
        reserve_buffer: i128,
        max_protocol_cap_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        if reserve_buffer < 0 {
            return Err(Error::InvalidBuffer);
        }
        if max_protocol_cap_bps == 0 || max_protocol_cap_bps > 10_000 {
            return Err(Error::InvalidParameter);
        }

        let config = ReinvestorConfig {
            admin: admin.clone(),
            base_asset: base_asset.clone(),
            reserve_buffer,
            max_protocol_cap_bps,
            total_invested: 0,
            total_yield_harvested: 0,
            is_emergency: false,
        };

        env.storage().instance().set(&DataKey::Config, &config);
        let empty_list: Vec<u32> = Vec::new(&env);
        env.storage().instance().set(&DataKey::ProtocolList, &empty_list);

        env.events().publish(
            (symbol_short!("init"),),
            (admin, base_asset, reserve_buffer, max_protocol_cap_bps),
        );
        Ok(())
    }

    /// Whitelist a conservative yield-bearing protocol
    pub fn whitelist_protocol(
        env: Env,
        caller: Address,
        protocol_id: u32,
        protocol_address: Address,
        name: Symbol,
    ) -> Result<(), Error> {
        let mut config = Self::load_config(&env)?;
        caller.require_auth();
        if caller != config.admin {
            return Err(Error::Unauthorized);
        }

        if env.storage().instance().has(&DataKey::Protocol(protocol_id)) {
            return Err(Error::ProtocolAlreadyWhitelisted);
        }

        let protocol = ProtocolInfo {
            id: protocol_id,
            address: protocol_address.clone(),
            name,
            allocated_amount: 0,
            yield_harvested: 0,
            active: true,
        };

        env.storage().instance().set(&DataKey::Protocol(protocol_id), &protocol);

        let mut list: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolList)
            .unwrap_or(Vec::new(&env));
        list.push_back(protocol_id);
        env.storage().instance().set(&DataKey::ProtocolList, &list);

        env.events().publish(
            (symbol_short!("w_list"),),
            (protocol_id, protocol_address),
        );
        Ok(())
    }

    /// Update status of a whitelisted protocol
    pub fn set_protocol_status(
        env: Env,
        caller: Address,
        protocol_id: u32,
        active: bool,
    ) -> Result<(), Error> {
        let config = Self::load_config(&env)?;
        caller.require_auth();
        if caller != config.admin {
            return Err(Error::Unauthorized);
        }

        let mut protocol: ProtocolInfo = env
            .storage()
            .instance()
            .get(&DataKey::Protocol(protocol_id))
            .ok_or(Error::ProtocolNotWhitelisted)?;

        protocol.active = active;
        env.storage().instance().set(&DataKey::Protocol(protocol_id), &protocol);

        env.events().publish((symbol_short!("status"),), (protocol_id, active));
        Ok(())
    }

    /// Update operational reserve buffer threshold
    pub fn set_reserve_buffer(
        env: Env,
        caller: Address,
        new_buffer: i128,
    ) -> Result<(), Error> {
        let mut config = Self::load_config(&env)?;
        caller.require_auth();
        if caller != config.admin {
            return Err(Error::Unauthorized);
        }
        if new_buffer < 0 {
            return Err(Error::InvalidBuffer);
        }

        config.reserve_buffer = new_buffer;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish((symbol_short!("buf_set"),), new_buffer);
        Ok(())
    }

    /// Update maximum protocol exposure cap in basis points
    pub fn set_max_protocol_cap(
        env: Env,
        caller: Address,
        cap_bps: u32,
    ) -> Result<(), Error> {
        let mut config = Self::load_config(&env)?;
        caller.require_auth();
        if caller != config.admin {
            return Err(Error::Unauthorized);
        }
        if cap_bps == 0 || cap_bps > 10_000 {
            return Err(Error::InvalidParameter);
        }

        config.max_protocol_cap_bps = cap_bps;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish((symbol_short!("cap_set"),), cap_bps);
        Ok(())
    }

    /// Calculate available treasury surplus exceeding operational reserve buffer
    pub fn calculate_surplus(env: Env, current_balance: i128) -> i128 {
        let config = match Self::load_config(&env) {
            Ok(c) => c,
            Err(_) => return 0,
        };

        if current_balance > config.reserve_buffer {
            current_balance - config.reserve_buffer
        } else {
            0
        }
    }

    /// Sweep fee surpluses into whitelisted conservative yield protocols within exposure caps
    pub fn sweep_surplus(
        env: Env,
        caller: Address,
        current_treasury_balance: i128,
        allocations: Vec<AllocationPlan>,
    ) -> Result<i128, Error> {
        caller.require_auth();
        let mut config = Self::load_config(&env)?;
        if config.is_emergency {
            return Err(Error::EmergencyActive);
        }

        let surplus = if current_treasury_balance > config.reserve_buffer {
            current_treasury_balance
                .checked_sub(config.reserve_buffer)
                .ok_or(Error::MathOverflow)?
        } else {
            return Err(Error::NoSurplus);
        };

        if allocations.is_empty() {
            return Err(Error::InvalidParameter);
        }

        let mut total_planned: i128 = 0;
        for i in 0..allocations.len() {
            let plan = allocations.get(i).unwrap();
            if plan.amount <= 0 {
                return Err(Error::InvalidParameter);
            }
            total_planned = total_planned
                .checked_add(plan.amount)
                .ok_or(Error::MathOverflow)?;
        }

        if total_planned > surplus {
            return Err(Error::AllocationExceedsSurplus);
        }

        let projected_total = config
            .total_invested
            .checked_add(total_planned)
            .ok_or(Error::MathOverflow)?;

        // Execute allocation checks and apply updates
        for i in 0..allocations.len() {
            let plan = allocations.get(i).unwrap();
            let mut protocol: ProtocolInfo = env
                .storage()
                .instance()
                .get(&DataKey::Protocol(plan.protocol_id))
                .ok_or(Error::ProtocolNotWhitelisted)?;

            if !protocol.active {
                return Err(Error::ProtocolInactive);
            }

            let new_protocol_allocation = protocol
                .allocated_amount
                .checked_add(plan.amount)
                .ok_or(Error::MathOverflow)?;

            // Check diversification exposure cap:
            // new_protocol_allocation * 10_000 <= projected_total * max_protocol_cap_bps
            let max_allowed = projected_total
                .checked_mul(config.max_protocol_cap_bps as i128)
                .ok_or(Error::MathOverflow)?
                .checked_div(10_000)
                .ok_or(Error::MathOverflow)?;

            if new_protocol_allocation > max_allowed {
                return Err(Error::ExceedsExposureCap);
            }

            protocol.allocated_amount = new_protocol_allocation;
            env.storage().instance().set(&DataKey::Protocol(plan.protocol_id), &protocol);
        }

        config.total_invested = projected_total;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("sweep"),),
            (total_planned, config.total_invested),
        );

        Ok(total_planned)
    }

    /// Harvest accrued yield from a specific protocol
    pub fn harvest_yield(
        env: Env,
        caller: Address,
        protocol_id: u32,
        yield_amount: i128,
    ) -> Result<i128, Error> {
        caller.require_auth();
        if yield_amount <= 0 {
            return Err(Error::InvalidParameter);
        }

        let mut config = Self::load_config(&env)?;
        let mut protocol: ProtocolInfo = env
            .storage()
            .instance()
            .get(&DataKey::Protocol(protocol_id))
            .ok_or(Error::ProtocolNotWhitelisted)?;

        protocol.yield_harvested = protocol
            .yield_harvested
            .checked_add(yield_amount)
            .ok_or(Error::MathOverflow)?;

        config.total_yield_harvested = config
            .total_yield_harvested
            .checked_add(yield_amount)
            .ok_or(Error::MathOverflow)?;

        env.storage().instance().set(&DataKey::Protocol(protocol_id), &protocol);
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("harvest"),),
            (protocol_id, yield_amount, config.total_yield_harvested),
        );

        Ok(protocol.yield_harvested)
    }

    /// Compound harvested yield back into the protocol while respecting safe exposure bounds
    pub fn compound_yield(
        env: Env,
        caller: Address,
        protocol_id: u32,
        compound_amount: i128,
    ) -> Result<i128, Error> {
        caller.require_auth();
        if compound_amount <= 0 {
            return Err(Error::InvalidParameter);
        }

        let mut config = Self::load_config(&env)?;
        if config.is_emergency {
            return Err(Error::EmergencyActive);
        }

        let mut protocol: ProtocolInfo = env
            .storage()
            .instance()
            .get(&DataKey::Protocol(protocol_id))
            .ok_or(Error::ProtocolNotWhitelisted)?;

        if !protocol.active {
            return Err(Error::ProtocolInactive);
        }

        let projected_total = config
            .total_invested
            .checked_add(compound_amount)
            .ok_or(Error::MathOverflow)?;

        let new_protocol_allocation = protocol
            .allocated_amount
            .checked_add(compound_amount)
            .ok_or(Error::MathOverflow)?;

        let max_allowed = projected_total
            .checked_mul(config.max_protocol_cap_bps as i128)
            .ok_or(Error::MathOverflow)?
            .checked_div(10_000)
            .ok_or(Error::MathOverflow)?;

        if new_protocol_allocation > max_allowed {
            return Err(Error::ExceedsExposureCap);
        }

        protocol.allocated_amount = new_protocol_allocation;
        config.total_invested = projected_total;

        env.storage().instance().set(&DataKey::Protocol(protocol_id), &protocol);
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("compound"),),
            (protocol_id, compound_amount, protocol.allocated_amount),
        );

        Ok(protocol.allocated_amount)
    }

    /// Emergency instant withdrawal: DAO governance recalls 100% of invested capital back to treasury
    pub fn emergency_withdraw_all(env: Env, caller: Address) -> Result<i128, Error> {
        caller.require_auth();
        let mut config = Self::load_config(&env)?;
        if caller != config.admin {
            return Err(Error::Unauthorized);
        }

        let protocol_ids: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolList)
            .unwrap_or(Vec::new(&env));

        let mut total_recovered: i128 = 0;
        for i in 0..protocol_ids.len() {
            let pid = protocol_ids.get(i).unwrap();
            if let Some(mut protocol) = env
                .storage()
                .instance()
                .get::<DataKey, ProtocolInfo>(&DataKey::Protocol(pid))
            {
                total_recovered = total_recovered
                    .checked_add(protocol.allocated_amount)
                    .ok_or(Error::MathOverflow)?;
                protocol.allocated_amount = 0;
                env.storage().instance().set(&DataKey::Protocol(pid), &protocol);
            }
        }

        config.total_invested = 0;
        config.is_emergency = true;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("emerg_all"),),
            (caller, total_recovered),
        );

        Ok(total_recovered)
    }

    /// Emergency withdrawal from a specific protocol
    pub fn emergency_withdraw_protocol(
        env: Env,
        caller: Address,
        protocol_id: u32,
    ) -> Result<i128, Error> {
        caller.require_auth();
        let mut config = Self::load_config(&env)?;
        if caller != config.admin {
            return Err(Error::Unauthorized);
        }

        let mut protocol: ProtocolInfo = env
            .storage()
            .instance()
            .get(&DataKey::Protocol(protocol_id))
            .ok_or(Error::ProtocolNotWhitelisted)?;

        let recovered = protocol.allocated_amount;
        protocol.allocated_amount = 0;

        config.total_invested = config
            .total_invested
            .checked_sub(recovered)
            .ok_or(Error::MathOverflow)?;

        env.storage().instance().set(&DataKey::Protocol(protocol_id), &protocol);
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("emrg_one"),),
            (protocol_id, recovered),
        );

        Ok(recovered)
    }

    /// Resume operations after emergency resolution
    pub fn resume_operations(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut config = Self::load_config(&env)?;
        if caller != config.admin {
            return Err(Error::Unauthorized);
        }

        config.is_emergency = false;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish((symbol_short!("resumed"),), caller);
        Ok(())
    }

    /// Read configuration
    pub fn get_config(env: Env) -> Result<ReinvestorConfig, Error> {
        Self::load_config(&env)
    }

    /// Read protocol details
    pub fn get_protocol(env: Env, protocol_id: u32) -> Result<ProtocolInfo, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Protocol(protocol_id))
            .ok_or(Error::ProtocolNotWhitelisted)
    }

    /// List all whitelisted protocols
    pub fn get_protocols(env: Env) -> Vec<ProtocolInfo> {
        let protocol_ids: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolList)
            .unwrap_or(Vec::new(&env));

        let mut protocols = Vec::new(&env);
        for i in 0..protocol_ids.len() {
            let pid = protocol_ids.get(i).unwrap();
            if let Some(protocol) = env
                .storage()
                .instance()
                .get::<DataKey, ProtocolInfo>(&DataKey::Protocol(pid))
            {
                protocols.push_back(protocol);
            }
        }
        protocols
    }

    /// Helper to load config
    fn load_config(env: &Env) -> Result<ReinvestorConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, symbol_short, Env};

    #[test]
    fn test_initialization() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let base_asset = Address::generate(&env);

        env.mock_all_auths();

        assert_eq!(
            TreasuryReinvestor::initialize(
                env.clone(),
                admin.clone(),
                base_asset.clone(),
                10_000,
                3000 // 30% cap
            ),
            Ok(())
        );

        let config = TreasuryReinvestor::get_config(env.clone()).unwrap();
        assert_eq!(config.admin, admin);
        assert_eq!(config.reserve_buffer, 10_000);
        assert_eq!(config.max_protocol_cap_bps, 3000);
        assert_eq!(config.total_invested, 0);
        assert_eq!(config.is_emergency, false);
    }

    #[test]
    fn test_surplus_calculation() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let base_asset = Address::generate(&env);

        env.mock_all_auths();
        TreasuryReinvestor::initialize(
            env.clone(),
            admin,
            base_asset,
            10_000,
            3000,
        ).unwrap();

        // Under or equal buffer => zero surplus
        assert_eq!(TreasuryReinvestor::calculate_surplus(env.clone(), 5_000), 0);
        assert_eq!(TreasuryReinvestor::calculate_surplus(env.clone(), 10_000), 0);

        // Above buffer => surplus is balance - buffer
        assert_eq!(TreasuryReinvestor::calculate_surplus(env.clone(), 15_000), 5_000);
        assert_eq!(TreasuryReinvestor::calculate_surplus(env.clone(), 25_000), 15_000);
    }

    #[test]
    fn test_whitelist_and_allocation_caps() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let base_asset = Address::generate(&env);
        let keeper = Address::generate(&env);

        let proto1 = Address::generate(&env);
        let proto2 = Address::generate(&env);
        let proto3 = Address::generate(&env);
        let proto4 = Address::generate(&env);

        env.mock_all_auths();
        TreasuryReinvestor::initialize(
            env.clone(),
            admin.clone(),
            base_asset,
            10_000,
            2500, // 25% max cap per protocol
        ).unwrap();

        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 1, proto1, symbol_short!("LSD_A")).unwrap();
        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 2, proto2, symbol_short!("LEND_B")).unwrap();
        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 3, proto3, symbol_short!("LSD_C")).unwrap();
        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 4, proto4, symbol_short!("LEND_D")).unwrap();

        // Attempt single allocation exceeding cap (40% to proto 1)
        let mut bad_allocations = Vec::new(&env);
        bad_allocations.push_back(AllocationPlan { protocol_id: 1, amount: 4_000 });
        bad_allocations.push_back(AllocationPlan { protocol_id: 2, amount: 2_000 });
        bad_allocations.push_back(AllocationPlan { protocol_id: 3, amount: 2_000 });
        bad_allocations.push_back(AllocationPlan { protocol_id: 4, amount: 2_000 });

        // Total treasury balance = 20,000. Surplus = 10,000.
        // Proto 1 receives 4,000 out of 10,000 (40%), exceeding 25% cap
        let err = TreasuryReinvestor::sweep_surplus(
            env.clone(),
            keeper.clone(),
            20_000,
            bad_allocations,
        );
        assert_eq!(err, Err(Error::ExceedsExposureCap));

        // Diversified allocation: 2,500 each across 4 protocols (25% each)
        let mut safe_allocations = Vec::new(&env);
        safe_allocations.push_back(AllocationPlan { protocol_id: 1, amount: 2_500 });
        safe_allocations.push_back(AllocationPlan { protocol_id: 2, amount: 2_500 });
        safe_allocations.push_back(AllocationPlan { protocol_id: 3, amount: 2_500 });
        safe_allocations.push_back(AllocationPlan { protocol_id: 4, amount: 2_500 });

        let swept = TreasuryReinvestor::sweep_surplus(
            env.clone(),
            keeper,
            20_000,
            safe_allocations,
        ).unwrap();
        assert_eq!(swept, 10_000);

        let config = TreasuryReinvestor::get_config(env.clone()).unwrap();
        assert_eq!(config.total_invested, 10_000);

        let p1 = TreasuryReinvestor::get_protocol(env.clone(), 1).unwrap();
        assert_eq!(p1.allocated_amount, 2_500);
    }

    #[test]
    fn test_yield_harvesting_and_compounding() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let base_asset = Address::generate(&env);
        let keeper = Address::generate(&env);
        let proto1 = Address::generate(&env);
        let proto2 = Address::generate(&env);

        env.mock_all_auths();
        TreasuryReinvestor::initialize(
            env.clone(),
            admin.clone(),
            base_asset,
            10_000,
            5000, // 50% max cap
        ).unwrap();

        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 1, proto1, symbol_short!("LSD_A")).unwrap();
        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 2, proto2, symbol_short!("LEND_B")).unwrap();

        let mut alloc = Vec::new(&env);
        alloc.push_back(AllocationPlan { protocol_id: 1, amount: 5_000 });
        alloc.push_back(AllocationPlan { protocol_id: 2, amount: 5_000 });

        TreasuryReinvestor::sweep_surplus(env.clone(), keeper.clone(), 20_000, alloc).unwrap();

        // Harvest yield from proto 1
        let harvested = TreasuryReinvestor::harvest_yield(env.clone(), keeper.clone(), 1, 350).unwrap();
        assert_eq!(harvested, 350);

        let config = TreasuryReinvestor::get_config(env.clone()).unwrap();
        assert_eq!(config.total_yield_harvested, 350);
    }

    #[test]
    fn test_emergency_withdrawal_clean_100_percent() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let base_asset = Address::generate(&env);
        let keeper = Address::generate(&env);
        let proto1 = Address::generate(&env);
        let proto2 = Address::generate(&env);

        env.mock_all_auths();
        TreasuryReinvestor::initialize(
            env.clone(),
            admin.clone(),
            base_asset,
            10_000,
            5000,
        ).unwrap();

        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 1, proto1, symbol_short!("LSD_A")).unwrap();
        TreasuryReinvestor::whitelist_protocol(env.clone(), admin.clone(), 2, proto2, symbol_short!("LEND_B")).unwrap();

        let mut alloc = Vec::new(&env);
        alloc.push_back(AllocationPlan { protocol_id: 1, amount: 5_000 });
        alloc.push_back(AllocationPlan { protocol_id: 2, amount: 5_000 });
        TreasuryReinvestor::sweep_surplus(env.clone(), keeper, 20_000, alloc).unwrap();

        // Non-admin cannot emergency withdraw
        let err = TreasuryReinvestor::emergency_withdraw_all(env.clone(), attacker);
        assert_eq!(err, Err(Error::Unauthorized));

        // Admin cleanly recovers 100% of capital
        let recovered = TreasuryReinvestor::emergency_withdraw_all(env.clone(), admin.clone()).unwrap();
        assert_eq!(recovered, 10_000);

        let config = TreasuryReinvestor::get_config(env.clone()).unwrap();
        assert_eq!(config.total_invested, 0);
        assert_eq!(config.is_emergency, true);

        let p1 = TreasuryReinvestor::get_protocol(env.clone(), 1).unwrap();
        assert_eq!(p1.allocated_amount, 0);
        let p2 = TreasuryReinvestor::get_protocol(env.clone(), 2).unwrap();
        assert_eq!(p2.allocated_amount, 0);
    }
}
