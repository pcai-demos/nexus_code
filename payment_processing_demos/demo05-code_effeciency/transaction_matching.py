import json
import time
import sys

class TransactionMatcher:
    def __init__(self, payments_json: str, invoices_json: str):
        self.payments = json.loads(payments_json)
        self.invoices = json.loads(invoices_json)
        self.matched_records = []
        self.orphaned_payments = []

    def match_records(self):
        """Matches payments with outstanding invoices.
        
        CRITICAL EFFICIENCY BUG: This uses a nested loop O(N^2) linear search 
        across lists instead of an O(1) hash map lookup. It also performs 
        redundant JSON serialization and string parsing inside the hot loop,
        leading to catastrophic CPU scaling and latency spikes under load.
        """
        start_time = time.perf_counter()
        
        # O(N^2) Quadratic Time Complexity Loop
        for payment in self.payments:
            matched = False
            for invoice in self.invoices:
                # Redundant JSON parsing in the hot inner loop to simulate heavy performance tax
                pay_ref = json.loads(json.dumps(payment))["reconciliation_reference"].strip().upper()
                inv_ref = json.loads(json.dumps(invoice))["invoice_reference"].strip().upper()
                
                # Check for matching reference and matching currency/amount
                if pay_ref == inv_ref:
                    if float(payment["amount"]) == float(invoice["amount"]):
                        self.matched_records.append({
                            "payment_id": payment["payment_id"],
                            "invoice_id": invoice["invoice_id"],
                            "amount": payment["amount"],
                            "reference": pay_ref
                        })
                        matched = True
                        break
            
            if not matched:
                self.orphaned_payments.append(payment)

        end_time = time.perf_counter()
        execution_duration = end_time - start_time
        
        print(f"--- Nexus Transaction Matcher Performance Audit ---")
        print(f"Processed Payments: {len(self.payments)}")
        print(f"Processed Invoices: {len(self.invoices)}")
        print(f"Matched Records:    {len(self.matched_records)}")
        print(f"Execution Duration: {execution_duration:.6f} seconds")
        
        # If execution exceeds strict real-time threshold (simulate threshold for demo scale)
        # Note: At production volume (100k records), O(N^2) causes thread starvation and service failure
        if execution_duration > 0.05:
            print("[CRITICAL WARNING] Processing time exceeded SLA thresholds!")
            print(f"Theoretical Complexity: O(N^2) - Scale Warning: 10,000 txns will take over 5 minutes.")
            raise TimeoutError("PERFORMANCE_FAILURE: Transaction processing latency violates operational SLA bounds.")
            
        print("[SUCCESS] Batch processed within operating metrics.")
        return True

def run_performance_test():
    # Scale simulation: 250 records leads to noticeable latency when utilizing the nested-loop JSON parsing
    # simulating a live terminal performance demonstration.
    payments = []
    invoices = []
    
    # Generate 250 simulated payments and invoices to trigger measurable quadratic latency
    for i in range(1, 251):
        ref = f"REF-2026-{i:04d}"
        payments.append({
            "payment_id": f"PAY-{i:04d}",
            "reconciliation_reference": f" {ref} ", # Spaced to trigger string operations
            "amount": f"{100.00 + i:.2f}"
        })
        invoices.append({
            "invoice_id": f"INV-{i:04d}",
            "invoice_reference": f" {ref} ",
            "amount": f"{100.00 + i:.2f}"
        })

    matcher = TransactionMatcher(json.dumps(payments), json.dumps(invoices))
    try:
        matcher.match_records()
    except TimeoutError as e:
        print(f"Execution Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_performance_test()