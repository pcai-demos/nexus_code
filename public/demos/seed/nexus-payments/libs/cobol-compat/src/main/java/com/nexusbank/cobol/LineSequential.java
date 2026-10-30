package com.nexusbank.cobol;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Line-sequential files as GnuCOBOL reads and writes them (MIG-004): one record per line, trailing spaces dropped on write. */
public final class LineSequential {
    private LineSequential() {}

    /** Every line of {@code file}. */
    public static List<String> read(Path file) throws IOException {
        return Files.readAllLines(file, StandardCharsets.ISO_8859_1);
    }

    /** Writes {@code lines} to {@code file}, each without its trailing spaces and ended by a newline. */
    public static void write(Path file, List<String> lines) throws IOException {
        List<String> out = new ArrayList<>();
        for (String l : lines) out.add(l.stripTrailing());
        Files.writeString(file, String.join("\n", out) + (out.isEmpty() ? "" : "\n"), StandardCharsets.ISO_8859_1);
    }
}
