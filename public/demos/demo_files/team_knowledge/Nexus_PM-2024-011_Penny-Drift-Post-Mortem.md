# PM-2024-011: Penny drift in scheme fee accumulation (refund fee batch)

| Field | Value |
|---|---|
| Document ID | PM-2024-011 |
| Title | Penny drift in scheme fee accumulation (refund fee batch) |
| Type | Post-mortem (blameless), Clearing Engineering wiki |
| Owner | Senior Engineer, Clearing Engineering (page owner: Priya Nair) |
| Version | 1.2 |
| Effective date | 2026-03-16 (this version; first published 2024-07-11) |
| Next review | 2027-03-15 |
| Classification | Internal |
| Status | Closed, all actions done |
| Incident | INC-2024-0701 (P3), raised 2024-07-01 |
| Squad | Clearing Engineering, Payments & Settlements Technology |

## TL;DR

For nine weeks in May and June 2024 our refund fee batch worked out fees in floating point and chopped them to pence with `int(fee * 100) / 100`. Any refund could come out a penny short. 57 merchants got £2.11 less merchant service charge back than they were owed, and our scheme fee accrual ended up £1.94 below what the schemes actually credited us. We fixed it twice, because the first fix was wrong too. Money in that batch is now Decimal, rounded half up once per refund, and the batch checks itself against the schemes' own figures every night.

## What happened

On Monday 29 April 2024 we switched the refund fee batch from the old Java job to `refund_fee_batch`, a Python rewrite. Each night it takes the day's card refunds and works out two amounts per refund: the merchant service charge we give back to the merchant (our merchant terms give the charge back on a refunded sale), and the scheme fee the card scheme credits back to us. It posts both, and adds the scheme fee credits to the accrual that Finance Operations checks against each scheme's monthly fee statement.

The Java job used BigDecimal. The rewrite used floats, and a helper that "rounded" to pence like this:

```python
fee = refund.amount * rate
fee = int(fee * 100) / 100
```

Nobody compared the new job's output with the old one's, and nothing compared our fee totals with the schemes' figures until month-end.

## Timeline (BST)

- **Mon 29 Apr 2024.** `refund_fee_batch` goes live and the Java job is switched off. Unit tests green.
- **Tue 4 Jun.** May month-end check: the refund scheme fee accrual is 46p below the schemes' statements. We put it down to timing (refunds either side of month-end) and let it go. First miss.
- **Mon 1 Jul.** June month-end check: £1.33 below (Visa 81p, Mastercard 52p). Joanna Pryce in Settlement Operations doesn't accept timing twice and raises INC-2024-0701 (P3).
- **Tue 2 Jul.** Priya picks it up and recomputes June's refunds in a spreadsheet. Every difference is the batch coming out a penny low.
- **Wed 3 Jul.** First fix: `round(fee, 2)` instead of the `int()` trick, plus a unit test. Test passes, fix deployed.
- **Thu 4 Jul.** Priya's spot check against the Visa daily report is still 1p out, on a £30.00 refund with a 1.45% fee: exactly 43.5p. Reopened.
- **Fri 5 Jul.** Second fix: Decimal from end to end, half up once per refund, and a reconciliation test over June's refunds against the schemes' own figures. Callum Reid reviewed it, David Vance approved it, deployed 16:40.
- **Mon 8 Jul.** Every refund since 29 April recalculated with the fixed code: 412 refunds, 57 merchants, £2.11 owed.
- **Wed 10 Jul.** Post-mortem meeting: Clearing Engineering, Settlement Operations, Risk & Compliance.
- **Wed 17 Jul.** £2.11 paid back to the 57 merchants with a note on their statements. Settlement Operations corrects the accrual.

## Impact

- **Merchants.** 57 merchant customers got back £2.11 less merchant service charge than they were owed, across 412 refunds between 29 April and 4 July. 211 of those refunds were a penny short; the biggest shortfall for one merchant was 19p. All paid back on 17 July. No merchant noticed. We found it, not them, and we'd like to keep it that way round.
- **Statements.** 211 refund lines on merchant statements showed a charge a penny out. Tiny, but a charge on a statement has to be right.
- **Cardholders.** None. Cardholders always got their full refund; only the fees were wrong.
- **Our books.** The scheme fee accrual was £1.94 below what the schemes credited us (Visa £1.18, Mastercard £0.76). The money had arrived; for nine weeks our records didn't say so.

## Root cause

Two problems, both in that two-line helper.

