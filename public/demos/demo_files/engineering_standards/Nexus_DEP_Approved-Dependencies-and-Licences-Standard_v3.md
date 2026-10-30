# Approved Dependencies and Licences Standard

| Field | Value |
|---|---|
| Document ID | STD-DEP |
| Title | Approved Dependencies and Licences Standard |
| Owner | Chief Architect |
| Approved by | Engineering Standards Board, with the Principal Security Engineer |
| Version | 3.0 |
| Effective date | 2026-03-09 |
| Next review | 2027-03-08 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the clause of the Third-Party and Open Source Software Policy (TPR-POL-002) it implements. Requirement IDs are stable; a retired ID is never reused. A package may be used before it is approved only under a time-limited exception granted under TPR-POL-002 clause 5.1.

## 2. Approved packages

**DEP-001 Approved packages only.** Code MUST depend only on third-party packages that are on the approved list for its language, at a version within the approved range. The list is kept as data in the repository, at `nexus-payments/approved-dependencies.json`, and the pre-merge check compares every dependency manifest (`package.json`, `requirements.txt`, `pom.xml`, `Cargo.toml`) with it. A package missing from the list blocks the merge.
Traces to: TPR-POL-002 clause 4.2 (Approved components only).

**DEP-002 Licences.** A package MAY be approved only under a permitted licence: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or ISC. Any other licence, including copyleft licences such as the GPL, LGPL and AGPL, needs General Counsel's approval first. A package with no licence, or one whose licence cannot be identified, MUST NOT be approved. Transitive dependencies are checked in the same way.
Traces to: TPR-POL-002 clause 4.3 (Licences).

**DEP-003 Requesting approval.** To add a package, or a new major version of one, the engineer raises a dependency request (DEPREQ) giving the package, version, licence, purpose, the approved packages considered instead, the maintainers' recent activity and any known vulnerabilities. The Chief Architect and the Principal Security Engineer, or their delegates, decide within five business days. An approval is added to the list by a reviewed pull request.
Traces to: TPR-POL-002 clauses 4.1 and 4.2.

## 3. Inventory and vulnerabilities

**DEP-004 Lockfiles and the software bill of materials.** Each service MUST commit its lockfile, and every build MUST produce a software bill of materials that lists every direct and transitive component with its version. The bill of materials feeds the Bank's inventory of third-party components.
Traces to: TPR-POL-002 clause 4.4 (Inventory of software components).

**DEP-005 Vulnerable dependencies.** A dependency with a known critical vulnerability MUST be upgraded or removed within one month of the fix's release, and one with a known high vulnerability within 60 days. A package with a known critical vulnerability and no fix MUST NOT be newly approved.
Traces to: TPR-POL-002 clause 4.5 (Vulnerabilities in components).

## 4. The approved list

The approved list records, for each package: its name, language and ecosystem, the approved version range, its licence, the date of approval, the DEPREQ reference and any conditions of use. For example, a decimal arithmetic library approved for TypeScript carries the condition that amounts are built from strings, as ADR-004 requires. A package is removed from the list when it is no longer maintained or its licence changes, and the services that use it are given a date to move off it.

## 5. Related documents

- TPR-POL-002 Third-Party and Open Source Software Policy
- STD-REV Code Review Standard (REV-002 pre-merge checks)
- STD-SCS Secure Coding Standard
- ADR-004 Monetary amounts use Decimal with an explicit scale

## 6. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2022-05-09 | First issue |
| 2.0 | 2024-07-15 | DEP-002 extended to transitive dependencies; DEP-004 software bill of materials added |
| 3.0 | 2026-03-09 | The approved list moved into the repository as data (`approved-dependencies.json`) so the pre-merge check can read it; DEP-005 fix times added; traces updated to TPR-POL-002 version 3.0 |
