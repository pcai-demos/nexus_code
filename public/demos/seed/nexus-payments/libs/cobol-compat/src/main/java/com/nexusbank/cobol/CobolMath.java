package com.nexusbank.cobol;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Storing a result into a receiving item, as COMPUTE does (MIG-004): the receiving item's PICTURE sets the decimal
 * places. Pass the picture as the source writes it.
 */
public final class CobolMath {
    private CobolMath() {}

    /** {@code COMPUTE target ROUNDED = value}: half away from zero, to the target picture's decimal places. */
    public static BigDecimal rounded(BigDecimal value, String targetPic) {
        return value.setScale(Pic.of(targetPic).scale, RoundingMode.HALF_UP);
    }

    /** {@code COMPUTE target = value} without ROUNDED: the extra digits dropped, toward zero. */
    public static BigDecimal truncated(BigDecimal value, String targetPic) {
        return value.setScale(Pic.of(targetPic).scale, RoundingMode.DOWN);
    }
}
