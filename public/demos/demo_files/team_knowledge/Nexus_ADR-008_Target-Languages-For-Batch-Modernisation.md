# ADR-008: Target languages for batch modernisation

| Field | Value |
|---|---|
| Document ID | ADR-008 |
| Title | Target languages for batch modernisation |
| Type | Architecture decision record, Payments & Settlements Technology |
| Owner | Chief Architect |
| Deciders | Marcus Thorne (Chief Architect), David Vance (Head of Payments Engineering) |
| Version | 1 |
| Effective date | 2026-06-17 (version 1, accepted) |
| Next review | 2027-06-16 |
| Classification | Internal |
| Status | Accepted |
| Applies to | Batch programs in Payments & Settlements Technology replaced under the Legacy Modernisation Standard |

## Context

The clearing batch (`CLEARING.cbl`) has to come off the batch host's GnuCOBOL runtime before it reaches end of life on 31 December 2026, and the one engineer who still maintains our COBOL retires in September. TEC-POL-004 and the Legacy Modernisation Standard (STD-MIG), both in force since 1 June, say how a replacement is proved and cut over, and STD-MIG has every port use the Bank's COBOL compatibility libraries. They don't say what we write it in. Left open, every migration picks its own language, and the batch run-book gains a runtime per program.

Two needs pull different ways. A batch job that totals money wants exact decimal arithmetic, a runtime the platform team already patches and monitors, and code most of the squad can review. A few components, such as code replacing C or parsers of files from outside the Bank, want memory safety and a small footprint without a garbage-collected runtime.

## Decision

**ADR-008 D1: Java 21 by default.** A batch program is replaced in Java 21 unless D2 applies. Money is `BigDecimal` (ADR-004 D1), and fields, rounding, edited pictures and files go through the Bank's COBOL compatibility library, `com.nexusbank.cobol` (MIG-004). The JVM is already on the batch host, monitored and in the run-book, and most of the squad reads Java.
Traces to: MIG-004 (Legacy Modernisation Standard).

**ADR-008 D2: Rust where memory safety or a small footprint matters.** Where the Chief Architect agrees that a component needs memory safety or a small footprint, such as code replacing C or a job that must run without a JVM, it is written in Rust with the Bank's COBOL compatibility crate, `cobol_compat` (MIG-005): money is its exact `Fixed`, never `f64`. Otherwise, standard library only, unless DEP-001 approves a crate.
Traces to: MIG-005 (Legacy Modernisation Standard); DEP-001 (Approved Dependencies and Licences Standard).

**ADR-008 D3: No binary floating point for money, in either language.** No `double` or `float` in Java and no `f64` or `f32` in Rust for an amount, a fee, a rate or a total: not in a variable, a parse, a test's expected value or a format call. Amounts are parsed from their text, as ADR-004 D4 says.
Traces to: PAY-012 and PAY-013 (Payments Engineering Standard).

**ADR-008 D4: The characterisation test ships with the migration.** The pull request that brings in the new program also brings its characterisation test, which runs the new program on the fixture and compares its report with the COBOL's expected report, byte for byte. The tool comparison against the COBOL itself (MIG-001) runs beside it, and the pull request isn't ready for review until both pass.
Traces to: TST-010 (Testing and Definition of Done Standard); MIG-001 (Legacy Modernisation Standard).

The fee for a refund of 13.75 at 1.20% in the clearing batch's record layout, with the libraries; each column is where its field starts:

```java
// Fields by column and PICTURE, as the COBOL declares them; never a double (MIG-004).
BigDecimal amount = FixedRecord.decimal(rec, 33, "S9(9)V99 SIGN LEADING SEPARATE"); // -13.75
BigDecimal rate = FixedRecord.decimal(rec, 45, "9V9(4)");                          // 0.0120
BigDecimal fee = CobolMath.rounded(amount.multiply(rate), "S9(9)V99");             // -0.165 -> -0.17
```

The same fee in Rust, with the crate's exact `Fixed`:

```rust
// The same fields and rounding, never f64 (MIG-005).
let amount = fixed_record::decimal(&rec, 33, "S9(9)V99 SIGN LEADING SEPARATE"); // -13.75
let rate = fixed_record::decimal(&rec, 45, "9V9(4)");                           // 0.0120
let fee = cobol_math::rounded(&amount.mul(&rate), "S9(9)V99");                  // -0.165 -> -0.17
```

## Consequences

- Two target languages, not one per program. Rust joins the batch run-book only when D2 is used.
- A port is reviewed like any money code: a `double` near money is a finding (REV-001, checklist item 4), and so is a field, a rounding or an edited picture written by hand instead of with the library (MIG-004, MIG-005).
- In Rust the crate's `Fixed` is the decimal type the standard library lacks: integer units at a scale, exact as ADR-004 D1 wants, rounded once per transaction, half up, by `cobol_math::rounded` (ADR-004 D3). This doesn't reopen ADR-004 for Python, Java or SQL.
- Both libraries are the Bank's own code in `libs/`, tested against what GnuCOBOL printed. A port uses them by path, so DEP-001, which governs third-party packages, doesn't apply to them.
- Our build platform has no route to the public crate registry, so an unapproved crate fails the build anyway; any other crate needs a DEPREQ (DEP-003).
- An AI assistant may draft a port under TEC-POL-005. That changes nothing above: the evidence is the same, and the change is labelled AI-assisted (REV-005).

## Alternatives considered

1. **Keep the COBOL on a supported commercial runtime.** Rejected: it deals with the runtime's end of life but not with the knowledge held by one person (TEC-POL-004 clause 4.6). Nobody else on the squad reads COBOL.
2. **Python, like the settlement reconciliation.** Rejected as the default for batch replacements. Decimal would do the job (ADR-004), but a statically typed port catches more of a migration's mistakes before it runs, and the JVM is already on the batch host and in its run-book.
3. **Rust for everything.** Rejected: most of the squad reads Java, not Rust, and the JVM is already supported.
4. **An automated COBOL-to-Java translator.** Rejected: it produces Java that reads like COBOL, needs a licence and a DEPREQ, and its output still needs MIG-001's evidence.
5. **Hand-written conversions in each port.** Rejected: every port would re-derive `ROUNDED`, the separate sign and the edited pictures, which is where ports go wrong. The libraries do it once, tested against GnuCOBOL's own output.

## Links

- TEC-POL-004 Technology Lifecycle and Modernisation Policy
- Legacy Modernisation Standard: MIG-001, MIG-004, MIG-005
- The COBOL compatibility libraries: `libs/cobol-compat/` (Java) and `libs/cobol-compat-rs/` (Rust)
- Testing and Definition of Done Standard: TST-010
- Payments Engineering Standard: PAY-012, PAY-013
- ADR-004 Monetary amounts use Decimal with an explicit scale
- CLR-WIKI-019 Running the clearing batch locally

## History

- Version 1, 2026-06-17: accepted (D1 to D4).
