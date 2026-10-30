# Payments Engineering Standard

| Field | Value |
|---|---|
| Document ID | STD-PAY |
| Title | Payments Engineering Standard |
| Owner | Head of Payments Engineering |
| Approved by | Engineering Standards Board (chair: Chief Architect) |
| Version | 3.0 |
| Effective date | 2026-02-16 |
| Next review | 2027-02-15 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the clause of the corporate policy it implements. Requirement IDs are stable; a retired ID is never reused.

**PAY-001 Waivers.** A deviation from a MUST requirement needs a written waiver from the Head of Payments Engineering, with an expiry date no more than 90 days ahead, recorded in the change record. Where the deviation also departs from FIN-POL-003, the Director of Risk & Compliance approves it first.
Traces to: FIN-POL-003 clause 5.1 (Reporting, review and exceptions).

## 2. Scope

**PAY-010 Scope.** STD-PAY applies to all code, queries, schemas, batch jobs and test fixtures in Payments & Settlements Technology that calculate, store, move, settle, reconcile or report money, and to every change to them. It covers the execution of payment transactions and charges, including scheme fees, from capture to settlement. These systems deliver an important business service: card payment acceptance and settlement.
Traces to: FIN-POL-003 section 2 (Scope) and clauses 4.1 and 4.2.

## 3. Monetary values

**PAY-011 Currency and scale.** Every monetary value MUST carry its currency as an ISO 4217 code. Sterling amounts MUST have a scale of two decimal places, the penny being the minor unit. A change of currency or scale MUST be explicit in the code and MUST NOT happen as a side effect of formatting, division or a type conversion.
Traces to: FIN-POL-003 clause 4.3 (Accurate records of payment transactions and charges).

**PAY-012 Monetary values: types and rounding.** Amounts, fees and charges MUST be held and calculated in a decimal type (Python `Decimal`, Java `BigDecimal`, SQL `DECIMAL`), never binary floating point (`float`, `double`, `REAL`). Each fee or charge MUST be rounded to the penny once per transaction, half up (ROUND_HALF_UP), and MUST NOT be truncated. Totals MUST be sums of the rounded amounts.
Traces to: FIN-POL-003 clause 4.3 (Accurate records of payment transactions and charges).

**PAY-013 Conversion at the boundaries.** Amounts and rates read from databases, files, messages or APIs MUST be parsed into the decimal type from their text form, never through a float. Where a store has no exact decimal type, such as SQLite, money MUST be stored as decimal text, for example '1234.56', and rates with their full precision, for example '0.0145'.
Traces to: FIN-POL-003 clause 4.3 (Accurate records of payment transactions and charges).

## 4. Reconciliation and settlement

**PAY-014 Reconciliation integrity checks.** A job that calculates scheme fees or settlement amounts MUST reconcile its gross, fee and net totals for each scheme and business date with the totals that scheme reported for that date, to the penny, before anything is posted. Any difference MUST fail the integrity check, end the job with a non-zero exit status and hold the settlement file. No tolerance may be applied.
Traces to: FIN-POL-003 clauses 4.4 and 4.5.

**PAY-015 Held settlement files.** A held settlement file MUST NOT be posted until the reconciliation passes on a re-run, or until Finance Operations signs off a documented manual reconciliation. Engineers MUST NOT edit a settlement file, a scheme's totals, the fee schedule or a test fixture's expected figures to make a reconciliation pass. Releasing the file is a Finance Operations action.
Traces to: FIN-POL-003 clauses 4.5 and 4.9.

## 5. Changes to money code

**PAY-020 Changes to fee and settlement code.** A change to code that calculates fees, charges or settlement amounts MUST meet TST-004 and, for an incident fix, TST-006. It MUST be reviewed by an engineer other than its author and approved by the Head of Payments Engineering or a named delegate, and its change record MUST list the PAY requirements it affects.
Traces to: FIN-POL-003 clauses 4.8 and 4.9.

## 6. Audit events

**PAY-030 Audit events for money movement.** Every action that creates, changes, holds, releases or posts settlement data, or changes a fee schedule, MUST emit an audit event recording who or which job acted, on what, when, the values before and after, and the ticket or change reference. Application code MUST NOT suppress, edit or delete audit events.
Traces to: FIN-POL-003 clauses 4.3 and 4.10.

**PAY-031 Reconciliation run events.** Each reconciliation run MUST record, as an audit event, the business date, the scheme totals it read, the totals it computed, the result and every mismatch, so that a break and its resolution can be rebuilt from the audit store alone.
Traces to: FIN-POL-003 clauses 4.4 and 4.10.

## 7. Related documents

- FIN-POL-003 Financial Controls and Reconciliation Policy
- STD-TST Testing and Definition of Done Standard
- ADR-004 Monetary amounts use Decimal with an explicit scale
- PM-2024-011 Penny drift in scheme fee accumulation (why PAY-012 and PAY-014 read as they do)

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2022-03-14 | First issue |
| 2.0 | 2023-09-04 | PAY-030 audit events added |
| 2.1 | 2024-10-21 | PAY-012 tightened (half up, once per transaction, never truncate) and PAY-014 added, after PM-2024-011 |
| 3.0 | 2026-02-16 | Annual review. PAY-013, PAY-015, PAY-020 and PAY-031 added; traces updated to FIN-POL-003 version 4.0 |
