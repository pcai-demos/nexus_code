# Financial Controls and Reconciliation Policy

| Field | Value |
|---|---|
| Document ID | FIN-POL-003 |
| Title | Financial Controls and Reconciliation Policy |
| Owner | Chief Financial Officer |
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

This policy sets out how Nexus Bank plc (the Bank) controls the execution of payment transactions and charges: how they are calculated, recorded, settled and reconciled. Its aims are that the Bank's records are accurate, that customers pay exactly the charges they agreed to, and that an error in a system is found and corrected before money moves. It forms part of the Bank's governance arrangements: the internal control mechanisms and the sound administrative and accounting procedures the Bank maintains in proportion to the nature, scale and complexity of its business.

## 2. Scope

This policy applies to every business area, system and service provider that calculates, records, settles or reconciles payment transactions, customer charges or card scheme fees on the Bank's behalf. It covers the daily operation of those systems and every change made to them. It applies in particular to Finance Operations and to Payments & Settlements Technology.

## 3. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Board Risk Committee | Approves this policy; receives the quarterly controls report |
| Chief Financial Officer | Owns this policy; accountable for the Bank's financial controls |
| Director of Risk & Compliance | Independent oversight; approves exceptions; agrees the classification of incidents |
| Head of Settlement Operations | Runs the daily reconciliation; owns breaks; releases held settlement files |
| Head of Payments Engineering | Ensures that systems which calculate charges meet this policy, through the Payments Engineering Standard and the Testing and Definition of Done Standard; approves changes to them |
| Internal Audit | Independent assurance; tests the evidence this policy requires |

## 4. Policy statements

**FIN-POL-003 clause 4.1: Governance arrangements and internal control.** The Bank maintains robust governance arrangements over payment transactions, charges, settlement and reconciliation: clear lines of responsibility, internal control mechanisms and sound administrative and accounting procedures, proportionate to the nature, scale and complexity of its business. They are reviewed at least once a year, and after any material change or significant incident.
Traces to: FCA SYSC 4.1.1R and 4.1.2R; FCA SYSC 15A.3.1R and 15A.3.2R.

**FIN-POL-003 clause 4.2: Operational resilience of important business services.** Card payment acceptance and settlement for merchant customers is one of the Bank's important business services, and the Board approves its impact tolerance. That tolerance covers integrity as well as availability: settlement that runs on time with unreliable figures is outside tolerance and is handled as an operational incident.
Traces to: FCA SYSC 15A.2.1R, 15A.2.5R and 15A.2.9R; PRA SS1/21 paragraphs 6.6 and 7.1.

**FIN-POL-003 clause 4.3: Accurate records of payment transactions and charges.** Every payment transaction, customer charge and card scheme fee is calculated exactly, to the penny, under a documented rule, and recorded at that amount. Where the Bank deducts its charges from an amount it credits to a customer, the customer is told the full amount of the transaction and the charges separately.
Traces to: Payment Services Regulations 2017, regulation 84(1) and (2); FCA SYSC 4.1.1R (sound administrative and accounting procedures).

**FIN-POL-003 clause 4.4: Daily reconciliation against scheme settlement totals.** Each business day, before that day's settlement is posted, the Bank reconciles its own totals of card transactions, scheme fees and net settlement for each card scheme with the scheme settlement report, to the penny. The reconciliation is automated and its result is recorded.
Traces to: Payment Services Regulations 2017, regulation 98(1); PRA SS1/21 paragraph 6.6.

**FIN-POL-003 clause 4.5: Breaks are resolved before release.** A difference of any amount, including a single penny, is a break. The day's settlement file is held while the break is investigated and its cause corrected. The file is released only when the reconciliation passes, or when the Head of Settlement Operations signs off a documented manual reconciliation. Every break is logged as an incident and classified.
Traces to: Payment Services Regulations 2017, regulation 98(1).

