#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};
use crate::storage::{
    get_song, is_initialized, set_initialized, set_song, get_usage_record, set_usage_record,
    get_license, set_license, get_revenue_share, set_revenue_share,
};
use crate::types::{Error, Song, Split, UsageRecord, License, RevenueShare};

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
        
        // Validate splits total 10000 (100%)
        let mut total_share: u32 = 0;
        for split in splits.iter() {
            total_share += split.share;
        }
        if total_share != 10000 {
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
        
        // Validate royalty rate (0-10000 basis points)
        if royalty_rate > 10000 {
            return Err(Error::InvalidSplits);
        }
        
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
        if usage_count == 0 || payment_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        
        // Verify license is active
        let license = get_license(&env, song_id.clone(), licensee.clone())
            .ok_or(Error::SongNotFound)?;
        
        if !license.active || env.ledger().timestamp() > license.expires_at {
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
        record.last_payment_timestamp = env.ledger().timestamp();
        
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
        let song = get_song(&env, song_id.clone()).ok_or(Error::SongNotFound)?;
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
