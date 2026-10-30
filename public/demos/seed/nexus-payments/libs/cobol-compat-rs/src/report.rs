//! Two reports compared byte for byte, as a characterisation test needs (MIG-001, TST-010). A mismatch panics with
//! the lines that differ, each between bars so trailing spaces show, instead of two lists of byte values.

use std::fs;
use std::path::Path;

/// Panics naming the lines that differ unless the two files hold the same bytes.
pub fn assert_same_bytes<P: AsRef<Path>, Q: AsRef<Path>>(expected: P, actual: Q) {
    let (expected, actual) = (expected.as_ref(), actual.as_ref());
    let e = fs::read(expected).unwrap_or_else(|err| panic!("cannot read the expected report {}: {}", expected.display(), err));
    let a = fs::read(actual).unwrap_or_else(|err| panic!("cannot read the actual report {}: {}", actual.display(), err));
    if e != a {
        panic!("{}", difference(expected, &e, actual, &a));
    }
}

/// The difference in words: up to three lines that differ, or the line endings when every line agrees.
pub fn difference(expected: &Path, e: &[u8], actual: &Path, a: &[u8]) -> String {
    let (el, al) = (lines(e), lines(a));
    let mut out = format!("the reports differ (expected {}, actual {})", expected.display(), actual.display());
    let mut shown = 0;
    for i in 0..el.len().max(al.len()) {
        if shown == 3 {
            break;
        }
        let (x, y) = (el.get(i), al.get(i));
        if x.is_some() && x == y {
            continue;
        }
        out.push_str(&format!("\nline {}:", i + 1));
        out.push_str(&format!("\n  expected: {}", x.map_or("(no line)".to_string(), |l| format!("|{}|", l))));
        out.push_str(&format!("\n  actual:   {}", y.map_or("(no line)".to_string(), |l| format!("|{}|", l))));
        shown += 1;
    }
    if shown == 0 {
        out.push_str(&format!(
            "\nevery line agrees: the files differ only in line endings or the final newline ({} bytes expected, {} actual)",
            e.len(),
            a.len()
        ));
    }
    out.push_str(&format!("\n({} lines expected, {} actual)", el.len(), al.len()));
    out
}

fn lines(b: &[u8]) -> Vec<String> {
    let text: String = b.iter().map(|&c| c as char).collect();
    let mut out: Vec<String> = text.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect();
    if out.last().map_or(false, |l| l.is_empty()) {
        out.pop();
    }
    out
}
