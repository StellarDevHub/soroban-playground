#![no_std]

mod storage;
mod types;
#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_license, get_patent, get_verifier, has_license, has_patent, is_initialized,
    is_paused, license_count, patent_count, set_admin, set_license, set_license_count, set_paused,
    set_patent, set_patent_count, set_verifier,
};
use crate::types::{Error, LicenseOffer, LicenseStatus, Patent, PatentStatus};

#[contract]
pub struct PatentRegistry;

#[contractimpl]
impl PatentRegistry {
    pub fn initialize(env: Env, admin: Address, verifier: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();
        set_admin(&env, &admin);
        set_verifier(&env, &verifier);
        set_patent_count(&env, 0);
        set_license_count(&env, 0);
        set_paused(&env, false);

        env.events()
            .publish((symbol_short!("init"),), (admin, verifier));

        Ok(())
    }

    pub fn register_patent(
        env: Env,
        owner: Address,
        title: String,
        metadata_uri: String,
        metadata_hash: String,
    ) -> Result<u32, Error> {
        Self::assert_active(&env)?;
        owner.require_auth();
        Self::assert_text(&title)?;
        Self::assert_text(&metadata_uri)?;
        Self::assert_text(&metadata_hash)?;

        let id = patent_count(&env) + 1;
        let timestamp = env.ledger().timestamp();
        let patent = Patent {
            owner: owner.clone(),
            title: title.clone(),
            metadata_uri: metadata_uri.clone(),
            metadata_hash: metadata_hash.clone(),
            status: PatentStatus::Registered,
            created_at: timestamp,
            updated_at: timestamp,
            verified_at: 0,
        };

        set_patent(&env, id, &patent);
        set_patent_count(&env, id);

        env.events().publish(
            (symbol_short!("patent"), symbol_short!("register"), id),
            (owner, title, metadata_hash),
        );

        Ok(id)
    }

    pub fn update_patent(
        env: Env,
        owner: Address,
        patent_id: u32,
        title: String,
        metadata_uri: String,
        metadata_hash: String,
    ) -> Result<(), Error> {
        Self::assert_active(&env)?;
        owner.require_auth();
        Self::assert_owner(&env, patent_id, &owner)?;
        Self::assert_text(&title)?;
        Self::assert_text(&metadata_uri)?;
        Self::assert_text(&metadata_hash)?;

        let mut patent = get_patent(&env, patent_id)?;
        patent.title = title.clone();
        patent.metadata_uri = metadata_uri.clone();
        patent.metadata_hash = metadata_hash.clone();
        patent.updated_at = env.ledger().timestamp();

        set_patent(&env, patent_id, &patent);

        env.events().publish(
            (symbol_short!("patent"), symbol_short!("update"), patent_id),
            (owner, title, metadata_hash),
        );

        Ok(())
    }

    pub fn verify_patent(env: Env, caller: Address, patent_id: u32) -> Result<(), Error> {
        Self::assert_active(&env)?;
        caller.require_auth();
        Self::assert_verifier(&env, &caller)?;

        let mut patent = get_patent(&env, patent_id)?;
        if patent.status == PatentStatus::Verified {
            return Err(Error::AlreadyVerified);
        }

        patent.status = PatentStatus::Verified;
        patent.verified_at = env.ledger().timestamp();
        patent.updated_at = patent.verified_at;
        set_patent(&env, patent_id, &patent);

        env.events().publish(
            (symbol_short!("patent"), symbol_short!("verify"), patent_id),
            (caller, patent.owner),
        );

        Ok(())
    }

    pub fn set_verifier(env: Env, admin: Address, verifier: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        verifier.require_auth();
        set_verifier(&env, &verifier);

        env.events()
            .publish((symbol_short!("verifier"), symbol_short!("set")), verifier);

        Ok(())
    }

