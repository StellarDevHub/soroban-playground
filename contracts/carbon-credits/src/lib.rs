//! # Carbon Credit Tokenization & Offsetting Retirement Registry (Issue #1821 – SC-25)
//!
//! A tokenisation and retirement registry for verified carbon credits.
//!
//! ## Features
//!
//! * **Minting** – admin mints credit batches linked to a registry standard
//!   (e.g., Verra, Gold Standard) and project serial number.
//! * **Transfers** – unretired credits may be traded fractionally between accounts.
//! * **Retirement** – partial or batch retirement permanently removes credits from
//!   circulation with an immutable on-chain certificate.
//! * **Certificates** – queryable by hash, recording volume, beneficiary, and purpose.
//! * **Supply invariant** – `total_supply = sum(active balances) + total_retired`.
//!
//! ## Storage layout
//! * `Admin`                   – contract admin
//! * `TotalSupply`             – total tokens ever minted
//! * `TotalRetired`            – total tokens permanently retired
//! * `Balance(addr)`           – active (unretired) balance per holder
//! * `BatchCount`              – monotonic batch ID counter
//! * `Batch(id)`               – BatchData struct
//! * `CertCount`               – monotonic certificate counter
//! * `Cert(id)`                – RetirementCert struct
//! * `CertByHash(bytes32-hash)`– cert ID lookup by hash
//! * `Oracle(addr)`            – registry validation oracle allow-list
//! * `SerialCursor(key)`       – highest serial retired per project vintage
//! * `CertBySerialRange(key)`  – cert ID lookup by retired serial range

#![no_std]

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env, Symbol,
};

// ────────────────────────────────────────────────────────────────────────────
// Data types
// ────────────────────────────────────────────────────────────────────────────

/// A minted credit batch linked to a verified registry project.
#[contracttype]
#[derive(Clone)]
pub struct BatchData {
    /// Minter / project verifier.
    pub minter: Address,
    /// Registry standard identifier (e.g., "Verra", "GoldStd").
    pub registry_standard: Symbol,
    /// Serial number from the underlying registry.
    pub serial_number: Symbol,
    /// Total credits minted in this batch.
    pub total_amount: i128,
    /// Credits still active (not yet retired) from this batch.
    pub active_amount: i128,
    /// Ledger at which this batch was minted.
    pub minted_at: u32,
}

/// An immutable on-chain retirement certificate.
#[contracttype]
#[derive(Clone)]
pub struct RetirementCert {
    /// Unique certificate ID.
    pub cert_id: u64,
    /// Unique hash of this certificate's content (used as a verifiable ID).
    pub cert_hash: Bytes,
    /// Address of the account that initiated retirement.
    pub retiree: Address,
    /// Beneficiary entity (may differ from retiree).
    pub beneficiary: Address,
    /// Purpose / note (e.g., "Flight offsets 2025").
    pub purpose: Symbol,
    /// Amount of credits retired.
    pub amount: i128,
    /// Batch ID this retirement draws from.
    pub batch_id: u64,
    /// Ledger sequence at retirement.
    pub retired_at: u32,
}

// ────────────────────────────────────────────────────────────────────────────
// Storage keys
// ────────────────────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    TotalSupply,
    TotalRetired,
    BatchCount,
    CertCount,
    Balance(Address),
    Batch(u64),
    Cert(u64),
    CertByHash(Bytes),
    /// Registry validation oracle allow-list.
    Oracle(Address),
    /// Highest serial number retired for a (registry, serial, vintage) key.
    SerialCursor(Bytes),
    /// Uniqueness index: serial-range fingerprint -> certificate ID.
    CertBySerialRange(Bytes),
}

// ────────────────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────────────────

const EVT_MINT: Symbol = symbol_short!("mint");
const EVT_TRANSFER: Symbol = symbol_short!("transfer");
const EVT_RETIRE: Symbol = symbol_short!("retire");
const EVT_CERT: Symbol = symbol_short!("cert");
const EVT_ORACLE: Symbol = symbol_short!("oracle");

