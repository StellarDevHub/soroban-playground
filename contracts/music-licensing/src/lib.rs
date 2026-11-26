#![no_std]
pub mod rights;
#[cfg(test)]
mod rights_test;
mod test;

use rights::{
    allocate, transfer_payment, validate_metadata, validate_terms, LicenseTerms, MusicMetadata,
    RightsError, RoyaltyPayment,
};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec,
};

#[contract]
pub struct MusicLicensingContract;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Track {
    pub id: u32,
    pub artist: Address,
    pub title: String,
    pub price: u128,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct License {
    pub track_id: u32,
    pub buyer: Address,
    pub purchase_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrackRights {
    pub metadata: MusicMetadata,
    pub terms: LicenseTerms,
    pub payment_token: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RightsLicense {
    pub track_id: u32,
    pub buyer: Address,
    pub purchase_time: u64,
    pub expires_at: u64,
    pub rights: TrackRights,
    pub paid_amount: i128,
    pub payments: Vec<RoyaltyPayment>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    NextTrackId,
    Track(u32),
    Licenses(u32), // List of licenses for a track
    IsPaused,
    TrackRights(u32),
    RightsLicense(u32, Address),
}

const EVENT_TRACK_REGISTERED: Symbol = symbol_short!("REGISTER");
const EVENT_LICENSE_PURCHASED: Symbol = symbol_short!("PURCHASE");
const EVENT_PAUSED: Symbol = symbol_short!("PAUSE");
const EVENT_UNPAUSED: Symbol = symbol_short!("UNPAUSE");

#[contractimpl]
impl MusicLicensingContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextTrackId, &1u32);
        env.storage().instance().set(&DataKey::IsPaused, &false);
    }

    pub fn register_track(env: Env, artist: Address, title: String, price: u128) -> u32 {
        artist.require_auth();
        assert!(!Self::is_paused(&env), "Contract is paused");

        let id = env
            .storage()
            .instance()
            .get(&DataKey::NextTrackId)
            .unwrap_or(1u32);

        let track = Track {
            id,
            artist: artist.clone(),
            title: title.clone(),
            price,
            is_active: true,
        };

        env.storage().persistent().set(&DataKey::Track(id), &track);
        env.storage()
            .instance()
            .set(&DataKey::NextTrackId, &(id + 1));

        env.events().publish((EVENT_TRACK_REGISTERED, artist), id);
        id
    }

    pub fn purchase_license(env: Env, buyer: Address, track_id: u32) {
        buyer.require_auth();
        assert!(!Self::is_paused(&env), "Contract is paused");

        let track: Track = env
            .storage()
            .persistent()
            .get(&DataKey::Track(track_id))
            .expect("Track not found");
        assert!(track.is_active, "Track is not active");
        if env
            .storage()
            .persistent()
            .has(&DataKey::TrackRights(track_id))
        {
            env.panic_with_error(RightsError::InvalidAgreement);
        }

        // Note: In a real implementation, we would transfer USDC/XLM here from buyer to track.artist
        // token::Client::new(&env, &usdc_id).transfer(&buyer, &track.artist, &track.price);

        let license = License {
            track_id,
            buyer: buyer.clone(),
            purchase_time: env.ledger().timestamp(),
        };

        let mut licenses: Vec<License> = env
            .storage()
            .persistent()
            .get(&DataKey::Licenses(track_id))
            .unwrap_or(Vec::new(&env));
        licenses.push_back(license);
        env.storage()
            .persistent()
            .set(&DataKey::Licenses(track_id), &licenses);

        env.events()
            .publish((EVENT_LICENSE_PURCHASED, buyer), track_id);
    }

    pub fn get_track(env: Env, id: u32) -> Track {
        env.storage()
            .persistent()
            .get(&DataKey::Track(id))
            .expect("Track not found")
    }

    /// Register a paid licensing offer without changing the legacy Track layout.
    pub fn register_track_with_metadata(
        env: Env,
        artist: Address,
        title: String,
        price: i128,
        metadata: MusicMetadata,
        terms: LicenseTerms,
        payment_token: Address,
    ) -> Result<u32, RightsError> {
        artist.require_auth();
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(RightsError::NotInitialized);
        }
        if Self::is_paused(&env) {
            return Err(RightsError::Paused);
        }
        let next_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextTrackId)
            .unwrap_or(1);
        if next_id == u32::MAX {
            return Err(RightsError::Overflow);
        }
        validate_metadata(&metadata)?;
        validate_terms(&terms)?;
        if price <= 0 {
            return Err(RightsError::InvalidAmount);
        }
        if title.is_empty() || title.len() > 200 {
            return Err(RightsError::InvalidTitle);
        }
        let id = next_id;
        env.storage().persistent().set(
            &DataKey::Track(id),
            &Track {
                id,
                artist: artist.clone(),
                title,
                price: price as u128,
                is_active: true,
            },
        );
        env.storage()
            .instance()
            .set(&DataKey::NextTrackId, &(id + 1));
        env.events().publish((EVENT_TRACK_REGISTERED, artist), id);
        env.storage().persistent().set(
            &DataKey::TrackRights(id),
            &TrackRights {
                metadata,
                terms,
                payment_token,
            },
        );
        Ok(id)
    }

    pub fn get_track_rights(env: Env, track_id: u32) -> Result<TrackRights, RightsError> {
        env.storage()
            .persistent()
            .get(&DataKey::TrackRights(track_id))
            .ok_or(RightsError::MetadataNotFound)
    }

    pub fn get_rights_license(
        env: Env,
        track_id: u32,
        buyer: Address,
    ) -> Result<RightsLicense, RightsError> {
        env.storage()
            .persistent()
            .get(&DataKey::RightsLicense(track_id, buyer))
            .ok_or(RightsError::LicenseNotFound)
    }

    pub fn purchase_rights_license(
        env: Env,
        buyer: Address,
        track_id: u32,
    ) -> Result<RightsLicense, RightsError> {
        buyer.require_auth();
        if Self::is_paused(&env) {
            return Err(RightsError::Paused);
        }
        let rights = Self::get_track_rights(env.clone(), track_id)?;
        let track = Self::get_track(env.clone(), track_id);
        if !track.is_active {
            return Err(RightsError::InvalidAgreement);
        }
        let key = DataKey::RightsLicense(track_id, buyer.clone());
        if env.storage().persistent().has(&key) {
            return Err(RightsError::AlreadyRegistered);
        }
        let amount = i128::try_from(track.price).map_err(|_| RightsError::InvalidAmount)?;
        let purchase_time = env.ledger().timestamp();
        let expires_at = purchase_time
            .checked_add(rights.terms.duration_seconds)
            .ok_or(RightsError::Overflow)?;
        let payments = allocate(&env, &rights.metadata.publisher_splits, amount)?;
        let license = RightsLicense {
            track_id,
            buyer: buyer.clone(),
            purchase_time,
            expires_at,
            rights: rights.clone(),
            paid_amount: amount,
            payments: payments.clone(),
        };
        // Mark before token calls; Soroban rolls this back if any transfer fails.
        env.storage().persistent().set(&key, &license);
        transfer_payment(&env, &rights.payment_token, &buyer, amount, &payments)?;
        env.events()
            .publish((EVENT_LICENSE_PURCHASED, buyer), track_id);
        Ok(license)
    }

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized");
        }
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events().publish((EVENT_PAUSED,), ());
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized");
        }
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.events().publish((EVENT_UNPAUSED,), ());
    }

    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }
}
