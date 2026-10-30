//! Nexus Bank's COBOL compatibility library for Rust ports (MIG-005).
//!
//! Money is exact: a [`Fixed`] holds integer units at a decimal scale (`units = 1375, scale = 2` is 13.75), never
//! `f32` or `f64`. Fields are read by 1-based column and the PICTURE exactly as the COBOL source writes it; `ROUNDED`
//! is half away from zero; edited pictures and line-sequential files come out as GnuCOBOL writes them, and a
//! characterisation test compares two reports byte for byte with `report::assert_same_bytes`. Standard
//! library only, so a port depends on it by path with no crate registry.

pub mod cobol_math;
pub mod fixed;
pub mod fixed_record;
pub mod line_sequential;
pub mod pic;
pub mod picture;
pub mod report;

pub use fixed::Fixed;
pub use pic::Pic;
