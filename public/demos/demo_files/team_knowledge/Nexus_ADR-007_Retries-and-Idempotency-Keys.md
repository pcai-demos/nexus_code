# ADR-007: Retries and idempotency keys for outbound payment calls

| Field | Value |
|---|---|
| Document ID | ADR-007 |
| Title | Retries and idempotency keys for outbound payment calls |
| Type | Architecture decision record, Payments & Settlements Technology |
| Owner | Chief Architect |
| Deciders | Marcus Thorne (Chief Architect), David Vance (Head of Payments Engineering), Priya Nair (Senior Engineer, Clearing Engineering) |
| Version | 2 |
| Effective date | 2026-04-27 (version 2; version 1 accepted 2025-03-10) |
| Next review | 2027-04-26 |
| Classification | Internal |
| Status | Accepted |
| Applies to | Services that send refunds, captures, reversals or payouts to the card scheme gateway or another payment gateway |

## Context

On Friday 7 February 2025 the card scheme gateway slowed down for about 40 minutes (INC-2025-0207). Our refund service gave up on each call after five seconds, and its HTTP client retried each refund as a brand-new request. The gateway had already accepted many of the first requests, so 23 refunds went to cardholders twice: £1,906.40 in all. The merchants were debited twice as well. We put the merchants right the next business day, and the Bank absorbed the loss rather than chase cardholders for it.

The nightly reconciliation couldn't catch it. The scheme processed every duplicate, so our figures and the scheme's agreed to the penny. The only thing that stops a duplicate is not sending one. The gateway has supported an `Idempotency-Key` header since 2023: a request that repeats a key the gateway has seen in the last 72 hours gets the first request's result back instead of being processed again. We weren't sending it.

## Decision

**ADR-007 D1: Every money-moving call carries an idempotency key.** Refunds, captures, reversals and payouts sent to a gateway carry an `Idempotency-Key` header. The key is a random UUID, created when the operation is created and before anything is sent, and stored on the operation's record (for a refund, the refund row) in the same database transaction.
Traces to: INT-001 (Payments Integration Standard).

**ADR-007 D2: A retry reuses the key.** A retry sends exactly the same request with exactly the same key. Never create a new key for a retry, and never build a "new" request for the same refund: that is how INC-2025-0207 happened.
Traces to: INT-001 (Payments Integration Standard).

**ADR-007 D3: Short timeouts, few retries, backing off.** For the scheme gateway: a 2-second connection timeout and a 10-second response timeout. At most three retries, after 1, 2 and 4 seconds, each with up to 20% random jitter, and honour a `Retry-After` header. Retry only timeouts, dropped connections and 429, 502, 503 or 504. Never retry any other 4xx: the request is wrong and will stay wrong.
Traces to: INT-002 (Payments Integration Standard).

**ADR-007 D4: Unknown is not failed.** If the last retry fails, the refund is marked `OUTCOME_UNKNOWN`, not `FAILED`. A status enquiry with the same key settles it, and anything still unknown at the end of the day goes to Settlement Operations' exceptions queue. It is never resent with a new key, and a merchant is never told a refund failed when we don't know that it did.
Traces to: INT-003 (Payments Integration Standard).

What the gateway sees on the first attempt and on every retry of the same refund (illustrative):

```
POST /v2/refunds HTTP/1.1
Idempotency-Key: 6f1c2b9e-8d4a-4f3e-9b71-2c5d0e8a7f14
Content-Type: application/json
```

## Consequences

- No refund is paid twice because of a retry, however slow the gateway is.
- Each operation table gets a key column with a unique index. The key is written before the first attempt, so a crash between creating the refund and sending it leaves a refund we can safely send later.
- The gateway only remembers keys for 72 hours. After that, an unknown outcome is settled by an enquiry, never by sending the refund again (D4).
- Each attempt is an audit event under PAY-030, with the key and the attempt number, so a refund's history can be rebuilt from the audit store.

## Alternatives considered

1. **No automatic retries.** Rejected: brief gateway timeouts happen most weeks, and refunds would be left unsent until someone noticed.
2. **Let the gateway spot duplicates by amount, card and merchant within a few minutes.** Rejected: two identical refunds can both be genuine, such as two £10.00 items returned on separate days that land in the same batch.
3. **Ask the gateway for the status first, then resend with a new key if it has no record.** Rejected: the first request may still be in flight, so the check races it.
4. **A new key for each attempt.** Rejected: that is the bug, with extra steps.

## Links

- INC-2025-0207 Refunds paid twice after gateway timeouts (2025)
- Payments Integration Standard: INT-001, INT-002, INT-003
- Payments Engineering Standard: PAY-030

## History

- Version 1, 2025-03-10: accepted (D1 to D4).
- Version 2, 2026-04-27: trace lines updated to the Payments Integration Standard v2.0, which took D4 in as INT-003; timeouts in D3 confirmed with the gateway team.
