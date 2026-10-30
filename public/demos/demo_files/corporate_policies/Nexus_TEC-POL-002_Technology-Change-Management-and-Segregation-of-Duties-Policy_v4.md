# Technology Change Management and Segregation of Duties Policy

| Field | Value |
|---|---|
| Document ID | TEC-POL-002 |
| Title | Technology Change Management and Segregation of Duties Policy |
| Owner | Chief Operating Officer |
| Approver | Board Risk Committee |
| Oversight | Director of Risk & Compliance |
| Version | 4.0 |
| Approved | 2026-01-20 |
| Effective date | 2026-02-02 |
| Next review | 2027-01-20 |
| Classification | Internal |
| Status | Approved |
| Applies to | Nexus Bank plc, its staff, contractors and service providers |

## 1. Purpose

This policy sets out how the Bank changes its technology safely. Every change is reviewed, tested and approved before release, no one person can make and approve a change alone, and the evidence is kept. Changes to systems are a common cause of operational disruption, so this policy forms part of the Bank's internal control mechanisms and of its arrangements for operational resilience.

## 2. Scope

This policy applies to every change to a production system: application code, configuration, infrastructure, data fixes and third-party components, whether the change is made by staff, contractors or service providers, and whether or not an AI assistant helped to make it. For systems that calculate, record or settle customer charges or scheme fees, FIN-POL-003 clauses 4.8 and 4.9 also apply.

## 3. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Board Risk Committee | Approves this policy; receives the quarterly change and exceptions report |
| Chief Operating Officer | Owns this policy; accountable for the Bank's technology systems |
| Chief Architect | Owns the Code Review Standard; chairs the Engineering Standards Board |
| Heads of engineering | Approve releases for their systems, or name delegates with release authority |
| Authors | Describe, test and evidence their changes |
| Reviewers | Review changes independently, against the Bank's standards |
| Director of Risk & Compliance | Independent oversight; approves exceptions |
| Internal Audit | Independent assurance; tests the change records |

## 4. Policy statements

**TEC-POL-002 clause 4.1: Controlled changes.** Every change to a production system follows the documented change process. Its change record gives the reason for the change and a description of it, its security impact, the tests run, the approval, and how to return to a safe state if it fails. A change that bypasses the process is handled as an incident.
Traces to: PCI DSS v4.0.1 Requirement 6.5.1; FCA SYSC 4.1.1R (internal control mechanisms).

**TEC-POL-002 clause 4.2: Independent review before release.** Code is reviewed before release by a person other than its author who knows the review techniques and secure coding practices the Bank requires. The review checks the change against the Bank's standards, looks for existing and emerging vulnerabilities and for sensitive data reaching logs, and the corrections it calls for are made before release.
Traces to: PCI DSS v4.0.1 Requirements 6.2.3 and 6.2.3.1.

**TEC-POL-002 clause 4.3: Approval to release.** A change is released only when a person with release authority has approved it. For a system in PCI DSS scope, or one that supports an important business service, that person is neither the author nor the reviewer of the change.
Traces to: PCI DSS v4.0.1 Requirement 6.2.3.1.

**TEC-POL-002 clause 4.4: Findings graded by severity.** Each review finding is graded on the severity scale in the Code Review Standard. A Critical finding stops the release until it is corrected and the change has been reviewed again; a High finding stops it unless a time-limited waiver is recorded. Other findings are corrected or tracked to a date.
Traces to: PCI DSS v4.0.1 Requirement 6.2.3 (appropriate corrections are implemented prior to release).

**TEC-POL-002 clause 4.5: Automated checks and reviewer judgement.** Automated checks run on every change before review, and their results are part of the review. They support the reviewer and do not replace them. The review record keeps findings verified by a tool apart from findings that rest on the reviewer's judgement.
Traces to: PCI DSS v4.0.1 Requirements 6.2.3 and 6.2.4.

**TEC-POL-002 clause 4.6: Testing of changes.** Every change is tested before deployment, including tests that show it does not weaken security. Tests run in environments separated from production, with test data that holds no live card numbers.
Traces to: PCI DSS v4.0.1 Requirements 6.5.1 and 6.5.5; FCA PS21/3 paragraph 1.7.

**TEC-POL-002 clause 4.7: Segregation of duties.** The author of a change may not approve it. Production is separated from development and testing, and changes reach it only through the deployment pipeline, so that only reviewed and approved changes are deployed. Access to production is limited to those whose role needs it.
Traces to: PCI DSS v4.0.1 Requirement 6.5.4; FCA SYSC 4.1.1R (clear lines of responsibility).

**TEC-POL-002 clause 4.8: Change records and evidence.** The change record keeps the review and its findings, the automated check results, the tests and their results, the approvals and any waivers, and states whether an AI assistant contributed to the change. Records are kept for at least six years and can be produced to Internal Audit and the regulators on request.
Traces to: PCI DSS v4.0.1 Requirement 6.5.1 (documented change approval); FCA SYSC 4.1.1R (sound administrative procedures).

## 5. Governance

**TEC-POL-002 clause 5.1: Emergency changes and exceptions.** An emergency change may be released after review by one senior engineer and approval by the on-call head of engineering; it is fully reviewed within two business days. Any other exception needs the prior approval of the Director of Risk & Compliance, is time-limited and is reported to the Board Risk Committee each quarter.
Traces to: FCA SYSC 4.1.1R (internal control mechanisms).

**TEC-POL-002 clause 5.2: Standards and team guidance.** Engineering standards implement the Bank's policies. Team guidance, such as wiki pages, tips and architecture decision records, may add detail but may not relax a policy or standard. Where they conflict, the policy or standard applies, and whoever finds the conflict reports it to the page owner so the page is corrected.
Traces to: FCA SYSC 4.1.1R (internal control mechanisms).

## 6. Definitions

- **Change:** any addition, removal or modification of a production system's code, configuration, infrastructure, data or third-party components.
- **Author:** the person who makes a change, including a change written with the help of an AI assistant.
- **Reviewer:** a person other than the author who reviews the change against the Bank's standards.
- **Release authority:** the authority, held by a head of engineering or a named delegate, to approve a change for release.
- **Team guidance:** wiki pages, tips, digests and architecture decision records written by an engineering team.

## 7. Related documents

- STD-REV Code Review Standard
- STD-TST Testing and Definition of Done Standard
- FIN-POL-003 Financial Controls and Reconciliation Policy
- TEC-POL-005 AI-Assisted Development Policy
- SEC-POL-001 Information Security and Data Handling Policy

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2019-03-12 | First issue, as the Technology Change Management Policy |
| 2.0 | 2021-02-23 | Segregation of duties added; renamed |
| 3.0 | 2023-11-21 | Review findings graded by severity; automated checks recognised as part of review |
| 4.0 | 2026-01-20 | Annual review. Release approval by a person who is neither the author nor the reviewer; records kept for six years, in line with FIN-POL-003; changes made with an AI assistant brought into scope; team guidance may not relax a standard (clause 5.2) |
