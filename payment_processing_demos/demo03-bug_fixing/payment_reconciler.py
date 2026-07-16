import json
import sys

class LedgerReconciler:
    def __init__(self, batch_file_content: str):
        self.batch_data = json.loads(batch_file_content)
        self.reconciliation_ledger = []
        self.total_processed_volume = 0.0
        self.total_fees_calculated = 0.0

    def parse_and_accumulate(self):
        """Parses transactions and calculates volumes and scheme fees.
        
        CRITICAL BUG: This uses native float arithmetic for monetary aggregation,
        leading to binary floating-point drift over batches.
        """
        for txn in self.batch_data["transactions"]:
            amount = float(txn["amount"])
            self.total_processed_volume += amount
            
            # Scheme fee is exactly 1.5% of the transaction amount
            scheme_fee = amount * 0.015
            self.total_fees_calculated += scheme_fee
            
            self.reconciliation_ledger.append({
                "transaction_id": txn["transaction_id"],
                "amount": amount,
                "scheme_fee": scheme_fee
            })

    def verify_settlement(self) -> bool:
        """Verifies the cumulative volume against the acquiring bank's settlement figure.
        
        The acquiring bank uses arbitrary exact decimal scaling (e.g., from ISO 8583 settlement frames).
        """
        expected_volume = float(self.batch_data["settlement_summary"]["expected_volume"])
        expected_fees = float(self.batch_data["settlement_summary"]["expected_fees"])
        
        print(f"--- Nexus Settlement Reconciliation Audit ---")
        print(f"Parsed Transactions: {len(self.reconciliation_ledger)}")
        print(f"Calculated Volume:   {self.total_processed_volume:.20f}")
        print(f"Expected Volume:     {expected_volume:.20f}")
        print(f"Calculated Fees:     {self.total_fees_calculated:.20f}")
        print(f"Expected Fees:       {expected_fees:.20f}")
        
        # Strict absolute parity check mandated by operational audit rules
        volume_match = (self.total_processed_volume == expected_volume)
        fees_match = (self.total_fees_calculated == expected_fees)
        
        if not volume_match or not fees_match:
            print("[CRITICAL] Reconciliation Mismatch Detected!")
            print(f"Volume Delta: {abs(self.total_processed_volume - expected_volume):.20f}")
            print(f"Fees Delta:   {abs(self.total_fees_calculated - expected_fees):.20f}")
            raise ValueError("REGULATORY_FAILURE: Ledger balances do not reconcile exactly.")
            
        print("[SUCCESS] Settlement balances matched perfectly. Safe to commit to central ledger.")
        return True

def run_local_reconciliation_batch():
    # Realistic batch data simulating 20 transaction entries where standard float 
    # precision drift mathematically manifests during simple summation.
    mock_batch = {
        "batch_id": "BCH-2026-06-25-09",
        "settlement_summary": {
            "expected_volume": "1005.10",
            "expected_fees": "15.0765"
        },
        "transactions": [
            {"transaction_id": "TXN-001", "amount": "50.10"},
            {"transaction_id": "TXN-002", "amount": "50.10"},
            {"transaction_id": "TXN-003", "amount": "50.10"},
            {"transaction_id": "TXN-004", "amount": "50.10"},
            {"transaction_id": "TXN-005", "amount": "50.10"},
            {"transaction_id": "TXN-006", "amount": "50.10"},
            {"transaction_id": "TXN-007", "amount": "50.10"},
            {"transaction_id": "TXN-008", "amount": "50.10"},
            {"transaction_id": "TXN-009", "amount": "50.10"},
            {"transaction_id": "TXN-010", "amount": "50.10"},
            {"transaction_id": "TXN-011", "amount": "50.10"},
            {"transaction_id": "TXN-012", "amount": "50.10"},
            {"transaction_id": "TXN-013", "amount": "50.10"},
            {"transaction_id": "TXN-014", "amount": "50.10"},
            {"transaction_id": "TXN-015", "amount": "50.10"},
            {"transaction_id": "TXN-016", "amount": "50.10"},
            {"transaction_id": "TXN-017", "amount": "50.10"},
            {"transaction_id": "TXN-018", "amount": "50.10"},
            {"transaction_id": "TXN-019", "amount": "50.10"},
            {"transaction_id": "TXN-020", "amount": "53.20"}
        ]
    }
    
    reconciler = LedgerReconciler(json.dumps(mock_batch))
    reconciler.parse_and_accumulate()
    try:
        reconciler.verify_settlement()
    except ValueError as e:
        print(f"Execution Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_local_reconciliation_batch()