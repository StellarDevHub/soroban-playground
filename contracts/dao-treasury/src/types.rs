use soroban_sdk::{contracterror, contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,                  // Address
    Threshold,              // u32
    SignerCount,            // u32
    Signer(Address),        // Signer
    TxCount,                // u32
    Tx(u32),                // Transaction
    Approval(u32, Address), // bool
    IsPaused,               // bool
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum Role {
    Viewer = 0,
    Operator = 1,
    Admin = 2,
    Owner = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signer {
    pub address: Address,
    pub role: Role,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TxStatus {
    Pending,
    Queued,
    Executed,
    Cancelled,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transaction {
    pub id: u32,
    pub proposer: Address,
    pub description: soroban_sdk::String,
    pub amount: i128,
    pub recipient: Option<Address>,
    pub status: TxStatus,
    pub approvals: u32,
    pub created_at: u64,
    pub execute_after: u64,
    pub expires_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidThreshold = 4,
    SignerAlreadyExists = 5,
    SignerNotFound = 6,
    EmptyDescription = 7,
    TransactionNotPending = 8,
    TransactionNotQueued = 9,
    TransactionExpired = 10,
    AlreadyApproved = 11,
    TimelockActive = 12,
    ContractPaused = 13,
    InsufficientBalance = 14,
}
