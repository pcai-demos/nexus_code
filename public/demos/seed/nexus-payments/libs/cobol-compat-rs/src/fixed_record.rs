//! Fields of a fixed-width record, by 1-based column and PICTURE (MIG-005).

use crate::fixed::Fixed;
use crate::pic::Pic;

fn slice(line: &str, start: usize, width: usize) -> String {
    let mut chars: Vec<char> = line.chars().collect();
    while chars.len() < start - 1 + width {
        chars.push(' ');
    }
    chars[start - 1..start - 1 + width].iter().collect()
}

/// The text of a `PIC X(n)` item starting in column `start`, padding included (a short record reads as padded).
pub fn text(line: &str, start: usize, pic: &str) -> String {
    slice(line, start, Pic::of(pic).width)
}

/// The value of a numeric item starting in column `start`: `"9(8)"`, `"9V9(4)"` (0.0145 from `00145`) or
/// `"S9(9)V99 SIGN LEADING SEPARATE"` (-13.75 from `-00000001375`).
pub fn decimal(line: &str, start: usize, pic: &str) -> Fixed {
    let p = Pic::of(pic);
    let mut field = slice(line, start, p.width);
    let mut negative = false;
    if p.sign_leading_separate {
        negative = field.starts_with('-');
        field = field[1..].to_string();
    }
    let digits: String = field.chars().map(|c| if c == ' ' { '0' } else { c }).collect();
    let units: i64 = digits.parse().expect("a numeric field holds a non-digit");
    Fixed::new(if negative { -units } else { units }, p.scale)
}
