# Testing and Definition of Done Standard

| Field | Value |
|---|---|
| Document ID | STD-TST |
| Title | Testing and Definition of Done Standard |
| Owner | Chief Architect |
| Approved by | Engineering Standards Board |
| Version | 3.0 |
| Effective date | 2026-03-02 |
| Next review | 2027-03-01 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory; SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the corporate policy clause it implements. Waivers follow PAY-001 in the Payments Engineering Standard.

## 2. Tests with every change

**TST-001 Unit tests with every change.** Every change to production code MUST include unit tests that exercise the changed behaviour, and the full test suite MUST pass in the pipeline before the change is merged. A change that alters behaviour without a test MUST NOT be approved. Testing of changes to systems is part of the change, not a follow-up task.
Traces to: FIN-POL-003 clause 4.8 (Testing of changes to systems that calculate charges).

**TST-002 Repeatable tests.** Tests MUST be deterministic and self-contained: no network, no shared databases and no dependence on today's date. The same commit MUST give the same result on any machine. Database tests SHOULD build their data from a fixture loaded into an in-memory database.
Traces to: FIN-POL-003 clause 4.8 (Testing of changes to systems that calculate charges).

## 3. Money and settlement tests

**TST-004 Reconciliation tests.** A change to settlement, fee or charge code MUST ship with tests that reconcile the totals the code computes against the scheme's settlement figures held in a fixture, to the penny, for every scheme in the fixture. Expected values MUST come from the fixture, as the scheme reported them, and MUST NOT be recomputed in the test with the code or formula under test.
Traces to: FIN-POL-003 clauses 4.4 and 4.8.

**TST-005 Reconciliation fixtures.** A reconciliation fixture SHOULD be built from a real business day, anonymised. It MUST include items that must not be counted, such as declined and reversed transactions and transactions on the neighbouring business dates. Live card numbers (PANs) MUST NOT appear in any fixture.
Traces to: FIN-POL-003 clause 4.8 (Testing of changes to systems that calculate charges).

**TST-006 Incident regression tests.** A fix for an incident MUST ship with a regression test that reproduces the incident: it fails before the fix and passes after it. The change record MUST show both runs. The test stays in the suite for good; deleting or weakening it needs the same approval as the original fix.
Traces to: FIN-POL-003 clauses 4.7 and 4.8.

**TST-008 Test evidence.** The evidence for a change MUST include the exact test command, its exit status, the full output of the final run, the commit or working tree tested, and the date and time. The evidence is attached to the change record and kept for as long as FIN-POL-003 requires.
Traces to: FIN-POL-003 clause 4.10 (Evidence and retention).

## 4. Migrations

**TST-010 Characterisation tests for migrations.** Before a program is migrated or rewritten, for example from COBOL to Java or Rust, or from a Java job to Python, its current behaviour MUST be captured in characterisation tests: the same inputs run through the old and the new program MUST give identical outputs, to the penny. The new program MUST NOT go live until they pass.
Traces to: FIN-POL-003 clause 4.8 (Testing of changes to systems that calculate charges).

## 5. Definition of Done

**TST-020 Definition of Done.** A change to payments code is done only when: the PAY and TST requirements it affects are named in the change record; the TST-001 tests, and where they apply the TST-004, TST-006 and TST-010 tests, pass; the TST-008 evidence is attached; another engineer has reviewed it; and the approval that PAY-020 requires is recorded.
Traces to: FIN-POL-003 clauses 4.8, 4.9 and 4.10.

## 6. Related documents

- FIN-POL-003 Financial Controls and Reconciliation Policy
- STD-PAY Payments Engineering Standard
- PM-2024-011 Penny drift in scheme fee accumulation (why TST-004, TST-006 and TST-010 exist)

## 7. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2023-05-02 | First issue |
| 2.0 | 2025-01-13 | TST-004, TST-005, TST-006 and TST-010 added, after PM-2024-011 |
| 3.0 | 2026-03-02 | TST-008 and TST-020 added; traces updated to FIN-POL-003 version 4.0 |
