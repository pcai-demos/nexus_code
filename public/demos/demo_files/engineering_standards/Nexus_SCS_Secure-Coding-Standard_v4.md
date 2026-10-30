# Secure Coding Standard

| Field | Value |
|---|---|
| Document ID | STD-SCS |
| Title | Secure Coding Standard |
| Owner | Principal Security Engineer |
| Approved by | Engineering Standards Board (chair: Chief Architect), with the Chief Information Security Officer |
| Version | 4.0 |
| Effective date | 2026-02-23 |
| Next review | 2027-02-22 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the clause of the Information Security and Data Handling Policy (SEC-POL-001) it implements. Requirement IDs are stable; a retired ID is never reused. Team pages may add detail to this standard but cannot relax it (TEC-POL-002 clause 5.2).

The pre-merge checks (REV-002) test SCS-010, SCS-021 and SCS-031 on every pull request. A finding they report is verified by tool; passing them does not show that the other requirements are met.

**SCS-001 Waivers.** A deviation from a MUST requirement needs a written waiver from the Principal Security Engineer, approved by the CISO, with an expiry no more than 90 days ahead, recorded in the change record. No waiver is available for SCS-010, SCS-011 or SCS-021.
Traces to: SEC-POL-001 clause 5.1 (Standards, exceptions and review).

## 2. Secrets

**SCS-010 No hard-coded secrets.** Source code, configuration, scripts, tests, fixtures, container images and documentation in a repository MUST NOT contain a secret: no password, API key, token, private key or connection string with credentials. Code MUST read secrets at run time from the Bank's secrets vault, or from environment variables the platform injects from it.
Traces to: SEC-POL-001 clause 4.3 (Secrets and credentials).

**SCS-011 Committed secrets are revoked.** A secret committed to any branch MUST be treated as exposed, even if a later commit removes it, because it stays in the history. It MUST be revoked and replaced at once, and the exposure reported to the Security Operations Centre as a security incident.
Traces to: SEC-POL-001 clauses 4.3 and 4.9.

## 3. Card data

**SCS-021 No card numbers or sensitive authentication data in logs.** Logs, traces, error messages, metrics and debugging output MUST NOT contain a full card number (PAN) or any sensitive authentication data, such as the card verification code. This applies at every log level, debug included, in every environment that handles real card data. Logging a whole request or response body that carries card data breaks this rule.
Traces to: SEC-POL-001 clause 4.6 (Logs and diagnostic output).

**SCS-022 Masking card numbers.** Where code must show or record which card was used, it MUST mask the number first: at most the BIN and the last four digits, and only the digits the purpose needs. Logs and support screens SHOULD show the last four only. Masking MUST happen in code before the value reaches a logger, formatter or response, not through the log level or a log filter.
Traces to: SEC-POL-001 clauses 4.5 and 4.6.

## 4. Data handling

**SCS-030 Minimal temporary data.** Code MUST NOT copy card data, secrets or personal data into temporary files, caches, exports, crash dumps, fixtures or tickets unless the task needs it. A copy that is needed MUST hold the minimum, be protected as the original and be deleted when the task ends.
Traces to: SEC-POL-001 clause 4.7 (Data minimisation and retention).

**SCS-031 Parameterised queries only.** SQL MUST be built as parameterised queries or prepared statements, with every value passed as a bound parameter. Code MUST NOT build SQL by concatenating or interpolating values into the query text, even values it believes are safe. A table or column name that varies MUST come from a fixed allow-list in the code.
Traces to: SEC-POL-001 clause 4.8 (Secure software development).

## 5. Related documents

- SEC-POL-001 Information Security and Data Handling Policy
- STD-REV Code Review Standard (REV-002 pre-merge checks, REV-003 severity scale)
- STD-PAY Payments Engineering Standard
- STD-TST Testing and Definition of Done Standard (TST-005: no live card numbers in fixtures)
- CLR-WIKI-014 Why we log the last four only

## 6. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2020-09-07 | First issue |
| 2.0 | 2022-09-05 | SCS-010 (no hard-coded secrets), SCS-021 (no card numbers in production logs) and SCS-031 (parameterised queries) added |
| 3.0 | 2024-03-04 | SCS-021 widened to every log level and environment, and to whole request and response bodies, after INC-2024-0213; SCS-022 recommends the last four only for logs |
| 4.0 | 2026-02-23 | Annual review. SCS-011 (committed secrets are revoked) and SCS-030 (minimal temporary data) added; traces updated to SEC-POL-001 version 5.0 |
