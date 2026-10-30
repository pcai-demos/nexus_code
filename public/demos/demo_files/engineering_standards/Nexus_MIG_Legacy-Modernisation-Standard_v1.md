# Legacy Modernisation Standard

| Field | Value |
|---|---|
| Document ID | STD-MIG |
| Title | Legacy Modernisation Standard |
| Owner | Chief Architect |
| Approved by | Engineering Standards Board |
| Version | 1.0 |
| Effective date | 2026-06-01 |
| Next review | 2027-06-01 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the clause of the Technology Lifecycle and Modernisation Policy (TEC-POL-004), or of another policy, that it implements. Requirement IDs are stable; a retired ID is never reused. There is no waiver from MIG-001 or MIG-002; any other deviation follows PAY-001 in the Payments Engineering Standard.

## 2. Scope

STD-MIG applies to every migration in Payments & Settlements Technology: a program rewritten in another language, moved to another platform, or replaced by a new program that does the same job. It adds to TST-010 in the Testing and Definition of Done Standard and does not replace it. The target language is agreed with the Chief Architect before work starts. The COBOL compatibility libraries are in `libs/cobol-compat/` (Java) and `libs/cobol-compat-rs/` (Rust). A migration written with an AI assistant needs the same evidence, and is labelled and reviewed under REV-005.

## 3. Proving equivalence

**MIG-001 Equivalence evidence.** A migration MUST be proved equivalent before it goes live. The old and the new program are each run on the same fixture (MIG-003), and a tool, not a person, compares their outputs, which MUST be identical byte for byte. The commands, both outputs, the tool's result and both programs' versions are kept with the change record. The pull request MUST also bring a characterisation test of the new program on the fixture (TST-010).
Traces to: TEC-POL-004 clause 4.3; FIN-POL-003 clause 4.8.

**MIG-002 Behaviour first.** A migration MUST NOT change behaviour. The new program does what the old one does, including its rounding, its filters and its report format, even where that looks wrong. A defect found on the way, such as a comment that contradicts the code, MUST be raised as its own ticket and fixed, if at all, in a separate change, never in passing. Where a comment and the code disagree, the code is the behaviour to keep.
Traces to: TEC-POL-004 clause 4.3; TEC-POL-002 clause 4.1.

**MIG-003 Fixtures.** The fixture MUST be built from a real business day, anonymised, with no live card numbers (TST-005). It MUST exercise every branch of the old program: each record type and status, both signs, the records it skips, half-penny fees of both signs, a negative total, and the report's thousands separators, zero suppression and negative signs. Before it is frozen it SHOULD be run through deliberately wrong ports, and each must change the output.
Traces to: TEC-POL-004 clause 4.3; FIN-POL-003 clause 4.8.

## 4. Mapping the code

**MIG-004 COBOL to Java mapping.** A Java port MUST use the COBOL compatibility library (`com.nexusbank.cobol`) for fields by PICTURE as the COBOL writes it (`FixedRecord`); `ROUNDED`, half away from zero, and truncation (`CobolMath`); edited pictures, with zero suppression, separators and a trailing minus (`Picture.edit`); and line-sequential files without trailing spaces (`LineSequential`). Never hand-write them. Money is `BigDecimal`, never `float` or `double`.
Traces to: TEC-POL-004 clause 4.3; FIN-POL-003 clause 4.3.

**MIG-005 COBOL to Rust mapping.** A Rust port MUST use the COBOL compatibility crate (`cobol_compat`) as MIG-004 uses the Java library: `fixed_record`, `cobol_math`, `picture` and `line_sequential`. Never hand-write them. Money is the crate's `Fixed`, an exact decimal (integer units at a scale) that meets PAY-012, never `f32` or `f64`. The crate is the Bank's own code, used by path; any other crate needs DEP-001 approval.
Traces to: TEC-POL-004 clause 4.3; FIN-POL-003 clause 4.3; TPR-POL-002 clause 4.2.

The libraries are the mapping's contract, and their tests check them against what GnuCOBOL printed:

| COBOL | Java (MIG-004) | Rust (MIG-005) |
|---|---|---|
| A field by column and PICTURE | `FixedRecord.decimal`, `.text` | `fixed_record::decimal`, `::text` |
| `S9(9)V99`, `9V9(4)` | `BigDecimal` at scale 2 or 4 | `Fixed` at scale 2 or 4 |
| `ROUNDED`: half away from zero | `CobolMath.rounded` | `cobol_math::rounded` |
| No `ROUNDED`: toward zero | `CobolMath.truncated` | `cobol_math::truncated` |
| `Z,ZZZ,ZZZ,ZZ9.99-`, `ZZ,ZZ9` | `Picture.edit` | `picture::edit`, `edit_count` |
| `LINE SEQUENTIAL` files | `LineSequential.read`, `.write` | `line_sequential::read`, `::write` |

## 5. Cut-over

**MIG-006 Parallel run before cut-over.** After MIG-001 passes, the new program MUST run alongside the old one on live input for at least ten business days, including a month-end, with a tool comparing their outputs each day. Any difference stops the run until its cause is found; then the ten days start again. Cut-over is approved in writing, the service's mapping is updated, and the old program stays ready to take the work back until the first month-end after cut-over reconciles.
Traces to: TEC-POL-004 clauses 4.4 and 4.5.

## 6. Related documents

- TEC-POL-004 Technology Lifecycle and Modernisation Policy
- STD-TST Testing and Definition of Done Standard (TST-005 fixtures, TST-010 characterisation tests)
- STD-PAY Payments Engineering Standard (PAY-012, PAY-013)
- STD-REV Code Review Standard (REV-005, AI-assisted changes)
- STD-DEP Approved Dependencies and Licences Standard (DEP-001)
- The COBOL compatibility libraries, `libs/cobol-compat/` and `libs/cobol-compat-rs/`, with their tests
- ADR-004 Monetary amounts use Decimal with an explicit scale
- PM-2024-011 Penny drift in scheme fee accumulation (why MIG-001 exists: lesson L5, "a rewrite is a change to money code")

## 7. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-01 | First issue, with TEC-POL-004 version 2.0 and the COBOL compatibility libraries for Java and Rust: equivalence evidence (MIG-001), behaviour first (MIG-002), fixtures (MIG-003), the COBOL to Java and COBOL to Rust mappings (MIG-004, MIG-005) and the parallel run (MIG-006) |
