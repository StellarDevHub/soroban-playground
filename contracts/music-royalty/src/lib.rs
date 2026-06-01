#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};
use crate::storage::{
    get_song, is_initialized, set_initialized, set_song, get_usage_record, set_usage_record,
    get_license, set_license, get_revenue_share, set_revenue_share,
};
use crate::types::{Error, Song, Split, UsageRecord, License, RevenueShare};

/// Basis points for 100% (used for split validation)
const TOTAL_SHARE_BASIS_POINTS: u32 = 10000;
/// Maximum song ID length to prevent storage bloat
const MAX_SONG_ID_LENGTH: u32 = 100;
/// Maximum title length to prevent storage bloat
const MAX_TITLE_LENGTH: u32 = 200;
/// Maximum license type length
const MAX_LICENSE_TYPE_LENGTH: u32 = 50;
/// Minimum royalty rate (0%)
const MIN_ROYALTY_RATE: u32 = 0;
/// Maximum royalty rate (100%)
const MAX_ROYALTY_RATE: u32 = 10000;
/// Minimum license duration (1 hour in seconds)
const MIN_LICENSE_DURATION: u64 = 3600;
/// Maximum license duration (10 years in seconds)
const MAX_LICENSE_DURATION: u64 = 315_360_000;

#[contract]
pub struct MusicRoyalty;

#[contractimpl]
impl MusicRoyalty {
    pub fn initialize(env: Env) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_initialized(&env);
        Ok(())
    }

    pub fn register_song(
        env: Env,
        artist: Address,
        id: String,
        title: String,
        splits: Vec<Split>,
    ) -> Result<(), Error> {
        artist.require_auth();
        
        // Validate song ID
        if id.len() == 0 || id.len() > MAX_SONG_ID_LENGTH {
            return Err(Error::InvalidSplits);
        }
        
        // Validate title
        if title.len() == 0 || title.len() > MAX_TITLE_LENGTH {
            return Err(Error::InvalidSplits);
        }
        
        // Validate splits total 10000 (100%)
        let total_share = self::validate_splits(&splits)?;
        if total_share != TOTAL_SHARE_BASIS_POINTS {
            return Err(Error::InvalidSplits);
        }

        let song = Song {
            id: id.clone(),
            title,
            artist,
            splits,
            total_royalty_earned: 0,
        };

        set_song(&env, id, &song);
        Ok(())
    }

    pub fn distribute_royalty(env: Env, song_id: String, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        
        let mut song = get_song(&env, song_id.clone()).ok_or(Error::SongNotFound)?;
        
        // In a real contract, we would actually transfer funds here
        // for each split.account. For the playground, we just track it.
        
        song.total_royalty_earned += amount;
        set_song(&env, song_id, &song);
        Ok(())
    }

    pub fn get_song_info(env: Env, song_id: String) -> Result<Song, Error> {
        get_song(&env, song_id).ok_or(Error::SongNotFound)
    }

    // ── License Management ────────────────────────────────────────────────────

    /// Issue a license for a song to a licensee
    pub fn issue_license(
        env: Env,
        artist: Address,
        song_id: String,
        licensee: Address,
        license_type: String,
        royalty_rate: u32,
        duration_seconds: u64,
    ) -> Result<(), Error> {
        artist.require_auth();
        
        // Verify song exists
        let _song = get_song(&env, song_id.clone()).ok_or(Error::SongNotFound)?;
        
        // Validate license parameters
        validate_license_params(&license_type, royalty_rate, duration_seconds)?;
        
        let now = env.ledger().timestamp();
        let license = License {
            song_id: song_id.clone(),
            licensee: licensee.clone(),
            license_type,
            royalty_rate,
            active: true,
            created_at: now,
            expires_at: now + duration_seconds,
        };
        
        set_license(&env, song_id.clone(), licensee.clone(), &license);
        
        // Initialize revenue share if not exists
        if get_revenue_share(&env, song_id.clone()).is_none() {
            let share = RevenueShare {
                song_id: song_id.clone(),
                total_revenue: 0,
                distributed_revenue: 0,
                pending_distribution: 0,
                last_distribution_timestamp: now,
            };
            set_revenue_share(&env, song_id.clone(), &share);
        }
        
        env.events().publish((symbol_short!("license"),), (song_id, licensee));
        Ok(())
    }

    // ── Usage Tracking ───────────────────────────────────────────────────────

    /// Track usage and record payment
    pub fn record_usage(
        env: Env,
        song_id: String,
        licensee: Address,
        usage_count: u32,
        payment_amount: i128,
    ) -> Result<(), Error> {
        // Validate inputs
        if usage_count == 0 || payment_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        
        // Verify license is active
        let license = get_license(&env, song_id.clone(), licensee.clone())
            .ok_or(Error::SongNotFound)?;
        
        let current_time = env.ledger().timestamp();
        if !is_license_active(&license, current_time) {
            return Err(Error::Unauthorized);
        }
        
        // Update or create usage record
        let mut record = get_usage_record(&env, song_id.clone(), licensee.clone())
            .unwrap_or(UsageRecord {
                song_id: song_id.clone(),
                licensee: licensee.clone(),
                usage_count: 0,
                total_paid: 0,
                last_payment_timestamp: 0,
            });
        
        record.usage_count += usage_count;
        record.total_paid += payment_amount;
        record.last_payment_timestamp = current_time;
        
        set_usage_record(&env, song_id.clone(), licensee.clone(), &record);
        
        // Update revenue share
        if let Some(mut share) = get_revenue_share(&env, song_id.clone()) {
            share.total_revenue += payment_amount;
            share.pending_distribution += payment_amount;
            set_revenue_share(&env, song_id.clone(), &share);
        }
        
        env.events().publish((symbol_short!("usage"),), (song_id, usage_count, payment_amount));
        Ok(())
    }

    // ── Revenue Distribution ──────────────────────────────────────────────────

    /// Distribute royalties to split recipients
    pub fn distribute_royalties(
        env: Env,
        song_id: String,
    ) -> Result<i128, Error> {
        let _song = get_song(&env, song_id.clone()).ok_or(Error::SongNotFound)?;
        let mut share = get_revenue_share(&env, song_id.clone()).ok_or(Error::SongNotFound)?;
        
        if share.pending_distribution <= 0 {
            return Err(Error::ZeroAmount);
        }
        
        let amount_to_distribute = share.pending_distribution;
        
        // In a real contract, we would transfer funds to each split recipient
        // For now, we just track the distribution
        share.distributed_revenue += amount_to_distribute;
        share.pending_distribution = 0;
        share.last_distribution_timestamp = env.ledger().timestamp();
        
        set_revenue_share(&env, song_id.clone(), &share);
        
        env.events().publish((symbol_short!("distrib"),), (song_id, amount_to_distribute));
        Ok(amount_to_distribute)
    }

    /// Get usage statistics for a song and licensee
    pub fn get_usage_stats(
        env: Env,
        song_id: String,
        licensee: Address,
    ) -> Result<UsageRecord, Error> {
        get_usage_record(&env, song_id, licensee).ok_or(Error::SongNotFound)
    }

    /// Get revenue share information
    pub fn get_revenue_info(env: Env, song_id: String) -> Result<RevenueShare, Error> {
        get_revenue_share(&env, song_id).ok_or(Error::SongNotFound)
    }

    /// Get license information
    pub fn get_license_info(
        env: Env,
        song_id: String,
        licensee: Address,
    ) -> Result<License, Error> {
        get_license(&env, song_id, licensee).ok_or(Error::SongNotFound)
    }
}

