#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};
use crate::storage::{get_song, is_initialized, set_initialized, set_song};
use crate::types::{Error, Song, Split};

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
}
