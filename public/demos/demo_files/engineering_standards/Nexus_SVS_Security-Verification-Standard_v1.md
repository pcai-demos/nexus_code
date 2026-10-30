# Security Verification Standard

| Field | Value |
|---|---|
| Document ID | STD-SVS |
| Title | Security Verification Standard |
| Owner | Head of Application Security |
| Approved by | Engineering Standards Board |
| Version | 1.0 |
| Effective date | 2026-06-01 |
| Next review | 2027-06-01 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. STD-SVS adopts the OWASP Application Security Verification Standard (ASVS) version 5.0.0 as the Bank's external reference for verifying application security. The "Traces to" line of each requirement names the policy clauses and the ASVS requirements it applies. Requirement IDs are stable. A deviation follows SCS-001 in the Secure Coding Standard.

## 2. Scope

STD-SVS applies to every new component, and to every change to code that handles card data, money or personal data, in Payments & Settlements Technology. It sets what is verified before a change is merged and how the evidence is kept. The Secure Coding Standard (STD-SCS) sets how the code is written.

## 3. Verification

**SVS-001 Verification level.** A new component, or a change to code that handles card data or money, MUST be verified against the ASVS 5.0.0 Level 2 requirements that apply to it before it is merged. The review records each requirement verified, and whether a tool or a reviewer verified it.
Traces to: SEC-POL-001 clause 4.8; PCI DSS v4.0.1 Requirement 6.2.4.

**SVS-010 Business input.** Input that drives a business decision, such as an amount, a status or a reference to a record, MUST be checked against the business rules before it is used: allow lists, ranges, and the record it names. A refusal MUST say which rule the input failed.
Traces to: SEC-POL-001 clause 4.8; OWASP ASVS 5.0.0 requirement 2.2.1.

**SVS-011 Injection.** Every database query MUST pass its values as bound parameters, as SCS-031 requires, including values the code believes are safe.
Traces to: SEC-POL-001 clause 4.8; OWASP ASVS 5.0.0 requirement 1.2.4.

**SVS-012 Minimum sensitive data.** A component MUST return, store and show only the sensitive data its purpose needs: a card number as its last four digits (SCS-022), and no copy of card data it does not need (SCS-030).
Traces to: SEC-POL-001 clauses 4.5 and 4.7; OWASP ASVS 5.0.0 requirements 14.2.6 and 14.2.7.

**SVS-013 Logs and audit events.** A log entry or an audit event MUST say when, where, who and what (PAY-030 for actions on settlement data), and MUST NOT hold a card number or other sensitive data (SCS-021).
Traces to: SEC-POL-001 clause 4.6; OWASP ASVS 5.0.0 requirements 16.2.1 and 16.2.5.

**SVS-014 Errors.** A refusal or an unexpected error MUST tell the caller what failed in plain terms, without internal detail: no query, stack trace, secret or card data.
Traces to: SEC-POL-001 clause 4.6; OWASP ASVS 5.0.0 requirement 16.5.1.

## 4. Evidence

**SVS-020 Evidence with the change.** The verification's results, by tool and by reviewer, MUST be kept with the change record (TST-008). A finding rated High or Critical under REV-003 MUST be fixed before merge. A lower one MUST be fixed, or accepted by the reviewer with the reason recorded.
Traces to: TEC-POL-002 clause 4.8.

## 5. Related documents

- OWASP Application Security Verification Standard 5.0.0 (May 2025), licensed CC BY-SA 4.0: the external reference
- STD-SCS Secure Coding Standard (SCS-021, SCS-022, SCS-030, SCS-031)
- STD-REV Code Review Standard (REV-002 pre-merge checks, REV-003 severity)
- STD-TST Testing and Definition of Done Standard (TST-008 test evidence)
- SEC-POL-001 Information Security and Data Handling Policy (clauses 4.5 to 4.8)
- TEC-POL-002 Technology Change Management and Segregation of Duties Policy (clause 4.8)

## 6. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-01 | First issue. OWASP ASVS 5.0.0 Level 2 is adopted as the Bank's external reference for verifying new components and changes to card-data and money code: business input (SVS-010), injection (SVS-011), minimum sensitive data (SVS-012), logs and audit events (SVS-013), errors (SVS-014), and the evidence kept with the change (SVS-020). |
