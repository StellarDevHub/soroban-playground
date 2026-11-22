#![no_std]

#[path = "../../music-licensing/src/rights.rs"]
pub mod rights;
mod storage;
mod types;

#[cfg(test)]
mod rights_test;
#[cfg(test)]
mod test;

use crate::storage::{
    get_license, get_revenue_share, get_song, get_usage_record, is_initialized, set_initialized,
    set_license, set_revenue_share, set_song, set_usage_record,
};
use crate::types::{Error, License, RevenueShare, Song, Split, UsageRecord};
use rights::{
    allocate, transfer_payment, validate_metadata, validate_terms, LicenseKind, LicenseTerms,
    MusicMetadata, RightsError, RoyaltyPayment,
};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RightsAgreement {
    pub metadata: MusicMetadata,
    pub terms: LicenseTerms,
    pub payment_token: Address,
    pub price: i128,
    pub expires_at: u64,
    pub purchased: bool,
}

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

        // Metadata-backed split tables cannot be replaced through the legacy API.
        if env
            .storage()
            .persistent()
            .has(&storage::DataKey::MusicMetadata(id.clone()))
        {
            return Err(Error::Unauthorized);
        }

        if id.is_empty() || id.len() > MAX_SONG_ID_LENGTH {
            return Err(Error::InvalidSongId);
        }

        if title.is_empty() || title.len() > MAX_TITLE_LENGTH {
            return Err(Error::InvalidTitle);
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
        if env
            .storage()
            .persistent()
            .has(&storage::DataKey::MusicMetadata(song_id.clone()))
        {
            return Err(Error::Unauthorized);
        }
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut song = get_song(&env, song_id.clone()).ok_or(Error::SongNotFound)?;

        // In a real contract, we would actually transfer funds here
        // for each split.account. For the playground, we just track it.

        // checked_add on every running total in this contract: these are
        // lifetime accumulators that only ever grow, and this crate's release
        // profile sets overflow-checks = true, so an unchecked `+=` would abort
        // the invocation with no error code once a total saturated.
        song.total_royalty_earned = song
            .total_royalty_earned
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
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
        if env
            .storage()
            .persistent()
            .has(&storage::DataKey::MusicMetadata(song_id.clone()))
        {
            return Err(Error::Unauthorized);
        }

        // Validate license parameters
        validate_license_params(&license_type, royalty_rate, duration_seconds)?;

        let now = env.ledger().timestamp();
        // A duration near u64::MAX would overflow the expiry. MAX_LICENSE_DURATION
        // already bounds it, but relying on a validation elsewhere to prevent an
        // arithmetic panic here is exactly the coupling that breaks when someone
        // later raises the constant.
        let expires_at = now.checked_add(duration_seconds).ok_or(Error::Overflow)?;

        let license = License {
            song_id: song_id.clone(),
            licensee: licensee.clone(),
            license_type,
            royalty_rate,
            active: true,
            created_at: now,
            expires_at,
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

        env.events()
            .publish((symbol_short!("license"),), (song_id, licensee));
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
        if env
            .storage()
            .persistent()
            .has(&storage::DataKey::MusicMetadata(song_id.clone()))
        {
            return Err(Error::Unauthorized);
        }
        // Validate inputs
        if usage_count == 0 || payment_amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // LicenseNotFound rather than SongNotFound: the song may well exist and
        // simply have no license for this licensee, and reporting the song as
        // missing sends a caller looking in the wrong place.
        let license =
            get_license(&env, song_id.clone(), licensee.clone()).ok_or(Error::LicenseNotFound)?;

        let current_time = env.ledger().timestamp();
        if !is_license_active(&license, current_time) {
            return Err(Error::Unauthorized);
        }

        // Update or create usage record
        let mut record =
            get_usage_record(&env, song_id.clone(), licensee.clone()).unwrap_or(UsageRecord {
                song_id: song_id.clone(),
                licensee: licensee.clone(),
                usage_count: 0,
                total_paid: 0,
                last_payment_timestamp: 0,
            });

        record.usage_count = record
            .usage_count
            .checked_add(usage_count)
            .ok_or(Error::Overflow)?;
        record.total_paid = record
            .total_paid
            .checked_add(payment_amount)
            .ok_or(Error::Overflow)?;
        record.last_payment_timestamp = current_time;

        set_usage_record(&env, song_id.clone(), licensee.clone(), &record);

        // Update revenue share
        if let Some(mut share) = get_revenue_share(&env, song_id.clone()) {
            share.total_revenue = share
                .total_revenue
                .checked_add(payment_amount)
                .ok_or(Error::Overflow)?;
            share.pending_distribution = share
                .pending_distribution
                .checked_add(payment_amount)
                .ok_or(Error::Overflow)?;
            set_revenue_share(&env, song_id.clone(), &share);
        }

        env.events().publish(
            (symbol_short!("usage"),),
            (song_id, usage_count, payment_amount),
        );
        Ok(())
    }

    // ── Revenue Distribution ──────────────────────────────────────────────────

    /// Distribute royalties to split recipients
    pub fn distribute_royalties(env: Env, song_id: String) -> Result<i128, Error> {
        let _song = get_song(&env, song_id.clone()).ok_or(Error::SongNotFound)?;
        let mut share = get_revenue_share(&env, song_id.clone()).ok_or(Error::SongNotFound)?;

        if share.pending_distribution <= 0 {
            return Err(Error::ZeroAmount);
        }

        let amount_to_distribute = share.pending_distribution;

        // In a real contract, we would transfer funds to each split recipient
        // For now, we just track the distribution
        share.distributed_revenue = share
            .distributed_revenue
            .checked_add(amount_to_distribute)
            .ok_or(Error::Overflow)?;
        share.pending_distribution = 0;
        share.last_distribution_timestamp = env.ledger().timestamp();

        set_revenue_share(&env, song_id.clone(), &share);

        env.events()
            .publish((symbol_short!("distrib"),), (song_id, amount_to_distribute));
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
        get_license(&env, song_id, licensee).ok_or(Error::LicenseNotFound)
    }

    pub fn register_song_with_metadata(
        env: Env,
        artist: Address,
        id: String,
        title: String,
        metadata: MusicMetadata,
    ) -> Result<(), RightsError> {
        artist.require_auth();
        if !is_initialized(&env) {
            return Err(RightsError::NotInitialized);
        }
        validate_metadata(&metadata)?;
        if get_song(&env, id.clone()).is_some() {
            return Err(RightsError::AlreadyRegistered);
        }
        if id.is_empty() || id.len() > MAX_SONG_ID_LENGTH {
            return Err(RightsError::InvalidSongId);
        }
        if title.is_empty() || title.len() > MAX_TITLE_LENGTH {
            return Err(RightsError::InvalidTitle);
        }
        let mut splits = Vec::new(&env);
        for publisher in metadata.publisher_splits.iter() {
            splits.push_back(Split {
                account: publisher.account,
                share: publisher.share,
            });
        }
        let song = Song {
            id: id.clone(),
            title,
            artist,
            splits,
            total_royalty_earned: 0,
        };
        set_song(&env, id.clone(), &song);
        env.storage()
            .persistent()
            .set(&storage::DataKey::MusicMetadata(id), &metadata);
        Ok(())
    }

    pub fn get_music_metadata(env: Env, song_id: String) -> Result<MusicMetadata, RightsError> {
        env.storage()
            .persistent()
            .get(&storage::DataKey::MusicMetadata(song_id))
            .ok_or(RightsError::MetadataNotFound)
    }

    pub fn issue_rights_license(
        env: Env,
        artist: Address,
        song_id: String,
        licensee: Address,
        terms: LicenseTerms,
        payment_token: Address,
        price: i128,
    ) -> Result<(), RightsError> {
        artist.require_auth();
        let song = get_song(&env, song_id.clone()).ok_or(RightsError::MetadataNotFound)?;
        if song.artist != artist {
            return Err(RightsError::Unauthorized);
        }
        let metadata = Self::get_music_metadata(env.clone(), song_id.clone())?;
        validate_terms(&terms)?;
        if price <= 0 {
            return Err(RightsError::InvalidAmount);
        }
        let key = storage::DataKey::RightsAgreement(song_id.clone(), licensee.clone());
        if env.storage().persistent().has(&key) {
            return Err(RightsError::AlreadyRegistered);
        }
        let now = env.ledger().timestamp();
        let expires_at = now
            .checked_add(terms.duration_seconds)
            .ok_or(RightsError::Overflow)?;
        let license_type = match &terms.kind {
            LicenseKind::Sync => String::from_str(&env, "sync"),
            LicenseKind::CommercialPerformance => {
                String::from_str(&env, "commercial_public_performance")
            }
        };
        // An issued offer becomes an active license only after payment.
        set_license(
            &env,
            song_id.clone(),
            licensee.clone(),
            &License {
                song_id: song_id.clone(),
                licensee,
                license_type,
                royalty_rate: 0,
                active: false,
                created_at: now,
                expires_at,
            },
        );
        env.storage().persistent().set(
            &key,
            &RightsAgreement {
                metadata,
                terms,
                payment_token,
                price,
                expires_at,
                purchased: false,
            },
        );
        Ok(())
    }

    pub fn get_rights_agreement(
        env: Env,
        song_id: String,
        licensee: Address,
    ) -> Result<RightsAgreement, RightsError> {
        env.storage()
            .persistent()
            .get(&storage::DataKey::RightsAgreement(song_id, licensee))
            .ok_or(RightsError::LicenseNotFound)
    }

    pub fn purchase_rights_license(
        env: Env,
        song_id: String,
        licensee: Address,
    ) -> Result<Vec<RoyaltyPayment>, RightsError> {
        licensee.require_auth();
        let mut agreement =
            Self::get_rights_agreement(env.clone(), song_id.clone(), licensee.clone())?;
        if agreement.purchased {
            return Err(RightsError::AlreadyRegistered);
        }
        if env.ledger().timestamp() >= agreement.expires_at {
            return Err(RightsError::LicenseExpired);
        }
        let mut song = get_song(&env, song_id.clone()).ok_or(RightsError::MetadataNotFound)?;
        let payments = allocate(&env, &agreement.metadata.publisher_splits, agreement.price)?;
        song.total_royalty_earned = song
            .total_royalty_earned
            .checked_add(agreement.price)
            .ok_or(RightsError::Overflow)?;
        let mut revenue = get_revenue_share(&env, song_id.clone()).unwrap_or(RevenueShare {
            song_id: song_id.clone(),
            total_revenue: 0,
            distributed_revenue: 0,
            pending_distribution: 0,
            last_distribution_timestamp: 0,
        });
        revenue.total_revenue = revenue
            .total_revenue
            .checked_add(agreement.price)
            .ok_or(RightsError::Overflow)?;
        revenue.distributed_revenue = revenue
            .distributed_revenue
            .checked_add(agreement.price)
            .ok_or(RightsError::Overflow)?;
        revenue.last_distribution_timestamp = env.ledger().timestamp();
        agreement.purchased = true;
        env.storage().persistent().set(
            &storage::DataKey::RightsAgreement(song_id.clone(), licensee.clone()),
            &agreement,
        );
        set_song(&env, song_id.clone(), &song);
        set_revenue_share(&env, song_id.clone(), &revenue);
        let mut license = get_license(&env, song_id.clone(), licensee.clone())
            .ok_or(RightsError::LicenseNotFound)?;
        license.active = true;
        set_license(&env, song_id.clone(), licensee.clone(), &license);
        transfer_payment(
            &env,
            &agreement.payment_token,
            &licensee,
            agreement.price,
            &payments,
        )?;
        env.events().publish(
            (symbol_short!("purchase"),),
            (song_id, licensee, agreement.price),
        );
        Ok(payments)
    }
}

