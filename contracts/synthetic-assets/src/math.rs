//! Fixed-point math helpers for the Synthetic Assets contract.
//!
//! All token, price, collateral and notional calculations are performed with
//! a fixed number of decimals ([`SCALE`]) using checked operations so that
//! integer overflow, underflow and division-by-zero are never silently
//! wrapped. Every operation returns a [`Result`] which maps failures onto the
//! contract's [`Error`] type instead of panicking on invalid accounting.

use crate::types::Error;

/// Number of decimal places used for fixed-point representations.
///
/// This matches the price oracle scale of `100_000_000` (1e8) so that
/// prices, collateral, debt and notional values all share a single precision.
pub const SCALE: i128 = 100_000_000;

/// A fixed-point wrapper around `i128` with [`SCALE`] decimals.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FixedPoint(pub i128);

impl FixedPoint {
    /// Construct from a raw unscaled integer value.
    #[inline]
    pub const fn from_raw(raw: i128) -> Self {
        FixedPoint(raw)
    }

    /// Return the underlying raw fixed-point value.
    #[inline]
    pub const fn to_i128(self) -> i128 {
        self.0
    }

    /// Scale an integer up to fixed-point precision.
    #[inline]
    pub fn from_int(value: i128) -> Result<Self, Error> {
        Ok(FixedPoint(value.checked_mul(SCALE).ok_or(Error::Overflow)?))
    }

    /// Scale a fixed-point value back down to an integer (truncating).
    #[inline]
    pub fn to_int(self) -> Result<i128, Error> {
        Ok(self.0.checked_div(SCALE).ok_or(Error::Overflow)?)
    }

    /// Checked integer addition at fixed-point precision.
    #[inline]
    pub fn checked_add(self, rhs: Self) -> Result<Self, Error> {
        Ok(FixedPoint(
            self.0.checked_add(rhs.0).ok_or(Error::Overflow)?,
        ))
    }

    /// Checked integer subtraction at fixed-point precision.
    #[inline]
    pub fn checked_sub(self, rhs: Self) -> Result<Self, Error> {
        Ok(FixedPoint(
            self.0.checked_sub(rhs.0).ok_or(Error::Overflow)?,
        ))
    }

    /// Checked fixed-point multiplication `(a * b) / SCALE`.
    ///
    /// Uses [`i128::checked_mul`] / [`i128::checked_div`] so that the
    /// intermediate product or the scaled result overflowing `i128` surfaces
    /// as [`Error::Overflow`] instead of silently wrapping or panicking.
    #[inline]
    pub fn checked_mul(self, rhs: Self) -> Result<Self, Error> {
        let mul = self.0.checked_mul(rhs.0).ok_or(Error::Overflow)?;
        Ok(FixedPoint(mul.checked_div(SCALE).ok_or(Error::Overflow)?))
    }

    /// Checked fixed-point division `(a * SCALE) / b`.
    ///
    /// Returns [`Error::DivisionByZero`] when the divisor is zero and
    /// [`Error::Overflow`] when the scaled numerator overflows `i128`.
    #[inline]
    pub fn checked_div(self, rhs: Self) -> Result<Self, Error> {
        if rhs.0 == 0 {
            return Err(Error::DivisionByZero);
        }
        let numerator = self.0.checked_mul(SCALE).ok_or(Error::Overflow)?;
        Ok(FixedPoint(
            numerator.checked_div(rhs.0).ok_or(Error::Overflow)?,
        ))
    }

    /// Scale a value expressed in basis points (1e-4) into fixed-point units.
    #[inline]
    pub fn from_bps(bps: u32) -> Result<Self, Error> {
        let bps128 = i128::from(bps);
        Ok(FixedPoint(
            bps128.checked_mul(SCALE / 10000).ok_or(Error::Overflow)?,
        ))
    }

    /// Convert a fixed-point value to basis points, truncating towards zero.
    #[inline]
    pub fn to_bps(self) -> Result<u32, Error> {
        let bps = self
            .0
            .checked_div(SCALE / 10000)
            .ok_or(Error::Overflow)?;
        if bps < 0 || bps > u32::MAX as i128 {
            return Err(Error::Overflow);
        }
        Ok(bps as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_point_mul_round_trip() {
        let a = FixedPoint::from_raw(2 * SCALE);
        let b = FixedPoint::from_raw(3 * SCALE);
        assert_eq!(a.checked_mul(b).unwrap().to_i128(), 6 * SCALE);
    }

    #[test]
    fn fixed_point_div_round_trip() {
        let a = FixedPoint::from_raw(6 * SCALE);
        let b = FixedPoint::from_raw(3 * SCALE);
        assert_eq!(a.checked_div(b).unwrap().to_i128(), 2 * SCALE);
    }

    #[test]
    fn fixed_point_div_by_zero_is_error() {
        let a = FixedPoint::from_raw(1);
        let b = FixedPoint::from_raw(0);
        assert!(matches!(a.checked_div(b), Err(Error::DivisionByZero)));
    }

    #[test]
    fn fixed_point_overflow_is_error() {
        let a = FixedPoint::from_raw(i128::MAX);
        let b = FixedPoint::from_raw(i128::MAX);
        assert!(matches!(a.checked_add(b), Err(Error::Overflow)));
    }
}
