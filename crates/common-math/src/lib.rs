#![no_std]

use soroban_sdk::Env;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MathError {
    Overflow,
    Underflow,
    DivisionByZero,
    InvalidScale,
}

pub trait SafeMath {
    fn safe_add(a: i128, b: i128) -> Result<i128, MathError>;
    fn safe_sub(a: i128, b: i128) -> Result<i128, MathError>;
    fn safe_mul(a: i128, b: i128) -> Result<i128, MathError>;
    fn safe_div(a: i128, b: i128) -> Result<i128, MathError>;
    fn checked_mul_div(a: i128, b: i128, c: i128) -> Result<i128, MathError>;
}

pub struct MathOps;

impl SafeMath for MathOps {
    fn safe_add(a: i128, b: i128) -> Result<i128, MathError> {
        a.checked_add(b).ok_or(MathError::Overflow)
    }

    fn safe_sub(a: i128, b: i128) -> Result<i128, MathError> {
        a.checked_sub(b).ok_or(MathError::Underflow)
    }

    fn safe_mul(a: i128, b: i128) -> Result<i128, MathError> {
        a.checked_mul(b).ok_or(MathError::Overflow)
    }

    fn safe_div(a: i128, b: i128) -> Result<i128, MathError> {
        if b == 0 {
            return Err(MathError::DivisionByZero);
        }
        a.checked_div(b).ok_or(MathError::Overflow)
    }

    fn checked_mul_div(a: i128, b: i128, c: i128) -> Result<i128, MathError> {
        if c == 0 {
            return Err(MathError::DivisionByZero);
        }
        
        let mul_result = a.checked_mul(b).ok_or(MathError::Overflow)?;
        mul_result.checked_div(c).ok_or(MathError::Overflow)
    }
}

pub struct FixedPoint {
    value: i128,
    scale: u32,
}

impl FixedPoint {
    pub fn new(value: i128, scale: u32) -> Result<Self, MathError> {
        if scale > 18 {
            return Err(MathError::InvalidScale);
        }
        Ok(FixedPoint { value, scale })
    }

    pub fn mul(self, other: FixedPoint) -> Result<FixedPoint, MathError> {
        if self.scale != other.scale {
            return Err(MathError::InvalidScale);
        }
        
        let result = MathOps::safe_mul(self.value, other.value)?;
        let divisor = 10_i128.pow(self.scale);
        let final_result = MathOps::safe_div(result, divisor)?;
        
        FixedPoint::new(final_result, self.scale)
    }

    pub fn div(self, other: FixedPoint) -> Result<FixedPoint, MathError> {
        if self.scale != other.scale {
            return Err(MathError::InvalidScale);
        }
        if other.value == 0 {
            return Err(MathError::DivisionByZero);
        }
        
        let multiplier = 10_i128.pow(self.scale);
        let adjusted = MathOps::safe_mul(self.value, multiplier)?;
        let result = MathOps::safe_div(adjusted, other.value)?;
        
        FixedPoint::new(result, self.scale)
    }

    pub fn value(&self) -> i128 {
        self.value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_add() {
        assert_eq!(MathOps::safe_add(5, 3), Ok(8));
        assert_eq!(MathOps::safe_add(i128::MAX, 1), Err(MathError::Overflow));
    }

    #[test]
    fn test_fixed_point_mul() {
        let a = FixedPoint::new(1000, 3).unwrap();
        let b = FixedPoint::new(500, 3).unwrap();
        let result = a.mul(b).unwrap();
        assert_eq!(result.value(), 500);
    }
}
