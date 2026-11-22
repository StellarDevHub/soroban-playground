//! Shared music rights wire types and validation used by both music contracts.
use soroban_sdk::{contracterror, contracttype, token, Address, Env, String, Vec};

pub const MAX_PUBLISHERS: u32 = 16;
pub const BASIS_POINTS: i128 = 10_000;

// Separate range from music-royalty's existing errors 1..=15.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RightsError {
    InvalidIsrc = 101,
    InvalidIswc = 102,
    InvalidSplits = 103,
    DuplicatePublisher = 104,
    InvalidAgreement = 105,
    InvalidAmount = 106,
    MetadataNotFound = 107,
    Unauthorized = 108,
    PaymentFailed = 109,
    Overflow = 110,
    AlreadyRegistered = 111,
    InvalidTitle = 112,
    LicenseNotFound = 113,
    LicenseExpired = 114,
    Paused = 115,
    NotInitialized = 116,
    InvalidSongId = 117,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublisherSplit {
    pub account: Address,
    /// Exact basis points; the complete table must total 10,000.
    pub share: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MusicMetadata {
    /// Canonical 12-character ISRC: CCXXXYYNNNNN, without hyphens.
    pub isrc: String,
    /// Canonical ISWC: T followed by nine work digits and one check digit.
    pub iswc: String,
    pub publisher_splits: Vec<PublisherSplit>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LicenseKind {
    Sync,
    CommercialPerformance,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LicenseTerms {
    pub kind: LicenseKind,
    /// ISO country code or WORLD; describes the offer, not legal verification.
    pub territory: String,
    /// HTTPS reference to the agreement; never fetched by the contract.
    pub terms_uri: String,
    pub duration_seconds: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoyaltyPayment {
    pub recipient: Address,
    pub amount: i128,
}

pub fn validate_metadata(metadata: &MusicMetadata) -> Result<(), RightsError> {
    if metadata.isrc.len() != 12 {
        return Err(RightsError::InvalidIsrc);
    }
    let mut isrc = [0u8; 12];
    metadata.isrc.copy_into_slice(&mut isrc);
    if !isrc[..2].iter().all(u8::is_ascii_uppercase)
        || !isrc[2..5]
            .iter()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        || !isrc[5..].iter().all(u8::is_ascii_digit)
    {
        return Err(RightsError::InvalidIsrc);
    }
    if metadata.iswc.len() != 11 {
        return Err(RightsError::InvalidIswc);
    }
    let mut iswc = [0u8; 11];
    metadata.iswc.copy_into_slice(&mut iswc);
    if iswc[0] != b'T' || !iswc[1..].iter().all(u8::is_ascii_digit) {
        return Err(RightsError::InvalidIswc);
    }
    let weighted = iswc[1..10]
        .iter()
        .enumerate()
        .fold(1u32, |sum, (index, digit)| {
            sum + (index as u32 + 1) * u32::from(digit - b'0')
        });
    if u32::from(iswc[10] - b'0') != (10 - weighted % 10) % 10 {
        return Err(RightsError::InvalidIswc);
    }
    let splits = &metadata.publisher_splits;
    if splits.is_empty() || splits.len() > MAX_PUBLISHERS {
        return Err(RightsError::InvalidSplits);
    }
    let mut total = 0u32;
    for (index, split) in splits.iter().enumerate() {
        if split.share == 0 || split.share > BASIS_POINTS as u32 {
            return Err(RightsError::InvalidSplits);
        }
        total += split.share; // At most sixteen bounded shares.
        for previous in 0..index {
            if splits.get(previous as u32).unwrap().account == split.account {
                return Err(RightsError::DuplicatePublisher);
            }
        }
    }
    if total != BASIS_POINTS as u32 {
        return Err(RightsError::InvalidSplits);
    }
    Ok(())
}

pub fn validate_terms(terms: &LicenseTerms) -> Result<(), RightsError> {
    let territory_valid = if terms.territory.len() == 2 {
        let mut bytes = [0u8; 2];
        terms.territory.copy_into_slice(&mut bytes);
        bytes.iter().all(u8::is_ascii_uppercase)
    } else {
        terms.territory == String::from_str(terms.territory.env(), "WORLD")
    };
    if !territory_valid
        || !(3_600..=315_360_000).contains(&terms.duration_seconds)
        || !(9..=256).contains(&terms.terms_uri.len())
    {
        return Err(RightsError::InvalidAgreement);
    }
    let mut uri = [0u8; 256];
    let length = terms.terms_uri.len() as usize;
    terms.terms_uri.copy_into_slice(&mut uri[..length]);
    if !uri[..length].starts_with(b"https://")
        || uri[8] == b'/'
        || uri[..length]
            .iter()
            .any(|c| !c.is_ascii_graphic() || matches!(c, b'@' | b'\\'))
    {
        return Err(RightsError::InvalidAgreement);
    }
    Ok(())
}

/// Integer allocation without amount*share overflow; final publisher gets dust.
pub fn allocate(
    env: &Env,
    splits: &Vec<PublisherSplit>,
    amount: i128,
) -> Result<Vec<RoyaltyPayment>, RightsError> {
    if amount <= 0 || splits.is_empty() {
        return Err(RightsError::InvalidAmount);
    }
    let mut remaining = amount;
    let mut result = Vec::new(env);
    for (index, split) in splits.iter().enumerate() {
        let portion = if index as u32 == splits.len() - 1 {
            remaining
        } else {
            amount / BASIS_POINTS * i128::from(split.share)
                + (amount % BASIS_POINTS * i128::from(split.share)) / BASIS_POINTS
        };
        remaining = remaining
            .checked_sub(portion)
            .ok_or(RightsError::Overflow)?;
        result.push_back(RoyaltyPayment {
            recipient: split.account,
            amount: portion,
        });
    }
    Ok(result)
}

/// Collect once, then route exactly that payment. Failure rolls back atomically.
pub fn transfer_payment(
    env: &Env,
    payment_token: &Address,
    payer: &Address,
    amount: i128,
    payouts: &Vec<RoyaltyPayment>,
) -> Result<(), RightsError> {
    let token = token::TokenClient::new(env, payment_token);
    let contract = env.current_contract_address();
    if *payer == contract {
        return Err(RightsError::Unauthorized);
    }
    if payouts.iter().any(|payout| payout.recipient == contract) {
        return Err(RightsError::InvalidSplits);
    }
    if !matches!(token.try_transfer(payer, &contract, &amount), Ok(Ok(()))) {
        return Err(RightsError::PaymentFailed);
    }
    for payout in payouts.iter() {
        if payout.amount > 0
            && !matches!(
                token.try_transfer(&contract, &payout.recipient, &payout.amount),
                Ok(Ok(()))
            )
        {
            return Err(RightsError::PaymentFailed);
        }
    }
    Ok(())
}
