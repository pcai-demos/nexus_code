//! COBOL edited pictures, as GnuCOBOL displays them (MIG-005).

use crate::cobol_math;
use crate::fixed::Fixed;
use crate::pic::expand;

/// `value` displayed through `picture` (9, Z, the comma, the point, a fixed `-` or `+` at either end), exactly the
/// picture's width. Extra decimals and lost high-order digits are truncated, as a COBOL MOVE does.
pub fn edit(value: &Fixed, picture: &str) -> String {
    let mut p = expand(picture);
    let mut lead: Option<char> = None;
    let mut trail: Option<char> = None;
    if p.starts_with('-') || p.starts_with('+') {
        lead = p.chars().next();
        p = p[1..].to_string();
    }
    if p.ends_with('-') || p.ends_with('+') {
        trail = p.chars().last();
        p = p[..p.len() - 1].to_string();
    }
    let (whole, frac) = match p.find('.') {
        Some(i) => (p[..i].to_string(), p[i + 1..].to_string()),
        None => (p.clone(), String::new()),
    };
    let whole_digits = whole.chars().filter(|&c| c == '9' || c == 'Z').count();
    let frac_digits = frac.len();
    let v = cobol_math::truncated(value, &format!("9V{}", "9".repeat(frac_digits)));
    let negative = v.units < 0;
    let mut digits = (v.units as i128).abs().to_string();
    let need = whole_digits + frac_digits;
    if digits.len() > need {
        digits = digits[digits.len() - need..].to_string();
    }
    let digits = format!("{}{}", "0".repeat(need - digits.len()), digits);
    let d: Vec<char> = digits.chars().collect();
    let mut out = String::new();
    let mut started = false;
    let mut k = 0;
    for sym in whole.chars() {
        if sym == ',' {
            out.push(if started { ',' } else { ' ' });
        } else {
            let digit = d[k];
            k += 1;
            if sym == '9' || digit != '0' || started {
                started = true;
                out.push(digit);
            } else {
                out.push(' ');
            }
        }
    }
    if !frac.is_empty() || p.contains('.') {
        out.push('.');
        out.extend(&d[k..k + frac_digits]);
    }
    let sign = |c: char| -> char {
        if c == '+' {
            if negative { '-' } else { '+' }
        } else if negative {
            '-'
        } else {
            ' '
        }
    };
    let mut body = out;
    if let Some(c) = lead {
        body = format!("{}{}", sign(c), body);
    }
    if let Some(c) = trail {
        body.push(sign(c));
    }
    body
}

/// A whole number displayed through `picture`, for counts.
pub fn edit_count(n: i64, picture: &str) -> String {
    edit(&Fixed::new(n, 0), picture)
}

/// `value` moved into a `PIC X(n)` item: padded with spaces on the right, or cut, to exactly n characters, as a COBOL
/// MOVE does (`text("TOTAL", "X(10)")` is `"TOTAL     "`).
pub fn text(value: &str, picture: &str) -> String {
    let n = crate::pic::Pic::of(picture).width;
    let mut out: String = value.chars().take(n).collect();
    while out.chars().count() < n {
        out.push(' ');
    }
    out
}
