# Information Security and Data Handling Policy

| Field | Value |
|---|---|
| Document ID | SEC-POL-001 |
| Title | Information Security and Data Handling Policy |
| Owner | Chief Information Security Officer |
| Approver | Board Risk Committee |
| Oversight | Director of Risk & Compliance |
| Version | 5.0 |
| Approved | 2026-01-20 |
| Effective date | 2026-02-02 |
| Next review | 2027-01-20 |
| Classification | Internal |
| Status | Approved |
| Applies to | Nexus Bank plc, its staff, contractors and service providers |

## 1. Purpose

This policy sets out how Nexus Bank plc (the Bank) protects its information and its information processing systems: how information is classified and handled, how card data and secrets are protected, what may be written to logs, and how little data the Bank keeps. It forms part of the Bank's internal control mechanisms and of the effective control and safeguard arrangements for information processing systems that the Bank maintains in proportion to the nature, scale and complexity of its business.

## 2. Scope

This policy applies to all information the Bank holds or processes, in any form, and to every system, environment and service provider that holds or processes it. It covers source code and code repositories, configuration, logs, traces, test data, tickets, chat messages, and the prompts and other input given to AI assistants. It applies in particular to Payments & Settlements Technology, whose systems store, process and transmit card data.

## 3. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Board Risk Committee | Approves this policy; receives the quarterly information security report |
| Chief Information Security Officer | Owns this policy; issues the security standards under it; approves exceptions with the Director of Risk & Compliance |
| Director of Risk & Compliance | Independent oversight; approves exceptions |
| Principal Security Engineer | Owns the Secure Coding Standard and the security checks run before code is merged |
| System owners | Classify the information their systems hold; record every place card data is stored and for how long |
| Staff and contractors | Handle information as its classification requires; report a suspected exposure at once |
| Internal Audit | Independent assurance; tests the evidence this policy requires |

## 4. Policy statements

**SEC-POL-001 clause 4.1: Information security controls.** The Bank protects the confidentiality, integrity and availability of its information with documented controls proportionate to the risk: classification, access control, secrets management, secure development, logging limits and incident management. For systems supporting payment services, they form part of the Bank's framework for managing operational and security risks.
Traces to: FCA SYSC 4.1.1R; Payment Services Regulations 2017, regulation 98(1).

**SEC-POL-001 clause 4.2: Classification of information.** Every information asset is classified Public, Internal, Confidential or Restricted and handled as its class requires. Card data and secrets are Restricted, and customer personal data is at least Confidential. Each system owner records the classes of information the system holds and every place it stores card data, including logs, backups and temporary files.
Traces to: FCA SYSC 4.1.1R; PCI DSS v4.0.1 Requirement 3.2.1.

**SEC-POL-001 clause 4.3: Secrets and credentials.** Passwords, API keys, tokens, private keys and other secrets are Restricted. They are held only in the Bank's secrets vault, or injected from it at run time, and never written into source code, repository configuration, tickets, chat or logs. An exposed secret is revoked and replaced at once.
Traces to: FCA SYSC 4.1.1R (effective control and safeguard arrangements for information processing systems); Payment Services Regulations 2017, regulation 98(1).

**SEC-POL-001 clause 4.4: Card data.** The Bank stores, processes and transmits card data only where a documented business need requires it. A full card number (PAN) is never stored in readable form: it is tokenised, encrypted, hashed or truncated. Sensitive authentication data (full track data, card verification code, PIN and PIN block) is never kept after authorisation, even encrypted, except under the PCI DSS conditions for card issuing.
Traces to: PCI DSS v4.0.1 Requirements 3.3.1 and 3.5.1.

**SEC-POL-001 clause 4.5: Displaying card numbers.** Where a card number is shown on a screen, report, receipt or other output, it is masked: at most the BIN and the last four digits are shown, and only the digits the purpose needs. Only roles with a documented business need may see more, and the Bank keeps the list of those roles.
Traces to: PCI DSS v4.0.1 Requirement 3.4.1.

