//! An exact fixed-point value: `units / 10^scale`.

use std::fmt;

/// An exact decimal value: `units` at `scale` decimal places (`Fixed::new(-1375, 2)` is -13.75).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fixed {
    pub units: i64,
    pub scale: u32,
}

fn pow10(n: u32) -> i128 {
    10i128.pow(n)
}

fn narrow(value: i128, scale: u32) -> Fixed {
    let units = i64::try_from(value).expect("fixed-point value out of range for i64 units");
    Fixed { units, scale }
}

impl Fixed {
    /// `units` at `scale` decimal places.
    pub fn new(units: i64, scale: u32) -> Fixed {
        Fixed { units, scale }
    }

    /// Zero at `scale` decimal places.
    pub fn zero(scale: u32) -> Fixed {
        Fixed { units: 0, scale }
    }

    /// Whether the value is below zero.
    pub fn is_negative(&self) -> bool {
        self.units < 0
    }

    /// The same value at a scale at least as large as its own (exact; a smaller scale needs `cobol_math`).
    pub fn at_scale(&self, scale: u32) -> Fixed {
        assert!(scale >= self.scale, "a smaller scale loses digits: use cobol_math::rounded or truncated");
        narrow(self.units as i128 * pow10(scale - self.scale), scale)
    }

    /// `self + other`, at the larger of the two scales.
    pub fn add(&self, other: &Fixed) -> Fixed {
        let s = self.scale.max(other.scale);
        narrow(self.at_scale(s).units as i128 + other.at_scale(s).units as i128, s)
    }

    /// `self - other`, at the larger of the two scales.
    pub fn sub(&self, other: &Fixed) -> Fixed {
        let s = self.scale.max(other.scale);
        narrow(self.at_scale(s).units as i128 - other.at_scale(s).units as i128, s)
    }

    /// `self * other`, exact: the scales add (an amount at 2 times a rate at 4 is at 6).
    pub fn mul(&self, other: &Fixed) -> Fixed {
        narrow(self.units as i128 * other.units as i128, self.scale + other.scale)
    }

    /// `-self`.
    pub fn neg(&self) -> Fixed {
        Fixed { units: -self.units, scale: self.scale }
    }
}

impl fmt::Display for Fixed {
    /// Plain decimal text: `-13.75`, `0.0145`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let negative = self.units < 0;
        let digits = (self.units as i128).abs().to_string();
        let s = self.scale as usize;
        let padded = if digits.len() <= s { format!("{}{}", "0".repeat(s + 1 - digits.len()), digits) } else { digits };
        let (whole, frac) = padded.split_at(padded.len() - s);
        let sign = if negative { "-" } else { "" };
        if s == 0 {
            write!(f, "{}{}", sign, whole)
        } else {
            write!(f, "{}{}.{}", sign, whole, frac)
        }
    }
}
