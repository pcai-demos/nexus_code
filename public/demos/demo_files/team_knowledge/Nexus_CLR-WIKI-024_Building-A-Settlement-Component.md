# Building a component in the settlement service

| Field | Value |
|---|---|
| Document ID | CLR-WIKI-024 |
| Title | Building a component in the settlement service |
| Type | Wiki page, Clearing Engineering |
| Owner | Senior Engineer, Clearing Engineering (page owner: Priya Nair) |
| Approved by | David Vance (Head of Payments Engineering) |
| Version | 1 |
| Effective date | 2026-07-28 |
| Next review | 2027-07-27 |
| Classification | Internal |
| Status | Current |
| Applies to | Clearing Engineering: new components in `services/settlement/` |

## TL;DR

A new component in the settlement service follows the reconciler's pattern: Python 3.13 and its standard library only, `sqlite3` with bound parameters, money in `Decimal`, an audit event for every action on settlement data, and unit tests on an in-memory database built from the service's fixture. It opens with the header below, and a card number never leaves the function whole.

## The header

Every module opens with this docstring; fill in the purpose and the history.

```
"""<One line saying what the module does.>

MODULE:          <module name>
PURPOSE:         <one or two lines: what it does and why>
SERVICE:         Card settlement
OWNER:           Clearing Engineering, Payments & Settlements Technology
CLASSIFICATION:  Internal
Copyright (c) Nexus Bank plc <year first written>-<year of the latest change>. All rights reserved.
Nexus and the Nexus logo are trade marks of Nexus Bank plc.
HISTORY:         <YYYY-MM-DD> <change> <ticket>, oldest first
REQUIREMENTS:    <the requirements its money logic implements>
AI-ASSISTED:     <what an assistant wrote, and which one>
"""
```

## Notes

**CLR-WIKI-024 C1: The module header.** The header is the module's docstring, with these labels in capitals, one to a line, in this order: MODULE, PURPOSE, SERVICE, OWNER, CLASSIFICATION, then the copyright line and the trade mark line, then HISTORY, REQUIREMENTS and AI-ASSISTED. The notice names Nexus Bank plc.
Traces to: DOC-001 and DOC-007 (Code Documentation Standard); LEG-POL-001 clause 4.2.

**CLR-WIKI-024 C2: Docstrings.** Every function and class has a docstring saying what it does and why: its arguments, what it returns and each refusal it raises. Money logic names the requirement it implements, such as PAY-012, in its docstring or a comment beside it.
Traces to: DOC-002 and DOC-006 (Code Documentation Standard).

**CLR-WIKI-024 C3: Tests.** Tests use `unittest`. A test file puts its own folder on `sys.path` and imports the module by name, as `test_settlement_reconciler.py` does (`HERE = Path(__file__).resolve().parent`), and loads `HERE / "fixtures" / "settlement_fixture.sql"` into an in-memory SQLite database. One rule per test; no clock, no network.
Traces to: TST-001 and TST-002 (Testing and Definition of Done Standard).

**CLR-WIKI-024 C4: Money.** The fixture keeps amounts as text. Read them into `Decimal`, compare them as `Decimal` and store them as a decimal string. Never `float`: the penny drift of PM-2024-011 came from a float.
Traces to: PAY-012 (Payments Engineering Standard); ADR-004.

**CLR-WIKI-024 C5: Card numbers.** Mask a card number to its last four digits in code, before it reaches a log line, a table, an audit event, an exception's message or a return value (CLR-WIKI-014). Hold the full number only as long as the function needs it.
Traces to: SCS-021, SCS-022 and SCS-030 (Secure Coding Standard).

**CLR-WIKI-024 C6: The disputes table.** `disputes(dispute_id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, card_last4 TEXT NOT NULL, amount TEXT NOT NULL, reason_code TEXT NOT NULL, received_on TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`, made with `CREATE TABLE IF NOT EXISTS`. A dispute starts as OPEN.
Traces to: SCS-030 (Secure Coding Standard); PAY-030 (Payments Engineering Standard).

**CLR-WIKI-024 C7: Audit events.** Each action on settlement data writes one row to `audit_events(event_id, action, entity_id, actor, at_utc, before_value, after_value, ticket)`: for a dispute, the action DISPUTE_RECORDED, the dispute's id, who acted, when (UTC), the values and the ticket. No card number goes in an event.
Traces to: PAY-030 (Payments Engineering Standard); SCS-021 (Secure Coding Standard).

**CLR-WIKI-024 C8: Before you merge.** Run the module's tests and the documentation check. The pre-merge checks run on the change, and it is verified against STD-SVS (OWASP ASVS 5.0.0 Level 2). Record the change, then commit it to the Bank's repository on `feature/<ticket>`, labelled AI-assisted where NexCODE helped, for review.
Traces to: SVS-001 and SVS-020 (Security Verification Standard); REV-002 and REV-005 (Code Review Standard); TEC-POL-005 clause 4.4.

## Page history

- **2026-07-28** First published, for the disputes work (DSP-2026-03): the header for Python, tests on the fixture, money, card numbers, the disputes and audit tables, and the steps before merge. Reviewed by David Vance. (PN)
