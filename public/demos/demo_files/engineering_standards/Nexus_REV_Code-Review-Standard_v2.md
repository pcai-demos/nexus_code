# Code Review Standard

| Field | Value |
|---|---|
| Document ID | STD-REV |
| Title | Code Review Standard |
| Owner | Chief Architect |
| Approved by | Engineering Standards Board |
| Version | 2.0 |
| Effective date | 2026-04-13 |
| Next review | 2027-04-12 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the clause of the Technology Change Management and Segregation of Duties Policy (TEC-POL-002), or of the AI-Assisted Development Policy (TEC-POL-005), that it implements. Requirement IDs are stable; a retired ID is never reused. There is no waiver from REV-001, REV-003 or REV-005; any other deviation follows PAY-001 in the Payments Engineering Standard.

## 2. The review

**REV-001 Review checklist.** Before a pull request is merged, an engineer other than its author MUST review it against every item of the checklist in section 3. The reviewer records each item as met, not met (a finding) or not applicable. A review that skips an item is incomplete and cannot approve the change.
Traces to: TEC-POL-002 clause 4.2 (Independent review before release).

**REV-002 Automated checks first.** The pre-merge checks MUST run on every pull request before human review: secrets, card numbers in code and logs, floating-point money, SQL built from strings, dependencies missing from the approved list, and changed modules with no test. Their output MUST be attached to the review. A check that fails is a finding verified by tool.
Traces to: TEC-POL-002 clause 4.5 (Automated checks and reviewer judgement).

## 3. The checklist

| # | Item | Requirements |
|---|---|---|
| 1 | No secret in code, configuration, tests or fixtures | SCS-010, SCS-011 |
| 2 | No card number or sensitive authentication data in logs, at any level; card numbers masked | SCS-021, SCS-022 |
| 3 | No more data copied or kept than the task needs | SCS-030 |
| 4 | Money in a decimal type, parsed from text, rounded once per transaction, half up | PAY-012, PAY-013 |
| 5 | SQL built only from parameterised queries | SCS-031 |
| 6 | Dependencies on the approved list, under permitted licences | DEP-001, DEP-002 |
| 7 | Tests for the changed behaviour, passing in the pipeline | TST-001 |
| 8 | An audit event for every action that moves money or changes settlement data | PAY-030 |
| 9 | Outbound money-moving calls: an idempotency key reused on retry, timeouts, bounded retries | INT-001, INT-002, INT-003 |
| 10 | An AI-assisted change is labelled | REV-005 |
| 11 | Team guidance followed only where it agrees with the standards | REV-008 |

## 4. Severity and how findings are established

**REV-003 Severity scale.** Each finding MUST be graded on the scale below. A Critical finding blocks the merge: the pull request cannot be approved until the finding is fixed and the change reviewed again, and no waiver applies. A High finding blocks the merge unless a waiver is recorded. A Medium finding is fixed in the pull request or ticketed for the next release; a Low finding is advice.
Traces to: TEC-POL-002 clause 4.4 (Findings graded by severity).

| Severity | What it means | Examples | Merge |
|---|---|---|---|
| Critical | The change as it stands exposes a secret, a full card number or sensitive authentication data: in code, in a log written in production (info level and above), in a file or in a message | A hard-coded API key; a full card number logged at info level | Blocked until fixed and reviewed again; no waiver |
| High | A MUST requirement is broken in a way that can move money wrongly, lose a record or weaken a control, including card data that would reach a log only if debug logging were switched on | Money in floating point; SQL built from strings; an unapproved dependency; changed behaviour with no test; a refund with no audit event; a retried payment call with no idempotency key | Blocked unless a waiver is recorded |
| Medium | A SHOULD requirement is not met, or a weakness with no direct route to harm | No timeout on a read-only call; an unhelpful error message | Fixed in the pull request or ticketed for the next release |
| Low | Readability, naming or style | A misleading variable name | Advice; the author decides |

**REV-004 Verified by tool or assessed by the reviewer.** Each finding MUST say how it was established. Verified by tool: a deterministic check reproduced it and its output is attached. Assessed by the reviewer: a judgement, recorded with its reasoning and the rule it rests on. The review record MUST list the two kinds apart, and an assessed finding MUST NOT be presented as verified.
Traces to: TEC-POL-002 clause 4.5 (Automated checks and reviewer judgement).

## 5. AI-assisted changes and reviews

**REV-005 AI-generated changes are labelled and reviewed by a human.** A change written wholly or partly by an AI assistant MUST be labelled AI-assisted in the pull request and the change record, naming the assistant and the model. Another engineer MUST review it in full and a person MUST approve it. An AI assistant MUST NOT approve, merge or deploy a change.
Traces to: TEC-POL-005 clauses 4.3 and 4.4.

**REV-006 AI-assisted reviews.** A reviewer MAY prepare a review with an approved AI assistant. The assistant's findings are proposals: the reviewer confirms or rejects each one, the review record shows which findings the assistant proposed, and the reviewer, not the assistant, decides the outcome.
Traces to: TEC-POL-005 clauses 4.3 and 4.4.

## 6. Outcome and conflicting guidance

**REV-007 Review outcome and record.** The outcome MUST be Approved, Approved with comments (only Medium or Low findings open, each ticketed) or Changes requested (any Critical or High finding open). The review record, with each finding's severity, rule IDs and how it was established, the tool output, any fixes made during review and the outcome, MUST be attached to the change record.
Traces to: TEC-POL-002 clauses 4.4 and 4.8.

**REV-008 Conflicting guidance.** Where a team page, wiki tip or architecture decision record conflicts with a standard or policy, the reviewer MUST apply the standard or policy, record the conflict in the finding, and tell the page owner so the page is corrected or archived. Having followed out-of-date team guidance does not change a finding's severity.
Traces to: TEC-POL-002 clause 5.2 (Standards and team guidance).

## 7. Related documents

- TEC-POL-002 Technology Change Management and Segregation of Duties Policy
- TEC-POL-005 AI-Assisted Development Policy
- STD-SCS Secure Coding Standard
- STD-PAY Payments Engineering Standard
- STD-TST Testing and Definition of Done Standard
- STD-DEP Approved Dependencies and Licences Standard
- STD-INT Payments Integration Standard

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2024-01-08 | First issue: REV-001 checklist, REV-003 severity scale and REV-007 review outcome |
| 1.1 | 2024-06-03 | REV-002: automated pre-merge checks on every pull request |
| 2.0 | 2026-04-13 | REV-004 (verified by tool or assessed by the reviewer), REV-005 and REV-006 (AI-assisted changes and reviews) and REV-008 (conflicting guidance) added; checklist extended to idempotency (INT-001 to INT-003) and audit events (PAY-030); traces updated to TEC-POL-002 version 4.0 and TEC-POL-005 version 2.0 |
