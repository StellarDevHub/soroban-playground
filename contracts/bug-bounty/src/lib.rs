#![no_std]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec};

#[contract]
pub struct BugBountyContract;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BountyStatus {
    Open,
    UnderReview,
    Resolved,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BugReport {
    pub id: u32,
    pub reporter: Address,
    pub title: String,
    pub target: String,
    pub severity: Severity,
    pub status: BountyStatus,
    pub reward: u128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    NextReportId,
    Report(u32),
    ReportsByReporter(Address),
    IsPaused,
}

const EVENT_REPORT_SUBMITTED: Symbol = symbol_short!("SUBMIT");
const EVENT_REPORT_REVIEWED: Symbol = symbol_short!("REVIEW");
const EVENT_PAUSED: Symbol = symbol_short!("PAUSE");
const EVENT_UNPAUSED: Symbol = symbol_short!("UNPAUSE");

#[contractimpl]
impl BugBountyContract {
    /// Initialize the contract with an admin.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextReportId, &1u32);
        env.storage().instance().set(&DataKey::IsPaused, &false);
    }

    /// Submit a new bug report.
    pub fn submit_bug(env: Env, reporter: Address, title: String, target: String, severity: Severity) -> u32 {
        reporter.require_auth();
        assert!(!Self::is_paused(&env), "Contract is paused");

        let id = env.storage().instance().get(&DataKey::NextReportId).unwrap_or(1u32);
        
        let report = BugReport {
            id,
            reporter: reporter.clone(),
            title: title.clone(),
            target,
            severity,
            status: BountyStatus::Open,
            reward: 0,
        };

        env.storage().persistent().set(&DataKey::Report(id), &report);
        env.storage().instance().set(&DataKey::NextReportId, &(id + 1));

        // Update reporter's list of reports
        let mut user_reports: Vec<u32> = env.storage().persistent().get(&DataKey::ReportsByReporter(reporter.clone())).unwrap_or(Vec::new(&env));
        user_reports.push_back(id);
        env.storage().persistent().set(&DataKey::ReportsByReporter(reporter.clone()), &user_reports);

        env.events().publish((EVENT_REPORT_SUBMITTED, reporter), id);
        id
    }

    /// Review a bug report and assign a reward (Admin only).
    pub fn review_bug(env: Env, admin: Address, id: u32, status: BountyStatus, reward: u128) {
        admin.require_auth();
        assert!(!Self::is_paused(&env), "Contract is paused");
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized");
        }

        let mut report: BugReport = env.storage().persistent().get(&DataKey::Report(id)).expect("Report not found");
        report.status = status.clone();
        report.reward = reward;

        env.storage().persistent().set(&DataKey::Report(id), &report);
        env.events().publish((EVENT_REPORT_REVIEWED, id), (status, reward));
    }

    /// Retrieve a bug report by ID.
    pub fn get_report(env: Env, id: u32) -> BugReport {
        env.storage().persistent().get(&DataKey::Report(id)).expect("Report not found")
    }

    /// Emergency pause (Admin only).
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized");
        }
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events().publish((EVENT_PAUSED,), ());
    }

    /// Unpause contract (Admin only).
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
