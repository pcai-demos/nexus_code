# Running the clearing batch locally

| Field | Value |
|---|---|
| Document ID | CLR-WIKI-019 |
| Title | Running the clearing batch locally |
| Type | Wiki page, Clearing Engineering |
| Owner | Senior Engineer, Clearing Engineering (page owner: Priya Nair) |
| Approved by | David Vance (Head of Payments Engineering), at the June 2026 rewrite |
| Version | 4 |
| Effective date | 2026-07-03 (this version; first published 2021-09-14) |
| Next review | 2027-07-02 |
| Classification | Internal |
| Status | Current |
| Applies to | Clearing Engineering: the clearing batch (`legacy/clearing-batch/`) and any port of it |

## TL;DR

The clearing batch is one COBOL program, `CLEARING.cbl`. Each night it totals the day's settlement records by scheme, and its totals feed the settlement reconciliation in `services/settlement/` (the job INC-2026-0419 was about). You can build and run it in the dev container in under a minute: compile, run, diff. If you're porting it, use the Bank's COBOL compatibility library, read the quirks at the bottom first, and trust the code, not its comments.

## What it does

The scheduler runs the batch every night for the business date. It reads a header, then the day's transactions; it skips declined records and any from another date, works out each transaction's fee, and prints gross, fees and net for each scheme, a total line and a line of counts.

It was written for the mainframe in 1998 and has run under GnuCOBOL on the batch host since September 2021. That runtime reaches end of life on 31 December 2026 and our last COBOL maintainer retires in September, so the batch is being ported to Java 21 (MOD-2026-07, under STD-MIG and ADR-008). On 2 July Marcus agreed under ADR-008 D2 that it may also be proved in Rust, for the batch host's move to a minimal container without a JVM.

## Run it

Everything runs from the repository root, in the dev container, offline.

### The COBOL

GnuCOBOL 3.2 builds and runs the original:

```
mkdir -p build
cobc -x -o build/clearing legacy/clearing-batch/CLEARING.cbl
DD_CLEARIN=legacy/clearing-batch/clearing_input.dat DD_CLEAROUT=build/clearing_totals.txt build/clearing
diff -u legacy/clearing-batch/expected_totals.txt build/clearing_totals.txt
```

- `cobc -x` builds an executable. The source is fixed-format (columns 8 to 72), cobc's default, so no `-free`.
- The files are assigned to `CLEARIN` and `CLEAROUT`, the old JCL DD names. At run time GnuCOBOL looks for an environment variable `DD_` plus the name: that's how the batch host's run script binds them, and how you do here.
- No output from `diff` (exit status 0) means your report matches `expected_totals.txt` byte for byte. That file is the COBOL's own report on the fixture. Never edit it by hand to make a run pass (PAY-015 says the same of any fixture's expected figures).

Every run prints `Warning: program compiled against libxml 212 using older 209`. It's harmless, a packaging mismatch in the Debian GnuCOBOL package, and it goes to stderr, not into the report, so the diff never sees it.

### A port, with the library

A port uses the Bank's COBOL compatibility library and never hand-writes what it covers: fields by column and PICTURE, `ROUNDED`, edited pictures and line-sequential files (MIG-004, MIG-005). The Java library is `libs/cobol-compat/` (package `com.nexusbank.cobol`) and the Rust crate is `libs/cobol-compat-rs/` (`cobol_compat`, used by path). Both are tested against what GnuCOBOL printed, and each port takes the input and report paths as its two arguments, in place of the DD names.

The Java port, `services/clearing/`: build it with the library and its test, run it, and compare.

```
javac -d build/classes -cp /usr/share/java/junit-platform-console-standalone.jar libs/cobol-compat/src/main/java/com/nexusbank/cobol/*.java services/clearing/src/main/java/com/nexusbank/clearing/ClearingBatch.java services/clearing/src/test/java/com/nexusbank/clearing/ClearingBatchCharacterisationTest.java
java -cp build/classes com.nexusbank.clearing.ClearingBatch legacy/clearing-batch/clearing_input.dat build/clearing_totals_java.txt
diff -u legacy/clearing-batch/expected_totals.txt build/clearing_totals_java.txt
```

