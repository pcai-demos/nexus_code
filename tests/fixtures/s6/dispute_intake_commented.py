"""Record card payment disputes against captured card transactions.

MODULE:          dispute_intake
PURPOSE:         Records a cardholder's dispute against a captured card payment, so that
                 reconciliation can see which settled payments are disputed (DSP-2026-03).
SERVICE:         Card settlement
OWNER:           Clearing Engineering, Payments & Settlements Technology
CLASSIFICATION:  Internal
Copyright (c) Nexus Bank plc 2026. All rights reserved.
Nexus and the Nexus logo are trade marks of Nexus Bank plc.
HISTORY:         2026-08-10 Dispute intake created (DSP-2026-03)
REQUIREMENTS:    PAY-012 (money in Decimal), PAY-030 (an audit event for each dispute),
                 SCS-021 and SCS-022 (the card number masked to its last four digits)
AI-ASSISTED:     Code, tests and comments written with NexCODE (qwen3.8:27b), reviewed by Priya Nair
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
    """A dispute the rules refuse: the message says which rule the input failed (SVS-010)."""


@dataclass(frozen=True)
class Dispute:
    """The dispute as stored: the card number as its last four digits only (SCS-022)."""

    dispute_id: str
    transaction_id: str
    card_last4: str
    amount: Decimal
    reason_code: str
    received_on: str
    status: str
    actor: str


def mask_card_number(card_number: str) -> str:
    """Return the last four digits of a card number, so no other digit is kept (SCS-022).

    Args:
        card_number: the full card number, spaces or hyphens allowed.

    Returns:
        The last four digits.

    Raises:
        DisputeIntakeError: when the number has fewer than four digits.
    """
    digits = card_number.replace(" ", "").replace("-", "")
    if len(digits) < 4:
        raise DisputeIntakeError("card number too short to mask")
    return digits[-4:]


def _ensure_tables(conn: sqlite3.Connection) -> None:
    """Create the disputes and audit_events tables if they are missing (CLR-WIKI-024 C6, C7)."""
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
    """Record a dispute against a captured card transaction (DSP-2026-03).

    The amount is compared and stored as a Decimal, never a float (PAY-012).

    Args:
        conn: the settlement database.
        transaction_id: the card transaction the scheme's notice names.
        card_number: the card number on the notice; only its last four digits are kept.
        amount: the disputed amount.
        reason_code: the reason code as the scheme sends it.
        received_on: the date the notice was received.
        actor: who records the dispute, for the audit event (PAY-030).

    Returns:
        The stored Dispute, with the status OPEN.

    Raises:
        DisputeIntakeError: the transaction is unknown or not CAPTURED, or the
            amount is not positive or is more than the transaction's.
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
