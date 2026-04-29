#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String, Vec, Map,
};

mod test;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    Signers,
    Threshold,
    ProposalCount,
    Proposal(u64),
    Execution(u64),
    Treasury,
}

#[derive(Clone)]
#[contracttype]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub token: Address,
    pub description: String,
    pub signatures: Vec<Address>,
    pub executed: bool,
    pub created_at: u64,
    pub expires_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct TreasuryInfo {
    pub total_balance: i128,
    pub total_proposals: u64,
    pub executed_proposals: u64,
    pub pending_proposals: u64,
}

#[contract]
pub struct DaoTreasuryContract;

#[contractimpl]
impl DaoTreasuryContract {
    pub fn initialize(env: Env, admin: Address, signers: Vec<Address>, threshold: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }

        if threshold == 0 || threshold > signers.len() {
            panic!("Invalid threshold");
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);

        env.events().publish(
            (String::from_str(&env, "initialized"),),
            (admin, signers.len(), threshold),
        );
    }

    pub fn create_proposal(
        env: Env,
        proposer: Address,
        recipient: Address,
        amount: i128,
        token: Address,
        description: String,
        duration: u64,
    ) -> u64 {
        proposer.require_auth();
        Self::require_not_paused(&env);
        Self::require_signer(&env, &proposer);

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let proposal_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        let proposal_id = proposal_count + 1;

        let current_time = env.ledger().timestamp();
        let mut signatures = Vec::new(&env);
        signatures.push_back(proposer.clone());

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            recipient,
            amount,
            token,
            description,
            signatures,
            executed: false,
            created_at: current_time,
            expires_at: current_time + duration,
        };

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &proposal_id);

        env.events().publish(
            (String::from_str(&env, "proposal_created"),),
            (proposal_id, proposer, amount),
        );

        proposal_id
    }

    pub fn sign_proposal(env: Env, signer: Address, proposal_id: u64) {
        signer.require_auth();
        Self::require_not_paused(&env);
        Self::require_signer(&env, &signer);

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.executed {
            panic!("Proposal already executed");
        }

        let current_time = env.ledger().timestamp();
        if current_time > proposal.expires_at {
            panic!("Proposal expired");
        }

        for i in 0..proposal.signatures.len() {
            if proposal.signatures.get(i).unwrap() == signer {
                panic!("Already signed");
            }
        }

        proposal.signatures.push_back(signer.clone());

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (String::from_str(&env, "proposal_signed"),),
            (proposal_id, signer, proposal.signatures.len()),
        );
    }

    pub fn execute_proposal(env: Env, executor: Address, proposal_id: u64) {
        executor.require_auth();
        Self::require_not_paused(&env);

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.executed {
            panic!("Proposal already executed");
        }

        let current_time = env.ledger().timestamp();
        if current_time > proposal.expires_at {
            panic!("Proposal expired");
        }

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .expect("Threshold not set");

        if proposal.signatures.len() < threshold {
            panic!("Insufficient signatures");
        }

        let token_client = token::Client::new(&env, &proposal.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &proposal.recipient, &proposal.amount);

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (String::from_str(&env, "proposal_executed"),),
            (proposal_id, proposal.recipient, proposal.amount),
        );
    }

    pub fn deposit(env: Env, depositor: Address, token: Address, amount: i128) {
        depositor.require_auth();
        Self::require_not_paused(&env);

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&depositor, &contract_address, &amount);

        env.events().publish(
            (String::from_str(&env, "deposit"),),
            (depositor, amount),
        );
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        env.storage().instance().get(&DataKey::Proposal(proposal_id))
    }

    pub fn get_treasury_info(env: Env, token: Address) -> TreasuryInfo {
        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        let balance = token_client.balance(&contract_address);

        let proposal_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);

        let mut executed = 0u64;
        let mut pending = 0u64;

        for i in 1..=proposal_count {
            if let Some(proposal) = Self::get_proposal(env.clone(), i) {
                if proposal.executed {
                    executed += 1;
                } else {
                    pending += 1;
                }
            }
        }

        TreasuryInfo {
            total_balance: balance,
            total_proposals: proposal_count,
            executed_proposals: executed,
            pending_proposals: pending,
        }
    }

    pub fn get_signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).unwrap_or(0)
    }

    pub fn add_signer(env: Env, admin: Address, new_signer: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        Self::require_not_paused(&env);

        let mut signers: Vec<Address> = Self::get_signers(env.clone());
        
        for i in 0..signers.len() {
            if signers.get(i).unwrap() == new_signer {
                panic!("Signer already exists");
            }
        }

        signers.push_back(new_signer.clone());
        env.storage().instance().set(&DataKey::Signers, &signers);

        env.events().publish(
            (String::from_str(&env, "signer_added"),),
            new_signer,
        );
    }

    pub fn remove_signer(env: Env, admin: Address, signer: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        Self::require_not_paused(&env);

        let mut signers: Vec<Address> = Self::get_signers(env.clone());
        let threshold: u32 = Self::get_threshold(env.clone());

        if signers.len() <= threshold as u32 {
            panic!("Cannot remove signer: would fall below threshold");
        }

        let mut new_signers = Vec::new(&env);
        let mut found = false;

        for i in 0..signers.len() {
            let current = signers.get(i).unwrap();
            if current != signer {
                new_signers.push_back(current);
            } else {
                found = true;
            }
        }

        if !found {
            panic!("Signer not found");
        }

        env.storage().instance().set(&DataKey::Signers, &new_signers);

        env.events().publish(
            (String::from_str(&env, "signer_removed"),),
            signer,
        );
    }

    pub fn update_threshold(env: Env, admin: Address, new_threshold: u32) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        Self::require_not_paused(&env);

        let signers: Vec<Address> = Self::get_signers(env.clone());

        if new_threshold == 0 || new_threshold > signers.len() {
            panic!("Invalid threshold");
        }

        env.storage().instance().set(&DataKey::Threshold, &new_threshold);

        env.events().publish(
            (String::from_str(&env, "threshold_updated"),),
            new_threshold,
        );
    }

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &true);

        env.events()
            .publish((String::from_str(&env, "paused"),), admin);
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);

        env.events()
            .publish((String::from_str(&env, "unpaused"),), admin);
    }

    fn require_admin(env: &Env, address: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        if admin != *address {
            panic!("Unauthorized: admin only");
        }
    }

    fn require_signer(env: &Env, address: &Address) {
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or(Vec::new(env));

        for i in 0..signers.len() {
            if signers.get(i).unwrap() == *address {
                return;
            }
        }
        panic!("Unauthorized: not a signer");
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("Contract is paused");
        }
    }
}
