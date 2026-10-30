"""Dispute intake for the settlement service.

Records a customer dispute against a captured card transaction. The card
number is masked to its last four digits in code before it reaches storage
or any log (SCS-021, SCS-022). All SQL is parameterised (SCS-031). Monetary
values are Decimal (PAY-012). An audit event is emitted on every successful
intake (PAY-030).

Ticket: DSP-2026-03
Owner: Clearing Engineering, Payments & Settlements Technology.
"""

import logging
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

log = logging.getLogger("settlement.dispute_intake")

TICKET_REF = "DSP-2026-03"


class DisputeIntakeError(ValueError):
    """Raised when a dispute cannot be recorded."""


@dataclass(frozen=True)
class Dispute:
    """The stored dispute record, returned to the caller."""

    dispute_id: str
    transaction_id: str
    card_last4: str
    amount: Decimal
    reason_code: str
    received_on: str
    status: str
    actor: str


def mask_card_number(card_number: str) -> str:
    """Return only the last four digits of a card number.

    SCS-022: masking MUST happen in code before the value reaches a logger,
    formatter or response.
    """
    digits = card_number.replace(" ", "").replace("-", "")
    if len(digits) < 4:
        raise DisputeIntakeError("card number too short to mask")
    return digits[-4:]


def _ensure_tables(conn: sqlite3.Connection) -> None:
    """Create the disputes and audit_events tables if they do not exist."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS disputes (
            dispute_id     TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL,
            card_last4     TEXT NOT NULL,
            amount         TEXT NOT NULL,
            reason_code    TEXT NOT NULL,
            received_on    TEXT NOT NULL,
            status         TEXT NOT NULL,
            actor          TEXT NOT NULL,
            created_at     TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            event_id   TEXT PRIMARY KEY,
            actor      TEXT NOT NULL,
            action     TEXT NOT NULL,
            entity     TEXT NOT NULL,
            entity_id  TEXT NOT NULL,
            before_val TEXT,
            after_val  TEXT,
            ticket_ref TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )


def record_dispute(
    conn: sqlite3.Connection,
    transaction_id: str,
    card_number: str,
    amount: Decimal,
    reason_code: str,
    received_on: date,
    actor: str,
) -> Dispute:
    """Record a dispute against a captured card transaction.

    Refuses (raises DisputeIntakeError) when:
      * the transaction id is not found,
      * the transaction status is not CAPTURED,
      * the disputed amount is not positive,
      * the disputed amount exceeds the transaction amount.

    On success, stores the dispute with the card number masked to its last
    four digits, emits an audit event, and returns the stored Dispute.
    """
    # --- Normalise amount to Decimal (PAY-012) ---
    if not isinstance(amount, Decimal):
        try:
            amount = Decimal(str(amount))
        except (InvalidOperation, TypeError) as exc:
            raise DisputeIntakeError(
                f"amount must be a Decimal or numeric string, got {type(amount).__name__}"
            ) from exc

    if amount <= 0:
        raise DisputeIntakeError(f"disputed amount must be positive, got {amount}")

    # --- Look up the transaction (parameterised query, SCS-031) ---
    row = conn.execute(
        "SELECT id, amount, status FROM card_transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone()

    if row is None:
        raise DisputeIntakeError(f"unknown transaction: {transaction_id}")

    txn_amount = Decimal(row[1])
    txn_status = row[2]

    if txn_status != "CAPTURED":
        raise DisputeIntakeError(
            f"transaction {transaction_id} is {txn_status}, not CAPTURED"
        )

    if amount > txn_amount:
        raise DisputeIntakeError(
            f"disputed amount {amount} exceeds transaction amount {txn_amount}"
        )

    # --- Mask the card number before it reaches storage or logs (SCS-022) ---
    card_last4 = mask_card_number(card_number)

    # --- Ensure tables exist ---
    _ensure_tables(conn)

    # --- Store the dispute (parameterised, SCS-031) ---
    dispute_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """
        INSERT INTO disputes
            (dispute_id, transaction_id, card_last4, amount,
             reason_code, received_on, status, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dispute_id,
            transaction_id,
            card_last4,
            str(amount),
            reason_code,
            received_on.isoformat(),
            "OPEN",
            actor,
            now,
        ),
    )

    # --- Audit event (PAY-030) ---
    event_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO audit_events
            (event_id, actor, action, entity, entity_id,
             before_val, after_val, ticket_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            actor,
            "CREATE_DISPUTE",
            "dispute",
            dispute_id,
            None,  # before: no dispute existed for this transaction
            f"txn={transaction_id}, amount={amount}, reason={reason_code}, status=OPEN",
            TICKET_REF,
            now,
        ),
    )

    conn.commit()

    # Log without the card number (SCS-021)
    log.info(
        "dispute %s recorded for transaction %s by %s",
        dispute_id,
        transaction_id,
        actor,
    )

    return Dispute(
        dispute_id=dispute_id,
        transaction_id=transaction_id,
        card_last4=card_last4,
        amount=amount,
        reason_code=reason_code,
        received_on=received_on.isoformat(),
        status="OPEN",
        actor=actor,
    )
