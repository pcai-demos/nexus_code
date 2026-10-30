//! The library against GnuCOBOL's own output: each expected string below was printed by GnuCOBOL 3.2.

use cobol_compat::{cobol_math, fixed_record, line_sequential, picture, report, Fixed, Pic};

#[test]
fn pictures_give_width_and_scale() {
    assert_eq!(Pic::of("S9(9)V99 SIGN LEADING SEPARATE").width, 12);
    assert_eq!(Pic::of("S9(9)V99 SIGN LEADING SEPARATE").scale, 2);
    assert_eq!(Pic::of("9V9(4)").width, 5);
    assert_eq!(Pic::of("9V9(4)").scale, 4);
    assert_eq!(Pic::of("X(10)").width, 10);
}

#[test]
fn edited_pictures_as_gnucobol_prints_them() {
    assert_eq!(picture::edit(&Fixed::new(-234358, 2), "Z,ZZZ,ZZZ,ZZ9.99-"), "        2,343.58-");
    assert_eq!(picture::edit(&Fixed::new(123462714, 2), "Z,ZZZ,ZZZ,ZZ9.99-"), "    1,234,627.14 ");
    assert_eq!(picture::edit(&Fixed::new(-5859, 2), "ZZZ,ZZZ,ZZ9.99-"), "         58.59-");
    assert_eq!(picture::edit(&Fixed::zero(2), "Z,ZZZ,ZZZ,ZZ9.99-"), "            0.00 ");
    assert_eq!(picture::edit(&Fixed::new(-123450, 2), "Z,ZZZ,ZZZ,ZZ9.99-"), "        1,234.50-");
    assert_eq!(picture::edit_count(20, "ZZ,ZZ9"), "    20");
    assert_eq!(picture::edit_count(1234, "ZZ,ZZ9"), " 1,234");
    assert_eq!(picture::edit_count(0, "ZZ,ZZ9"), "     0");
}

#[test]
fn text_moves_pad_or_cut() {
    assert_eq!(picture::text("TOTAL", "X(10)"), "TOTAL     ");
    assert_eq!(picture::text("MASTERCARDS", "X(10)"), "MASTERCARD");
}

#[test]
fn negative_zero_shows_no_sign() {
    assert_eq!(picture::edit(&Fixed::new(-4, 4), "Z,ZZZ,ZZZ,ZZ9.99-"), "            0.00 ");
}

#[test]
fn fields_by_column_and_picture() {
    let rec = "T20260624MASTERCARDMC2606240002R-0000000137500120";
    assert_eq!(fixed_record::text(rec, 10, "X(10)"), "MASTERCARD");
    assert_eq!(fixed_record::decimal(rec, 33, "S9(9)V99 SIGN LEADING SEPARATE"), Fixed::new(-1375, 2));
    assert_eq!(fixed_record::decimal(rec, 45, "9V9(4)"), Fixed::new(120, 4));
    assert_eq!(fixed_record::decimal(rec, 2, "9(8)"), Fixed::new(20260624, 0));
    assert_eq!(fixed_record::text("H20260624", 46, "X(4)"), "    ");
}

#[test]
fn rounded_is_half_away_from_zero() {
    assert_eq!(cobol_math::rounded(&Fixed::new(145000, 6), "S9(9)V99"), Fixed::new(15, 2));
    assert_eq!(cobol_math::rounded(&Fixed::new(-165000, 6), "S9(9)V99"), Fixed::new(-17, 2));
    assert_eq!(cobol_math::truncated(&Fixed::new(-165000, 6), "S9(9)V99"), Fixed::new(-16, 2));
    assert_eq!(Fixed::new(-1375, 2).mul(&Fixed::new(120, 4)), Fixed::new(-165000, 6));
    assert_eq!(Fixed::new(-1375, 2).to_string(), "-13.75");
}

#[test]
fn line_sequential_drops_trailing_spaces() {
    let path = std::env::temp_dir().join(format!("cobol_compat_ls_{}.txt", std::process::id()));
    line_sequential::write(&path, &["AMEX     3  ".to_string(), "TOTAL ".to_string()]).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "AMEX     3\nTOTAL\n");
    assert_eq!(line_sequential::read(&path).unwrap(), vec!["AMEX     3".to_string(), "TOTAL".to_string()]);
    std::fs::remove_file(&path).unwrap();
}

/// Not GnuCOBOL output: the characterisation test's comparison (MIG-001), whose failure names the lines that differ.
#[test]
fn reports_compare_byte_for_byte_and_name_the_lines_that_differ() {
    let dir = std::env::temp_dir().join(format!("cobol-compat-report-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (e, same, other, crlf) = (dir.join("e.txt"), dir.join("same.txt"), dir.join("other.txt"), dir.join("crlf.txt"));
    std::fs::write(&e, "AMEX     3\nVISA     7\n").unwrap();
    std::fs::write(&same, "AMEX     3\nVISA     7\n").unwrap();
    std::fs::write(&other, "AMEX     3\nVISA     6\n").unwrap();
    std::fs::write(&crlf, "AMEX     3\r\nVISA     7\r\n").unwrap();
    report::assert_same_bytes(&e, &same);
    let read = |p: &std::path::Path| std::fs::read(p).unwrap();
    let msg = report::difference(&e, &read(&e), &other, &read(&other));
    assert!(msg.contains("line 2:\n  expected: |VISA     7|\n  actual:   |VISA     6|"), "{}", msg);
    assert!(report::difference(&e, &read(&e), &crlf, &read(&crlf)).contains("differ only in line endings"));
    assert!(std::panic::catch_unwind(|| report::assert_same_bytes(&e, &other)).is_err());
    std::fs::remove_dir_all(&dir).unwrap();
}
