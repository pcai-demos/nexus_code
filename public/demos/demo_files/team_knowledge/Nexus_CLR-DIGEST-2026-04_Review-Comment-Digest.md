# Review-comment digest: April 2026

| Field | Value |
|---|---|
| Document ID | CLR-DIGEST-2026-04 |
| Title | Review-comment digest: April 2026 |
| Type | Monthly review digest, Clearing Engineering wiki |
| Owner | Senior Engineer, Clearing Engineering (compiled by Priya Nair) |
| Approved by | David Vance (Head of Payments Engineering), for circulation |
| Version | 1 |
| Effective date | 2026-05-05 |
| Next review | None: replaced by the May 2026 digest |
| Classification | Internal |
| Status | Published |
| Applies to | Clearing Engineering |

## The month in numbers

In April we reviewed 71 pull requests and merged 58. 24 of them got "Changes requested" at least once. The findings below cover 38 review comments, grouped by the rule they cite. Anything that came up only once isn't listed.

## Lesson of the month: INC-2026-0419

On Saturday 18 April a refactor of the settlement reconciliation moved the scheme fee calculation into a new helper. The helper worked in floats and cut each fee to the penny instead of rounding it, the same bug PM-2024-011 describes from 2024, and the refactor shipped without a reconciliation test. The next morning's run caught a 4p difference against the schemes' totals and held the settlement file. The fix went in on Sunday 19 April with reconciliation tests, and Finance Operations released the file once the re-run passed.

Thanks to Tom Okafor, whose reconciliation test reproduced the failure by 07:50 that morning. If you write code that touches money, read PM-2024-011 and ADR-004 before you start.

## What we kept finding

**CLR-DIGEST-2026-04 F1: Money in floats (9 comments, 5 pull requests).** In TypeScript a `number` is binary floating point, just like a Python `float`, and pennies go missing. Amounts and fees are decimals built from text and rounded half up, once per transaction. INC-2026-0419 is what happens when this gets through.
Traces to: PAY-012 and PAY-013 (Payments Engineering Standard).

**CLR-DIGEST-2026-04 F2: New code with no tests (7 comments).** A new module, or a change in behaviour, needs its own unit tests in the same pull request, and the whole suite has to pass in the pipeline. "Tests to follow" is a finding, not a plan.
Traces to: TST-001 (Testing and Definition of Done Standard).

**CLR-DIGEST-2026-04 F3: Whole request bodies in logs (6 comments, 3 pull requests).** Debug lines that dump the whole request "to help with debugging". In the card services that body has a card number in it, and debug logging gets switched on in production when things go wrong. Log the IDs and the outcome instead; CLR-WIKI-014 explains why.
Traces to: SCS-021 and SCS-022 (Secure Coding Standard).

**CLR-DIGEST-2026-04 F4: SQL built from strings (5 comments).** Concatenation and template literals in queries, usually with "it's only an internal ID". Every value is a bound parameter, every time, internal or not.
Traces to: SCS-031 (Secure Coding Standard).

**CLR-DIGEST-2026-04 F5: Packages that aren't on the approved list (4 comments).** Check `approved-dependencies.json` before you install anything: the pre-merge check fails the build if you don't. If you need a new package, raise a DEPREQ and allow five business days for the decision.
Traces to: DEP-001 and DEP-003 (Approved Dependencies and Licences Standard).

**CLR-DIGEST-2026-04 F6: Money moved with no audit event (3 comments).** A refund, hold or release has to emit an audit event saying who acted, on what, when, the values before and after, and the ticket reference. An application log line is not an audit event.
Traces to: PAY-030 (Payments Engineering Standard).

**CLR-DIGEST-2026-04 F7: Retries without an idempotency key (2 comments).** One gateway client built a fresh request on each retry, which is how INC-2025-0207 paid 23 refunds twice. Create the key with the operation, store it, and send the same key on every retry.
Traces to: INT-001 and INT-002 (Payments Integration Standard). See also ADR-007.

**CLR-DIGEST-2026-04 F8: Secrets in test configuration (2 comments).** A real-looking API key in a test config file. Use obviously fake values in tests and read real ones from the vault at run time. If a real key was ever committed, it has to be rotated, not just deleted.
Traces to: SCS-010 and SCS-011 (Secure Coding Standard).

## Housekeeping

- NexCODE, the squad's AI assistant, has been approved for general use since 30 March under the AI-Assisted Development Policy v2.0. Label AI-assisted changes in the pull request (REV-005). If you prepare a review with it, say so and mark which findings it proposed (REV-006).
- The Code Review Standard v2.0 has applied since 13 April: every finding is marked verified by tool or assessed by the reviewer (REV-004).
- Next digest: early June. (PN)

## Page history

- **2026-05-05** Version 1: published for April 2026. (PN)
