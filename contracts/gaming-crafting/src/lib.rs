// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Gaming Item Crafting & Durability Degradation Engine
//!
//! An on-chain Soroban smart contract that models:
//! - **Item definitions** – base stats, category, and max durability.
//! - **Recipes** – ordered ingredient lists, level & soulbound achievement
//!   prerequisites, and stochastic success / rare drop rates.
//! - **Player inventories** – items owned by each player address.
//! - **Commit-reveal crafting** – atomically validates prerequisites and burns
//!   input materials during the commitment phase (`commit_craft`), then
//!   derives unbiased SHA-256 randomness during the reveal phase
//!   (`reveal_craft`) after a minimum ledger delay.
//! - **Durability degradation** – items lose durability each time they are used;
//!   when durability reaches zero the item is destroyed.
//!
//! ## Commit-Reveal Randomness
//! To prevent players and validators from predicting crafting outcomes or
//! selectively reverting transactions:
//! 1. The player commits `commitment = sha256(secret)` via `commit_craft`.
//!    All prerequisites (level, soulbound achievements, materials) are
//!    validated atomically and input materials are burned immediately.
//! 2. After at least `MIN_REVEAL_DELAY` ledgers (and before `reveal_deadline`),
//!    the player reveals `secret` via `reveal_craft`.
//! 3. Entropy is derived from `sha256(secret || commit_id || commit_ledger ||
//!    reveal_ledger || recipe_id)` and expanded with domain-separated SHA-256
//!    streams for success, rare drop, and attribute rolls.
//!
//! ## Storage layout
//! | Key pattern                        | Value             |
//! |------------------------------------|-------------------|
//! | `(ADMIN,)`                         | `Address`         |
//! | `(PAUSED,)`                        | `bool`            |
//! | `(ITEM_DEF, item_def_id)`          | `ItemDef`         |
//! | `(ITEM_DEF_COUNT,)`                | `u32`             |
//! | `(RECIPE, recipe_id)`              | `Recipe`          |
//! | `(RECIPE_COUNT,)`                  | `u32`             |
//! | `(INV, player, slot_index)`        | `ItemInstance`    |
//! | `(INV_SIZE, player)`               | `u32`             |
//! | `(LVL, player)`                    | `u32`             |
//! | `(ACH, player, achievement_id)`    | `bool`            |
//! | `(COMMIT, commit_id)`              | `CraftCommitment` |
//! | `(COMMIT_CNT,)`                    | `u32`             |
//!
//! ## Events
//! `init`, `paused`, `unpaused`, `item_def`, `recipe`, `c_commit`, `crafted`,
//! `c_failed`, `used`, `destroyed`, `granted`

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, Bytes, BytesN,
    Env, Symbol, Vec,
};

// ── Error codes ───────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract was already initialised.
    AlreadyInitialized = 1,
    /// Contract is paused.
    Paused = 2,
    /// Caller is not authorized for this action.
    Unauthorized = 3,
    /// Requested item definition does not exist.
    ItemDefNotFound = 4,
    /// Requested recipe does not exist.
    RecipeNotFound = 5,
    /// Player does not own a required ingredient.
    MissingIngredient = 6,
    /// Crafting would exceed the player's inventory capacity.
    InventoryFull = 7,
    /// Requested inventory slot is empty.
    SlotEmpty = 8,
    /// Item's durability is already zero.
    ItemBroken = 9,
    /// Contract was not yet initialised.
    NotInitialized = 10,
    /// A recipe ingredient list is empty.
    EmptyRecipe = 11,
    /// Item definition name is empty.
    EmptyName = 12,
    /// Player's level is below the recipe's minimum level requirement.
    InsufficientLevel = 13,
    /// Player does not hold a required soulbound achievement.
    MissingAchievement = 14,
    /// Requested craft commitment does not exist.
    CommitmentNotFound = 15,
    /// Craft commitment has already been revealed.
    CommitmentAlreadyRevealed = 16,
    /// Reveal attempted before the minimum ledger delay has elapsed.
    RevealTooEarly = 17,
    /// Reveal attempted after the commitment's reveal deadline.
    RevealExpired = 18,
    /// Revealed secret does not match the stored commitment hash.
    InvalidReveal = 19,
    /// Success rate or rare drop rate exceeds 100.
    InvalidRate = 20,
}

// ── Domain types ──────────────────────────────────────────────────────────────

/// Category tag for an item.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ItemCategory {
    Weapon,
    Armour,
    Consumable,
    Accessory,
    Material,
}

/// Immutable blueprint for a class of items.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ItemDef {
    /// Auto-assigned identifier.
    pub id: u32,
    /// Display name (max ~64 chars recommended).
    pub name: Symbol,
    pub category: ItemCategory,
    /// Maximum durability when newly crafted / found.
    pub max_durability: u32,
    /// Base attack stat (before random roll).
    pub base_attack: u32,
    /// Base defence stat.
    pub base_defence: u32,
    /// Base speed stat.
    pub base_speed: u32,
    /// Base magic stat.
    pub base_magic: u32,
    /// Each rolled stat is drawn from `[base, base + stat_range]`.
    pub stat_range: u32,
}

