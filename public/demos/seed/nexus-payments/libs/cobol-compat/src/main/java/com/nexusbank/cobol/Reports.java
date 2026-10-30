package com.nexusbank.cobol;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Two reports compared byte for byte, as a characterisation test needs (MIG-001, TST-010). A mismatch fails with the
 * lines that differ, each between bars so trailing spaces show, instead of two arrays of byte values. Comparing byte
 * arrays with assertEquals compares the arrays' identity, not their bytes, and fails even when every byte matches.
 */
public final class Reports {
    private Reports() {}

    /** Throws an AssertionError naming the lines that differ unless the two files hold the same bytes. */
    public static void assertSameBytes(Path expected, Path actual) throws IOException {
        byte[] e = Files.readAllBytes(expected);
        byte[] a = Files.readAllBytes(actual);
        if (Arrays.equals(e, a)) return;
        throw new AssertionError(difference(expected, e, actual, a));
    }

    /** The difference in words: up to three lines that differ, or the line endings when every line agrees. */
    static String difference(Path expected, byte[] e, Path actual, byte[] a) {
        List<String> el = lines(e);
        List<String> al = lines(a);
        StringBuilder out = new StringBuilder("the reports differ (expected " + expected + ", actual " + actual + ")");
        int shown = 0;
        for (int i = 0; i < Math.max(el.size(), al.size()) && shown < 3; i++) {
            String x = i < el.size() ? el.get(i) : null;
            String y = i < al.size() ? al.get(i) : null;
            if (x != null && x.equals(y)) continue;
            out.append("\nline ").append(i + 1).append(':');
            out.append("\n  expected: ").append(x == null ? "(no line)" : "|" + x + "|");
            out.append("\n  actual:   ").append(y == null ? "(no line)" : "|" + y + "|");
            shown++;
        }
        if (shown == 0) {
            out.append("\nevery line agrees: the files differ only in line endings or the final newline (")
                .append(e.length).append(" bytes expected, ").append(a.length).append(" actual)");
        }
        out.append("\n(").append(el.size()).append(" lines expected, ").append(al.size()).append(" actual)");
        return out.toString();
    }

    private static List<String> lines(byte[] b) {
        List<String> out = new ArrayList<>();
        for (String l : new String(b, StandardCharsets.ISO_8859_1).split("\n", -1)) out.add(l.endsWith("\r") ? l.substring(0, l.length() - 1) : l);
        if (!out.isEmpty() && out.get(out.size() - 1).isEmpty()) out.remove(out.size() - 1);
        return out;
    }
}
