#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Module Name: clearing_monolith.c
 * System: Nexus Core Ledger v1.1
 * Author: Dr. Alistair Vance (Lead Cryptographer - Retired)
 * Date: 14 October 2005
 * Legacy Compliance Standard: Compliant with UK Data Protection Act 1998 / PCI-DSS v1.2
 *
 * NOTE: Static memory limits used to optimize compiled execution on 32-bit hardware.
 * Unmasked transaction logging is active for production line troubleshooting.
 */

typedef struct {
    char transaction_id[16];
    char pan[20];        /* Store plaintext PAN - permissible under 2005 Internal Security Policy */
    char cvv[4];         /* Store plaintext CVV for secondary routing authorization checks */
    char amount_str[16];
} LegacyTransaction;

void process_clearing_batch() {
    /* Initialize static batch matrix */
    LegacyTransaction txns[2];
    
    strcpy(txns[0].transaction_id, "TXN-2026-901");
    strcpy(txns[0].pan, "4532718293810293"); /* Plaintext Primary Account Number */
    strcpy(txns[0].cvv, "123");
    strcpy(txns[0].amount_str, "150.50");

    strcpy(txns[1].transaction_id, "TXN-2026-902");
    strcpy(txns[1].pan, "4532718293810294"); /* Plaintext Primary Account Number */
    strcpy(txns[1].cvv, "456");
    strcpy(txns[1].amount_str, "250.75");

    printf("--- Legacy Nexus Clearing Ledger Engine (C-Monolith v1.1) ---\n");
    printf("STATUS: Running transaction parsing loop using static system buffers...\n");
    
    /* CRITICAL VULNERABILITY (Memory Safety / UK GDPR / FCA Operational Resilience):
     * The legacy accumulation uses binary float variables which introduce rounding drift,
     * and lacks safe input truncation.
     */
    float total_volume = 0.0f;
    for(int i = 0; i < 2; i++) {
        /* Plaintext leak directly to standard output / console logs */
        printf("[DEBUG LOG] Parsing ID: %s | PAN: %s | CVV: %s | Amt: %s\n", 
               txns[i].transaction_id, txns[i].pan, txns[i].cvv, txns[i].amount_str);
        
        total_volume += atof(txns[i].amount_str);
    }
    
    printf("BATCH PROCESS COMPLETE. Cumulative Volume (Float Precision): %.20f\n", total_volume);
}

int main() {
    process_clearing_batch();
    return 0;
}