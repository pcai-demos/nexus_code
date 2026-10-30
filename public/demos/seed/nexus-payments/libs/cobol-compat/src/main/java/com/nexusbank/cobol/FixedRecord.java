package com.nexusbank.cobol;

import java.math.BigDecimal;

/**
 * Fields of a fixed-width record, by the 1-based column and the PICTURE the COBOL layout gives them (MIG-004). Pass the
 * picture exactly as the source writes it; the library works out the width, the sign and the implied decimal point. A
 * line-sequential record shorter than its layout reads as if padded with spaces, as COBOL reads it.
 */
public final class FixedRecord {
    private FixedRecord() {}

    /** The text of a {@code PIC X(n)} item starting in column {@code start}, padding included. */
    public static String text(String line, int start, String pic) {
        return slice(line, start, Pic.of(pic).width);
    }

    /**
     * The value of a numeric item starting in column {@code start}: {@code "9(8)"}, {@code "9V9(4)"} (0.0145 from
     * {@code 00145}) or {@code "S9(9)V99 SIGN LEADING SEPARATE"} (-13.75 from {@code -00000001375}).
     */
    public static BigDecimal decimal(String line, int start, String pic) {
        Pic p = Pic.of(pic);
        String field = slice(line, start, p.width);
        boolean negative = false;
        if (p.signLeadingSeparate) {
            negative = field.charAt(0) == '-';
            field = field.substring(1);
        }
        String digits = field.trim().isEmpty() ? "0" : field.replace(' ', '0');
        BigDecimal value = new BigDecimal(digits).movePointLeft(p.scale);
        return negative ? value.negate() : value;
    }

    private static String slice(String line, int start, int width) {
        StringBuilder padded = new StringBuilder(line);
        while (padded.length() < start - 1 + width) padded.append(' ');
        return padded.substring(start - 1, start - 1 + width);
    }
}