// ── Private Helper Functions ─────────────────────────────────────────────────────

/// Validate that splits sum to 100% and each split is valid
fn validate_splits(splits: &Vec<Split>) -> Result<u32, Error> {
    let mut total_share: u32 = 0;
    
    for split in splits.iter() {
        // Validate individual split share
        if split.share == 0 || split.share > TOTAL_SHARE_BASIS_POINTS {
            return Err(Error::InvalidSplits);
        }
        total_share += split.share;
        
        // Check for overflow
        if total_share > TOTAL_SHARE_BASIS_POINTS {
            return Err(Error::InvalidSplits);
        }
    }
    
    // Ensure at least one split exists
    if splits.is_empty() {
        return Err(Error::InvalidSplits);
    }
    
    Ok(total_share)
}

/// Validate license parameters
fn validate_license_params(
    license_type: &String,
    royalty_rate: u32,
    duration_seconds: u64,
) -> Result<(), Error> {
    // Validate license type length
    if license_type.len() == 0 || license_type.len() > MAX_LICENSE_TYPE_LENGTH {
        return Err(Error::InvalidSplits);
    }
    
    // Validate royalty rate
    if royalty_rate < MIN_ROYALTY_RATE || royalty_rate > MAX_ROYALTY_RATE {
        return Err(Error::InvalidSplits);
    }
    
    // Validate duration
    if duration_seconds < MIN_LICENSE_DURATION || duration_seconds > MAX_LICENSE_DURATION {
        return Err(Error::InvalidSplits);
    }
    
    Ok(())
}

/// Check if a license is currently active
fn is_license_active(license: &License, current_time: u64) -> bool {
    license.active && current_time <= license.expires_at
}