**SEC-POL-001 clause 4.6: Logs and diagnostic output.** Logs, traces, error reports and debugging output are stored data. They never hold a full card number, sensitive authentication data or a secret, at any log level, in any environment that handles real card data. A card number in a log is cut to at most the BIN and last four digits, and personal data is limited to what the log's purpose needs.
Traces to: PCI DSS v4.0.1 Requirements 3.3.1 and 3.5.1.

**SEC-POL-001 clause 4.7: Data minimisation and retention.** Systems collect, copy and keep only the data their purpose needs, for no longer than the Bank's retention schedule allows. Temporary copies such as files, caches, exports and debugging dumps hold the minimum, are protected as the original and are deleted when the task ends. Live card numbers are never used in development or test.
Traces to: PCI DSS v4.0.1 Requirements 3.2.1 and 6.5.5.

**SEC-POL-001 clause 4.8: Secure software development.** Software the Bank develops, or has developed for it, is written and reviewed against the Bank's secure coding standard, so that it resists common attacks such as injection and keeps sensitive data out of logs. Security checks run on every change before it is merged, and a finding that exposes card data or a secret is corrected before release.
Traces to: PCI DSS v4.0.1 Requirements 6.2.1, 6.2.3 and 6.2.4.

**SEC-POL-001 clause 4.9: Security incidents.** Anyone who suspects that card data, a secret or other Restricted information has been exposed reports it at once to the Security Operations Centre. The incident is classified, exposed secrets are revoked and logs holding card data are purged under the CISO's direction. A major operational or security incident is notified to the FCA without undue delay.
Traces to: Payment Services Regulations 2017, regulations 98(1) and 99(1).

## 5. Governance

**SEC-POL-001 clause 5.1: Standards, exceptions and review.** The CISO issues standards under this policy, including the Secure Coding Standard. An exception needs the prior written approval of the CISO and the Director of Risk & Compliance, lasts at most 90 days and is reported to the Board Risk Committee each quarter. This policy is reviewed at least once a year and after any significant incident.
Traces to: FCA SYSC 4.1.1R (effective processes to identify, manage, monitor and report risks).

## 6. Definitions

- **Card data:** the full card number (PAN), the cardholder name, the expiry date and the service code, and any sensitive authentication data.
- **Sensitive authentication data:** full track data from the magnetic stripe or its equivalent on a chip, the card verification code, the PIN and the PIN block.
- **BIN:** the bank identification number, the leading digits of a card number that identify the card's issuer.
- **Masking:** hiding some digits of a card number when it is displayed. The full number may still be stored elsewhere.
- **Truncation:** removing digits from a stored card number so that they cannot be recovered from that copy. A log line that keeps only the last four digits holds a truncated number.
- **Secret:** any value that grants access to a system or to data: a password, API key, token, private key or connection string with credentials.
- **Restricted:** the Bank's highest classification, covering card data and secrets. Restricted information is shared only with those whose role needs it, and never appears in a log in readable form.

## 7. Related documents

- STD-SCS Secure Coding Standard
- TEC-POL-002 Technology Change Management and Segregation of Duties Policy
- TPR-POL-002 Third-Party and Open Source Software Policy
- TEC-POL-005 AI-Assisted Development Policy
- FIN-POL-003 Financial Controls and Reconciliation Policy

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2018-05-22 | First issue, as the Information Security Policy |
| 2.0 | 2020-06-16 | Secrets clause added: secrets held in the Bank's vault, never in source code |
| 3.0 | 2022-04-26 | Aligned with the Bank's operational resilience framework; incident classification added |
| 4.0 | 2024-04-16 | The Data Classification and Handling Policy merged into this policy, which was renamed. Logging clause widened to every log level after a 2024 security incident in which debug logging wrote card numbers to the log platform |
| 5.0 | 2026-01-20 | Annual review. An exposed secret is revoked and replaced at once; prompts given to AI assistants brought into scope; definitions of masking and truncation added |
