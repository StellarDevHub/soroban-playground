use soroban_sdk::{contracterror, contracttype, Address, BytesN};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ContractPaused = 3,
    Unauthorized = 4,
    RoundNotFound = 5,
    RoundNotOpen = 6,
    RoundStillOpen = 7,
    RoundAlreadyDrawn = 8,
    RoundCancelled = 9,
    NoTicketsSold = 10,
    AlreadyClaimed = 11,
    NotWinner = 12,
    TicketNotFound = 13,
    InvalidPrice = 14,
    InvalidDuration = 15,
    RoundNotCompleted = 16,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RoundStatus {
    Open,
    Completed,
    Cancelled,
}

/// A single lottery round.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Round {
    pub id: u32,
    pub status: RoundStatus,
    pub start_time: u64,
    pub end_time: u64,
    pub ticket_price: i128,
    pub total_tickets: u32,
    pub prize_pool: i128,
    pub winner_ticket_id: Option<u32>,
    pub winner: Option<Address>,
    /// SHA-256 of (start_timestamp || round_id) committed at round creation.
    /// Combined with the draw-time ledger state for verifiable randomness.
    pub committed_seed: BytesN<32>,
    pub claimed: bool,
}

/// Cumulative protocol analytics stored in contract instance storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Analytics {
    pub total_rounds: u32,
    pub completed_rounds: u32,
    pub cancelled_rounds: u32,
    pub total_tickets_sold: u64,
    pub total_prize_pool: i128,
    pub total_prizes_claimed: i128,
}

/// Storage key namespace for all contract data.
#[contracttype]
pub enum DataKey {
    Admin,
    TicketPrice,
    Paused,
    RoundCount,
    Analytics,
    Round(u32),
    TicketBuyer(u32, u32), // (round_id, ticket_id)
}
