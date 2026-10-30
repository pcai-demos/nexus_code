# ADR-004: Monetary amounts use Decimal with an explicit scale

| Field | Value |
|---|---|
| Document ID | ADR-004 |
| Title | Monetary amounts use Decimal with an explicit scale |
| Type | Architecture decision record, Payments & Settlements Technology |
| Owner | Chief Architect |
| Deciders | Marcus Thorne (Chief Architect), David Vance (Head of Payments Engineering), Priya Nair (Senior Engineer, Clearing Engineering) |
| Version | 2 |
| Effective date | 2026-03-09 (version 2; version 1 accepted 2024-08-14) |
| Next review | 2027-03-08 |
| Classification | Internal |
| Status | Accepted |

## Context

In July 2024 we found that the refund fee batch had been losing up to a penny on each refund for nine weeks (PM-2024-011). It held money in floats and cut fees to pence with `int(fee * 100) / 100`. The first fix, `round(fee, 2)`, was still wrong for fees that land on exactly half a penny, because `round()` works on the binary value.

When we looked further, our money code rounded in at least three different ways. The Java services used BigDecimal; the Python jobs and the SQL had no rule at all. We need one rule that holds in every language we write money code in, and that gives the same totals as the card schemes' settlement figures, to the penny.

## Decision

**ADR-004 D1: Decimal, never float.** Monetary amounts are decimal values: `decimal.Decimal` in Python, `BigDecimal` in Java, `NUMERIC` or `DECIMAL` in SQL, and decimal text where the store has no decimal type, as in SQLite. Binary floating point (`float`, `double`, SQL `REAL`) is not used for money anywhere, tests included.
Traces to: PAY-012 (Payments Engineering Standard).

**ADR-004 D2: Pounds, with an explicit scale of two.** Amounts are pounds held to two decimal places, so the smallest unit is the penny: `Decimal("1234.56")`. Rates keep their full precision, `Decimal("0.0145")`, and intermediate results keep every digit until the one rounding in D3.
Traces to: PAY-011 and PAY-012 (Payments Engineering Standard).

**ADR-004 D3: Round once, half up, per transaction.** Each fee or charge is worked out for its own transaction at full precision and quantised to the penny once, with ROUND_HALF_UP. Totals are sums of the rounded per-transaction amounts and are never rounded again. No truncation, and no `round()` on a float.
Traces to: PAY-012 (Payments Engineering Standard).

**ADR-004 D4: Parse from text at the edges.** Amounts and rates arrive as text and go straight into Decimal: `Decimal(row["amount"])`. Never `float(...)` on the way in and never `Decimal(some_float)`; both carry the binary error with them. Where the store has no decimal type, money is written back as decimal text.
Traces to: PAY-013 (Payments Engineering Standard).

The pattern in Python:

```python
from decimal import Decimal, ROUND_HALF_UP

PENNY = Decimal("0.01")

def to_penny(value: Decimal) -> Decimal:
    """Round a money value to the penny, half up. Call it once per transaction."""
    return value.quantize(PENNY, rounding=ROUND_HALF_UP)

amount = Decimal(row["amount"])        # "30.00" from the database: text in, Decimal out
fee = to_penny(amount * rate + fixed)  # rate and fixed are Decimal too; one rounding, here
total_fees += fee                      # add up the rounded fees; never round the total
```

## Consequences

- Our fee totals reconcile to the schemes' settlement figures to the penny, which is what the nightly check under PAY-014 depends on.
- One rule everywhere, and an easy one to review: a float anywhere near money is a review finding.
- Every boundary needs an explicit parse. Amounts in JSON travel as strings ("12.50"), not numbers.
- `Decimal(0.1)` is a trap: it copies the binary error in. Build Decimals from strings.
- Decimal is slower than float. At our volumes it doesn't matter: the refund fee batch went from 41 to 44 seconds.

## Alternatives considered

1. **Integer pence everywhere.** Simple to store and to add up. Rejected for calculation: rates are fractions, so a fee still needs decimal arithmetic and a rounding rule before it becomes pence. Integer pence is fine in a file format that demands it, converted at the edge.
2. **Floats, rounded with `round()` at the end.** Rejected: `round()` works on the binary value (`round(2.675, 2)` is 2.67), and rounding a total gives a different answer from rounding each transaction.
3. **Round the day's total, not each fee.** Rejected: the settlement figures we reconcile against add up per-transaction fees, so a rounded total drifts away from them.
4. **A third-party money library.** Rejected for now. Decimal does the job, and a new dependency needs approval under the dependencies standard.

## Links

- PM-2024-011 Penny drift in scheme fee accumulation (2024)
- Payments Engineering Standard: PAY-011, PAY-012, PAY-013, PAY-014
- Testing and Definition of Done Standard: TST-004

## History

- Version 1, 2024-08-14: accepted (D1 to D3).
- Version 2, 2026-03-09: D4 added (parse from text; SQLite keeps money as decimal text); trace lines updated to the Payments Engineering Standard v3.0.