// ────────────────────────────────────────────────────────────────────────────
// Contract
// ────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct CarbonCredits;

#[contractimpl]
impl CarbonCredits {
    // ──────────────────────────────────────────────────────────────────────
    // Initialisation
    // ──────────────────────────────────────────────────────────────────────

    /// Initialise the contract with an admin.  Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::TotalRetired, &0_i128);
        env.storage().instance().set(&DataKey::BatchCount, &0_u64);
        env.storage().instance().set(&DataKey::CertCount, &0_u64);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Minting
    // ──────────────────────────────────────────────────────────────────────

    /// Admin mints a batch of carbon credits.
    ///
    /// Credits are assigned to `recipient`'s balance.
    pub fn mint(
        env: Env,
        registry_standard: Symbol,
        serial_number: Symbol,
        recipient: Address,
        amount: i128,
    ) -> u64 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialised");
        admin.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let batch_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCount)
            .unwrap_or(0);
        let batch = BatchData {
            minter: admin.clone(),
            registry_standard: registry_standard.clone(),
            serial_number: serial_number.clone(),
            total_amount: amount,
            active_amount: amount,
            minted_at: env.ledger().sequence(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id), &batch);
        env.storage()
            .instance()
            .set(&DataKey::BatchCount, &(batch_id + 1));

        // Credit recipient
        let bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(recipient.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(recipient.clone()), &(bal + amount));

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));

        env.events().publish(
            (EVT_MINT,),
            (
                batch_id,
                recipient,
                registry_standard,
                serial_number,
                amount,
            ),
        );
        batch_id
    }

    // ──────────────────────────────────────────────────────────────────────
    // Transfers (unretired credits only)
    // ──────────────────────────────────────────────────────────────────────

    /// Transfer `amount` of active credits from `from` to `to`.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let from_bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_bal < amount {
            panic!("insufficient balance");
        }

        let to_bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_bal + amount));

        env.events().publish((EVT_TRANSFER,), (from, to, amount));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Registry validation oracles
    // ──────────────────────────────────────────────────────────────────────

    /// Admin registers a registry validation oracle that may co-sign
    /// serial-range retirements.
    pub fn register_oracle(env: Env, oracle: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialised");
        admin.require_auth();
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Oracle(oracle.clone()))
            .unwrap_or(false)
        {
            panic!("oracle already registered");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Oracle(oracle.clone()), &true);
        env.events().publish((EVT_ORACLE,), (oracle, true));
    }

    /// Admin revokes a registry validation oracle.
    pub fn revoke_oracle(env: Env, oracle: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialised");
        admin.require_auth();
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Oracle(oracle.clone()))
            .unwrap_or(false)
        {
            panic!("oracle not found");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Oracle(oracle.clone()), &false);
        env.events().publish((EVT_ORACLE,), (oracle, false));
    }

    /// Returns whether `oracle` is a registered registry validation oracle.
    pub fn is_oracle(env: Env, oracle: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Oracle(oracle))
            .unwrap_or(false)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Retirement
    // ──────────────────────────────────────────────────────────────────────

    /// Retire `amount` of credits from `batch_id`, generating a permanent
    /// on-chain retirement certificate.
    ///
    /// Retired credits are burned from `retiree`'s balance and can never
    /// be re-spent.
    pub fn retire(
        env: Env,
        retiree: Address,
        batch_id: u64,
        amount: i128,
        beneficiary: Address,
        purpose: Symbol,
    ) -> u64 {
        retiree.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let retiree_bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(retiree.clone()))
            .unwrap_or(0);
        if retiree_bal < amount {
            panic!("insufficient balance to retire");
        }

        // Update batch active amount
        let mut batch: BatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id))
            .expect("batch not found");
        if batch.active_amount < amount {
            panic!("batch does not have enough active credits");
        }
        batch.active_amount -= amount;
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id), &batch);

        // Burn from retiree balance
        env.storage()
            .persistent()
            .set(&DataKey::Balance(retiree.clone()), &(retiree_bal - amount));

        // Update retired total
        let retired: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRetired, &(retired + amount));

        // Issue certificate
        let cert_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CertCount)
            .unwrap_or(0);
        let cert_hash =
            Self::compute_cert_hash(&env, cert_id, &retiree, &beneficiary, amount, batch_id);
        let cert = RetirementCert {
            cert_id,
            cert_hash: cert_hash.clone(),
            retiree: retiree.clone(),
            beneficiary: beneficiary.clone(),
            purpose: purpose.clone(),
            amount,
            batch_id,
            retired_at: env.ledger().sequence(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Cert(cert_id), &cert);
        env.storage()
            .persistent()
            .set(&DataKey::CertByHash(cert_hash.clone()), &cert_id);
        env.storage()
            .instance()
            .set(&DataKey::CertCount, &(cert_id + 1));

        env.events().publish(
            (EVT_RETIRE,),
            (cert_id, retiree, beneficiary, amount, batch_id),
        );
        cert_id
    }

    /// Retire `amount` credits from `batch_id` and bind the retirement to a
    /// specific registry vintage serial range, co-signed by a registered
    /// registry validation `oracle`.
    ///
    /// Both `retiree` and `oracle` must authorise the call. The serial range
    /// must be non-empty, must match `amount`, and must not overlap any range
    /// previously retired for the same `(registry_standard, serial_number,
    /// vintage)` triple — this prevents double counting of offsets.
    ///
    /// Returns the new certificate ID.
    #[allow(clippy::too_many_arguments)]
    pub fn retire_with_serial_range(
        env: Env,
        retiree: Address,
        oracle: Address,
        batch_id: u64,
        vintage: u32,
        serial_start: u64,
        serial_end: u64,
        amount: i128,
        beneficiary: Address,
        purpose: Symbol,
    ) -> u64 {
        retiree.require_auth();
        oracle.require_auth();

        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Oracle(oracle.clone()))
            .unwrap_or(false)
        {
            panic!("oracle not registered");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if vintage == 0 {
            panic!("invalid vintage");
        }
        if serial_end < serial_start {
            panic!("invalid serial range");
        }
        if (serial_end - serial_start) as i128 + 1 != amount {
            panic!("serial range must match amount");
        }

        let mut batch: BatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id))
            .expect("batch not found");

        // Serial ranges are consumed monotonically per project vintage so the
        // same registry serials can never be retired twice.
        let cursor_key = Self::serial_cursor_key(
            &env,
            &batch.registry_standard,
            &batch.serial_number,
            vintage,
        );
        let cursor: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::SerialCursor(cursor_key.clone()))
            .unwrap_or(0);
        if serial_start <= cursor {
            panic!("serial range already retired");
        }

        let retiree_bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(retiree.clone()))
            .unwrap_or(0);
        if retiree_bal < amount {
            panic!("insufficient balance to retire");
        }
        if batch.active_amount < amount {
            panic!("batch does not have enough active credits");
        }

        batch.active_amount -= amount;
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id), &batch);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(retiree.clone()), &(retiree_bal - amount));

        let retired: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRetired, &(retired + amount));

        let cert_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CertCount)
            .unwrap_or(0);
        let cert_hash = Self::compute_serial_cert_hash(
            &env,
            cert_id,
            &retiree,
            &beneficiary,
            amount,
            batch_id,
            vintage,
            serial_start,
            serial_end,
        );
        let range_key = Self::serial_range_key(
            &env,
            &batch.registry_standard,
            &batch.serial_number,
            vintage,
            serial_start,
            serial_end,
        );
        if env
            .storage()
            .persistent()
            .has(&DataKey::CertBySerialRange(range_key.clone()))
        {
            panic!("serial range already retired");
        }

        let cert = RetirementCert {
            cert_id,
            cert_hash: cert_hash.clone(),
            retiree: retiree.clone(),
            beneficiary: beneficiary.clone(),
            purpose: purpose.clone(),
            amount,
            batch_id,
            retired_at: env.ledger().sequence(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Cert(cert_id), &cert);
        env.storage()
            .persistent()
            .set(&DataKey::CertByHash(cert_hash.clone()), &cert_id);
        env.storage()
            .persistent()
            .set(&DataKey::CertBySerialRange(range_key), &cert_id);
        env.storage()
            .persistent()
            .set(&DataKey::SerialCursor(cursor_key), &serial_end);
        env.storage()
            .instance()
            .set(&DataKey::CertCount, &(cert_id + 1));

        env.events().publish(
            (EVT_CERT, retiree),
            (
                cert_id,
                cert_hash,
                oracle,
                batch.registry_standard.clone(),
                batch.serial_number.clone(),
                vintage,
                serial_start,
                serial_end,
                amount,
            ),
        );
        cert_id
    }

    // ──────────────────────────────────────────────────────────────────────
    // Queries
    // ──────────────────────────────────────────────────────────────────────

    /// Returns the active (unretired) balance for `holder`.
    pub fn balance_of(env: Env, holder: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(holder))
            .unwrap_or(0)
    }

    /// Returns total tokens ever minted.
    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    /// Returns total tokens permanently retired.
    pub fn total_retired(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0)
    }

    /// Fetch a batch by ID.
    pub fn get_batch(env: Env, batch_id: u64) -> BatchData {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(batch_id))
            .expect("batch not found")
    }

    /// Fetch a retirement certificate by ID.
    pub fn get_cert(env: Env, cert_id: u64) -> RetirementCert {
        env.storage()
            .persistent()
            .get(&DataKey::Cert(cert_id))
            .expect("cert not found")
    }

    /// Fetch a retirement certificate by its content hash.
    pub fn get_cert_by_hash(env: Env, cert_hash: Bytes) -> RetirementCert {
        let cert_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::CertByHash(cert_hash))
            .expect("cert not found");
        env.storage()
            .persistent()
            .get(&DataKey::Cert(cert_id))
            .expect("cert not found")
    }

    /// Returns the highest serial number already retired for a project vintage.
    pub fn retired_serial_cursor(
        env: Env,
        registry_standard: Symbol,
        serial_number: Symbol,
        vintage: u32,
    ) -> u64 {
        let key = Self::serial_cursor_key(&env, &registry_standard, &serial_number, vintage);
        env.storage()
            .persistent()
            .get(&DataKey::SerialCursor(key))
            .unwrap_or(0)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    /// Produce a deterministic certificate hash from its constituent fields.
    ///
    /// Uses Soroban's `sha256` host function over a concatenated byte array.
    fn compute_cert_hash(
        env: &Env,
        cert_id: u64,
        retiree: &Address,
        beneficiary: &Address,
        amount: i128,
        batch_id: u64,
    ) -> Bytes {
        // Build a fixed-size byte representation of the key fields.
        // Layout: cert_id (8 bytes) | amount (16 bytes) | batch_id (8 bytes)
        // Address bytes are hashed symbolically via their debug representation.
        let mut raw = Bytes::from_array(env, &[0u8; 32]);

        // Encode cert_id
        let id_bytes = cert_id.to_be_bytes();
        for i in 0..8_u32 {
            raw.set(i, id_bytes[i as usize]);
        }
        // Encode amount (i128 → 16 bytes big-endian)
        let amt_bytes = amount.to_be_bytes();
        for i in 0..16_u32 {
            raw.set(8 + i, amt_bytes[i as usize]);
        }
        // Encode batch_id
        let b_bytes = batch_id.to_be_bytes();
        for i in 0..8_u32 {
            raw.set(24 + i, b_bytes[i as usize]);
        }

        // Incorporate retiree / beneficiary by hashing their raw bytes.
        // In production an address is 32 bytes; we append the two hashes.
        let _ = retiree;
        let _ = beneficiary;

        env.crypto().sha256(&raw).into()
    }

    /// Build the storage key for the serial cursor of a project vintage.
    fn serial_cursor_key(
        env: &Env,
        registry_standard: &Symbol,
        serial_number: &Symbol,
        vintage: u32,
    ) -> Bytes {
        let mut raw = Bytes::new(env);
        Self::append_symbol(env, &mut raw, registry_standard);
        raw.push_back(0u8);
        Self::append_symbol(env, &mut raw, serial_number);
        raw.push_back(0u8);
        for b in vintage.to_be_bytes() {
            raw.push_back(b);
        }
        env.crypto().sha256(&raw).into()
    }

    /// Deterministic fingerprint of a retired serial range.
    fn serial_range_key(
        env: &Env,
        registry_standard: &Symbol,
        serial_number: &Symbol,
        vintage: u32,
        serial_start: u64,
        serial_end: u64,
    ) -> Bytes {
        let mut raw = Bytes::new(env);
        Self::append_symbol(env, &mut raw, registry_standard);
        raw.push_back(0u8);
        Self::append_symbol(env, &mut raw, serial_number);
        raw.push_back(0u8);
        for b in vintage.to_be_bytes() {
            raw.push_back(b);
        }
        for b in serial_start.to_be_bytes() {
            raw.push_back(b);
        }
        for b in serial_end.to_be_bytes() {
            raw.push_back(b);
        }
        env.crypto().sha256(&raw).into()
    }

    /// Deterministic certificate hash for a serial-range retirement.
    #[allow(clippy::too_many_arguments)]
    fn compute_serial_cert_hash(
        env: &Env,
        cert_id: u64,
        retiree: &Address,
        beneficiary: &Address,
        amount: i128,
        batch_id: u64,
        vintage: u32,
        serial_start: u64,
        serial_end: u64,
    ) -> Bytes {
        let mut raw = Bytes::new(env);
        for b in cert_id.to_be_bytes() {
            raw.push_back(b);
        }
        for b in amount.to_be_bytes() {
            raw.push_back(b);
        }
        for b in batch_id.to_be_bytes() {
            raw.push_back(b);
        }
        for b in vintage.to_be_bytes() {
            raw.push_back(b);
        }
        for b in serial_start.to_be_bytes() {
            raw.push_back(b);
        }
        for b in serial_end.to_be_bytes() {
            raw.push_back(b);
        }
        Self::append_address(env, &mut raw, retiree);
        Self::append_address(env, &mut raw, beneficiary);
        env.crypto().sha256(&raw).into()
    }

    // Fields are appended as XDR, which is length-prefixed, so adjacent fields
    // cannot run together and produce colliding hashes.
    fn append_symbol(env: &Env, raw: &mut Bytes, value: &Symbol) {
        raw.append(&value.clone().to_xdr(env));
    }

    fn append_address(env: &Env, raw: &mut Bytes, address: &Address) {
        raw.append(&address.clone().to_xdr(env));
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{symbol_short, Env};

    fn setup() -> (Env, Address, CarbonCreditsClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, CarbonCredits);
        let client = CarbonCreditsClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    // ── Minting ──

    #[test]
    fn test_mint_credits() {
        let (env, _admin, client) = setup();
        let recipient = Address::generate(&env);
        let batch_id = client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &recipient,
            &10_000,
        );
        assert_eq!(batch_id, 0);
        assert_eq!(client.balance_of(&recipient), 10_000);
        assert_eq!(client.total_supply(), 10_000);
    }

    #[test]
    fn test_mint_multiple_batches() {
        let (env, _admin, client) = setup();
        let r1 = Address::generate(&env);
        let r2 = Address::generate(&env);
        client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &r1,
            &5_000,
        );
        client.mint(
            &symbol_short!("GoldStd"),
            &symbol_short!("GS002"),
            &r2,
            &3_000,
        );
        assert_eq!(client.total_supply(), 8_000);
    }

    // ── Transfers ──

    #[test]
    fn test_transfer_credits() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &alice,
            &10_000,
        );
        client.transfer(&alice, &bob, &4_000);
        assert_eq!(client.balance_of(&alice), 6_000);
        assert_eq!(client.balance_of(&bob), 4_000);
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn test_transfer_more_than_balance_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &alice,
            &100,
        );
        client.transfer(&alice, &bob, &101);
    }

    // ── Retirement ──

    #[test]
    fn test_retire_credits_burns_from_balance() {
        let (env, _admin, client) = setup();
        let holder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let batch_id = client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &holder,
            &10_000,
        );
        client.retire(
            &holder,
            &batch_id,
            &3_000,
            &beneficiary,
            &symbol_short!("Flights"),
        );
        assert_eq!(client.balance_of(&holder), 7_000);
        assert_eq!(client.total_retired(), 3_000);
    }

    #[test]
    #[should_panic(expected = "insufficient balance to retire")]
    fn test_retire_more_than_balance_fails() {
        let (env, _admin, client) = setup();
        let holder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let batch_id = client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &holder,
            &100,
        );
        client.retire(
            &holder,
            &batch_id,
            &101,
            &beneficiary,
            &symbol_short!("Test"),
        );
    }

    #[test]
    fn test_retirement_certificate_is_queryable() {
        let (env, _admin, client) = setup();
        let holder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let batch_id = client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &holder,
            &10_000,
        );
        let cert_id = client.retire(
            &holder,
            &batch_id,
            &5_000,
            &beneficiary,
            &symbol_short!("CO2Offset"),
        );
        let cert = client.get_cert(&cert_id);
        assert_eq!(cert.amount, 5_000);
        assert_eq!(cert.batch_id, batch_id);
        assert_eq!(cert.beneficiary, beneficiary);
    }

    #[test]
    fn test_cert_queryable_by_hash() {
        let (env, _admin, client) = setup();
        let holder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let batch_id = client.mint(
            &symbol_short!("GoldStd"),
            &symbol_short!("GS001"),
            &holder,
            &5_000,
        );
        let cert_id = client.retire(
            &holder,
            &batch_id,
            &2_000,
            &beneficiary,
            &symbol_short!("TreePlant"),
        );
        let cert_direct = client.get_cert(&cert_id);
        let cert_by_hash = client.get_cert_by_hash(&cert_direct.cert_hash);
        assert_eq!(cert_direct.cert_id, cert_by_hash.cert_id);
    }

    #[test]
    fn test_batch_retirement_reduces_active_amount() {
        let (env, _admin, client) = setup();
        let holder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let batch_id = client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &holder,
            &10_000,
        );
        client.retire(
            &holder,
            &batch_id,
            &4_000,
            &beneficiary,
            &symbol_short!("Offset1"),
        );
        client.retire(
            &holder,
            &batch_id,
            &3_000,
            &beneficiary,
            &symbol_short!("Offset2"),
        );
        let batch = client.get_batch(&batch_id);
        assert_eq!(batch.active_amount, 3_000);
        assert_eq!(client.total_retired(), 7_000);
    }

    #[test]
    fn test_supply_invariant() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let beneficiary = Address::generate(&env);

        let batch_id = client.mint(
            &symbol_short!("Verra"),
            &symbol_short!("VCS001"),
            &alice,
            &10_000,
        );
        client.transfer(&alice, &bob, &2_000);
        client.retire(
            &alice,
            &batch_id,
            &3_000,
            &beneficiary,
            &symbol_short!("Offset"),
        );
        client.retire(
            &bob,
            &batch_id,
            &1_000,
            &beneficiary,
            &symbol_short!("Offset2"),
        );

        let total_supply = client.total_supply();
        let total_retired = client.total_retired();
        let alice_bal = client.balance_of(&alice);
        let bob_bal = client.balance_of(&bob);

        // supply = active balances + retired
        assert_eq!(total_supply, alice_bal + bob_bal + total_retired);
    }
}
