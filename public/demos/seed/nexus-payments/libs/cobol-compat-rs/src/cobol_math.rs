//! Storing a result into a receiving item, as COMPUTE does (MIG-005).

use crate::fixed::Fixed;
use crate::pic::Pic;

fn to_scale(value: &Fixed, scale: u32, round: bool) -> Fixed {
    if scale >= value.scale {
        return value.at_scale(scale);
    }
    let divisor = 10i128.pow(value.scale - scale);
    let units = value.units as i128;
    let mut q = units / divisor; // toward zero
    let r = units % divisor;
    if round && r.abs() * 2 >= divisor {
        q += if units < 0 { -1 } else { 1 }; // half away from zero
    }
    Fixed::new(i64::try_from(q).expect("fixed-point value out of range"), scale)
}

/// `COMPUTE target ROUNDED = value`: half away from zero, to the target picture's decimal places.
pub fn rounded(value: &Fixed, target_pic: &str) -> Fixed {
    to_scale(value, Pic::of(target_pic).scale, true)
}

/// `COMPUTE target = value` without ROUNDED: the extra digits dropped, toward zero.
pub fn truncated(value: &Fixed, target_pic: &str) -> Fixed {
    to_scale(value, Pic::of(target_pic).scale, false)
}