/// A crafting recipe: burns the listed item definition IDs and produces
/// `output_item_def_id` subject to prerequisites and stochastic rates.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Recipe {
    /// Auto-assigned identifier.
    pub id: u32,
    /// Item definition IDs of required ingredients.
    pub ingredients: Vec<u32>,
    /// Definition ID of the item produced.
    pub output_item_def_id: u32,
    /// Minimum player level required to craft this recipe.
    pub min_level: u32,
    /// Soulbound achievement IDs required to craft this recipe.
    pub required_achievements: Vec<u32>,
    /// Probability of crafting success in `[0, 100]` (percent).
    pub success_rate: u32,
    /// Probability of a rare item drop upon success in `[0, 100]` (percent).
    pub rare_drop_rate: u32,
}

/// A concrete item instance owned by a player.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ItemInstance {
    /// References the `ItemDef` that defines this item's type.
    pub item_def_id: u32,
    /// Remaining uses before the item is destroyed.
    pub durability: u32,
    /// Rolled attack value (may exceed base_attack).
    pub attack: u32,
    /// Rolled defence value.
    pub defence: u32,
    /// Rolled speed value.
    pub speed: u32,
    /// Rolled magic value.
    pub magic: u32,
    /// Whether this item was rolled as a rare drop.
    pub is_rare: bool,
}

/// Stored commitment for a two-phase commit-reveal crafting operation.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CraftCommitment {
    /// Auto-assigned commitment identifier.
    pub id: u32,
    /// Player who submitted the commitment and burned the ingredients.
    pub player: Address,
    /// Recipe being crafted.
    pub recipe_id: u32,
    /// SHA-256 hash of the player's 32-byte secret.
    pub commitment: BytesN<32>,
    /// Ledger sequence at which the commitment was recorded.
    pub commit_ledger: u32,
    /// Last ledger sequence at which this commitment may be revealed.
    pub reveal_deadline: u32,
    /// Whether this commitment has already been revealed.
    pub revealed: bool,
}

/// Result returned by `reveal_craft`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CraftOutcome {
    /// Whether the crafting roll succeeded.
    pub succeeded: bool,
    /// Whether a rare item drop was rolled (always `false` if `!succeeded`).
    pub is_rare: bool,
    /// Inventory slot index of the newly minted item, if `succeeded`.
    pub slot: Option<u32>,
}

// ── Storage keys & constants ──────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const ITEM_DEF: Symbol = symbol_short!("ITEM_DEF");
const ITEM_DEF_CNT: Symbol = symbol_short!("ID_CNT");
const RECIPE: Symbol = symbol_short!("RECIPE");
const RECIPE_CNT: Symbol = symbol_short!("RC_CNT");
const INV: Symbol = symbol_short!("INV");
const INV_SIZE: Symbol = symbol_short!("INV_SZ");
const LVL: Symbol = symbol_short!("LVL");
const ACH: Symbol = symbol_short!("ACH");
const COMMIT: Symbol = symbol_short!("COMMIT");
const COMMIT_CNT: Symbol = symbol_short!("CM_CNT");

const MAX_INVENTORY: u32 = 100;
/// Minimum number of ledgers between `commit_craft` and `reveal_craft`.
pub const MIN_REVEAL_DELAY: u32 = 1;
/// Maximum number of ledgers after `commit_craft` during which reveal is valid.
pub const REVEAL_WINDOW: u32 = 100;

// ── Storage helpers ───────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&ADMIN).unwrap()
}

fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&ADMIN)
}

fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&PAUSED).unwrap_or(false)
}

fn require_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        Err(Error::Paused)
    } else {
        Ok(())
    }
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env) != *caller {
        Err(Error::Unauthorized)
    } else {
        Ok(())
    }
}

fn get_item_def_count(env: &Env) -> u32 {
    env.storage().instance().get(&ITEM_DEF_CNT).unwrap_or(0)
}

fn get_recipe_count(env: &Env) -> u32 {
    env.storage().instance().get(&RECIPE_CNT).unwrap_or(0)
}

fn get_commit_count(env: &Env) -> u32 {
    env.storage().instance().get(&COMMIT_CNT).unwrap_or(0)
}

fn get_item_def(env: &Env, id: u32) -> Result<ItemDef, Error> {
    env.storage()
        .persistent()
        .get(&(ITEM_DEF, id))
        .ok_or(Error::ItemDefNotFound)
}

fn get_recipe(env: &Env, id: u32) -> Result<Recipe, Error> {
    env.storage()
        .persistent()
        .get(&(RECIPE, id))
        .ok_or(Error::RecipeNotFound)
}