Then the characterisation test, with JUnit 5's console launcher:

```
java -jar /usr/share/java/junit-platform-console-standalone.jar execute --class-path build/classes --scan-class-path
```

The Rust port, `services/clearing-rs/` (package `clearing`): build, run, compare, test.

```
CARGO_TARGET_DIR=build/cargo cargo build --offline --manifest-path services/clearing-rs/Cargo.toml
build/cargo/debug/clearing legacy/clearing-batch/clearing_input.dat build/clearing_totals_rust.txt
diff -u legacy/clearing-batch/expected_totals.txt build/clearing_totals_rust.txt
CARGO_TARGET_DIR=build/cargo cargo test --offline --manifest-path services/clearing-rs/Cargo.toml
```

### Where tests write

A characterisation test writes its report to a temporary folder: a JUnit `@TempDir` in Java, `std::env::temp_dir()` in Rust, where the test builds its own paths from `env!("CARGO_MANIFEST_DIR")`. Never `target/`: there's no Maven here. The build folder is `build/`, Cargo's too through `CARGO_TARGET_DIR`, and git ignores it.

## The fixture

`clearing_input.dat` is business day Wednesday 24 June 2026, anonymised and cut down to 21 transaction records after the header: 3 declined on the day, three from other days (two from 23 June, one of them declined, and one from 25 June), refunds as status R with negative amounts, and fees that land on exactly half a penny, on sales and on refunds. `expected_totals.txt` is what the COBOL printed for it on 25 June. The header is `H` and the business date; a transaction record is fixed-width:

| Columns | Field | PICTURE | Example |
|---|---|---|---|
| 1 | Record type: `H` header, `T` transaction | `X` | `T` |
| 2 to 9 | Business date, YYYYMMDD | `9(8)` | `20260624` |
| 10 to 19 | Scheme, padded with spaces | `X(10)` | `VISA` |
| 20 to 31 | Transaction ID | `X(12)` | `VI2606240001` |
| 32 | Status: `A` accepted, `R` refund, `D` declined | `X` | `A` |
| 33 to 44 | Amount: its sign, then 11 digits, the last two pence | `S9(9)V99 SIGN LEADING SEPARATE` | `+00000001000` is 10.00 |
| 45 to 49 | Fee rate, five digits, the last four of them decimals | `9V9(4)` | `00145` is 0.0145 |

The library reads a field by the column it starts in and its PICTURE, exactly as the COBOL writes it. The sign is part of the amount's field, so the amount starts in column 33: `FixedRecord.decimal(line, 33, "S9(9)V99 SIGN LEADING SEPARATE")` in Java, `fixed_record::decimal(&line, 33, ...)` in Rust.

## Quirks a port must keep

STD-MIG says how to port it and how to prove the port, and ADR-008 says Java 21, with Rust where Marcus agrees (he did for this batch on 2 July). The library does the arithmetic and the formats if you let it; these are the things a port still gets wrong by default. Most of them are in the fixture on purpose, so the diff catches a port that misses one.

**CLR-WIKI-019 Q1: ROUNDED rounds half away from zero.** Each fee is `COMPUTE WS-FEE ROUNDED = IN-AMOUNT * IN-FEE-RATE`, rounded on its own, then added up. A half penny goes away from zero: +0.145 is 0.15 and -0.145 is -0.15. That's `CobolMath.rounded(fee, "S9(9)V99")`, or `cobol_math::rounded` in Rust. Hand-rolled, it goes wrong: `HALF_EVEN` and `Math.round` both turn the fixture's -0.165 refund fee into -0.16, not -0.17.
Traces to: MIG-004 and MIG-005 (Legacy Modernisation Standard); PAY-012 (Payments Engineering Standard).