1. **Truncation.** `int(fee * 100) / 100` always rounds down, so any fee with half a penny or more on the end loses a penny. The £30.00 refund with a 1.45% fee is exactly 43.5p: it should be 44p and came out as 43p.
2. **Binary floating point.** Floats can't hold most amounts in pence exactly. In Python `0.29 * 100` is 28.999999999999996, so `int(0.29 * 100)` is 28. Fees that land on a whole penny can lose one too.

Our first fix, `round(fee, 2)`, didn't properly fix either. `round()` works on the binary value, not the decimal one you think you have: 0.435 is stored as 0.434999999999999997779..., so `round(0.435, 2)` is 0.43. Same wrong answer, now with a passing test, because the test worked out its expected value with the same float expression as the code. It agreed with itself.

Why it got through: the rewrite had no test proving it gave the same answers as the Java job; nothing compared our totals with the schemes' own figures until month-end; and the 46p in May was waved through as timing.

## What we changed

| # | Action | Owner | Ref | Status |
|---|---|---|---|---|
| 1 | `refund_fee_batch` on Decimal end to end: amounts parsed from the database's decimal text, rates as Decimal, each fee quantised to 0.01 with ROUND_HALF_UP once per refund, totals added up from the rounded fees | Priya Nair | CLR-1162 | Done 5 Jul 2024 |
| 2 | Reconciliation test over a fixture of June 2024 refunds, with the expected totals typed in from the schemes' reports, not worked out by our code | Priya Nair | CLR-1164 | Done 5 Jul 2024 |
| 3 | Nightly check of refund scheme fee credits against each scheme's daily figures; any difference, even 1p, holds the posting and pages on-call | Callum Reid | CLR-1163 | Done 26 Jul 2024 |
| 4 | Pay back the 57 merchants and correct the accrual | Joanna Pryce | FINOPS-2207 | Done 17 Jul 2024 |
| 5 | Check the chargeback fee batch and the interchange report for the same pattern | Callum Reid | CLR-1170 | Done 30 Aug 2024: chargeback fee batch fixed; interchange report was already on Decimal |
| 6 | Write the money decision down | Marcus Thorne | ADR-004 | Accepted 14 Aug 2024 |
| 7 | Get the rounding rule and the nightly check into the Payments Engineering Standard | David Vance | STD-PAY v2.1 | Done 21 Oct 2024 (PAY-012, PAY-014) |

## Lessons

**PM-2024-011 L1: Money is never a float.** Not in a variable, not in a database column, not on the way in from a file or a message. Floats can't hold pence exactly, and the error comes out as lost pennies. Use Decimal and build it from text, `Decimal("30.00")`, never from a float: `Decimal(30.0 * 0.0145)` just copies the binary error in.
Traces to: PAY-012 and PAY-013 (Payments Engineering Standard). See also ADR-004.

**PM-2024-011 L2: Round once, half up, per transaction.** Work out each fee or charge at full precision, round it to the penny once with ROUND_HALF_UP, then add up the rounded amounts. Don't truncate, don't call `round()` on a float, and don't round the day's total instead of each fee. Rounding each transaction is how our totals end up matching the schemes' figures to the penny.
Traces to: PAY-012 (Payments Engineering Standard).

**PM-2024-011 L3: Reconcile against the scheme's own totals, every day.** Our numbers checked against our own numbers prove nothing. Every night, before anything is posted, compare our totals with the figures the scheme reports, to the penny, and treat a 1p difference as a break that holds the posting. The 46p we waved through on 4 June was the bug telling us.
Traces to: PAY-014 and PAY-015 (Payments Engineering Standard).

**PM-2024-011 L4: Every fix gets a reconciliation test.** A fix to fee or settlement code ships with a test that reconciles against the scheme's figures held in a fixture. Expected values come from the fixture, never from the code or formula under test: our first fix passed a test that agreed with itself. Write the test first and watch it fail before you fix anything.
Traces to: TST-004 and TST-006 (Testing and Definition of Done Standard).

**PM-2024-011 L5: A rewrite is a change to money code.** Before the new version of a job replaces the old one, run both on the same inputs and prove they give the same answers. The Java job had this right for years; nobody checked that the Python one agreed with it.
Traces to: TST-010 (Testing and Definition of Done Standard).

## Review notes

- **2024-07-11** Published after the post-mortem meeting on 10 July. (PN)
- **2024-10-21** L2 and L3 are now PAY-012 and PAY-014 in the Payments Engineering Standard v2.1. (DV)
- **2025-01-13** L4 and L5 are now TST-004, TST-006 and TST-010 in the Testing and Definition of Done Standard v2.0. (PN)
- **2026-03-16** Annual review. All actions closed. Trace lines checked against the Payments Engineering Standard v3.0 and the Testing and Definition of Done Standard v3.0. Added to the squad's onboarding reading list: if you write code that touches money, read this first. (PN)