    pub fn create_license_offer(
        env: Env,
        owner: Address,
        patent_id: u32,
        licensee: Address,
        terms: String,
        payment_amount: i128,
        payment_currency: String,
    ) -> Result<u32, Error> {
        Self::assert_active(&env)?;
        owner.require_auth();
        licensee.require_auth();
        Self::assert_owner(&env, patent_id, &owner)?;
        Self::assert_text(&terms)?;
        Self::assert_text(&payment_currency)?;
        if payment_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let patent = get_patent(&env, patent_id)?;
        if patent.status != PatentStatus::Verified {
            return Err(Error::NotVerifier);
        }

        let id = license_count(&env) + 1;
        let timestamp = env.ledger().timestamp();
        let offer = LicenseOffer {
            patent_id,
            licensor: owner.clone(),
            licensee: licensee.clone(),
            terms: terms.clone(),
            payment_amount,
            payment_currency: payment_currency.clone(),
            status: LicenseStatus::Open,
            created_at: timestamp,
            accepted_at: 0,
            payment_reference: String::from_str(&env, ""),
        };

        set_license(&env, id, &offer);
        set_license_count(&env, id);

        env.events().publish(
            (symbol_short!("license"), symbol_short!("create"), id),
            (patent_id, owner, licensee, payment_amount),
        );

        Ok(id)
    }

    pub fn accept_license(
        env: Env,
        licensee: Address,
        patent_id: u32,
        license_id: u32,
        payment_reference: String,
    ) -> Result<(), Error> {
        Self::assert_active(&env)?;
        licensee.require_auth();
        Self::assert_text(&payment_reference)?;

        let mut offer = get_license(&env, license_id)?;
        if offer.patent_id != patent_id {
            return Err(Error::LicenseNotFound);
        }
        if offer.status != LicenseStatus::Open {
            return Err(Error::LicenseAlreadyAccepted);
        }
        if offer.licensee != licensee {
            return Err(Error::Unauthorized);
        }

        let patent = get_patent(&env, patent_id)?;
        if patent.status != PatentStatus::Verified {
            return Err(Error::NotVerifier);
        }

        offer.status = LicenseStatus::Accepted;
        offer.accepted_at = env.ledger().timestamp();
        offer.payment_reference = payment_reference.clone();
        set_license(&env, license_id, &offer);

        env.events().publish(
            (symbol_short!("license"), symbol_short!("accept"), license_id),
            (patent_id, licensee, payment_reference),
        );

        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("pause"),), admin);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpause"),), admin);
        Ok(())
    }

    pub fn paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_patent(env: Env, patent_id: u32) -> Result<Patent, Error> {
        get_patent(&env, patent_id)
    }

    pub fn get_license(env: Env, license_id: u32) -> Result<LicenseOffer, Error> {
        get_license(&env, license_id)
    }

    pub fn patent_count(env: Env) -> u32 {
        patent_count(&env)
    }

    pub fn license_count(env: Env) -> u32 {
        license_count(&env)
    }

    pub fn list_patents(env: Env) -> Vec<u32> {
        let mut ids = Vec::new(&env);
        for patent_id in 1..=patent_count(&env) {
            if has_patent(&env, patent_id) {
                ids.push_back(patent_id);
            }
        }
        ids
    }

    pub fn list_licenses(env: Env, patent_id: u32) -> Vec<u32> {
        let mut ids = Vec::new(&env);
        for license_id in 1..=license_count(&env) {
            if has_license(&env, license_id) {
                let offer = get_license(&env, license_id).unwrap();
                if offer.patent_id == patent_id {
                    ids.push_back(license_id);
                }
            }
        }
        ids
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_verifier(env: Env) -> Result<Address, Error> {
        get_verifier(&env)
    }

    fn assert_active(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        if get_admin(env)? != *caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_verifier(env: &Env, caller: &Address) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        let verifier = get_verifier(env)?;
        let admin = get_admin(env)?;
        if verifier != *caller && admin != *caller {
            return Err(Error::NotVerifier);
        }
        Ok(())
    }

    fn assert_owner(env: &Env, patent_id: u32, caller: &Address) -> Result<(), Error> {
        let patent = get_patent(env, patent_id)?;
        if patent.owner != *caller {
            return Err(Error::NotPatentOwner);
        }
        Ok(())
    }

    fn assert_text(value: &String) -> Result<(), Error> {
        if value.len() == 0 {
            return Err(Error::InvalidInput);
        }
        Ok(())
    }
}
