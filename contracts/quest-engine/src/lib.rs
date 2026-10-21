// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    QuestNotFound = 4,
    QuestInactive = 5,
    QuestExpired = 6,
    PrerequisiteNotMet = 7,
    AlreadyClaimed = 8,
    InvalidOracle = 9,
    NonTransferableBadge = 10,
    BadgeNotFound = 11,
    InvalidParameters = 12,
    MathOverflow = 13,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuestCriteria {
    pub id: u32,
    pub title: String,
    pub description: String,
    pub xp_reward: u32,
    pub badge_name: String,
    pub prerequisite_quest_id: Option<u32>,
    pub is_seasonal: bool,
    pub season_deadline: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AchievementBadge {
    pub badge_id: u64,
    pub quest_id: u32,
    pub recipient: Address,
    pub name: String,
    pub xp_earned: u32,
    pub minted_at: u64,
    pub is_seasonal: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeveloperProfile {
    pub developer: Address,
    pub total_xp: u64,
    pub level: u32,
    pub title: Symbol,
    pub quests_completed: u32,
}

#[contracttype]
enum DataKey {
    Admin,
    Oracle,
    BadgeCount,
    Quest(u32),
    Badge(u64),
    UserBadges(Address),
    UserClaimed(Address, u32),
    UserProfile(Address),
}

#[contract]
pub struct QuestEngine;

#[contractimpl]
impl QuestEngine {
    /// Initialize the quest and achievement engine with admin and playground verification oracle
    pub fn initialize(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::BadgeCount, &0u64);

        env.events().publish((symbol_short!("init"),), (admin, oracle));
        Ok(())
    }

    /// Update playground verification oracle
    pub fn set_oracle(env: Env, caller: Address, new_oracle: Address) -> Result<(), Error> {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != admin {
            return Err(Error::Unauthorized);
        }

        env.storage().instance().set(&DataKey::Oracle, &new_oracle);
        env.events().publish((symbol_short!("set_orc"),), new_oracle);
        Ok(())
    }

    /// Define a new quest with criteria, prerequisite requirements, XP reward, and seasonal bounds
    pub fn define_quest(
        env: Env,
        caller: Address,
        quest_id: u32,
        title: String,
        description: String,
        xp_reward: u32,
        badge_name: String,
        prerequisite_quest_id: Option<u32>,
        is_seasonal: bool,
        season_deadline: u64,
    ) -> Result<(), Error> {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != admin {
            return Err(Error::Unauthorized);
        }

        if xp_reward == 0 {
            return Err(Error::InvalidParameters);
        }
        if is_seasonal && season_deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidParameters);
        }

        let criteria = QuestCriteria {
            id: quest_id,
            title,
            description,
            xp_reward,
            badge_name,
            prerequisite_quest_id,
            is_seasonal,
            season_deadline,
            active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Quest(quest_id), &criteria);

        env.events().publish(
            (symbol_short!("qst_def"),),
            (quest_id, xp_reward, is_seasonal),
        );

        Ok(())
    }

    /// Set quest active/inactive status
    pub fn set_quest_active(
        env: Env,
        caller: Address,
        quest_id: u32,
        active: bool,
    ) -> Result<(), Error> {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != admin {
            return Err(Error::Unauthorized);
        }

        let mut quest: QuestCriteria = env
            .storage()
            .persistent()
            .get(&DataKey::Quest(quest_id))
            .ok_or(Error::QuestNotFound)?;

        quest.active = active;
        env.storage()
            .persistent()
            .set(&DataKey::Quest(quest_id), &quest);

        env.events().publish((symbol_short!("qst_act"),), (quest_id, active));
        Ok(())
    }

    /// Verify cryptographic completion proof from oracle and mint non-transferable achievement badge
    pub fn claim_quest(
        env: Env,
        developer: Address,
        quest_id: u32,
    ) -> Result<u64, Error> {
        developer.require_auth();

        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .ok_or(Error::NotInitialized)?;
        // Cryptographic completion proof: Playground verification oracle must authenticate the completion
        oracle.require_auth();

        let quest: QuestCriteria = env
            .storage()
            .persistent()
            .get(&DataKey::Quest(quest_id))
            .ok_or(Error::QuestNotFound)?;

        if !quest.active {
            return Err(Error::QuestInactive);
        }

        // Seasonal deadline check
        let now = env.ledger().timestamp();
        if quest.is_seasonal && now > quest.season_deadline {
            return Err(Error::QuestExpired);
        }

        // Prevent double claiming
        if env
            .storage()
            .persistent()
            .has(&DataKey::UserClaimed(developer.clone(), quest_id))
        {
            return Err(Error::AlreadyClaimed);
        }

        // Prerequisite validation
        if let Some(prereq_id) = quest.prerequisite_quest_id {
            if !env
                .storage()
                .persistent()
                .has(&DataKey::UserClaimed(developer.clone(), prereq_id))
            {
                return Err(Error::PrerequisiteNotMet);
            }
        }

        // Record claim to prevent double-claiming
        env.storage()
            .persistent()
            .set(&DataKey::UserClaimed(developer.clone(), quest_id), &true);

        // Mint non-transferable achievement badge NFT
        let mut badge_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BadgeCount)
            .unwrap_or(0);
        badge_id = badge_id.checked_add(1).ok_or(Error::MathOverflow)?;

        let badge = AchievementBadge {
            badge_id,
            quest_id,
            recipient: developer.clone(),
            name: quest.badge_name.clone(),
            xp_earned: quest.xp_reward,
            minted_at: now,
            is_seasonal: quest.is_seasonal,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Badge(badge_id), &badge);

        let mut badges: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBadges(developer.clone()))
            .unwrap_or(Vec::new(&env));
        badges.push_back(badge_id);
        env.storage()
            .persistent()
            .set(&DataKey::UserBadges(developer.clone()), &badges);
        env.storage().instance().set(&DataKey::BadgeCount, &badge_id);

        // Update monotonic developer progression XP points and level
        let mut profile = Self::get_profile_internal(&env, &developer);
        profile.total_xp = profile
            .total_xp
            .checked_add(quest.xp_reward as u64)
            .ok_or(Error::MathOverflow)?;
        profile.quests_completed = profile
            .quests_completed
            .checked_add(1)
            .ok_or(Error::MathOverflow)?;

        let (new_level, new_title) = Self::compute_level_and_title(profile.total_xp);
        profile.level = new_level;
        profile.title = new_title;

        env.storage()
            .persistent()
            .set(&DataKey::UserProfile(developer.clone()), &profile);

        env.events().publish(
            (symbol_short!("claimed"),),
            (developer, quest_id, badge_id, profile.total_xp),
        );

        Ok(badge_id)
    }

    /// Attempt to transfer non-transferable badge (Strictly reverts as badges are soulbound)
    pub fn transfer_badge(
        _env: Env,
        _from: Address,
        _to: Address,
        _badge_id: u64,
    ) -> Result<(), Error> {
        Err(Error::NonTransferableBadge)
    }

    /// Read developer profile and progression
    pub fn get_profile(env: Env, developer: Address) -> DeveloperProfile {
        Self::get_profile_internal(&env, &developer)
    }

    /// Check if developer has claimed a specific quest
    pub fn has_claimed(env: Env, developer: Address, quest_id: u32) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::UserClaimed(developer, quest_id))
    }

    /// Query badge details
    pub fn get_badge(env: Env, badge_id: u64) -> Result<AchievementBadge, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Badge(badge_id))
            .ok_or(Error::BadgeNotFound)
    }

    /// Query quest criteria
    pub fn get_quest(env: Env, quest_id: u32) -> Result<QuestCriteria, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Quest(quest_id))
            .ok_or(Error::QuestNotFound)
    }

    /// Get all badge IDs owned by developer
    pub fn get_developer_badges(env: Env, developer: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::UserBadges(developer))
            .unwrap_or(Vec::new(&env))
    }

    /// Compute progression level (Level 1 Novice -> Level 50 Arch-Mage) based on total XP
    pub fn compute_level_and_title(total_xp: u64) -> (u32, Symbol) {
        // 100 XP per level, capped at Level 50 Arch-Mage
        let computed = 1 + (total_xp / 100);
        let level = if computed >= 50 { 50u32 } else { computed as u32 };

        let title = if level >= 50 {
            symbol_short!("ArchMage")
        } else if level >= 40 {
            symbol_short!("GrandMstr")
        } else if level >= 30 {
            symbol_short!("Master")
        } else if level >= 20 {
            symbol_short!("Adept")
        } else if level >= 10 {
            symbol_short!("Apprent")
        } else {
            symbol_short!("Novice")
        };

        (level, title)
    }

    fn get_profile_internal(env: &Env, developer: &Address) -> DeveloperProfile {
        env.storage()
            .persistent()
            .get(&DataKey::UserProfile(developer.clone()))
            .unwrap_or_else(|| {
                let (lvl, ttl) = Self::compute_level_and_title(0);
                DeveloperProfile {
                    developer: developer.clone(),
                    total_xp: 0,
                    level: lvl,
                    title: ttl,
                    quests_completed: 0,
                }
            })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, String, Env};

    #[test]
    fn test_initialization_and_quest_definition() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);

        env.mock_all_auths();
        QuestEngine::initialize(env.clone(), admin.clone(), oracle).unwrap();

        let title = String::from_str(&env, "First Contract");
        let desc = String::from_str(&env, "Deploy your first Soroban smart contract");
        let badge_name = String::from_str(&env, "Pioneer Badge");

        QuestEngine::define_quest(
            env.clone(),
            admin,
            1,
            title,
            desc,
            150, // 150 XP
            badge_name,
            None,
            false,
            0,
        ).unwrap();

        let quest = QuestEngine::get_quest(env.clone(), 1).unwrap();
        assert_eq!(quest.id, 1);
        assert_eq!(quest.xp_reward, 150);
        assert_eq!(quest.active, true);
    }

    #[test]
    fn test_claim_quest_and_badge_minting() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let developer = Address::generate(&env);

        env.mock_all_auths();
        QuestEngine::initialize(env.clone(), admin.clone(), oracle).unwrap();

        QuestEngine::define_quest(
            env.clone(),
            admin,
            1,
            String::from_str(&env, "Simulate 100 Txs"),
            String::from_str(&env, "Simulate 100 transactions in playground"),
            250,
            String::from_str(&env, "Simulator Master"),
            None,
            false,
            0,
        ).unwrap();

        // Developer claims quest with oracle verification
        let badge_id = QuestEngine::claim_quest(env.clone(), developer.clone(), 1).unwrap();
        assert_eq!(badge_id, 1);

        // Verify badge metadata
        let badge = QuestEngine::get_badge(env.clone(), badge_id).unwrap();
        assert_eq!(badge.recipient, developer);
        assert_eq!(badge.quest_id, 1);
        assert_eq!(badge.xp_earned, 250);

        // Badges are non-transferable soulbound tokens
        let transfer_err = QuestEngine::transfer_badge(
            env.clone(),
            developer.clone(),
            Address::generate(&env),
            badge_id,
        );
        assert_eq!(transfer_err, Err(Error::NonTransferableBadge));

        // Monotonic progression XP update
        let profile = QuestEngine::get_profile(env.clone(), developer.clone());
        assert_eq!(profile.total_xp, 250);
        assert_eq!(profile.quests_completed, 1);
        assert_eq!(profile.level, 3); // 1 + 250/100 = 3
        assert_eq!(profile.title, symbol_short!("Novice"));
    }

    #[test]
    fn test_prevent_double_claiming() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let developer = Address::generate(&env);

        env.mock_all_auths();
        QuestEngine::initialize(env.clone(), admin.clone(), oracle).unwrap();

        QuestEngine::define_quest(
            env.clone(),
            admin,
            1,
            String::from_str(&env, "Audit Passed"),
            String::from_str(&env, "Pass automated audit check"),
            500,
            String::from_str(&env, "Security Guardian"),
            None,
            false,
            0,
        ).unwrap();

        // First claim succeeds
        QuestEngine::claim_quest(env.clone(), developer.clone(), 1).unwrap();

        // Second claim rejected
        let err = QuestEngine::claim_quest(env.clone(), developer, 1);
        assert_eq!(err, Err(Error::AlreadyClaimed));
    }

    #[test]
    fn test_seasonal_quest_deadline_expiration() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let developer = Address::generate(&env);

        env.mock_all_auths();
        QuestEngine::initialize(env.clone(), admin.clone(), oracle).unwrap();

        let start_time = 1_000;
        env.ledger().set_timestamp(start_time);
        let deadline = start_time + 100;

        QuestEngine::define_quest(
            env.clone(),
            admin,
            10,
            String::from_str(&env, "Summer Hackathon Quest"),
            String::from_str(&env, "Limited edition seasonal quest"),
            1_000,
            String::from_str(&env, "Summer 2026 Champion"),
            None,
            true, // seasonal
            deadline,
        ).unwrap();

        // Move ledger past deadline
        env.ledger().set_timestamp(deadline + 1);

        let err = QuestEngine::claim_quest(env.clone(), developer, 10);
        assert_eq!(err, Err(Error::QuestExpired));
    }

    #[test]
    fn test_progression_level_arch_mage() {
        // Test progression calculation up to Level 50 Arch-Mage
        let (lvl_0, title_0) = QuestEngine::compute_level_and_title(0);
        assert_eq!(lvl_0, 1);
        assert_eq!(title_0, symbol_short!("Novice"));

        let (lvl_10, title_10) = QuestEngine::compute_level_and_title(1_000);
        assert_eq!(lvl_10, 11);
        assert_eq!(title_10, symbol_short!("Apprent"));

        let (lvl_20, title_20) = QuestEngine::compute_level_and_title(2_000);
        assert_eq!(lvl_20, 21);
        assert_eq!(title_20, symbol_short!("Adept"));

        let (lvl_30, title_30) = QuestEngine::compute_level_and_title(3_000);
        assert_eq!(lvl_30, 31);
        assert_eq!(title_30, symbol_short!("Master"));

        let (lvl_40, title_40) = QuestEngine::compute_level_and_title(4_000);
        assert_eq!(lvl_40, 41);
        assert_eq!(title_40, symbol_short!("GrandMstr"));

        let (lvl_50, title_50) = QuestEngine::compute_level_and_title(5_000);
        assert_eq!(lvl_50, 50);
        assert_eq!(title_50, symbol_short!("ArchMage"));

        // Cap at 50
        let (lvl_max, _) = QuestEngine::compute_level_and_title(100_000);
        assert_eq!(lvl_max, 50);
    }
}
