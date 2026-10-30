# Why we log the last four only

| Field | Value |
|---|---|
| Document ID | CLR-WIKI-014 |
| Title | Why we log the last four only |
| Type | Wiki page, Clearing Engineering |
| Owner | Senior Engineer, Clearing Engineering (page owner: Priya Nair) |
| Approved by | Siobhan Patel (Principal Security Engineer), at the 2026 review |
| Version | 3 |
| Effective date | 2026-03-04 (this version; first published 2024-03-06) |
| Next review | 2027-03-03 |
| Classification | Internal |
| Status | Current |
| Applies to | Clearing Engineering: every service that sees a card number |

## TL;DR

When a log line needs to say which card a payment used, we write the last four digits. Not the BIN, not the full number, and not a request body with the number somewhere inside it. That goes for debug logging too.

## Why

A log isn't a scratch pad. It's stored data: it gets shipped to the log platform, indexed, kept for 13 months and copied into backups. PCI DSS says the same. Its rule that a stored card number must be unreadable (3.5.1) covers "audit logs, exception, or troubleshooting logs", not just databases. A full card number in one log line brings the log platform and its backups into PCI scope.

We learned this the hard way. On 13 February 2024 (INC-2024-0213) we switched debug logging on in production for about three hours to chase gateway timeouts. The refund service had a debug line that dumped the whole request body, and it wrote full card numbers from 1,212 refund requests to the log platform. Nobody outside the platform team could search those logs, and they were purged the next day, but it was still a security incident. It's the reason SCS-021 now says every log level, debug included.

## Why the last four and not the BIN as well

The standard allows at most the BIN and the last four, and only the digits you need (SCS-022). In our logs the BIN adds nothing: the scheme and the issuing country are already fields on the transaction. The last four is what the merchant sees on the receipt, and it's enough to agree which card we're talking about. So we keep the last four and drop the rest. Strictly that's truncation, not masking: the digits we drop are gone from the log for good.

## Rules of thumb

**CLR-WIKI-014 R1: Last four, nothing more.** When a log line has to identify a card, write the last four digits, as in "card ending 1234", and nothing else: no BIN, no expiry date, no cardholder name. If a support screen really needs the BIN, that's a design question for Siobhan, not a logging one.
Traces to: SCS-022 (Secure Coding Standard).

**CLR-WIKI-014 R2: Mask before you log, not after.** Mask the card number where it enters the service, before it can reach a logger, an error message or a metric. Don't rely on the log level, a log filter or the log platform's redaction to catch it. Those are a safety net, not the control.
Traces to: SCS-021 and SCS-022 (Secure Coding Standard).

**CLR-WIKI-014 R3: Log a reference, not a body.** Never log a whole request or response body from a service that sees card numbers, at any level. Log what you need to find the transaction again: the refund or transaction ID, the merchant ID, the outcome, the gateway's error code and the timings. If you need the body to debug, reproduce the call in the gateway sandbox with test cards.
Traces to: SCS-021 and SCS-030 (Secure Coding Standard).

**CLR-WIKI-014 R4: Debug isn't a safe place.** Debug logging gets switched on in production when something is going wrong, which is exactly when the payloads are most interesting. Write every log line as if it will run in production, because one day it will.
Traces to: SCS-021 (Secure Coding Standard).

## Page history

- **2024-03-06** First published after INC-2024-0213. (PN)
- **2025-03-12** R2 added after a review found a card number that was only masked by a log filter. (PN)
- **2026-03-04** Annual review against the Secure Coding Standard v4.0 (SCS-021, SCS-022, SCS-030). Reviewed by Siobhan Patel. (PN)