// ── Private Helper Functions ─────────────────────────────────────────────────────

/// Validate that splits sum to 100%, each split is valid, and no account repeats.
///
/// The emptiness check now runs *first*. It previously sat after the loop,
/// where it could only ever be reached with `total_share == 0` — the guard was
/// correct but unreachable-looking, and reading it required proving the loop
/// body never ran.
fn validate_splits(splits: &Vec<Split>) -> Result<u32, Error> {
    if splits.is_empty() {
        return Err(Error::InvalidSplits);
    }

    let mut total_share: u32 = 0;

    for (i, split) in splits.iter().enumerate() {
        if split.share == 0 || split.share > TOTAL_SHARE_BASIS_POINTS {
            return Err(Error::InvalidSplits);
        }

        // checked_add, not `+=`: the previous code added first and range-checked
        // afterwards, so a long enough split table would overflow u32 before the
        // bound was ever tested. The comment there said "Check for overflow" but
        // it checked the 10000 bound, which is a different thing.
        total_share = total_share
            .checked_add(split.share)
            .ok_or(Error::Overflow)?;

        if total_share > TOTAL_SHARE_BASIS_POINTS {
            return Err(Error::InvalidSplits);
        }

        // A repeated account silently collects two shares while the artist
        // believes it holds one. O(n^2), which is affordable because the shares
        // must sum to 10000 and each is at least 1, capping the table length.
        for j in (i + 1)..(splits.len() as usize) {
            if split.account == splits.get(j as u32).unwrap().account {
                return Err(Error::DuplicateSplitAccount);
            }
        }
    }

    Ok(total_share)
}

/// Validate license parameters
fn validate_license_params(
    license_type: &String,
    royalty_rate: u32,
    duration_seconds: u64,
) -> Result<(), Error> {
    // Each failure now reports what actually failed. These all returned
    // InvalidSplits before, which told a caller their split table was wrong
    // when the split table was fine.
    if license_type.is_empty() || license_type.len() > MAX_LICENSE_TYPE_LENGTH {
        return Err(Error::InvalidLicenseType);
    }

    if !(MIN_ROYALTY_RATE..=MAX_ROYALTY_RATE).contains(&royalty_rate) {
        return Err(Error::InvalidRoyaltyRate);
    }

    if !(MIN_LICENSE_DURATION..=MAX_LICENSE_DURATION).contains(&duration_seconds) {
        return Err(Error::InvalidDuration);
    }

    Ok(())
}

/// Check if a license is currently active
fn is_license_active(license: &License, current_time: u64) -> bool {
    license.active && current_time <= license.expires_at
}
