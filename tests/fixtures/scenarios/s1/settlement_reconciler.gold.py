"""Nightly card scheme settlement reconciliation.

Totals one business date's captured card transactions per scheme, works out
the scheme fees due and the net amount each scheme should settle to us, and
checks those figures against the totals in the scheme's settlement file. Any
difference fails the integrity check, and the clearing scheduler then holds
the day's settlement file for manual review by Finance Operations.

    python3 settlement_reconciler.py --db /data/settlement/settlement.db --date 2026-04-18

Exit status 0 when every scheme reconciles, 1 when the integrity check fails.
Owner: Clearing Engineering, Payments & Settlements Technology.
"""

import argparse
import logging
import sqlite3
import sys
from contextlib import closing
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

log = logging.getLogger("settlement.reconciler")

RECONCILIATION_SQL = Path(__file__).with_name("reconciliation.sql")
SETTLEMENT_SQL = (
    "SELECT scheme, gross, fees, net FROM scheme_settlements WHERE business_date = :business_date"
)

PENNY = Decimal("0.01")


@dataclass(frozen=True)
class Transaction:
    transaction_id: str
    scheme: str
    amount: Decimal
    fee_rate: Decimal
    fixed_fee: Decimal


@dataclass
class SchemeTotals:
    scheme: str
    transactions: int = 0
    gross: Decimal = Decimal("0.00")
    fees: Decimal = Decimal("0.00")

    @property
    def net(self) -> Decimal:
        """What the scheme should settle to us: gross less the scheme fees."""
        return self.gross - self.fees


@dataclass(frozen=True)
class Mismatch:
    scheme: str
    field: str
    expected: Decimal
    actual: Decimal
    difference_pence: int


@dataclass
class ReconciliationResult:
    business_date: str
    totals: dict[str, SchemeTotals]
    mismatches: list[Mismatch]

    @property
    def passed(self) -> bool:
        """The integrity check: every scheme agrees with its settlement totals."""
        return not self.mismatches


def scheme_fee(amount: Decimal, fee_rate: Decimal, fixed_fee: Decimal) -> Decimal:
    """Scheme fee for one transaction: the rate on the amount plus the fixed fee, in pounds and pence."""
    fee = amount * fee_rate + fixed_fee
    return fee.quantize(PENNY, rounding=ROUND_HALF_UP)


def load_transactions(conn: sqlite3.Connection, business_date: str) -> list[Transaction]:
    """Captured transactions for the business date, each with its scheme's fee terms."""
    query = RECONCILIATION_SQL.read_text(encoding="utf-8")
    rows = conn.execute(query, {"business_date": business_date}).fetchall()
    return [
        Transaction(transaction_id, scheme, Decimal(amount), Decimal(fee_rate), Decimal(fixed_fee))
        for transaction_id, scheme, amount, fee_rate, fixed_fee in rows
    ]


def load_scheme_settlements(conn: sqlite3.Connection, business_date: str) -> dict[str, dict[str, Decimal]]:
    """Each scheme's own totals for the business date, keyed by scheme."""
    rows = conn.execute(SETTLEMENT_SQL, {"business_date": business_date})
    return {
        scheme: {"gross": Decimal(gross), "fees": Decimal(fees), "net": Decimal(net)}
        for scheme, gross, fees, net in rows
    }


def reconcile(conn: sqlite3.Connection, business_date: str) -> ReconciliationResult:
    """Total the business date per scheme and compare the totals with the schemes' own."""
    transactions = load_transactions(conn, business_date)
    log.info("%d captured transactions for %s", len(transactions), business_date)
    totals: dict[str, SchemeTotals] = {}
    for txn in transactions:
        scheme_totals = totals.setdefault(txn.scheme, SchemeTotals(txn.scheme))
        scheme_totals.transactions += 1
        scheme_totals.gross += txn.amount
        scheme_totals.fees += scheme_fee(txn.amount, txn.fee_rate, txn.fixed_fee)

    settlements = load_scheme_settlements(conn, business_date)
    mismatches = []
    for scheme in sorted(set(totals) | set(settlements)):
        if scheme not in settlements:
            raise LookupError(f"no settlement totals from {scheme} for {business_date}")
        ours = totals.setdefault(scheme, SchemeTotals(scheme))
        for figure in ("gross", "fees", "net"):
            expected, actual = settlements[scheme][figure], getattr(ours, figure)
            difference = round((actual - expected) * 100)
            if difference:
                mismatches.append(Mismatch(scheme, figure, expected, actual, difference))
    return ReconciliationResult(business_date, totals, mismatches)


def format_summary(result: ReconciliationResult) -> str:
    """The summary written to the job log: one line per scheme, then any mismatches."""
    failed = {m.scheme for m in result.mismatches}
    lines = [
        f"Settlement reconciliation for business date {result.business_date}",
        f"{'Scheme':<12}{'Txns':>5}{'Gross':>13}{'Fees':>10}{'Net':>13}  Status",
    ]
    for scheme, t in sorted(result.totals.items()):
        status = "MISMATCH" if scheme in failed else "OK"
        lines.append(f"{scheme:<12}{t.transactions:>5}{t.gross:>13,.2f}{t.fees:>10,.2f}{t.net:>13,.2f}  {status}")
    if result.mismatches:
        lines += ["", "Mismatches against scheme settlement totals:"]
        for m in result.mismatches:
            lines.append(
                f"  {m.scheme:<11} {m.field:<5} expected {m.expected:>10,.2f}"
                f"  actual {m.actual:>10,.2f}  difference {m.difference_pence:+d}p"
            )
    verdict = "PASSED" if result.passed else f"FAILED ({len(result.mismatches)} mismatches)"
    return "\n".join(lines + ["", f"Integrity check {verdict}"])


def main(argv=None) -> int:
    """Entry point for the clearing scheduler; returns the process exit status."""
    parser = argparse.ArgumentParser(description="Reconcile card scheme settlement for one business date.")
    parser.add_argument("--db", required=True, type=Path, help="settlement database (SQLite)")
    parser.add_argument("--date", required=True, type=date.fromisoformat, help="business date, YYYY-MM-DD")
    args = parser.parse_args(argv)
    if not args.db.is_file():
        parser.error(f"no such database: {args.db}")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    with closing(sqlite3.connect(f"{args.db.resolve().as_uri()}?mode=ro", uri=True)) as conn:
        result = reconcile(conn, args.date.isoformat())
    print(format_summary(result))
    return 0 if result.passed else 1


if __name__ == "__main__":
    sys.exit(main())
