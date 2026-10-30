"""Reconciliation tests for the nightly settlement job.

Builds an in-memory settlement database from fixtures/settlement_fixture.sql,
reconciles business date 2026-04-18 and checks our figures against the totals
each scheme settled for that date. The fixture also holds declined and
reversed transactions and transactions on the neighbouring business dates,
none of which may be counted.

Run from the repository root:

    python3 -m unittest discover -s services/settlement -p "test_*.py" -v
"""

import sqlite3
import sys
import unittest
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import settlement_reconciler  # noqa: E402  (found through the path entry above)

FIXTURE = HERE / "fixtures" / "settlement_fixture.sql"
BUSINESS_DATE = "2026-04-18"

# Captured transactions per scheme on the business date, counted from the fixture.
EXPECTED_COUNTS = {"AMEX": 12, "MASTERCARD": 17, "VISA": 20}


def pence(value) -> int:
    """A money value as whole pence (half up), so that figures compare to the penny."""
    return int((Decimal(str(value)) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def pounds(value) -> str:
    """A money value for a failure message, e.g. £1,234.56."""
    return f"£{Decimal(pence(value)).scaleb(-2):,.2f}"


class SettlementReconciliationTest(unittest.TestCase):
    """The reconciler on the 2026-04-18 fixture, against the schemes' own totals."""

    @classmethod
    def setUpClass(cls):
        cls.conn = sqlite3.connect(":memory:")
        cls.conn.executescript(FIXTURE.read_text(encoding="utf-8"))
        cls.result = settlement_reconciler.reconcile(cls.conn, BUSINESS_DATE)
        cls.settled = {
            scheme: {"gross": Decimal(gross), "fees": Decimal(fees), "net": Decimal(net)}
            for scheme, gross, fees, net in cls.conn.execute(
                "SELECT scheme, gross, fees, net FROM scheme_settlements WHERE business_date = ?",
                (BUSINESS_DATE,),
            )
        }

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def assert_figure_matches_settlement(self, figure):
        """Fail, listing every scheme whose figure differs from its settlement total by a penny or more."""
        differences = []
        for scheme, settled in sorted(self.settled.items()):
            expected = settled[figure]
            actual = getattr(self.result.totals[scheme], figure)
            if pence(actual) != pence(expected):
                differences.append(
                    f"{scheme} {figure}: expected {pounds(expected)} (scheme settlement), "
                    f"got {pounds(actual)} ({pence(actual) - pence(expected):+d}p)"
                )
        if differences:
            self.fail("\n".join(differences))

    def test_counts_only_captured_transactions_for_the_business_date(self):
        counts = {scheme: totals.transactions for scheme, totals in self.result.totals.items()}
        self.assertEqual(counts, EXPECTED_COUNTS, f"captured transactions per scheme on {BUSINESS_DATE}")

    def test_gross_matches_scheme_settlement(self):
        self.assert_figure_matches_settlement("gross")

    def test_fees_match_scheme_settlement_to_the_penny(self):
        self.assert_figure_matches_settlement("fees")

    def test_net_matches_scheme_settlement_to_the_penny(self):
        self.assert_figure_matches_settlement("net")

    def test_integrity_check_passes(self):
        found = "\n".join(
            f"{m.scheme} {m.field}: expected {pounds(m.expected)}, "
            f"got {pounds(m.actual)} ({m.difference_pence:+d}p)"
            for m in self.result.mismatches
        )
        if not self.result.passed:
            self.fail(f"integrity check failed:\n{found}")


if __name__ == "__main__":
    unittest.main()
