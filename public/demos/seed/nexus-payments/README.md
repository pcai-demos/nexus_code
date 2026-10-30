# nexus-payments

Payment clearing and settlement services for Nexus Bank plc, owned by the
Clearing Engineering squad in Payments & Settlements Technology.

This checkout holds part of the repository:

| Path | What it holds |
|---|---|
| `services/settlement/` | The nightly card scheme settlement reconciliation job (`settlement_reconciler.py`), its query (`reconciliation.sql`), its tests and their SQLite fixture (`fixtures/`) |
| `services/refund-api/` | The card refund API (TypeScript on Node 20): logging, audit events, the database interface and their tests |
| `legacy/clearing-batch/` | The nightly clearing batch (`CLEARING.cbl`, GnuCOBOL), its fixture (`clearing_input.dat`) and the report it gives on that fixture (`expected_totals.txt`) |
| `services/clearing/` | The clearing batch in Java 21, once MOD-2026-07 is done |
| `services/clearing-rs/` | The clearing batch in Rust, MOD-2026-07's Rust variant |
| `libs/cobol-compat/` | The Bank's COBOL compatibility library for Java ports (MIG-004): fields by PICTURE, `ROUNDED`, edited pictures, line-sequential files; JUnit tests against GnuCOBOL's own output |
| `libs/cobol-compat-rs/` | The same library for Rust ports (MIG-005), crate `cobol_compat`: exact fixed point, standard library only |
| `approved-dependencies.json` | The approved third-party packages, by ecosystem, that the pre-merge check compares every manifest with (DEP-001) |
| `backlog/` | Tickets the squad is working on |
| `compliance/records/` | Evidence records for changes |

## Settlement tests

The settlement service needs Python 3.9 or later and nothing beyond the
standard library. From the repository root:

```
python3 -m unittest discover -s services/settlement -p "test_*.py" -v
```

The tests build an in-memory SQLite database from
`services/settlement/fixtures/settlement_fixture.sql`, so they need no
database server and no network.

## Refund API tests

The refund API is TypeScript, compiled with the platform's `tsc` (no `npm install`: the build platform
provides the type definitions and approved packages). From the repository root:

```
tsc -p services/refund-api/tsconfig.json && node --test services/refund-api/dist/test
```

## The clearing batch

The COBOL program names its files by DD name (`CLEARIN`, `CLEAROUT`), bound by
environment variables as the JCL used to bind them. From the repository root:

```
cobc -x -o build/clearing legacy/clearing-batch/CLEARING.cbl
DD_CLEARIN=legacy/clearing-batch/clearing_input.dat DD_CLEAROUT=build/clearing_totals.txt build/clearing
diff -u legacy/clearing-batch/expected_totals.txt build/clearing_totals.txt
```

No output from `diff` means the report matches. CLR-WIKI-019 has the details.

A port is proved the same way: build it with its library, run it on the same fixture, and `diff` its report against
the COBOL's (MIG-001). For the Java port:

```
javac -d build/classes -cp /usr/share/java/junit-platform-console-standalone.jar libs/cobol-compat/src/main/java/com/nexusbank/cobol/*.java services/clearing/src/main/java/com/nexusbank/clearing/ClearingBatch.java services/clearing/src/test/java/com/nexusbank/clearing/ClearingBatchCharacterisationTest.java
java -cp build/classes com.nexusbank.clearing.ClearingBatch legacy/clearing-batch/clearing_input.dat build/clearing_totals_java.txt
diff -u build/clearing_totals.txt build/clearing_totals_java.txt
```

For the Rust port (offline: the crate is used by path):

```
CARGO_TARGET_DIR=build/cargo cargo run --offline --manifest-path services/clearing-rs/Cargo.toml -- legacy/clearing-batch/clearing_input.dat build/clearing_totals_rust.txt
diff -u build/clearing_totals.txt build/clearing_totals_rust.txt
```

## Running the reconciliation job

```
python3 services/settlement/settlement_reconciler.py --db <settlement database> --date <YYYY-MM-DD>
```

It prints a per-scheme summary and exits with status 1 when any scheme fails
the integrity check against its settlement totals.

## Committing a change

A change is committed on a feature branch named after its ticket (`feature/<ticket>`), with its evidence
record from `compliance/records/`, and pushed to the Bank's repository (the remote `bank`) for review. A change
written with an AI assistant says so in its commit message (TEC-POL-005 clause 4.4, REV-005).

## Contacts

- Squad: Clearing Engineering (Payments & Settlements Technology)
- Head of Payments Engineering: David Vance
- Chief Architect: Marcus Thorne
