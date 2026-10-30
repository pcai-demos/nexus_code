# Code Documentation Standard

| Field | Value |
|---|---|
| Document ID | STD-DOC |
| Title | Code Documentation Standard |
| Owner | Chief Architect |
| Approved by | Engineering Standards Board |
| Version | 1.0 |
| Effective date | 2026-06-01 |
| Next review | 2027-06-01 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the policy clauses it implements. Requirement IDs are stable; a retired ID is never reused. There is no waiver from DOC-004 or DOC-008; any other deviation follows PAY-001 in the Payments Engineering Standard.

## 2. Scope

STD-DOC applies to the comments in every program, script, module and test that Payments & Settlements Technology owns, in every language, legacy code included. A comment is the documentation the next engineer relies on when the people who wrote the code have gone (TEC-POL-004 clause 4.6), so it is held to the same care as the code. Comments written with an AI assistant are held to this standard too, and the change is labelled and reviewed under REV-005.

## 3. The header

**DOC-001 The mandatory header.** Every program, script and module MUST open with a header comment giving: its name; its purpose, in one or two sentences; the important business service it supports, if any; the owning squad; its classification under SEC-POL-001 clause 4.2; the Bank's copyright notice and trade mark line as LEG-POL-001 clause 4.2 sets them, naming the Bank's current legal entity; its change history, each entry with its date, the change and the ticket; and the requirements its money logic implements (DOC-006). Each team keeps on its wiki a header template for each language it writes.
Traces to: TEC-POL-004 clause 4.6; SEC-POL-001 clause 4.2; LEG-POL-001 clause 4.2.

## 4. Comments in the code

**DOC-002 A purpose comment for every unit.** Every division, section and paragraph of a COBOL program, and every class, function and method in other languages, MUST carry a comment that says what it does and why, directly above or directly below the line that opens it.
Traces to: TEC-POL-004 clause 4.6.

**DOC-003 Comments say why, and agree with the code.** A comment explains intent and reasons, not syntax. A comment that contradicts the code is a defect. It MUST be corrected to say what the code does; the code MUST NOT be changed to match the comment, which would be a change of behaviour (MIG-002).
Traces to: TEC-POL-004 clause 4.6.

**DOC-004 No card numbers, secrets or personal data.** A comment MUST NOT hold a card number, a secret or customer personal data, test data included. Where an example is needed, use the last four digits or an obviously synthetic value.
Traces to: SEC-POL-001 clauses 4.3 and 4.4.

**DOC-005 No commented-out code.** Code that no longer runs MUST be deleted, not commented out. Version control and the change record keep its history, and a commented-out line misleads a reader about what runs.
Traces to: TEC-POL-004 clause 4.6; TEC-POL-002 clause 4.8.

**DOC-006 Money logic carries its requirement.** Code that calculates, rounds or totals money MUST carry, in a comment beside it, the ID of the requirement it implements, such as PAY-012.
Traces to: FIN-POL-003 clause 4.3.

**DOC-007 AI assistance is disclosed.** Where an AI assistant wrote or materially shaped a file's comments, the header MUST say so, naming the assistant. The change is labelled AI-assisted and a person reviews it under REV-005.
Traces to: TEC-POL-005 clauses 4.4 and 4.5.

## 5. Documentation-only changes

**DOC-008 A documentation-only change leaves behaviour unchanged.** A change that touches only comments MUST be shown by a tool, not by eye, to change no line of code: with every comment and blank line set aside, the old and the new version are identical. The program MUST still build, and its own tests or check MUST still pass on the same inputs. The tool's result is kept with the change record. A documentation change that needs a line of code changed is not a documentation change: raise it as its own ticket.
Traces to: TEC-POL-002 clauses 4.5 and 4.8; TEC-POL-004 clause 4.3.

## 6. Related documents

- TEC-POL-004 Technology Lifecycle and Modernisation Policy (clause 4.6, knowledge held by few people)
- SEC-POL-001 Information Security and Data Handling Policy (clauses 4.2 to 4.4)
- LEG-POL-001 Intellectual Property and Notices Policy (clause 4.2, notices in the Bank's software)
- TEC-POL-005 AI-Assisted Development Policy
- TEC-POL-002 Technology Change Management and Segregation of Duties Policy
- STD-REV Code Review Standard (REV-005, AI-assisted changes)
- STD-MIG Legacy Modernisation Standard (MIG-002, behaviour first)
- STD-PAY Payments Engineering Standard (PAY-012)

## 7. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-01 | First issue, with TEC-POL-004 version 2.0, so that code whose behaviour few people know is documented in the code itself: the header (DOC-001), purpose comments (DOC-002), comments that agree with the code (DOC-003), no card numbers or secrets (DOC-004), no commented-out code (DOC-005), money logic tagged with its requirement (DOC-006), AI assistance disclosed (DOC-007) and documentation-only changes proved by a tool (DOC-008) |
