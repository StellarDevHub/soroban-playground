#![no_std]

use serde::Deserialize;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env,
};

const MAX_CLIENT_DATA_JSON_BYTES: usize = 4096;
const MAX_AUTHENTICATOR_DATA_BYTES: u32 = 4096;
const MAX_CHALLENGE_BYTES: u32 = 256;
const MAX_ORIGIN_BYTES: u32 = 256;
const FLAG_USER_PRESENT: u8 = 0x01;
const FLAG_USER_VERIFIED: u8 = 0x04;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotRegistered = 1,
    Unauthorized = 2,
    InvalidInput = 3,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    PublicKey,
    Origin,
    RpIdHash,
    Challenge,
}

#[derive(Deserialize)]
struct ClientData<'a> {
    #[serde(rename = "type", borrow)]
    client_type: &'a str,
    #[serde(borrow)]
    challenge: &'a str,
    #[serde(borrow)]
    origin: &'a str,
}

#[contract]
pub struct AccountAbstraction;

#[contractimpl]
impl AccountAbstraction {
    /// Register or rotate the account's passkey and WebAuthn relying-party policy.
    pub fn register_passkey(
        env: Env,
        owner: Address,
        public_key: BytesN<65>,
        origin: Bytes,
        rp_id_hash: BytesN<32>,
    ) -> Result<(), Error> {
        owner.require_auth();

        let storage = env.storage().instance();
        if let Some(registered_owner) = storage.get::<_, Address>(&DataKey::Owner) {
            if registered_owner != owner {
                return Err(Error::Unauthorized);
            }
        }
        if public_key.get(0) != Some(0x04) || origin.len() == 0 || origin.len() > MAX_ORIGIN_BYTES {
            return Err(Error::InvalidInput);
        }

        storage.set(&DataKey::Owner, &owner);
        storage.set(&DataKey::PublicKey, &public_key);
        storage.set(&DataKey::Origin, &origin);
        storage.set(&DataKey::RpIdHash, &rp_id_hash);
        storage.remove(&DataKey::Challenge);
        Ok(())
    }

    /// Set the base64url challenge that the next passkey assertion must contain.
    pub fn set_challenge(env: Env, owner: Address, challenge: Bytes) -> Result<(), Error> {
        let storage = env.storage().instance();
        let registered_owner = storage
            .get::<_, Address>(&DataKey::Owner)
            .ok_or(Error::NotRegistered)?;
        if owner != registered_owner {
            return Err(Error::Unauthorized);
        }
        owner.require_auth();

        if challenge.len() == 0 || challenge.len() > MAX_CHALLENGE_BYTES {
            return Err(Error::InvalidInput);
        }
        storage.set(&DataKey::Challenge, &challenge);
        Ok(())
    }

    /// Verify a WebAuthn assertion and consume its one-time challenge on success.
    pub fn verify_passkey_auth(
        env: Env,
        client_data_json: Bytes,
        authenticator_data: Bytes,
        signature: BytesN<64>,
    ) -> bool {
        let storage = env.storage().instance();
        let Some(public_key) = storage.get::<_, BytesN<65>>(&DataKey::PublicKey) else {
            return false;
        };
        let Some(expected_origin) = storage.get::<_, Bytes>(&DataKey::Origin) else {
            return false;
        };
        let Some(expected_rp_id_hash) = storage.get::<_, BytesN<32>>(&DataKey::RpIdHash) else {
            return false;
        };
        let Some(expected_challenge) = storage.get::<_, Bytes>(&DataKey::Challenge) else {
            return false;
        };

        let json_len = client_data_json.len() as usize;
        if json_len == 0 || json_len > MAX_CLIENT_DATA_JSON_BYTES {
            return false;
        }
        let mut json_buffer = [0u8; MAX_CLIENT_DATA_JSON_BYTES];
        client_data_json.copy_into_slice(&mut json_buffer[..json_len]);
        let Ok(client_data) = serde_json::from_slice::<ClientData>(&json_buffer[..json_len]) else {
            return false;
        };

        if client_data.client_type != "webauthn.get"
            || Bytes::from_slice(&env, client_data.challenge.as_bytes()) != expected_challenge
            || Bytes::from_slice(&env, client_data.origin.as_bytes()) != expected_origin
            || authenticator_data.len() < 37
            || authenticator_data.len() > MAX_AUTHENTICATOR_DATA_BYTES
        {
            return false;
        }

        let mut actual_rp_id_hash = [0u8; 32];
        authenticator_data
            .slice(0..32)
            .copy_into_slice(&mut actual_rp_id_hash);
        if BytesN::from_array(&env, &actual_rp_id_hash) != expected_rp_id_hash {
            return false;
        }

        let flags = authenticator_data.get(32).unwrap_or(0);
        if flags & FLAG_USER_PRESENT == 0 || flags & FLAG_USER_VERIFIED == 0 {
            return false;
        }

        let client_data_hash = env.crypto().sha256(&client_data_json);
        let mut signed_data = authenticator_data;
        signed_data.append(&Bytes::from_array(&env, &client_data_hash.to_array()));
        let signing_digest = env.crypto().sha256(&signed_data);
        env.crypto()
            .secp256r1_verify(&public_key, &signing_digest, &signature);

        storage.remove(&DataKey::Challenge);
        true
    }
}
