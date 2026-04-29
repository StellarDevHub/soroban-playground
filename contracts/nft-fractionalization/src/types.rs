use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    VaultNotFound = 4,
    VaultAlreadyExists = 5,
    InsufficientShares = 6,
    BuyoutThresholdNotMet = 7,
    VaultNotActive = 8,
    ZeroAmount = 9,
    InvalidShares = 10,
    InvalidBuyoutPrice = 11,
    AlreadyRedeemed = 12,
}

/// Status of a fractionalized NFT vault.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultStatus {
    /// NFT is locked, shares are tradable.
    Active,
    /// Buyout initiated, pending completion.
    BuyoutPending,
    /// NFT has been released to the buyout winner.
    Redeemed,
}

/// A vault holding a fractionalized NFT.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Vault {
    pub id: u32,
    /// Original NFT depositor / creator.
    pub depositor: Address,
    /// The NFT contract address.
    pub nft_contract: Address,
    /// NFT token ID (represented as a u64 for Soroban compatibility).
    pub nft_token_id: u64,
    /// NFT metadata URI hash.
    pub metadata_hash: String,
    /// Total number of shares issued.
    pub total_shares: i128,
    /// Shares still held by the depositor.
    pub depositor_shares: i128,
    /// Minimum price (in payment token) required for a full buyout.
    pub buyout_price: i128,
    /// Current vault status.
    pub status: VaultStatus,
    /// Timestamp when the vault was created.
    pub created_at: u64,
    /// Address of the buyout winner (set when status = Redeemed).
    pub buyout_winner: Option<Address>,
}

/// A share holding record for an address in a vault.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ShareHolding {
    pub vault_id: u32,
    pub holder: Address,
    pub shares: i128,
}
