# Third-Party and Open Source Software Policy

| Field | Value |
|---|---|
| Document ID | TPR-POL-002 |
| Title | Third-Party and Open Source Software Policy |
| Owner | Chief Operating Officer |
| Approver | Board Risk Committee |
| Oversight | Director of Risk & Compliance |
| Version | 3.0 |
| Approved | 2026-02-17 |
| Effective date | 2026-03-02 |
| Next review | 2027-02-17 |
| Classification | Internal |
| Status | Approved |
| Applies to | Nexus Bank plc, its staff, contractors and service providers |

## 1. Purpose

This policy sets out how the Bank chooses, approves, records and maintains software it obtains from third parties: open source software, commercial libraries and frameworks, container images, development tools and AI models. Using such software is not outsourcing, but it is a third-party arrangement. The Bank assesses the materiality and risks of each one and applies controls in proportion to them, so that a weakness in someone else's software does not become a weakness in the Bank's services.

## 2. Scope

This policy covers third-party software used in, or to build, any of the Bank's systems, whether bought, licensed or obtained free of charge. It also covers the third parties the Bank's systems call at run time to deliver a service, such as card schemes and payment gateways. Outsourcing arrangements are governed by the Bank's outsourcing policy and are outside the scope of this policy.

## 3. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Board Risk Committee | Approves this policy; receives the quarterly third-party software report |
| Chief Operating Officer | Owns this policy; accountable for the Bank's technology systems and their third-party dependencies |
| Chief Architect | Approves software components for engineering use, with the Principal Security Engineer; owns the approved lists |
| Principal Security Engineer | Assesses components for security; monitors the inventory for vulnerabilities |
| General Counsel | Approves any licence outside the permitted list |
| Director of Risk & Compliance | Independent oversight; reviews the register of exceptions each quarter |
| Internal Audit | Independent assurance |

## 4. Policy statements

**TPR-POL-002 clause 4.1: Assessing third-party software.** Before the Bank relies on third-party software, including open source software, the owning area assesses its materiality and risks: security, resilience, licence, maintenance and concentration. Software that supports an important business service, or is assessed as material or high risk, gets controls as robust as an outsourcing arrangement of the same materiality would.
Traces to: PRA SS2/21 paragraphs 2.3 to 2.6.

**TPR-POL-002 clause 4.2: Approved components only.** A third-party software component may be used in the Bank's systems only once it is approved for that use and recorded on the approved list for its language or platform. Approval follows the assessment in clause 4.1 and is reviewed when the component's version, licence or maintainers change. The approved lists are kept where the Bank's automated checks can read them.
Traces to: PRA SS2/21 paragraphs 2.5 and 2.6.

**TPR-POL-002 clause 4.3: Licences.** A component is approved only if its licence permits the Bank's use and the Bank can meet the licence's conditions. A licence outside the Bank's permitted list needs the approval of General Counsel. Software with no licence, or with a licence that cannot be identified, is not approved.
Traces to: FCA SYSC 4.1.1R (effective processes to identify, manage, monitor and report risks).

**TPR-POL-002 clause 4.4: Inventory of software components.** The Bank keeps an inventory of its bespoke software and of every third-party component incorporated in it, by system and version, and uses it to find and fix vulnerabilities. For each important business service, the inventory is part of the record of the technology the service depends on.
Traces to: PCI DSS v4.0.1 Requirement 6.3.2; FCA SYSC 15A.4.1R; PRA SS1/21 paragraph 5.5.

**TPR-POL-002 clause 4.5: Vulnerabilities in components.** Components in the inventory are monitored against recognised sources of vulnerability information, and each vulnerability found is ranked by risk. The fix for a critical vulnerability is installed within one month of its release, and other fixes within a time set by their ranking.
Traces to: PCI DSS v4.0.1 Requirements 6.3.1 and 6.3.3.

**TPR-POL-002 clause 4.6: Third parties that support important business services.** Where a third party such as a card scheme or a payment gateway supports an important business service, the Bank maps the dependency and designs its systems so that the service can stay within its impact tolerance when that third party is slow or unavailable. Its scenario testing includes that disruption.
Traces to: PRA SS1/21 paragraphs 4.5 and 5.5; FCA SYSC 15A.5.6G(3).

**TPR-POL-002 clause 4.7: AI models and libraries.** Pre-trained AI models, their weights and machine learning libraries are third-party software. They are assessed and approved under this policy before use, recorded in the inventory, and used for software development only as the AI-Assisted Development Policy allows.
Traces to: PRA SS2/21 paragraph 2.4; Bank of England AI letter (22 April 2024), annex paragraph 3.

## 5. Governance

**TPR-POL-002 clause 5.1: Exceptions and reporting.** Using a component before it is approved needs a time-limited exception from the Chief Architect and the Principal Security Engineer, for no more than 90 days, recorded in the change record. Each quarter the Chief Operating Officer reports material third-party software risks, open exceptions and overdue fixes to the Board Risk Committee.
Traces to: PRA SS2/21 paragraph 2.6; FCA SYSC 4.1.1R.

## 6. Definitions

- **Third-party software component:** any software the Bank did not write that is incorporated into, or used to build, its systems: a library, framework, package, container image, tool or AI model.
- **Open source software:** software whose source code is published under a licence that lets others use, change and share it, subject to the licence's conditions.
- **Approved list:** the record of components approved for use, by language or platform and version. For Payments & Settlements Technology it is kept as data in the code repository.
- **Inventory:** the Bank's record of its bespoke software and the third-party components in it. It is built from the software bill of materials each build produces.
- **Permitted licence:** a licence on the Bank's list of licences that need no further legal review.

## 7. Related documents

- STD-DEP Approved Dependencies and Licences Standard
- STD-INT Payments Integration Standard
- SEC-POL-001 Information Security and Data Handling Policy
- TEC-POL-005 AI-Assisted Development Policy

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2022-03-22 | First issue, alongside the Bank's outsourcing policy: third-party software treated as a third-party arrangement and assessed before use |
| 2.0 | 2023-06-20 | Licence review and the inventory of third-party components added |
| 3.0 | 2026-02-17 | Annual review. AI models and libraries brought into scope (clause 4.7); fix times for critical vulnerabilities set (clause 4.5); third parties that support important business services (clause 4.6) |
