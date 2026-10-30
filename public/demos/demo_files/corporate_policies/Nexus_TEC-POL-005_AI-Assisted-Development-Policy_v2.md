# AI-Assisted Development Policy

| Field | Value |
|---|---|
| Document ID | TEC-POL-005 |
| Title | AI-Assisted Development Policy |
| Owner | Chief Operating Officer |
| Approver | Board Risk Committee |
| Oversight | Director of Risk & Compliance; Chief Information Security Officer |
| Version | 2.0 |
| Approved | 2026-03-17 |
| Effective date | 2026-03-30 |
| Next review | 2027-03-17 |
| Classification | Internal |
| Status | Approved |
| Applies to | Nexus Bank plc staff and contractors who write, change, test, review or document software |

## 1. Purpose

This policy sets the conditions under which the Bank's staff may use AI assistants to write, change, test, review or document software. It applies the Bank's existing controls to that work rather than creating a separate regime. In April 2024 the FCA, in its AI Update, and the Bank of England, in a letter to the Department for Science, Innovation and Technology and HM Treasury, each described a technology-agnostic approach under which their existing rules and principles cover firms' use of AI. This policy follows that approach. Those publications state the regulators' approach and do not add rules: the obligations this policy implements come from the rules and standards named in each clause.

## 2. Scope

This policy covers all use of AI assistants in software development for the Bank: code generation and completion, changes made by an assistant in an editor, test generation, code review, documentation, and the migration of code from one language to another. It covers assistants built into development tools and assistants run as services. AI used in customer-facing services, or to inform business decisions, is outside its scope and is governed by the Bank's model risk framework.

## 3. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Board Risk Committee | Approves this policy; receives the quarterly report on AI use in software development |
| Chief Operating Officer | Owns this policy; the Senior Manager accountable for the use of AI in software development |
| Chief Information Security Officer | Approves assistants and models for security, with the Chief Architect; oversight |
| Chief Architect | Keeps the register of approved assistants and models, and sets how each may be used |
| Heads of engineering | Ensure their teams use only approved assistants, label AI-assisted work and keep the records |
| Engineers | Remain the authors of, and accountable for, every change they make with an assistant |
| Director of Risk & Compliance | Independent oversight; approves exceptions |
| Internal Audit | Independent assurance; tests the records |

## 4. Policy statements

**TEC-POL-005 clause 4.1: Existing controls apply.** AI-assisted development is software development. Every control on a change applies in the same way when an AI assistant helped make it: standards, review, testing, change management and information security. This is in line with the regulators' stated, technology-agnostic approach, and nothing in this policy relaxes another policy or standard.
Traces to: FCA SYSC 4.1.1R; FCA AI Update (April 2024), page 10; Bank of England AI letter (22 April 2024), annex paragraph 9(c)(ii).

**TEC-POL-005 clause 4.2: Approved assistants on the Bank's own platform.** Staff may use only AI assistants and models approved by the CISO and the Chief Architect and entered in the register. Approved assistants run on the Bank's own platform, so code, data and prompts stay inside the Bank. No other AI service may be given the Bank's code or data.
Traces to: FCA SYSC 4.1.1R (effective control and safeguard arrangements for information processing systems); PRA SS2/21 paragraphs 2.4 and 2.5.

**TEC-POL-005 clause 4.3: A human reviews and approves every AI-generated change.** The engineer who asks an assistant for a change is its author and is accountable for it as if they had written it. Every AI-generated or AI-assisted change is reviewed in full by another engineer and approved by a person, under TEC-POL-002. An AI assistant never approves, merges or deploys a change.
Traces to: PCI DSS v4.0.1 Requirement 6.2.3.1; FCA AI Update (April 2024), page 18.

**TEC-POL-005 clause 4.4: AI-assisted changes are labelled.** A change written wholly or partly by an AI assistant is labelled AI-assisted in the pull request and the change record, naming the assistant and the model. A review prepared with an assistant says so, and shows which findings the assistant proposed. This keeps AI use visible to reviewers and auditors, in line with the accountability and governance principle in the FCA's AI Update.
Traces to: FCA AI Update (April 2024), page 16.

**TEC-POL-005 clause 4.5: Records of AI use.** For each AI-assisted change the Bank keeps, with the change record: the assistant, the model and their versions, the task given, the documents given to the assistant as sources, the checks and tests run, and the engineers who reviewed and approved the change. The records are kept for at least six years.
Traces to: FCA SYSC 4.1.1R (sound administrative procedures); FCA AI Update (April 2024), page 16.

**TEC-POL-005 clause 4.6: No card data, secrets or personal data in prompts.** Card numbers, sensitive authentication data, secrets and customer personal data are never put into a prompt, a file or any other input to an AI assistant. Assistants work on code, documents and synthetic or masked test data. Prompts and answers are stored data under the Information Security and Data Handling Policy.
Traces to: PCI DSS v4.0.1 Requirements 3.2.1 and 3.5.1.

**TEC-POL-005 clause 4.7: Accountability.** The Chief Operating Officer (SMF24), as the Senior Manager responsible for the Bank's technology systems, is accountable for the use of AI in software development. Heads of engineering are responsible for its use in their teams, and each engineer for the changes they make with it.
Traces to: FCA AI Update (April 2024), page 17; Bank of England AI letter (22 April 2024), annex paragraph 6(a).

## 5. Governance

**TEC-POL-005 clause 5.1: Register, review and exceptions.** The Chief Architect keeps the register of approved assistants and models and reviews it with the CISO at least every six months. An exception to this policy needs the prior approval of the CISO and the Director of Risk & Compliance, and is time-limited. The use of AI in software development is reported to the Board Risk Committee each quarter.
Traces to: FCA SYSC 4.1.1R (internal control mechanisms).

## 6. Definitions

- **AI assistant:** a software tool that uses an AI model to generate, change, explain or review code or documents.
- **AI-generated change:** a change whose code an AI assistant wrote, whether or not an engineer then edited it.
- **AI-assisted change:** a change in which an AI assistant wrote or materially shaped any part, including its tests and documentation. Every AI-generated change is AI-assisted.
- **AI-assisted review:** a review whose findings were prepared, in whole or in part, with an AI assistant.
- **Register:** the Chief Architect's record of the approved assistants and models, their versions and their permitted uses.
- **The Bank's own platform:** computing infrastructure the Bank operates or controls inside its own security boundary, where prompts, code and answers are not shared with the assistant's supplier.

## 7. Related documents

- STD-REV Code Review Standard
- TEC-POL-002 Technology Change Management and Segregation of Duties Policy
- TPR-POL-002 Third-Party and Open Source Software Policy (clause 4.7, AI models and libraries)
- SEC-POL-001 Information Security and Data Handling Policy

## 8. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2025-06-24 | First issue: a pilot of AI coding assistants on the Bank's own platform, with human review of every AI-generated change |
| 2.0 | 2026-03-17 | Approved assistants for general use in software development; AI-assisted changes and reviews labelled (clause 4.4); records of AI use (clause 4.5); the Chief Operating Officer's accountability made explicit (clause 4.7) |