fn get_commitment_internal(env: &Env, id: u32) -> Result<CraftCommitment, Error> {
    env.storage()
        .persistent()
        .get(&(COMMIT, id))
        .ok_or(Error::CommitmentNotFound)
}

fn get_inv_size(env: &Env, player: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&(INV_SIZE, player.clone()))
        .unwrap_or(0)
}

fn get_inv_slot(env: &Env, player: &Address, slot: u32) -> Option<ItemInstance> {
    env.storage().persistent().get(&(INV, player.clone(), slot))
}

fn set_inv_slot(env: &Env, player: &Address, slot: u32, item: &ItemInstance) {
    env.storage()
        .persistent()
        .set(&(INV, player.clone(), slot), item);
}

fn remove_inv_slot(env: &Env, player: &Address, slot: u32) {
    env.storage()
        .persistent()
        .remove(&(INV, player.clone(), slot));
}

fn get_player_level_internal(env: &Env, player: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&(LVL, player.clone()))
        .unwrap_or(0)
}

fn has_player_achievement_internal(env: &Env, player: &Address, achievement_id: u32) -> bool {
    env.storage()
        .persistent()
        .get(&(ACH, player.clone(), achievement_id))
        .unwrap_or(false)
}

fn slot_already_matched(matched: &Vec<u32>, slot: u32) -> bool {
    for i in 0..matched.len() {
        if matched.get_unchecked(i) == slot {
            return true;
        }
    }
    false
}

// ── Cryptographic commit-reveal RNG helpers ───────────────────────────────────

/// Compute the commitment hash `sha256(secret)` for a 32-byte secret.
pub fn compute_commitment(env: &Env, secret: &BytesN<32>) -> BytesN<32> {
    let preimage = Bytes::from_slice(env, &secret.to_array());
    env.crypto().sha256(&preimage).into()
}

/// Derive a 32-byte cryptographic entropy seed by hashing the revealed secret
/// together with the commitment ID, commit ledger, reveal ledger, and recipe ID.
fn derive_reveal_entropy(
    env: &Env,
    secret: &BytesN<32>,
    commit_id: u32,
    commit_ledger: u32,
    reveal_ledger: u32,
    recipe_id: u32,
) -> BytesN<32> {
    let mut buf = [0u8; 48];
    buf[0..32].copy_from_slice(&secret.to_array());
    buf[32..36].copy_from_slice(&commit_id.to_be_bytes());
    buf[36..40].copy_from_slice(&commit_ledger.to_be_bytes());
    buf[40..44].copy_from_slice(&reveal_ledger.to_be_bytes());
    buf[44..48].copy_from_slice(&recipe_id.to_be_bytes());
    let bytes = Bytes::from_slice(env, &buf);
    env.crypto().sha256(&bytes).into()
}

/// Derive deterministic entropy for admin-initiated item grants.
fn derive_admin_entropy(env: &Env, item_def_id: u32, inv_size: u32, ledger_seq: u32) -> BytesN<32> {
    let mut buf = [0u8; 12];
    buf[0..4].copy_from_slice(&item_def_id.to_be_bytes());
    buf[4..8].copy_from_slice(&inv_size.to_be_bytes());
    buf[8..12].copy_from_slice(&ledger_seq.to_be_bytes());
    let bytes = Bytes::from_slice(env, &buf);
    env.crypto().sha256(&bytes).into()
}

