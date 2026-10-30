# Payments Integration Standard

| Field | Value |
|---|---|
| Document ID | STD-INT |
| Title | Payments Integration Standard |
| Owner | Head of Payments Engineering |
| Approved by | Engineering Standards Board (chair: Chief Architect) |
| Version | 2.0 |
| Effective date | 2026-03-23 |
| Next review | 2027-03-22 |
| Classification | Internal |
| Status | In force |
| Applies to | Payments & Settlements Technology |

## 1. Using this standard

MUST and MUST NOT are mandatory. SHOULD is expected unless the change record says why not. The "Traces to" line of each requirement names the corporate policy clauses it implements. Requirement IDs are stable; a retired ID is never reused. Waivers follow PAY-001 in the Payments Engineering Standard.

## 2. Scope

STD-INT applies to code that asks another system to move money or to change a payment's state: refunds, captures, reversals and payouts sent to the card scheme gateway, the Faster Payments gateway or any other party. These calls are part of an important business service, card payment acceptance and settlement for merchant customers (FIN-POL-003 clause 4.2). A network call can time out after the receiver has acted, so the sender cannot tell a lost request from a lost response. The requirements below make it safe to try again.

## 3. Idempotency

**INT-001 Idempotency keys on money-moving calls.** Every outbound call that moves money or changes a payment's state MUST carry an idempotency key that identifies the business operation, not the attempt. The key MUST be created once, with the operation, and stored with it before the first attempt. Every retry MUST send the same key; a new key MUST NOT be created for a retry.
Traces to: FIN-POL-003 clause 4.2 (Operational resilience of important business services).

## 4. Timeouts, retries and unknown outcomes

**INT-002 Timeouts and bounded retries.** Every outbound call MUST set a connection timeout and a response timeout. A money-moving call MAY be retried at most three times, with exponential backoff and jitter, and only after a timeout, a lost connection or a response the receiver documents as safe to retry, such as 429 or 503. A request the receiver rejected as invalid MUST NOT be retried.
Traces to: FIN-POL-003 clause 4.2; TPR-POL-002 clause 4.6.

**INT-003 Unknown outcomes.** When the last retry fails, the operation MUST be recorded as outcome unknown, not as failed, and resolved by asking the receiver for the status of its idempotency key. It MUST NOT be sent again as a new operation. Operations still unknown at the end of the business day go to Settlement Operations' exceptions queue.
Traces to: FIN-POL-003 clauses 4.2 and 4.3.

## 5. Related documents

- FIN-POL-003 Financial Controls and Reconciliation Policy
- TPR-POL-002 Third-Party and Open Source Software Policy
- STD-PAY Payments Engineering Standard (PAY-030 audit events)
- ADR-007 Retries and idempotency keys for outbound payment calls

## 6. Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2025-06-02 | First issue: INT-001 and INT-002, taken from ADR-007 after INC-2025-0207 (refunds paid twice after gateway timeouts) |
| 2.0 | 2026-03-23 | INT-003 (unknown outcomes) added from ADR-007 D4; traces updated to FIN-POL-003 version 4.0 and TPR-POL-002 version 3.0 |
