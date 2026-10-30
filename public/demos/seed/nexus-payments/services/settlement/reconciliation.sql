-- reconciliation.sql
-- Captured card transactions for one business date, each with the fee terms
-- of its card scheme. Read and run by settlement_reconciler.py.
--
-- Parameter: :business_date, the settlement cycle's date as YYYY-MM-DD.
-- Amounts and fixed fees are pounds held as TEXT ('1234.56'); fee rates are
-- TEXT fractions ('0.0145' is 1.45%).
SELECT
    t.id         AS transaction_id,
    t.scheme     AS scheme,
    t.amount     AS amount,
    f.rate       AS fee_rate,
    f.fixed_fee  AS fixed_fee
FROM card_transactions AS t
JOIN scheme_fee_schedule AS f
    ON f.scheme = t.scheme
WHERE t.business_date = :business_date
  AND t.status = 'CAPTURED'
ORDER BY t.scheme, t.id;
