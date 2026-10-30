//! Line-sequential files as GnuCOBOL reads and writes them (MIG-005).

use std::fs;
use std::io;
use std::path::Path;

/// Every line of `path`, without line endings.
pub fn read<P: AsRef<Path>>(path: P) -> io::Result<Vec<String>> {
    let bytes = fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<String> = text.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect();
    if text.ends_with('\n') {
        lines.pop();
    }
    Ok(lines)
}

/// Writes `lines` to `path`, each without its trailing spaces and ended by a newline.
pub fn write<P: AsRef<Path>>(path: P, lines: &[String]) -> io::Result<()> {
    let mut out = String::new();
    for l in lines {
        out.push_str(l.trim_end_matches(' '));
        out.push('\n');
    }
    fs::write(path, out)
}
