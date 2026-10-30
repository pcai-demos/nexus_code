package com.nexusbank.cobol;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * COBOL edited pictures, as GnuCOBOL displays them (MIG-004). Supports 9, Z, the comma, the point and a fixed sign
 * ({@code -} or {@code +}) at either end, with the repeat form {@code Z(3)}. A MOVE to an edited picture truncates
 * extra decimals and lost high-order digits, as COBOL does; round first with {@link CobolMath#rounded}.
 */
public final class Picture {
    private Picture() {}

    /** The picture with its repeats written out: {@code Z(3)9.99} becomes {@code ZZZ9.99}. */
    public static String expand(String picture) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < picture.length(); i++) {
            char c = picture.charAt(i);
            if (i + 1 < picture.length() && picture.charAt(i + 1) == '(') {
                int close = picture.indexOf(')', i + 2);
                int n = Integer.parseInt(picture.substring(i + 2, close));
                out.append(String.valueOf(c).repeat(n));
                i = close;
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    /** {@code value} displayed through {@code picture}, exactly the picture's width. */
    public static String edit(BigDecimal value, String picture) {
        String p = expand(picture);
        char leadSign = 0;
        char trailSign = 0;
        if (p.startsWith("-") || p.startsWith("+")) { leadSign = p.charAt(0); p = p.substring(1); }
        if (p.endsWith("-") || p.endsWith("+")) { trailSign = p.charAt(p.length() - 1); p = p.substring(0, p.length() - 1); }
        int point = p.indexOf('.');
        String whole = point < 0 ? p : p.substring(0, point);
        String frac = point < 0 ? "" : p.substring(point + 1);
        int wholeDigits = (int) whole.chars().filter(ch -> ch == '9' || ch == 'Z').count();
        int fracDigits = frac.length();

        BigDecimal v = value.setScale(fracDigits, RoundingMode.DOWN);
        boolean negative = v.signum() < 0;
        String digits = v.abs().movePointRight(fracDigits).toBigInteger().toString();
        int need = wholeDigits + fracDigits;
        if (digits.length() > need) digits = digits.substring(digits.length() - need);
        digits = "0".repeat(need - digits.length()) + digits;
        if (v.signum() == 0) negative = false;

        StringBuilder out = new StringBuilder();
        boolean started = false;
        int d = 0;
        for (int i = 0; i < whole.length(); i++) {
            char sym = whole.charAt(i);
            if (sym == ',') {
                out.append(started ? ',' : ' ');
            } else {
                char digit = digits.charAt(d++);
                if (sym == '9' || digit != '0' || started) {
                    started = true;
                    out.append(digit);
                } else {
                    out.append(' ');
                }
            }
        }
        if (point >= 0) {
            out.append('.');
            out.append(digits, d, d + fracDigits);
        }
        String sign = negative ? "-" : "+";
        String body = out.toString();
        if (leadSign != 0) body = (leadSign == '+' ? sign : (negative ? "-" : " ")) + body;
        if (trailSign != 0) body = body + (trailSign == '+' ? sign : (negative ? "-" : " "));
        return body;
    }

    /** A whole number displayed through {@code picture}, for counts. */
    public static String edit(long value, String picture) {
        return edit(BigDecimal.valueOf(value), picture);
    }

    /**
     * {@code value} moved into a {@code PIC X(n)} item: padded with spaces on the right, or cut, to exactly n characters,
     * as a COBOL MOVE does ({@code text("TOTAL", "X(10)")} is {@code "TOTAL     "}).
     */
    public static String text(String value, String picture) {
        int n = Pic.of(picture).width;
        String v = value == null ? "" : value;
        if (v.length() >= n) return v.substring(0, n);
        return v + " ".repeat(n - v.length());
    }
}
