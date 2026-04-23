#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

const TOTAL_DONATIONS: Symbol = symbol_short!("TOTAL");
const DONORS: Symbol = symbol_short!("DONORS");

#[contract]
pub struct DonationTracker;

#[contractimpl]
impl DonationTracker {
    /// Increments the total donation amount and tracks the donor's contribution
    pub fn donate(env: Env, donor: Address, amount: i128) -> i128 {
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        // Require donor's authorization
        donor.require_auth();

        // Update Total Donations
        let mut total: i128 = env.storage().instance().get(&TOTAL_DONATIONS).unwrap_or(0);
        total += amount;
        env.storage().instance().set(&TOTAL_DONATIONS, &total);

        // Update individual donor contribution
        // We use donor address as the key
        let mut donor_total: i128 = env.storage().persistent().get(&donor).unwrap_or(0);
        donor_total += amount;
        env.storage().persistent().set(&donor, &donor_total);

        total
    }

    /// Returns the total amount of donations tracked
    pub fn get_total(env: Env) -> i128 {
        env.storage().instance().get(&TOTAL_DONATIONS).unwrap_or(0)
    }

    /// Returns the total donated by a specific address
    pub fn get_donor_amount(env: Env, donor: Address) -> i128 {
        env.storage().persistent().get(&donor).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_donation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, DonationTracker);
        let client = DonationTrackerClient::new(&env, &contract_id);

        let donor = Address::generate(&env);
        
        env.mock_all_auths();

        let total = client.donate(&donor, &100);
        assert_eq!(total, 100);
        assert_eq!(client.get_total(), 100);
        assert_eq!(client.get_donor_amount(&donor), 100);

        client.donate(&donor, &50);
        assert_eq!(client.get_total(), 150);
        assert_eq!(client.get_donor_amount(&donor), 150);
    }
}
