package com.nexusbank.cobol;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The library against GnuCOBOL's own output: each expected string below was printed by GnuCOBOL 3.2. */
class CobolCompatTest {
    @Test
    void picturesGiveWidthAndScale() {
        assertEquals(12, Pic.of("S9(9)V99 SIGN LEADING SEPARATE").width);
        assertEquals(2, Pic.of("S9(9)V99 SIGN LEADING SEPARATE").scale);
        assertEquals(5, Pic.of("9V9(4)").width);
        assertEquals(4, Pic.of("9V9(4)").scale);
        assertEquals(10, Pic.of("X(10)").width);
    }

    @Test
    void editedPicturesAsGnuCobolPrintsThem() {
        assertEquals("        2,343.58-", Picture.edit(new BigDecimal("-2343.58"), "Z,ZZZ,ZZZ,ZZ9.99-"));
        assertEquals("    1,234,627.14 ", Picture.edit(new BigDecimal("1234627.14"), "Z,ZZZ,ZZZ,ZZ9.99-"));
        assertEquals("         58.59-", Picture.edit(new BigDecimal("-58.59"), "ZZZ,ZZZ,ZZ9.99-"));
        assertEquals("            0.00 ", Picture.edit(BigDecimal.ZERO, "Z,ZZZ,ZZZ,ZZ9.99-"));
        assertEquals("        1,234.50-", Picture.edit(new BigDecimal("-1234.50"), "Z,ZZZ,ZZZ,ZZ9.99-"));
        assertEquals("    20", Picture.edit(20, "ZZ,ZZ9"));
        assertEquals(" 1,234", Picture.edit(1234, "ZZ,ZZ9"));
        assertEquals("     0", Picture.edit(0, "ZZ,ZZ9"));
    }

    @Test
    void textMovesPadOrCut() {
        assertEquals("TOTAL     ", Picture.text("TOTAL", "X(10)"));
        assertEquals("MASTERCARD", Picture.text("MASTERCARDS", "X(10)"));
    }

    @Test
    void negativeZeroShowsNoSign() {
        assertEquals("            0.00 ", Picture.edit(new BigDecimal("-0.00"), "Z,ZZZ,ZZZ,ZZ9.99-"));
    }

    @Test
    void fieldsByColumnAndPicture() {
        String rec = "T20260624MASTERCARDMC2606240002R-0000000137500120";
        assertEquals("MASTERCARD", FixedRecord.text(rec, 10, "X(10)"));
        assertEquals(new BigDecimal("-13.75"), FixedRecord.decimal(rec, 33, "S9(9)V99 SIGN LEADING SEPARATE"));
        assertEquals(new BigDecimal("0.0120"), FixedRecord.decimal(rec, 45, "9V9(4)"));
        assertEquals(new BigDecimal("20260624"), FixedRecord.decimal(rec, 2, "9(8)"));
        assertEquals("    ", FixedRecord.text("H20260624", 46, "X(4)"));
    }

    @Test
    void roundedIsHalfAwayFromZero() {
        assertEquals(new BigDecimal("0.15"), CobolMath.rounded(new BigDecimal("0.145000"), "S9(9)V99"));
        assertEquals(new BigDecimal("-0.17"), CobolMath.rounded(new BigDecimal("-0.165000"), "S9(9)V99"));
        assertEquals(new BigDecimal("-0.16"), CobolMath.truncated(new BigDecimal("-0.165000"), "S9(9)V99"));
    }

    @Test
    void lineSequentialDropsTrailingSpaces(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("out.txt");
        LineSequential.write(f, List.of("AMEX     3  ", "TOTAL "));
        assertEquals("AMEX     3\nTOTAL\n", Files.readString(f));
    }

    /** Not GnuCOBOL output: the characterisation test's comparison (MIG-001), whose failure names the lines that differ. */
    @Test
    void reportsCompareByteForByteAndNameTheLinesThatDiffer(@TempDir Path dir) throws Exception {
        Path e = dir.resolve("e.txt"), same = dir.resolve("same.txt"), other = dir.resolve("other.txt"), crlf = dir.resolve("crlf.txt");
        Files.writeString(e, "AMEX     3\nVISA     7\n");
        Files.writeString(same, "AMEX     3\nVISA     7\n");
        Files.writeString(other, "AMEX     3\nVISA     6\n");
        Files.writeString(crlf, "AMEX     3\r\nVISA     7\r\n");
        Reports.assertSameBytes(e, same);
        AssertionError x = assertThrows(AssertionError.class, () -> Reports.assertSameBytes(e, other));
        assertTrue(x.getMessage().contains("line 2:\n  expected: |VISA     7|\n  actual:   |VISA     6|"), x.getMessage());
        AssertionError y = assertThrows(AssertionError.class, () -> Reports.assertSameBytes(e, crlf));
        assertTrue(y.getMessage().contains("differ only in line endings"), y.getMessage());
    }
}
