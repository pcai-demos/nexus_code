//! A PICTURE clause, written as the COBOL source writes it.

/// A numeric or text PICTURE: its width in a record and its decimal places (MIG-005).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pic {
    /// Characters the item takes in a record, a separate sign included.
    pub width: usize,
    /// Digits after the implied decimal point (V).
    pub scale: u32,
    /// Whether the picture starts with S.
    pub signed: bool,
    /// Whether the sign is a separate leading character (`SIGN LEADING SEPARATE`).
    pub sign_leading_separate: bool,
}

/// The picture with its repeats written out: `Z(3)9.99` becomes `ZZZ9.99`.
pub fn expand(picture: &str) -> String {
    let chars: Vec<char> = picture.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if i + 1 < chars.len() && chars[i + 1] == '(' {
            let close = chars[i + 2..].iter().position(|&x| x == ')').expect("unclosed repeat in a PICTURE") + i + 2;
            let n: usize = chars[i + 2..close].iter().collect::<String>().parse().expect("bad repeat count in a PICTURE");
            for _ in 0..n {
                out.push(c);
            }
            i = close + 1;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

impl Pic {
    /// The picture of `clause`: a PICTURE string, optionally followed by `SIGN LEADING SEPARATE`.
    pub fn of(clause: &str) -> Pic {
        let upper = clause.trim().to_uppercase();
        let words: Vec<&str> = upper.split_whitespace().collect();
        let separate = upper.contains("SIGN") && upper.contains("LEADING") && upper.contains("SEPARATE");
        let p = expand(words.first().copied().unwrap_or(""));
        let signed = p.starts_with('S');
        let body = if signed { &p[1..] } else { &p[..] };
        let scale = body.find('V').map(|v| (body.len() - v - 1) as u32).unwrap_or(0);
        let width = body.replace('V', "").len() + if signed && separate { 1 } else { 0 };
        Pic { width, scale, signed, sign_leading_separate: separate }
    }
}
