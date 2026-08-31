//! Safe-math helpers for the interest-rate model.
//!
//! Rate and utilization computations are expressed as pure, unit-testable
//! functions that use only checked integer operations. Every division guards
//! against zero and every multiply guards against `i128`/`u128` overflow so
//! that an extreme input surfaces as a contract [`Error`] rather than a panic
//! or a silently wrapped accounting value.

use crate::types::Error;

/// Number of basis points in a whole unit (100%).
const BPS: u128 = 10_000;

/// Compute pool utilization as an unsigned basis-point percentage (0..=10000+).
///
/// Returns 0 when there are no funds available, and clamps negative
/// utilization (borrowed < 0) to 0.
pub fn compute_utilization_bps(borrowed: i128, total_available: i128) -> Result<u32, Error> {
    if total_available == 0 {
        return Ok(0);
    }
    let scaled = borrowed.checked_mul(BPS as i128).ok_or(Error::Overflow)?;
    let util = scaled.checked_div(total_available).ok_or(Error::DivisionByZero)?;
    if util < 0 {
        return Ok(0);
    }
    u32::try_from(util).map_err(|_| Error::Overflow)
}

/// Apply the linear interest equation and cap at `max_rate_bps`.
///
/// `rate = base + (utilization * multiplier) / 10000`, capped at `max_rate`.
pub fn compute_linear_rate(
    base_rate_bps: u32,
    multiplier_bps: u32,
    utilization_bps: u32,
    max_rate_bps: u32,
) -> Result<u32, Error> {
    let mult = (utilization_bps as u128)
        .checked_mul(multiplier_bps as u128)
        .ok_or(Error::Overflow)?
        .checked_div(BPS)
        .ok_or(Error::DivisionByZero)?;
    let rate = (base_rate_bps as u128)
        .checked_add(mult)
        .ok_or(Error::Overflow)?;
    Ok(if rate > max_rate_bps as u128 {
        max_rate_bps
    } else {
        rate as u32
    })
}

/// Apply the exponential interest equation and cap at `max_rate_bps`.
///
/// `rate = base + (utilization^2 / 10000) * multiplier / 10000`, capped at
/// `max_rate`. The squared utilization grows quickly, so careful checked
/// scaling is used to avoid overflow.
pub fn compute_exponential_rate(
    base_rate_bps: u32,
    multiplier_bps: u32,
    utilization_bps: u32,
    max_rate_bps: u32,
) -> Result<u32, Error> {
    let util = utilization_bps as u128;
    let util_sq = util
        .checked_mul(util)
        .ok_or(Error::Overflow)?
        .checked_div(BPS)
        .ok_or(Error::DivisionByZero)?;
    let mult = util_sq
        .checked_mul(multiplier_bps as u128)
        .ok_or(Error::Overflow)?
        .checked_div(BPS)
        .ok_or(Error::DivisionByZero)?;
    let rate = (base_rate_bps as u128)
        .checked_add(mult)
        .ok_or(Error::Overflow)?;
    Ok(if rate > max_rate_bps as u128 {
        max_rate_bps
    } else {
        rate as u32
    })
}
