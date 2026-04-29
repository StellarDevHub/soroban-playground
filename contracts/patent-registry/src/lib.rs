#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_offer, get_offer_count, get_patent, get_patent_count, get_verifier,
    is_initialized, is_paused, set_admin, set_offer, set_offer_count, set_patent,
    set_patent_count, set_paused, set_verifier,
};
use crate::types::{Error, LicenseOffer, LicenseStatus, Patent, VerificationStatus};

#[contract]
pub struct PatentRegistry;

#[contractimpl]
impl PatentRegistry {
    pub fn initialize(env: Env, admin: Address, verifier: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();
        verifier.require_auth();

        set_admin(&env, &admin);
        set_verifier(&env, &verifier);
        set_patent_count(&env, 0);
        set_offer_count(&env, 0);
        set_paused(&env, false);

        env.events().publish((symbol_short!("init"),), (admin, verifier));
        Ok(())
    }

    pub fn register_patent(
        env: Env,
        owner: Address,
        title: String,
        description: String,
        content_hash: String,
        metadata_uri: String,
    ) -> Result<u32, Error> {
        Self::assert_active(&env)?;
        owner.require_auth();
        Self::assert_text(&title)?;
        Self::assert_text(&description)?;
        Self::assert_text(&content_hash)?;
        Self::assert_text(&metadata_uri)?;

        let patent_id = get_patent_count(&env) + 1;
        let timestamp = env.ledger().timestamp();
        let patent = Patent {
            id: patent_id,
            owner: owner.clone(),
            title,
            description,
            content_hash,
            metadata_uri,
            verification_status: VerificationStatus::Pending,
            verifier: None,
            created_at: timestamp,
            updated_at: timestamp,
        };

        set_patent(&env, &patent);
        set_patent_count(&env, patent_id);
        env.events()
            .publish((symbol_short!("patent"), symbol_short!("create"), patent_id), owner);

        Ok(patent_id)
    }

    pub fn update_patent(
        env: Env,
        owner: Address,
        patent_id: u32,
        title: String,
        description: String,
        content_hash: String,
        metadata_uri: String,
    ) -> Result<(), Error> {
        Self::assert_active(&env)?;
        owner.require_auth();
        Self::assert_text(&title)?;
        Self::assert_text(&description)?;
        Self::assert_text(&content_hash)?;
        Self::assert_text(&metadata_uri)?;

        let mut patent = get_patent(&env, patent_id)?;
        if patent.owner != owner {
            return Err(Error::Unauthorized);
        }

        patent.title = title;
        patent.description = description;
        patent.content_hash = content_hash;
        patent.metadata_uri = metadata_uri;
        patent.verification_status = VerificationStatus::Pending;
        patent.verifier = None;
        patent.updated_at = env.ledger().timestamp();

        set_patent(&env, &patent);
        env.events()
            .publish((symbol_short!("patent"), symbol_short!("update"), patent_id), owner);
        Ok(())
    }

    pub fn verify_patent(env: Env, verifier: Address, patent_id: u32) -> Result<(), Error> {
        Self::assert_active(&env)?;
        verifier.require_auth();
        Self::assert_verifier_or_admin(&env, &verifier)?;

        let mut patent = get_patent(&env, patent_id)?;
        patent.verification_status = VerificationStatus::Verified;
        patent.verifier = Some(verifier.clone());
        patent.updated_at = env.ledger().timestamp();

        set_patent(&env, &patent);
        env.events().publish(
            (symbol_short!("patent"), symbol_short!("verify"), patent_id),
            verifier,
        );
        Ok(())
    }

    pub fn create_license_offer(
        env: Env,
        owner: Address,
        patent_id: u32,
        terms_uri: String,
        payment_amount: i128,
        payment_token: String,
    ) -> Result<u32, Error> {
        Self::assert_active(&env)?;
        owner.require_auth();
        Self::assert_text(&terms_uri)?;
        Self::assert_text(&payment_token)?;
        if payment_amount <= 0 {
            return Err(Error::InvalidPaymentAmount);
        }

        let patent = get_patent(&env, patent_id)?;
        if patent.owner != owner {
            return Err(Error::Unauthorized);
        }

        let offer_id = get_offer_count(&env) + 1;
        let timestamp = env.ledger().timestamp();
        let offer = LicenseOffer {
            id: offer_id,
            patent_id,
            owner: owner.clone(),
            licensee: None,
            terms_uri,
            payment_amount,
            payment_token,
            status: LicenseStatus::Open,
            created_at: timestamp,
            updated_at: timestamp,
            accepted_at: 0,
        };

        set_offer(&env, &offer);
        set_offer_count(&env, offer_id);
        env.events()
            .publish((symbol_short!("offer"), symbol_short!("create"), offer_id), owner);
        Ok(offer_id)
    }

    pub fn update_license_offer(
        env: Env,
        owner: Address,
        offer_id: u32,
        terms_uri: String,
        payment_amount: i128,
        payment_token: String,
    ) -> Result<(), Error> {
        Self::assert_active(&env)?;
        owner.require_auth();
        Self::assert_text(&terms_uri)?;
        Self::assert_text(&payment_token)?;
        if payment_amount <= 0 {
            return Err(Error::InvalidPaymentAmount);
        }

        let mut offer = get_offer(&env, offer_id)?;
        if offer.owner != owner {
            return Err(Error::Unauthorized);
        }
        if offer.status == LicenseStatus::Accepted {
            return Err(Error::AlreadyAccepted);
        }

        offer.terms_uri = terms_uri;
        offer.payment_amount = payment_amount;
        offer.payment_token = payment_token;
        offer.updated_at = env.ledger().timestamp();

        set_offer(&env, &offer);
        env.events()
            .publish((symbol_short!("offer"), symbol_short!("update"), offer_id), owner);
        Ok(())
    }

    pub fn accept_license_offer(
        env: Env,
        licensee: Address,
        offer_id: u32,
    ) -> Result<(), Error> {
        Self::assert_active(&env)?;
        licensee.require_auth();

        let mut offer = get_offer(&env, offer_id)?;
        if offer.owner == licensee {
            return Err(Error::InvalidLicensee);
        }
        if offer.status == LicenseStatus::Accepted {
            return Err(Error::AlreadyAccepted);
        }

        let timestamp = env.ledger().timestamp();
        offer.licensee = Some(licensee.clone());
        offer.status = LicenseStatus::Accepted;
        offer.updated_at = timestamp;
        offer.accepted_at = timestamp;

        set_offer(&env, &offer);
        env.events().publish(
            (symbol_short!("offer"), symbol_short!("accept"), offer_id),
            licensee,
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

    pub fn get_patent(env: Env, patent_id: u32) -> Result<Patent, Error> {
        get_patent(&env, patent_id)
    }

    pub fn get_license_offer(env: Env, offer_id: u32) -> Result<LicenseOffer, Error> {
        get_offer(&env, offer_id)
    }

    pub fn patent_count(env: Env) -> u32 {
        get_patent_count(&env)
    }

    pub fn offer_count(env: Env) -> u32 {
        get_offer_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_verifier(env: Env) -> Result<Address, Error> {
        get_verifier(&env)
    }

    pub fn paused(env: Env) -> bool {
        is_paused(&env)
    }

    fn assert_text(value: &String) -> Result<(), Error> {
        if value.len() == 0 {
            return Err(Error::EmptyField);
        }
        Ok(())
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_active(env: &Env) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, admin: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        admin.require_auth();
        if get_admin(env)? != *admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_verifier_or_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = get_admin(env)?;
        let verifier = get_verifier(env)?;
        if *caller != admin && *caller != verifier {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
