package com.nexusbank.cobol;

/**
 * A numeric or text PICTURE clause, written as the COBOL source writes it ({@code "S9(9)V99 SIGN LEADING SEPARATE"},
 * {@code "9V9(4)"}, {@code "X(10)"}): its width in a record and its decimal places (MIG-004).
 */
public final class Pic {
    /** Characters the item takes in a record, a separate sign included. */
    public final int width;
    /** Digits after the implied decimal point (V). */
    public final int scale;
    /** Whether the picture starts with S. */
    public final boolean signed;
    /** Whether the sign is a separate leading character ({@code SIGN LEADING SEPARATE}). */
    public final boolean signLeadingSeparate;

    private Pic(int width, int scale, boolean signed, boolean signLeadingSeparate) {
        this.width = width;
        this.scale = scale;
        this.signed = signed;
        this.signLeadingSeparate = signLeadingSeparate;
    }

    /** The picture of {@code clause}: a PICTURE string, optionally followed by {@code SIGN LEADING SEPARATE}. */
    public static Pic of(String clause) {
        String c = clause.trim().toUpperCase();
        boolean separate = c.matches(".*\\bSIGN\\s+(IS\\s+)?LEADING\\s+SEPARATE\\b.*");
        String p = Picture.expand(c.split("\\s+")[0]);
        boolean signed = p.startsWith("S");
        String body = signed ? p.substring(1) : p;
        int v = body.indexOf('V');
        int scale = v < 0 ? 0 : body.length() - v - 1;
        int width = body.replace("V", "").length() + (signed && separate ? 1 : 0);
        return new Pic(width, scale, signed, separate);
    }
}