**FIN-POL-003 clause 4.6: Customers are protected while a file is held.** Holding a settlement file must not delay funds the Bank must make available to its customers. Where it could, the Head of Settlement Operations and the Director of Risk & Compliance agree how undisputed amounts are released on time. If a break is classified as a major operational incident, the Bank notifies the FCA without undue delay.
Traces to: Payment Services Regulations 2017, regulations 89(1), 89(3) and 99(1).

**FIN-POL-003 clause 4.7: Lessons learned.** After any break or incident caused by a fault in a system or process, the owning team completes a lessons-learned review within ten business days. The review records the cause, the customers and amounts affected, the corrections made and the actions that will stop it recurring. Actions are tracked to completion, and each fix is proven by a test.
Traces to: FCA SYSC 15A.5.8R and 15A.5.9R; PRA SS1/21 paragraph 8.3.

**FIN-POL-003 clause 4.8: Testing of changes to systems that calculate charges.** A change to a system that calculates, records or settles customer charges or scheme fees is tested before deployment, including a test that reconciles its results with independently sourced figures. It is approved by an authorised person other than its author, and the evidence is kept with the change record.
Traces to: PCI DSS v4.0.1 Requirement 6.5.1 (systems in PCI DSS scope); FCA PS21/3 paragraph 1.7.

**FIN-POL-003 clause 4.9: Segregation of duties.** No one person may both make and approve a change to a system that calculates charges, both prepare and sign off a reconciliation, or both resolve a break and release the settlement file it held. Production is separated from development and testing, so that only reviewed and approved changes are deployed.
Traces to: PCI DSS v4.0.1 Requirement 6.5.4; FCA SYSC 4.1.1R (clear lines of responsibility and internal control mechanisms).

**FIN-POL-003 clause 4.10: Evidence and retention.** The Bank keeps evidence of each daily reconciliation, each break and its resolution, each lessons-learned review and each change to a system that calculates charges, including the tests run and their results, the review and the approval. Evidence is kept for at least six years and can be produced to Internal Audit and the regulators on request.
Traces to: FCA SYSC 15A.6.1R(6) and 15A.6.2R.

## 5. Governance

**FIN-POL-003 clause 5.1: Reporting, review and exceptions.** Each quarter the Chief Financial Officer reports breaks, held files, lessons-learned reviews and exceptions to the Board Risk Committee. Reviews that concern an important business service feed the operational resilience self-assessment that the Board approves. Exceptions need the prior written approval of the Director of Risk & Compliance and are time-limited.
Traces to: FCA SYSC 15A.6.1R(6) and 15A.7.1R; PRA SS1/21 paragraph 8.1.

## 6. Definitions

- **Break:** any difference, of any amount, between the Bank's figures and the figures it reconciles them against.
- **Scheme settlement report:** the totals a card scheme reports for a business date: the gross value of transactions, the scheme fees and the net amount settled.
- **Settlement file:** the file of a business date's settlement entries that the Bank posts to its ledgers.
- **Important business service:** for the FCA, a service the Bank provides to its clients which, if disrupted, could cause intolerable levels of harm to them or pose a risk to the soundness, stability or resilience of the UK financial system or the orderly operation of financial markets (PS21/3); for the PRA, a service whose disruption could pose a risk to the Bank's safety and soundness or, where the PRA's criteria are met, to UK financial stability (SS1/21 paragraph 2.2).

## 7. Related documents

- STD-PAY Payments Engineering Standard
- STD-TST Testing and Definition of Done Standard

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2019-06-27 | First issue |
| 2.0 | 2022-03-24 | Aligned with the Bank's operational resilience framework: card payment settlement named as an important business service |
| 3.0 | 2024-11-26 | Daily reconciliation extended to every fee and charge calculation; lessons-learned reviews and testing of changes to charging systems added, after a 2024 rounding error in refund fees |
| 4.0 | 2026-01-20 | Annual review; segregation of duties extended to held settlement files; evidence retention set at six years |