**CLR-WIKI-019 Q2: The sign is a character of its own.** Amounts are `PIC S9(9)V99 SIGN LEADING SEPARATE`: a `+` or `-`, then eleven digits with an implied decimal point, so `-00000250000` is -2,500.00. Let the library read it from column 33, where the sign is, with the PICTURE as written; never parse it through a `double`. Rates are `PIC 9V9(4)`: `00145` is 0.0145.
Traces to: MIG-004 and MIG-005 (Legacy Modernisation Standard); PAY-013 (Payments Engineering Standard).

**CLR-WIKI-019 Q3: Only D is skipped; refunds count.** Status `D` (declined) is skipped and counted under DECLINED. Everything else is counted, `A` and `R` alike, and a refund's negative amount brings a negative fee with it. That's why AMEX's totals in the fixture are negative. Don't filter on `A`: the COBOL never did.
Traces to: MIG-002 (Legacy Modernisation Standard).

**CLR-WIKI-019 Q4: Another day's records are skipped first.** The business date comes from the header. A record with any other date is skipped and counted under OTHER DATE before its status is looked at, so a declined record from another day counts as OTHER DATE, not DECLINED. The fixture has two records from the 23rd, one of them declined, and one from the 25th.
Traces to: MIG-002 and MIG-003 (Legacy Modernisation Standard).

**CLR-WIKI-019 Q5: READ doesn't count the header.** Only the first record is checked for `H`; every record after it is treated as a transaction, whatever its first character. READ counts every record after the header, the skipped ones included: 21 in the fixture, of which 15 are totalled, 3 declined and 3 from other dates.
Traces to: MIG-002 (Legacy Modernisation Standard).

**CLR-WIKI-019 Q6: Scheme lines come out in input order.** The input is sorted by scheme, and the program prints a scheme's line when the scheme changes (a control break). It never sorts or groups: if a scheme's records weren't together, it would get two lines. A port that collects totals in a `HashMap`, Java's or Rust's, can print the schemes in any order; a `LinkedHashMap`, a `Vec` in input order or a running control break like the COBOL's keeps it.
Traces to: MIG-002 (Legacy Modernisation Standard).

**CLR-WIKI-019 Q7: The report is fixed-width, and the trailing spaces go.** Amounts use edited pictures like `Z,ZZZ,ZZZ,ZZ9.99-`: leading zeros become spaces, commas group the thousands, and the sign follows the number, `-` (`2,343.58-`) or a space. Line-sequential output trims trailing spaces, so a positive amount at the end of a line loses its sign space. Use `Picture.edit` and `LineSequential.write` (Rust: `picture::edit`, `line_sequential::write`).
Traces to: MIG-004, MIG-005 and MIG-001 (Legacy Modernisation Standard).

**CLR-WIKI-019 Q8: Trust the code, not its comments.** The header still says COPYRIGHT (C) NEXUS PAYMENTS LTD 1998, a company that folded into the Bank. A comment says fees are truncated to the penny; they've been rounded since 2009, and the old truncating COMPUTE is still there, commented out. Another names a test card number: don't copy it anywhere, as the pre-merge check flags card numbers. Port what the code does; ticket the comments.
Traces to: MIG-002 (Legacy Modernisation Standard); REV-002 (Code Review Standard).

## Page history

- **2021-09-14** First published when the batch moved off the mainframe onto the batch host under GnuCOBOL: how to build it, how to run it and the DD names. (the batch's maintainer)
- **2023-10-17** Batch host on GnuCOBOL 3.2; the libxml warning explained. (the batch's maintainer)
- **2026-06-26** Rewritten ahead of the port to Java: the fixture from business day 24 June, `expected_totals.txt` from the COBOL's own run, and the quirks a port must keep (Q1 to Q8), checked against the code with the batch's maintainer. Reviewed by David Vance. (PN)
- **2026-07-03** Porting it: the COBOL compatibility libraries (MIG-004, MIG-005), the commands for the Java port and, after Marcus agreed the Rust variant on 2 July (MOD-2026-07), for the Rust port, and where tests write. Reviewed by Marcus Thorne. (PN)
