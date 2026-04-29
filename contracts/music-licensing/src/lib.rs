#![no_std]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec};

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
pub enum DataKey {
    Admin,
    NextTrackId,
    Track(u32),
    Licenses(u32), // List of licenses for a track
    IsPaused,
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

        let id = env.storage().instance().get(&DataKey::NextTrackId).unwrap_or(1u32);
        
        let track = Track {
            id,
            artist: artist.clone(),
            title: title.clone(),
            price,
            is_active: true,
        };

        env.storage().persistent().set(&DataKey::Track(id), &track);
        env.storage().instance().set(&DataKey::NextTrackId, &(id + 1));

        env.events().publish((EVENT_TRACK_REGISTERED, artist), id);
        id
    }

    pub fn purchase_license(env: Env, buyer: Address, track_id: u32) {
        buyer.require_auth();
        assert!(!Self::is_paused(&env), "Contract is paused");

        let track: Track = env.storage().persistent().get(&DataKey::Track(track_id)).expect("Track not found");
        assert!(track.is_active, "Track is not active");

        // Note: In a real implementation, we would transfer USDC/XLM here from buyer to track.artist
        // token::Client::new(&env, &usdc_id).transfer(&buyer, &track.artist, &track.price);

        let license = License {
            track_id,
            buyer: buyer.clone(),
            purchase_time: env.ledger().timestamp(),
        };

        let mut licenses: Vec<License> = env.storage().persistent().get(&DataKey::Licenses(track_id)).unwrap_or(Vec::new(&env));
        licenses.push_back(license);
        env.storage().persistent().set(&DataKey::Licenses(track_id), &licenses);

        env.events().publish((EVENT_LICENSE_PURCHASED, buyer), track_id);
    }

    pub fn get_track(env: Env, id: u32) -> Track {
        env.storage().persistent().get(&DataKey::Track(id)).expect("Track not found")
    }

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized");
        }
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events().publish((EVENT_PAUSED,), ());
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized");
        }
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.events().publish((EVENT_UNPAUSED,), ());
    }

    pub fn is_paused(env: &Env) -> bool {
        env.storage().instance().get(&DataKey::IsPaused).unwrap_or(false)
    }
}
