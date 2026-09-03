#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String};

const INSTANCE_BUMP_THRESHOLD: u32 = 17_280;
const INSTANCE_EXTEND_TO: u32 = 518_400;
const PERSISTENT_BUMP_THRESHOLD: u32 = 17_280;
const PERSISTENT_EXTEND_TO: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CharityError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidParameters = 4,
    CampaignNotFound = 5,
    MilestoneNotFound = 6,
    MilestoneAlreadyCompleted = 7,
    InsufficientFunds = 8,
    CampaignNotActive = 9,
    MilestoneNotApproved = 10,
    DonationFailed = 11,
    InvalidMilestoneStatus = 12,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CharityCampaign {
    pub id: u32,
    pub organizer: Address,
    pub charity_name: String,
    pub description: String,
    pub goal_amount: i128,
    pub raised_amount: i128,
    pub milestone_count: u32,
    pub active: bool,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub id: u32,
    pub campaign_id: u32,
    pub description: String,
    pub target_amount: i128,
    pub released_amount: i128,
    pub completed: bool,
    pub verified: bool,
    pub proof_hash: String,
    pub completed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Donation {
    pub id: u32,
    pub campaign_id: u32,
    pub donor: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub receipt_issued: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DonorImpact {
    pub donor: Address,
    pub campaign_id: u32,
    pub total_donated: i128,
    pub allocated_amount: i128,
    pub milestones_supported: u32,
    pub last_donation_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneValidation {
    pub campaign_id: u32,
    pub milestone_id: u32,
    pub votes_for: u32,
    pub votes_against: u32,
    pub validation_status: bool,
    pub proof_hash: String,
    pub verified_at: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    CampaignCount,
    DonationCount,
    Campaign(u32),
    Milestone(u32, u32),
    Donation(u32),
    CampaignDonations(u32, u32),
    TotalDonations(u32),
    MilestoneReleaseStatus(u32, u32),
    DonorImpact(Address, u32),
    MilestoneValidation(u32, u32),
    DAOValidator(Address),
    MilestoneValidatorVote(u32, u32, Address),
}

#[contract]
pub struct CharityTrackerContract;

#[contractimpl]
impl CharityTrackerContract {
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), CharityError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CharityError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::CampaignCount, &0u32);
        env.storage().instance().set(&DataKey::DonationCount, &0u32);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_EXTEND_TO);
        Ok(())
    }

    pub fn create_campaign(
        env: Env,
        organizer: Address,
        charity_name: String,
        description: String,
        goal_amount: i128,
        milestone_count: u32,
    ) -> Result<u32, CharityError> {
        organizer.require_auth();

        if goal_amount <= 0 || milestone_count == 0 || milestone_count > 20 {
            return Err(CharityError::InvalidParameters);
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CampaignCount)
            .unwrap_or(0);
        let id = count + 1;

        let campaign = CharityCampaign {
            id,
            organizer: organizer.clone(),
            charity_name,
            description,
            goal_amount,
            raised_amount: 0,
            milestone_count,
            active: true,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Campaign(id), &campaign);
        env.storage()
            .instance()
            .set(&DataKey::CampaignCount, &id);
        env.storage()
            .instance()
            .set(&DataKey::TotalDonations(id), &0u32);

        env.events()
            .publish((symbol_short!("ch"), symbol_short!("campaign")), id);
        Ok(id)
    }

    pub fn add_milestone(
        env: Env,
        organizer: Address,
        campaign_id: u32,
        milestone_id: u32,
        description: String,
        target_amount: i128,
    ) -> Result<(), CharityError> {
        organizer.require_auth();

        let campaign: CharityCampaign = env
            .storage()
            .instance()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(CharityError::CampaignNotFound)?;

        if campaign.organizer != organizer {
            return Err(CharityError::Unauthorized);
        }

        if milestone_id == 0 || milestone_id > campaign.milestone_count {
            return Err(CharityError::InvalidParameters);
        }

        if target_amount <= 0 {
            return Err(CharityError::InvalidParameters);
        }

        let milestone = Milestone {
            id: milestone_id,
            campaign_id,
            description,
            target_amount,
            released_amount: 0,
            completed: false,
            verified: false,
            proof_hash: String::from_str(&env, ""),
            completed_at: 0,
        };

        env.storage().persistent().set(
            &DataKey::Milestone(campaign_id, milestone_id),
            &milestone,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::Milestone(campaign_id, milestone_id),
            PERSISTENT_BUMP_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );

        env.events().publish(
            (symbol_short!("ch"), symbol_short!("milestone")),
            (campaign_id, milestone_id),
        );
        Ok(())
    }

    pub fn donate(
        env: Env,
        donor: Address,
        campaign_id: u32,
        amount: i128,
    ) -> Result<u32, CharityError> {
        donor.require_auth();

        if amount <= 0 {
            return Err(CharityError::InvalidParameters);
        }

        let mut campaign: CharityCampaign = env
            .storage()
            .instance()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(CharityError::CampaignNotFound)?;

        if !campaign.active {
            return Err(CharityError::CampaignNotActive);
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DonationCount)
            .unwrap_or(0);
        let id = count + 1;

        let donation = Donation {
            id,
            campaign_id,
            donor: donor.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
            receipt_issued: false,
        };

        env.storage().instance().set(&DataKey::Donation(id), &donation);
        env.storage()
            .instance()
            .set(&DataKey::DonationCount, &id);

        let donation_index: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalDonations(campaign_id))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::CampaignDonations(campaign_id, donation_index),
            &id,
        );
        env.storage()
            .instance()
            .set(&DataKey::TotalDonations(campaign_id), &(donation_index + 1));

        let impact_key = DataKey::DonorImpact(donor.clone(), campaign_id);
        let mut impact: DonorImpact = env
            .storage()
            .persistent()
            .get(&impact_key)
            .unwrap_or(DonorImpact {
                donor: donor.clone(),
                campaign_id,
                total_donated: 0,
                allocated_amount: 0,
                milestones_supported: 0,
                last_donation_timestamp: env.ledger().timestamp(),
            });
        impact.total_donated += amount;
        impact.last_donation_timestamp = env.ledger().timestamp();
        env.storage().persistent().set(&impact_key, &impact);

        campaign.raised_amount += amount;
        if campaign.raised_amount >= campaign.goal_amount {
            campaign.active = false;
        }
        env.storage()
            .instance()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(CharityError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&donor, &env.current_contract_address(), &amount);

        env.events().publish(
            (symbol_short!("ch"), symbol_short!("donate")),
            (campaign_id, donor, amount),
        );

        Ok(id)
    }

    pub fn complete_milestone(
        env: Env,
        organizer: Address,
        campaign_id: u32,
        milestone_id: u32,
        proof_hash: String,
    ) -> Result<(), CharityError> {
        organizer.require_auth();

        let campaign: CharityCampaign = env
            .storage()
            .instance()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(CharityError::CampaignNotFound)?;

        if campaign.organizer != organizer {
            return Err(CharityError::Unauthorized);
        }

        let key = DataKey::Milestone(campaign_id, milestone_id);
        let mut milestone: Milestone = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(CharityError::MilestoneNotFound)?;

        if milestone.completed {
            return Err(CharityError::MilestoneAlreadyCompleted);
        }

        milestone.completed = true;
        milestone.proof_hash = proof_hash;
        milestone.completed_at = env.ledger().timestamp();
        env.storage().persistent().set(&key, &milestone);

        env.events().publish(
            (symbol_short!("ch"), symbol_short!("complete")),
            (campaign_id, milestone_id),
        );
        Ok(())
    }

    pub fn verify_milestone(
        env: Env,
        admin: Address,
        campaign_id: u32,
        milestone_id: u32,
    ) -> Result<i128, CharityError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CharityError::NotInitialized)?;
        if admin != stored_admin {
            return Err(CharityError::Unauthorized);
        }

        let key = DataKey::Milestone(campaign_id, milestone_id);
        let mut milestone: Milestone = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(CharityError::MilestoneNotFound)?;

        if !milestone.completed {
            return Err(CharityError::MilestoneNotApproved);
        }

        if milestone.verified {
            return Err(CharityError::MilestoneAlreadyCompleted);
        }

        milestone.verified = true;
        milestone.released_amount = milestone.target_amount;
        env.storage().persistent().set(&key, &milestone);

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(CharityError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token);
        let balance = token_client.balance(&env.current_contract_address());
        let release_amount = milestone.target_amount.min(balance);
        if release_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stored_admin,
                &release_amount,
            );
        }

        env.events().publish(
            (symbol_short!("ch"), symbol_short!("verified")),
            (campaign_id, milestone_id, milestone.target_amount),
        );

        Ok(milestone.target_amount)
    }

    pub fn get_campaign(env: Env, campaign_id: u32) -> Result<CharityCampaign, CharityError> {
        env.storage()
            .instance()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(CharityError::CampaignNotFound)
    }

    pub fn get_milestone(
        env: Env,
        campaign_id: u32,
        milestone_id: u32,
    ) -> Result<Milestone, CharityError> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestone(campaign_id, milestone_id))
            .ok_or(CharityError::MilestoneNotFound)
    }

    pub fn get_donation(env: Env, donation_id: u32) -> Result<Donation, CharityError> {
        env.storage()
            .instance()
            .get(&DataKey::Donation(donation_id))
            .ok_or(CharityError::DonationFailed)
    }

    pub fn get_total_donations(env: Env, campaign_id: u32) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalDonations(campaign_id))
            .unwrap_or(0)
    }

    pub fn add_dao_validator(
        env: Env,
        admin: Address,
        validator: Address,
    ) -> Result<(), CharityError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CharityError::NotInitialized)?;
        if admin != stored_admin {
            return Err(CharityError::Unauthorized);
        }
        let val_key = DataKey::DAOValidator(validator);
        env.storage().persistent().set(&val_key, &true);
        env.storage().persistent().extend_ttl(
            &val_key,
            PERSISTENT_BUMP_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
        Ok(())
    }

    pub fn allocate_direct_impact(
        env: Env,
        donor: Address,
        campaign_id: u32,
        milestone_id: u32,
        amount: i128,
    ) -> Result<(), CharityError> {
        donor.require_auth();
        if amount <= 0 {
            return Err(CharityError::InvalidParameters);
        }

        let campaign: CharityCampaign = env
            .storage()
            .instance()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(CharityError::CampaignNotFound)?;

        if milestone_id == 0 || milestone_id > campaign.milestone_count {
            return Err(CharityError::InvalidParameters);
        }

        let milestone_key = DataKey::Milestone(campaign_id, milestone_id);
        if !env.storage().persistent().has(&milestone_key) {
            return Err(CharityError::MilestoneNotFound);
        }

        let impact_key = DataKey::DonorImpact(donor.clone(), campaign_id);
        let mut impact: DonorImpact = env
            .storage()
            .persistent()
            .get(&impact_key)
            .unwrap_or(DonorImpact {
                donor: donor.clone(),
                campaign_id,
                total_donated: 0,
                allocated_amount: 0,
                milestones_supported: 0,
                last_donation_timestamp: env.ledger().timestamp(),
            });

        impact.allocated_amount += amount;
        impact.milestones_supported += 1;
        impact.last_donation_timestamp = env.ledger().timestamp();

        env.storage().persistent().set(&impact_key, &impact);
        env.storage().persistent().extend_ttl(
            &impact_key,
            PERSISTENT_BUMP_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );

        env.events().publish(
            (symbol_short!("ch"), symbol_short!("impact")),
            (campaign_id, milestone_id, donor, amount),
        );
        Ok(())
    }

    pub fn vote_validate_milestone(
        env: Env,
        validator: Address,
        campaign_id: u32,
        milestone_id: u32,
        approve: bool,
    ) -> Result<(), CharityError> {
        validator.require_auth();

        let is_dao_validator: bool = env
            .storage()
            .persistent()
            .get(&DataKey::DAOValidator(validator.clone()))
            .unwrap_or(false);

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CharityError::NotInitialized)?;

        if !is_dao_validator && validator != stored_admin {
            return Err(CharityError::Unauthorized);
        }

        let vote_key = DataKey::MilestoneValidatorVote(campaign_id, milestone_id, validator.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(CharityError::InvalidMilestoneStatus);
        }

        let milestone_key = DataKey::Milestone(campaign_id, milestone_id);
        let mut milestone: Milestone = env
            .storage()
            .persistent()
            .get(&milestone_key)
            .ok_or(CharityError::MilestoneNotFound)?;

        if !milestone.completed {
            return Err(CharityError::MilestoneNotApproved);
        }

        let val_key = DataKey::MilestoneValidation(campaign_id, milestone_id);
        let mut validation: MilestoneValidation = env
            .storage()
            .persistent()
            .get(&val_key)
            .unwrap_or(MilestoneValidation {
                campaign_id,
                milestone_id,
                votes_for: 0,
                votes_against: 0,
                validation_status: false,
                proof_hash: milestone.proof_hash.clone(),
                verified_at: 0,
            });

        if approve {
            validation.votes_for += 1;
        } else {
            validation.votes_against += 1;
        }

        env.storage().persistent().set(&vote_key, &true);

        if validation.votes_for >= 1 && !milestone.verified {
            milestone.verified = true;
            milestone.released_amount = milestone.target_amount;
            validation.validation_status = true;
            validation.verified_at = env.ledger().timestamp();
            env.storage().persistent().set(&milestone_key, &milestone);

            let token: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(CharityError::NotInitialized)?;
            let token_client = token::Client::new(&env, &token);
            let balance = token_client.balance(&env.current_contract_address());
            let release_amount = milestone.target_amount.min(balance);
            if release_amount > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &stored_admin,
                    &release_amount,
                );
            }
        }

        env.storage().persistent().set(&val_key, &validation);

        env.events().publish(
            (symbol_short!("ch"), symbol_short!("validate")),
            (campaign_id, milestone_id, approve),
        );
        Ok(())
    }

    pub fn get_donor_impact(
        env: Env,
        donor: Address,
        campaign_id: u32,
    ) -> Result<DonorImpact, CharityError> {
        env.storage()
            .persistent()
            .get(&DataKey::DonorImpact(donor, campaign_id))
            .ok_or(CharityError::InvalidParameters)
    }

    pub fn get_milestone_validation(
        env: Env,
        campaign_id: u32,
        milestone_id: u32,
    ) -> Result<MilestoneValidation, CharityError> {
        env.storage()
            .persistent()
            .get(&DataKey::MilestoneValidation(campaign_id, milestone_id))
            .ok_or(CharityError::MilestoneNotFound)
    }
}

mod test;
