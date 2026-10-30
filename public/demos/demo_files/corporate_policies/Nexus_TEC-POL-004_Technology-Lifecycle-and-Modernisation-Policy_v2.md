# Technology Lifecycle and Modernisation Policy

| Field | Value |
|---|---|
| Document ID | TEC-POL-004 |
| Title | Technology Lifecycle and Modernisation Policy |
| Owner | Chief Operating Officer |
| Approver | Board Risk Committee |
| Oversight | Director of Risk & Compliance |
| Version | 2.0 |
| Approved | 2026-05-19 |
| Effective date | 2026-06-01 |
| Next review | 2027-05-19 |
| Classification | Internal |
| Status | Approved |
| Applies to | Nexus Bank plc, its staff, contractors and service providers |

## 1. Purpose

This policy sets out how the Bank keeps the technology behind its services supported, and how it replaces technology that is reaching the end of its life without disturbing the services that depend on it. Unsupported technology and knowledge held by too few people are weaknesses in an important business service; so is a replacement that does not give the same results as the system it replaces. This policy forms part of the Bank's arrangements for operational resilience and of its internal control mechanisms.

## 2. Scope

This policy applies to all technology that supports an important business service, or that calculates, records or settles money: hardware, operating systems, language runtimes, databases, applications and batch programs. It covers their lifecycle and every modernisation of them, whoever does the work and whether or not an AI assistant helps. A modernisation is also a change under TEC-POL-002, and FIN-POL-003 clauses 4.8 and 4.9 apply where it touches a system that calculates charges.

## 3. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Board Risk Committee | Approves this policy; receives the quarterly technology lifecycle report |
| Chief Operating Officer | Owns this policy; accountable for the Bank's technology systems and their operational resilience |
| Chief Architect | Keeps the technology lifecycle register; approves lifecycle plans and target technologies; owns the Legacy Modernisation Standard |
| Heads of engineering | Keep their systems supported; own the lifecycle plans and modernisations of their systems; approve cut-over with the business owner |
| Business owners of important business services | Approve cut-over for their service; confirm the service's mapping after a replacement |
| Director of Risk & Compliance | Independent oversight; approves exceptions |
| Internal Audit | Independent assurance; tests the equivalence evidence and the cut-over approvals |

## 4. Policy statements

**TEC-POL-004 clause 4.1: Technology lifecycle register.** The Bank records, for each technology that supports an important business service, its owner, the services that depend on it and its lifecycle status: supported, approaching end of life (support ends within 24 months) or end of life, with the date support ends. The register is part of each service's mapping, builds on the inventory kept under TPR-POL-002 clause 4.4, and is reviewed at least once a year.
Traces to: FCA SYSC 15A.4.1R; PRA SS1/21 paragraphs 5.1 and 5.2.

**TEC-POL-004 clause 4.2: End-of-life technology replaced under a plan.** When technology that supports an important business service is approaching end of life, its head of engineering agrees a plan with the Chief Architect to replace, upgrade or retire it before support ends. After that it receives no security fixes, so running it any longer needs an exception under clause 5.1.
Traces to: FCA SYSC 15A.4.1R; PRA SS1/21 paragraph 5.3; PCI DSS v4.0.1 Requirement 6.3.3 (systems in PCI DSS scope).

**TEC-POL-004 clause 4.3: Equivalence proved before go-live.** A system that replaces one which calculates, records or settles money goes live only once it is proved to give the same results as the old system from the same inputs. The proof is an automated comparison of their outputs, kept with the change record. Any difference is resolved first; a wanted change of behaviour is a separate change.
Traces to: PRA SS1/21 paragraph 6.6; FCA SYSC 4.1.1R (sound administrative and accounting procedures); FCA PS21/3 paragraph 1.7.

**TEC-POL-004 clause 4.4: Parallel run and approved cut-over.** Before it takes over, a replacement for a system supporting an important business service runs beside the old one on live business days, with their outputs compared. Cut-over is approved in writing by the system's head of engineering and the service's business owner, and the old system stays ready to take the work back for the period the Legacy Modernisation Standard sets.
Traces to: PCI DSS v4.0.1 Requirement 6.5.1 (systems in PCI DSS scope); FCA SYSC 15A.2.9R.

**TEC-POL-004 clause 4.5: Mapping and testing after a replacement.** The Bank treats the replacement of a system that supports an important business service as a material change to the resources that deliver it. At cut-over the service's mapping is updated, without waiting for the annual review, and the Bank decides, in proportion to the change, whether the service's scenario testing must be repeated.
Traces to: PRA SS1/21 paragraphs 5.9 and 6.6; FCA SYSC 15A.4.3R and 15A.5.7R.

**TEC-POL-004 clause 4.6: Knowledge held by few people.** Where a system that supports an important business service depends on knowledge or skills that only one or two people hold, such as a legacy programming language, its head of engineering records the dependency in the service's mapping and keeps a plan for those people being unavailable: the system's behaviour documented, others trained, or the system replaced under clause 4.2.
Traces to: FCA SYSC 15A.4.1R and 15A.5.6G(2); FCA PS21/3, chapter 5 (pages 30 and 31).

## 5. Governance

**TEC-POL-004 clause 5.1: Reporting and exceptions.** Each quarter the Chief Operating Officer reports to the Board Risk Committee the technology that is approaching or past end of life, with its plans, and the replacements that went live. Running technology past the end of its support needs the prior approval of the Director of Risk & Compliance, is time-limited and is reported to the Board Risk Committee. No exception is available from clause 4.3.
Traces to: FCA SYSC 4.1.1R (internal control mechanisms).

## 6. Definitions

- **End of life:** the date after which a technology's supplier, or the team that maintains it, no longer provides fixes for it, security fixes included.
- **Lifecycle status:** supported; approaching end of life, when support ends within 24 months; or end of life.
- **Modernisation:** the replacement, rewrite or re-platforming of a system or program, including its migration to another programming language.
- **Equivalence:** a replacement gives the same outputs as the system it replaces from the same inputs: the same records, figures and reports, to the penny.
- **Parallel run:** running a replacement alongside the old system on the same live inputs, and comparing their outputs, before the replacement takes over.
- **Cut-over:** the point at which the replacement takes over the work and the old system stops doing it.
- **Mapping:** the Bank's record of the people, processes, technology, facilities and information necessary to deliver an important business service.
- **Important business service:** as defined in FIN-POL-003.

## 7. Related documents

- STD-MIG Legacy Modernisation Standard
- STD-TST Testing and Definition of Done Standard (TST-010, characterisation tests for migrations)
- TEC-POL-002 Technology Change Management and Segregation of Duties Policy
- FIN-POL-003 Financial Controls and Reconciliation Policy
- TPR-POL-002 Third-Party and Open Source Software Policy (clause 4.4, the inventory of software components)
- TEC-POL-005 AI-Assisted Development Policy

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2022-05-24 | First issue, as the Technology Lifecycle Policy, after the Bank first mapped its important business services: a lifecycle status for each technology that supports one, and end-of-life technology replaced under a plan |
| 2.0 | 2026-05-19 | Renamed the Technology Lifecycle and Modernisation Policy. Equivalence proved before go-live (clause 4.3), parallel run and approved cut-over (4.4), mapping and testing after a replacement (4.5) and knowledge held by few people (4.6) added, after a review of the end-of-life technology on the batch host and the 2024 rewrite of a fee batch that went live without proof that it gave the same results |
