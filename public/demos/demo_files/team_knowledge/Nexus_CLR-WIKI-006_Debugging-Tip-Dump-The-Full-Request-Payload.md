# Debugging tip: dump the full request payload

| Field | Value |
|---|---|
| Document ID | CLR-WIKI-006 |
| Title | Debugging tip: dump the full request payload |
| Type | Wiki page (tip), Clearing Engineering |
| Owner | None. The author, a contractor on the squad, left the Bank in June 2024 |
| Approved by | Not reviewed (squad tip) |
| Version | 1.1 |
| Effective date | 2023-06-21 (last edited; first published 2023-03-15) |
| Next review | 2024-03-15 (overdue) |
| Classification | Internal |
| Status | Published; not reviewed since 2023 |
| Applies to | Clearing Engineering: the refund and capture services |

> **This page has not been updated in more than 12 months.** It may be out of date. Check it against the current standards before you rely on it. (Added automatically by the wiki, 2024-06-21.)

## The problem

When a refund or a capture fails at the scheme gateway, all you usually get back is a 400 and an error code nobody can find in the gateway docs. Half the time the problem is in what we sent: a field in the wrong format, an amount with three decimal places, a merchant ID with a trailing space. Guessing from the code takes hours.

## The tip

**CLR-WIKI-006 T1: Dump the full request payload.** In the refund and capture services, log the whole incoming request body, and the request we send on to the gateway, as one line of JSON at debug level. Then you can see exactly what went out and diff it against a request that worked. Debug logging is off in production, so this only ever fires in dev and test.
Traces to: Secure Coding Standard v2.0, SCS-021 (no card numbers in production logs).

**CLR-WIKI-006 T2: Replay it against the sandbox.** Copy the logged gateway request out of the log viewer and replay it against the gateway sandbox, changing one field at a time until the error goes away. Paste the payloads you tried into the ticket so the next person can see what you ruled out.
Traces to: none (squad practice).

Saved me a whole afternoon on the capture rejections. Happy debugging!

## Comments

- **Callum Reid, 2023-03-16:** Lifesaver. Found the capture bug in ten minutes with this.
- **Callum Reid, 2024-02-15:** Heads up. During INC-2024-0213 on Tuesday we switched debug logging on in production for about three hours to chase gateway timeouts, and T1 wrote full card numbers from 1,212 refund requests to the log platform. The logs have been purged, and SCS-021 is being changed to cover every log level. Can we take this page down, or rewrite it?
- **David Vance, 2024-02-16:** Agreed. Page owner, please update or archive this before the next review.

## Page history

- **2023-03-15** Version 1: first published (T1, incoming request body only).
- **2023-06-21** Version 1.1: T1 extended to the outbound gateway request; T2 added.