/// Produce a uniformly distributed value in `[0, bound)` using domain-separated
/// SHA-256 expansion (`sha256(entropy || stream_index)`).
///
/// Returns `0` when `bound <= 1`.
pub fn uniform_roll(env: &Env, entropy: &BytesN<32>, stream_index: u32, bound: u32) -> u32 {
    if bound <= 1 {
        return 0;
    }
    let mut buf = [0u8; 36];
    buf[0..32].copy_from_slice(&entropy.to_array());
    buf[32..36].copy_from_slice(&stream_index.to_be_bytes());
    let digest: BytesN<32> = env.crypto().sha256(&Bytes::from_slice(env, &buf)).into();
    let raw = digest.to_array();
    let sample = u64::from_be_bytes([
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
    ]);
    (sample % (bound as u64)) as u32
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct GamingCrafting;

#[contractimpl]
impl GamingCrafting {
    // ── Administration ────────────────────────────────────────────────────────

    /// Initialise the contract. Can only be called once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&ITEM_DEF_CNT, &0u32);
        env.storage().instance().set(&RECIPE_CNT, &0u32);
        env.storage().instance().set(&COMMIT_CNT, &0u32);
        env.events()
            .publish((symbol_short!("init"),), admin.clone());
        Ok(())
    }

    /// Pause or unpause the contract. Admin only.
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage().instance().set(&PAUSED, &paused);
        let evt = if paused {
            symbol_short!("paused")
        } else {
            symbol_short!("unpaused")
        };
        env.events().publish((evt,), admin);
        Ok(())
    }

    // ── Player progression & soulbound achievements ───────────────────────────

    /// Set a player's crafting level. Admin only.
    pub fn set_player_level(
        env: Env,
        admin: Address,
        player: Address,
        level: u32,
    ) -> Result<(), Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage().persistent().set(&(LVL, player), &level);
        Ok(())
    }

    /// Query a player's current crafting level.
    pub fn get_player_level(env: Env, player: Address) -> u32 {
        get_player_level_internal(&env, &player)
    }

    /// Grant a non-transferable (soulbound) achievement to a player. Admin only.
    pub fn grant_achievement(
        env: Env,
        admin: Address,
        player: Address,
        achievement_id: u32,
    ) -> Result<(), Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&(ACH, player, achievement_id), &true);
        Ok(())
    }

    /// Check whether a player holds a given soulbound achievement.
    pub fn has_achievement(env: Env, player: Address, achievement_id: u32) -> bool {
        has_player_achievement_internal(&env, &player, achievement_id)
    }

    // ── Item definitions ──────────────────────────────────────────────────────

    /// Register a new item definition. Returns the assigned `item_def_id`.
    pub fn add_item_def(
        env: Env,
        admin: Address,
        name: Symbol,
        category: ItemCategory,
        max_durability: u32,
        base_attack: u32,
        base_defence: u32,
        base_speed: u32,
        base_magic: u32,
        stat_range: u32,
    ) -> Result<u32, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let id = get_item_def_count(&env);
        let def = ItemDef {
            id,
            name: name.clone(),
            category,
            max_durability,
            base_attack,
            base_defence,
            base_speed,
            base_magic,
            stat_range,
        };
        env.storage().persistent().set(&(ITEM_DEF, id), &def);
        env.storage().instance().set(&ITEM_DEF_CNT, &(id + 1));

        env.events()
            .publish((symbol_short!("item_def"),), (id, name));
        Ok(id)
    }

    /// Retrieve an item definition by ID.
    pub fn get_item_def(env: Env, item_def_id: u32) -> Result<ItemDef, Error> {
        get_item_def(&env, item_def_id)
    }

    /// Total number of registered item definitions.
    pub fn item_def_count(env: Env) -> u32 {
        get_item_def_count(&env)
    }

    // ── Recipes ───────────────────────────────────────────────────────────────

    /// Register a crafting recipe with default prerequisites (`min_level = 0`,
    /// no required achievements, `success_rate = 100`, `rare_drop_rate = 0`).
    pub fn add_recipe(
        env: Env,
        admin: Address,
        ingredients: Vec<u32>,
        output_item_def_id: u32,
    ) -> Result<u32, Error> {
        let empty_achs = vec![&env];
        Self::add_recipe_with_prereqs(
            env,
            admin,
            ingredients,
            output_item_def_id,
            0,
            empty_achs,
            100,
            0,
        )
    }

    /// Register a crafting recipe with explicit level & soulbound achievement
    /// prerequisites and stochastic success / rare drop rates (`0..=100`).
    pub fn add_recipe_with_prereqs(
        env: Env,
        admin: Address,
        ingredients: Vec<u32>,
        output_item_def_id: u32,
        min_level: u32,
        required_achievements: Vec<u32>,
        success_rate: u32,
        rare_drop_rate: u32,
    ) -> Result<u32, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        if ingredients.is_empty() {
            return Err(Error::EmptyRecipe);
        }
        if success_rate > 100 || rare_drop_rate > 100 {
            return Err(Error::InvalidRate);
        }
        // Validate output item exists.
        get_item_def(&env, output_item_def_id)?;
        // Validate each ingredient item exists.
        for i in 0..ingredients.len() {
            get_item_def(&env, ingredients.get_unchecked(i))?;
        }

        let id = get_recipe_count(&env);
        let recipe = Recipe {
            id,
            ingredients,
            output_item_def_id,
            min_level,
            required_achievements,
            success_rate,
            rare_drop_rate,
        };
        env.storage().persistent().set(&(RECIPE, id), &recipe);
        env.storage().instance().set(&RECIPE_CNT, &(id + 1));

        env.events()
            .publish((symbol_short!("recipe"),), (id, output_item_def_id));
        Ok(id)
    }

    /// Retrieve a recipe by ID.
    pub fn get_recipe(env: Env, recipe_id: u32) -> Result<Recipe, Error> {
        get_recipe(&env, recipe_id)
    }

    /// Total number of registered recipes.
    pub fn recipe_count(env: Env) -> u32 {
        get_recipe_count(&env)
    }

    // ── Commit-Reveal Crafting ────────────────────────────────────────────────

    /// Phase 1 of crafting: atomically validate all recipe prerequisites
    /// (player level, soulbound achievements, required materials, and inventory
    /// capacity), **burn** the input crafting materials immediately, and record
    /// the player's `commitment = sha256(secret)`.
    ///
    /// Returns the assigned `commit_id`.
    pub fn commit_craft(
        env: Env,
        player: Address,
        recipe_id: u32,
        commitment: BytesN<32>,
    ) -> Result<u32, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        player.require_auth();

        // ── Atomic prerequisite validation (no state mutated yet) ─────────────
        let recipe = get_recipe(&env, recipe_id)?;
        get_item_def(&env, recipe.output_item_def_id)?;

        // 1. Level prerequisite.
        if get_player_level_internal(&env, &player) < recipe.min_level {
            return Err(Error::InsufficientLevel);
        }

        // 2. Soulbound achievement prerequisites.
        for i in 0..recipe.required_achievements.len() {
            let ach_id = recipe.required_achievements.get_unchecked(i);
            if !has_player_achievement_internal(&env, &player, ach_id) {
                return Err(Error::MissingAchievement);
            }
        }

        // 3. Material prerequisites (resolve distinct slots before burning).
        let inv_size = get_inv_size(&env, &player);
        let mut matched_slots: Vec<u32> = vec![&env];
        for i in 0..recipe.ingredients.len() {
            let needed_def = recipe.ingredients.get_unchecked(i);
            let mut found_slot: Option<u32> = None;
            for slot in 0..inv_size {
                if slot_already_matched(&matched_slots, slot) {
                    continue;
                }
                if let Some(item) = get_inv_slot(&env, &player, slot) {
                    if item.item_def_id == needed_def {
                        found_slot = Some(slot);
                        break;
                    }
                }
            }
            match found_slot {
                Some(s) => matched_slots.push_back(s),
                None => return Err(Error::MissingIngredient),
            }
        }

        // 4. Inventory capacity check (accounting for burned ingredients).
        let remaining_after_burn = inv_size - matched_slots.len();
        if remaining_after_burn >= MAX_INVENTORY {
            return Err(Error::InventoryFull);
        }

        // ── Burn input materials & compact inventory ──────────────────────────
        for i in 0..matched_slots.len() {
            remove_inv_slot(&env, &player, matched_slots.get_unchecked(i));
        }

        let mut compact: Vec<ItemInstance> = vec![&env];
        for slot in 0..inv_size {
            if let Some(item) = get_inv_slot(&env, &player, slot) {
                compact.push_back(item);
            }
        }
        for slot in 0..inv_size {
            remove_inv_slot(&env, &player, slot);
        }
        let new_size = compact.len();
        for idx in 0..new_size {
            set_inv_slot(&env, &player, idx, &compact.get_unchecked(idx));
        }
        env.storage()
            .persistent()
            .set(&(INV_SIZE, player.clone()), &new_size);

        // ── Record commitment ─────────────────────────────────────────────────
        let commit_id = get_commit_count(&env);
        let commit_ledger = env.ledger().sequence();
        let reveal_deadline = commit_ledger.saturating_add(REVEAL_WINDOW);
        let record = CraftCommitment {
            id: commit_id,
            player: player.clone(),
            recipe_id,
            commitment,
            commit_ledger,
            reveal_deadline,
            revealed: false,
        };
        env.storage()
            .persistent()
            .set(&(COMMIT, commit_id), &record);
        env.storage().instance().set(&COMMIT_CNT, &(commit_id + 1));

        env.events().publish(
            (symbol_short!("c_commit"),),
            (player, commit_id, recipe_id, commit_ledger),
        );
        Ok(commit_id)
    }

    /// Phase 2 of crafting: verify the revealed `secret` against the stored
    /// commitment after `MIN_REVEAL_DELAY` ledgers, derive unbiased SHA-256
    /// randomness, and resolve crafting success, rare drop, and item stats.
    pub fn reveal_craft(
        env: Env,
        player: Address,
        commit_id: u32,
        secret: BytesN<32>,
    ) -> Result<CraftOutcome, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        player.require_auth();

        let mut commit = get_commitment_internal(&env, commit_id)?;
        if commit.player != player {
            return Err(Error::Unauthorized);
        }
        if commit.revealed {
            return Err(Error::CommitmentAlreadyRevealed);
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger < commit.commit_ledger.saturating_add(MIN_REVEAL_DELAY) {
            return Err(Error::RevealTooEarly);
        }
        if current_ledger > commit.reveal_deadline {
            return Err(Error::RevealExpired);
        }

        if compute_commitment(&env, &secret) != commit.commitment {
            return Err(Error::InvalidReveal);
        }

        // Mark revealed before minting to prevent replay.
        commit.revealed = true;
        env.storage()
            .persistent()
            .set(&(COMMIT, commit_id), &commit);

        let recipe = get_recipe(&env, commit.recipe_id)?;
        let output_def = get_item_def(&env, recipe.output_item_def_id)?;

        let entropy = derive_reveal_entropy(
            &env,
            &secret,
            commit_id,
            commit.commit_ledger,
            current_ledger,
            commit.recipe_id,
        );

        let success_roll = uniform_roll(&env, &entropy, 0, 100);
        if success_roll >= recipe.success_rate {
            env.events().publish(
                (symbol_short!("c_failed"),),
                (player, commit_id, commit.recipe_id),
            );
            return Ok(CraftOutcome {
                succeeded: false,
                is_rare: false,
                slot: None,
            });
        }

        let inv_size = get_inv_size(&env, &player);
        if inv_size >= MAX_INVENTORY {
            return Err(Error::InventoryFull);
        }

        let rare_roll = uniform_roll(&env, &entropy, 1, 100);
        let is_rare = rare_roll < recipe.rare_drop_rate;

        let stat_bound = output_def.stat_range.saturating_add(1);
        let crafted = ItemInstance {
            item_def_id: output_def.id,
            durability: output_def.max_durability,
            attack: output_def.base_attack + uniform_roll(&env, &entropy, 2, stat_bound),
            defence: output_def.base_defence + uniform_roll(&env, &entropy, 3, stat_bound),
            speed: output_def.base_speed + uniform_roll(&env, &entropy, 4, stat_bound),
            magic: output_def.base_magic + uniform_roll(&env, &entropy, 5, stat_bound),
            is_rare,
        };

        set_inv_slot(&env, &player, inv_size, &crafted);
        env.storage()
            .persistent()
            .set(&(INV_SIZE, player.clone()), &(inv_size + 1));

        env.events().publish(
            (symbol_short!("crafted"),),
            (player, commit.recipe_id, output_def.id, inv_size, is_rare),
        );
        Ok(CraftOutcome {
            succeeded: true,
            is_rare,
            slot: Some(inv_size),
        })
    }

    /// Retrieve a stored craft commitment by ID.
    pub fn get_commitment(env: Env, commit_id: u32) -> Result<CraftCommitment, Error> {
        get_commitment_internal(&env, commit_id)
    }

    // ── Item usage & durability ───────────────────────────────────────────────

    /// Use the item at `slot` in the caller's inventory, reducing its
    /// durability by `uses` (default: 1). If durability reaches zero the item
    /// is destroyed and the inventory is compacted.
    ///
    /// Returns the remaining durability (0 means the item was just destroyed).
    pub fn use_item(env: Env, player: Address, slot: u32, uses: u32) -> Result<u32, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        player.require_auth();

        let mut item = get_inv_slot(&env, &player, slot).ok_or(Error::SlotEmpty)?;
        if item.durability == 0 {
            return Err(Error::ItemBroken);
        }

        let actual_uses = uses.max(1);
        let remaining = item.durability.saturating_sub(actual_uses);

        if remaining == 0 {
            // Destroy item and compact inventory.
            let inv_size = get_inv_size(&env, &player);
            remove_inv_slot(&env, &player, slot);

            let mut compacted: Vec<ItemInstance> = vec![&env];
            for s in 0..inv_size {
                if s == slot {
                    continue;
                }
                if let Some(i) = get_inv_slot(&env, &player, s) {
                    compacted.push_back(i);
                }
            }
            for s in 0..inv_size {
                remove_inv_slot(&env, &player, s);
            }
            let new_size = compacted.len();
            for idx in 0..new_size {
                set_inv_slot(&env, &player, idx, &compacted.get_unchecked(idx));
            }
            env.storage()
                .persistent()
                .set(&(INV_SIZE, player.clone()), &new_size);

            env.events().publish(
                (symbol_short!("destroyed"),),
                (player, item.item_def_id, slot),
            );
            return Ok(0);
        }

        item.durability = remaining;
        set_inv_slot(&env, &player, slot, &item);

        env.events()
            .publish((symbol_short!("used"),), (player, slot, remaining));
        Ok(remaining)
    }

    // ── Inventory queries ─────────────────────────────────────────────────────

    /// Return the number of items in the player's inventory.
    pub fn inventory_size(env: Env, player: Address) -> u32 {
        get_inv_size(&env, &player)
    }

    /// Return the item at a specific inventory slot.
    pub fn get_item(env: Env, player: Address, slot: u32) -> Result<ItemInstance, Error> {
        get_inv_slot(&env, &player, slot).ok_or(Error::SlotEmpty)
    }

    // ── Admin: grant item ─────────────────────────────────────────────────────

    /// Admin may grant an item directly to a player (e.g. for onboarding or
    /// rewards).
    pub fn grant_item(
        env: Env,
        admin: Address,
        player: Address,
        item_def_id: u32,
    ) -> Result<u32, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        require_not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let def = get_item_def(&env, item_def_id)?;
        let inv_size = get_inv_size(&env, &player);
        if inv_size >= MAX_INVENTORY {
            return Err(Error::InventoryFull);
        }

        let entropy = derive_admin_entropy(&env, def.id, inv_size, env.ledger().sequence());
        let stat_bound = def.stat_range.saturating_add(1);
        let item = ItemInstance {
            item_def_id: def.id,
            durability: def.max_durability,
            attack: def.base_attack + uniform_roll(&env, &entropy, 0, stat_bound),
            defence: def.base_defence + uniform_roll(&env, &entropy, 1, stat_bound),
            speed: def.base_speed + uniform_roll(&env, &entropy, 2, stat_bound),
            magic: def.base_magic + uniform_roll(&env, &entropy, 3, stat_bound),
            is_rare: false,
        };

        set_inv_slot(&env, &player, inv_size, &item);
        env.storage()
            .persistent()
            .set(&(INV_SIZE, player.clone()), &(inv_size + 1));

        env.events()
            .publish((symbol_short!("granted"),), (player, item_def_id, inv_size));
        Ok(inv_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup() -> (Env, GamingCraftingClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, GamingCrafting);
        let client = GamingCraftingClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let player = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin, player)
    }

    fn make_secret(env: &Env, seed: u32) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[0..4].copy_from_slice(&seed.to_be_bytes());
        bytes[28..32].copy_from_slice(&seed.wrapping_mul(2654435761).to_be_bytes());
        BytesN::from_array(env, &bytes)
    }

    #[test]
    fn test_commit_burns_materials_and_reveal_mints_item() {
        let (env, client, admin, player) = setup();

        let ore = client.add_item_def(
            &admin,
            &symbol_short!("ORE"),
            &ItemCategory::Material,
            &1,
            &0,
            &0,
            &0,
            &0,
            &0,
        );
        let sword = client.add_item_def(
            &admin,
            &symbol_short!("SWORD"),
            &ItemCategory::Weapon,
            &50,
            &10,
            &2,
            &5,
            &0,
            &10,
        );
        let recipe_id = client.add_recipe_with_prereqs(
            &admin,
            &vec![&env, ore, ore],
            &sword,
            &5,
            &vec![&env, 42],
            &100,
            &100,
        );

        client.set_player_level(&admin, &player, &5);
        client.grant_achievement(&admin, &player, &42);
        client.grant_item(&admin, &player, &ore);
        client.grant_item(&admin, &player, &ore);
        assert_eq!(client.inventory_size(&player), 2);

        let secret = make_secret(&env, 7);
        let commitment = compute_commitment(&env, &secret);

        let commit_id = client.commit_craft(&player, &recipe_id, &commitment);
        // Materials must be burned immediately during commitment phase.
        assert_eq!(client.inventory_size(&player), 0);

        // Advance ledger past MIN_REVEAL_DELAY.
        env.ledger()
            .with_mut(|l| l.sequence_number += MIN_REVEAL_DELAY);

        let outcome = client.reveal_craft(&player, &commit_id, &secret);
        assert!(outcome.succeeded);
        assert!(outcome.is_rare);
        assert_eq!(outcome.slot, Some(0));
        assert_eq!(client.inventory_size(&player), 1);

        let crafted = client.get_item(&player, &0);
        assert_eq!(crafted.item_def_id, sword);
        assert!(crafted.is_rare);
        assert!(crafted.attack >= 10 && crafted.attack <= 20);
    }

    #[test]
    fn test_atomic_prerequisite_validation_does_not_burn_on_failure() {
        let (env, client, admin, player) = setup();

        let ore = client.add_item_def(
            &admin,
            &symbol_short!("ORE"),
            &ItemCategory::Material,
            &1,
            &0,
            &0,
            &0,
            &0,
            &0,
        );
        let sword = client.add_item_def(
            &admin,
            &symbol_short!("SWORD"),
            &ItemCategory::Weapon,
            &50,
            &10,
            &2,
            &5,
            &0,
            &5,
        );
        let recipe_id = client.add_recipe_with_prereqs(
            &admin,
            &vec![&env, ore, ore],
            &sword,
            &10,
            &vec![&env, 99],
            &100,
            &0,
        );

        client.grant_item(&admin, &player, &ore);
        let secret = make_secret(&env, 1);
        let commitment = compute_commitment(&env, &secret);

        // 1. Fails on level prerequisite; inventory untouched.
        assert_eq!(
            client.try_commit_craft(&player, &recipe_id, &commitment),
            Err(Ok(Error::InsufficientLevel))
        );
        assert_eq!(client.inventory_size(&player), 1);

        // 2. Level met, fails on missing soulbound achievement; inventory untouched.
        client.set_player_level(&admin, &player, &10);
        assert_eq!(
            client.try_commit_craft(&player, &recipe_id, &commitment),
            Err(Ok(Error::MissingAchievement))
        );
        assert_eq!(client.inventory_size(&player), 1);

        // 3. Achievement met, fails on missing 2nd ore; 1st ore must NOT be burned.
        client.grant_achievement(&admin, &player, &99);
        assert_eq!(
            client.try_commit_craft(&player, &recipe_id, &commitment),
            Err(Ok(Error::MissingIngredient))
        );
        assert_eq!(client.inventory_size(&player), 1);
    }

    #[test]
    fn test_commit_reveal_security_guards() {
        let (env, client, admin, player) = setup();

        let ore = client.add_item_def(
            &admin,
            &symbol_short!("ORE"),
            &ItemCategory::Material,
            &1,
            &0,
            &0,
            &0,
            &0,
            &0,
        );
        let sword = client.add_item_def(
            &admin,
            &symbol_short!("SWORD"),
            &ItemCategory::Weapon,
            &50,
            &10,
            &2,
            &5,
            &0,
            &5,
        );
        let recipe_id = client.add_recipe(&admin, &vec![&env, ore], &sword);
        client.grant_item(&admin, &player, &ore);

        let secret = make_secret(&env, 123);
        let wrong_secret = make_secret(&env, 456);
        let commitment = compute_commitment(&env, &secret);

        let commit_id = client.commit_craft(&player, &recipe_id, &commitment);

        // Same-ledger reveal is rejected.
        assert_eq!(
            client.try_reveal_craft(&player, &commit_id, &secret),
            Err(Ok(Error::RevealTooEarly))
        );

        // Advance past MIN_REVEAL_DELAY.
        env.ledger()
            .with_mut(|l| l.sequence_number += MIN_REVEAL_DELAY);

        // Wrong secret is rejected.
        assert_eq!(
            client.try_reveal_craft(&player, &commit_id, &wrong_secret),
            Err(Ok(Error::InvalidReveal))
        );

        // Correct secret succeeds once.
        let outcome = client.reveal_craft(&player, &commit_id, &secret);
        assert!(outcome.succeeded);

        // Replay reveal is rejected.
        assert_eq!(
            client.try_reveal_craft(&player, &commit_id, &secret),
            Err(Ok(Error::CommitmentAlreadyRevealed))
        );
    }

    #[test]
    fn test_reveal_expired_leaves_materials_burned() {
        let (env, client, admin, player) = setup();

        let ore = client.add_item_def(
            &admin,
            &symbol_short!("ORE"),
            &ItemCategory::Material,
            &1,
            &0,
            &0,
            &0,
            &0,
            &0,
        );
        let sword = client.add_item_def(
            &admin,
            &symbol_short!("SWORD"),
            &ItemCategory::Weapon,
            &50,
            &10,
            &2,
            &5,
            &0,
            &5,
        );
        let recipe_id = client.add_recipe(&admin, &vec![&env, ore], &sword);
        client.grant_item(&admin, &player, &ore);

        let secret = make_secret(&env, 77);
        let commitment = compute_commitment(&env, &secret);
        let commit_id = client.commit_craft(&player, &recipe_id, &commitment);
        assert_eq!(client.inventory_size(&player), 0);

        // Advance past reveal deadline.
        env.ledger()
            .with_mut(|l| l.sequence_number += REVEAL_WINDOW + 1);

        assert_eq!(
            client.try_reveal_craft(&player, &commit_id, &secret),
            Err(Ok(Error::RevealExpired))
        );
        // Materials remain burned.
        assert_eq!(client.inventory_size(&player), 0);
    }

    #[test]
    fn test_uniform_distribution_over_10000_runs() {
        let env = Env::default();
        const RUNS: u32 = 10_000;
        const BUCKETS: usize = 10;
        let mut counts = [0u32; BUCKETS];
        let mut rare_drops: u32 = 0;

        for run in 0..RUNS {
            let secret = make_secret(&env, run);
            let entropy = derive_reveal_entropy(&env, &secret, run, 100, 101, 0);
            let roll = uniform_roll(&env, &entropy, 0, 100);
            assert!(roll < 100);
            counts[(roll / 10) as usize] += 1;

            let rare_roll = uniform_roll(&env, &entropy, 1, 100);
            if rare_roll < 20 {
                rare_drops += 1;
            }
        }

        // Expected count per bucket is 1,000 (std dev ~30).
        // Chi-squared goodness-of-fit test with df = 9, critical value at p=0.001 is 27.877.
        let expected = (RUNS as f64) / (BUCKETS as f64);
        let mut chi_squared = 0.0f64;
        for &count in &counts {
            assert!(
                count >= 850 && count <= 1150,
                "bucket count {} out of uniform bounds [850, 1150]",
                count
            );
            let diff = (count as f64) - expected;
            chi_squared += (diff * diff) / expected;
        }
        assert!(
            chi_squared < 27.877,
            "chi-squared statistic {:.3} exceeds p=0.001 threshold 27.877",
            chi_squared
        );

        // 20% rare drop rate over 10,000 runs => expected 2,000 (std dev = 40).
        assert!(
            rare_drops >= 1840 && rare_drops <= 2160,
            "rare drop count {} out of expected bounds [1840, 2160]",
            rare_drops
        );
    }
}
