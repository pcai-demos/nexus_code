-- Settlement reconciliation fixture: business date 2026-04-18.
--
-- Loaded into an in-memory SQLite database by test_settlement_reconciler.py.
-- Money is held as TEXT decimal strings in pounds and fee rates as TEXT
-- fractions ('0.0145' is 1.45%). The fee schedule holds illustrative test
-- values, not any card scheme's published pricing.

CREATE TABLE scheme_fee_schedule (
    scheme     TEXT PRIMARY KEY,
    rate       TEXT NOT NULL,
    fixed_fee  TEXT NOT NULL
);

CREATE TABLE card_transactions (
    id             TEXT PRIMARY KEY,
    business_date  TEXT NOT NULL,
    scheme         TEXT NOT NULL,
    amount         TEXT NOT NULL,
    status         TEXT NOT NULL
);

CREATE TABLE scheme_settlements (
    business_date  TEXT NOT NULL,
    scheme         TEXT NOT NULL,
    gross          TEXT NOT NULL,
    fees           TEXT NOT NULL,
    net            TEXT NOT NULL,
    PRIMARY KEY (business_date, scheme)
);

INSERT INTO scheme_fee_schedule (scheme, rate, fixed_fee) VALUES
    ('VISA',       '0.0145', '0.05'),
    ('MASTERCARD', '0.0155', '0.05'),
    ('AMEX',       '0.0275', '0.10');

-- Business date 2026-04-18. Only CAPTURED transactions settle; the declined
-- and reversed ones stay in the table, as they do in production.
INSERT INTO card_transactions (id, business_date, scheme, amount, status) VALUES
    ('TXN-20260418-0001', '2026-04-18', 'MASTERCARD', '45.00',    'REVERSED'),
    ('TXN-20260418-0002', '2026-04-18', 'MASTERCARD', '160.00',   'CAPTURED'),
    ('TXN-20260418-0003', '2026-04-18', 'AMEX',       '9.60',     'CAPTURED'),
    ('TXN-20260418-0004', '2026-04-18', 'VISA',       '62.40',    'CAPTURED'),
    ('TXN-20260418-0005', '2026-04-18', 'VISA',       '4.99',     'CAPTURED'),
    ('TXN-20260418-0006', '2026-04-18', 'MASTERCARD', '14.20',    'CAPTURED'),
    ('TXN-20260418-0007', '2026-04-18', 'VISA',       '250.00',   'CAPTURED'),
    ('TXN-20260418-0008', '2026-04-18', 'VISA',       '129.00',   'REVERSED'),
    ('TXN-20260418-0009', '2026-04-18', 'AMEX',       '57.25',    'CAPTURED'),
    ('TXN-20260418-0010', '2026-04-18', 'MASTERCARD', '612.30',   'CAPTURED'),
    ('TXN-20260418-0011', '2026-04-18', 'AMEX',       '1375.00',  'CAPTURED'),
    ('TXN-20260418-0012', '2026-04-18', 'VISA',       '162.30',   'CAPTURED'),
    ('TXN-20260418-0013', '2026-04-18', 'VISA',       '118.75',   'CAPTURED'),
    ('TXN-20260418-0014', '2026-04-18', 'AMEX',       '154.25',   'CAPTURED'),
    ('TXN-20260418-0015', '2026-04-18', 'MASTERCARD', '109.99',   'CAPTURED'),
    ('TXN-20260418-0016', '2026-04-18', 'VISA',       '33.80',    'CAPTURED'),
    ('TXN-20260418-0017', '2026-04-18', 'VISA',       '26.45',    'CAPTURED'),
    ('TXN-20260418-0018', '2026-04-18', 'VISA',       '64.99',    'DECLINED'),
    ('TXN-20260418-0019', '2026-04-18', 'MASTERCARD', '92.35',    'CAPTURED'),
    ('TXN-20260418-0020', '2026-04-18', 'MASTERCARD', '899.00',   'CAPTURED'),
    ('TXN-20260418-0021', '2026-04-18', 'MASTERCARD', '22.75',    'CAPTURED'),
    ('TXN-20260418-0022', '2026-04-18', 'AMEX',       '329.95',   'CAPTURED'),
    ('TXN-20260418-0023', '2026-04-18', 'MASTERCARD', '178.90',   'CAPTURED'),
    ('TXN-20260418-0024', '2026-04-18', 'VISA',       '46.25',    'CAPTURED'),
    ('TXN-20260418-0025', '2026-04-18', 'VISA',       '12.50',    'CAPTURED'),
    ('TXN-20260418-0026', '2026-04-18', 'MASTERCARD', '3.95',     'CAPTURED'),
    ('TXN-20260418-0027', '2026-04-18', 'MASTERCARD', '315.60',   'CAPTURED'),
    ('TXN-20260418-0028', '2026-04-18', 'MASTERCARD', '236.85',   'CAPTURED'),
    ('TXN-20260418-0029', '2026-04-18', 'MASTERCARD', '79.00',    'CAPTURED'),
    ('TXN-20260418-0030', '2026-04-18', 'AMEX',       '95.75',    'CAPTURED'),
    ('TXN-20260418-0031', '2026-04-18', 'AMEX',       '515.80',   'CAPTURED'),
    ('TXN-20260418-0032', '2026-04-18', 'VISA',       '215.40',   'CAPTURED'),
    ('TXN-20260418-0033', '2026-04-18', 'VISA',       '35.99',    'CAPTURED'),
    ('TXN-20260418-0034', '2026-04-18', 'MASTERCARD', '23.99',    'CAPTURED'),
    ('TXN-20260418-0035', '2026-04-18', 'AMEX',       '264.00',   'CAPTURED'),
    ('TXN-20260418-0036', '2026-04-18', 'VISA',       '489.00',   'CAPTURED'),
    ('TXN-20260418-0037', '2026-04-18', 'VISA',       '1234.56',  'CAPTURED'),
    ('TXN-20260418-0038', '2026-04-18', 'VISA',       '73.80',    'CAPTURED'),
    ('TXN-20260418-0039', '2026-04-18', 'MASTERCARD', '84.60',    'CAPTURED'),
    ('TXN-20260418-0040', '2026-04-18', 'MASTERCARD', '31.20',    'CAPTURED'),
    ('TXN-20260418-0041', '2026-04-18', 'VISA',       '2500.00',  'CAPTURED'),
    ('TXN-20260418-0042', '2026-04-18', 'AMEX',       '420.00',   'DECLINED'),
    ('TXN-20260418-0043', '2026-04-18', 'AMEX',       '44.80',    'CAPTURED'),
    ('TXN-20260418-0044', '2026-04-18', 'VISA',       '37.85',    'CAPTURED'),
    ('TXN-20260418-0045', '2026-04-18', 'MASTERCARD', '54.30',    'CAPTURED'),
    ('TXN-20260418-0046', '2026-04-18', 'VISA',       '2.40',     'CAPTURED'),
    ('TXN-20260418-0047', '2026-04-18', 'AMEX',       '2045.90',  'CAPTURED'),
    ('TXN-20260418-0048', '2026-04-18', 'AMEX',       '735.00',   'CAPTURED'),
    ('TXN-20260418-0049', '2026-04-18', 'VISA',       '6.30',     'CAPTURED'),
    ('TXN-20260418-0050', '2026-04-18', 'VISA',       '97.50',    'CAPTURED'),
    ('TXN-20260418-0051', '2026-04-18', 'AMEX',       '17.85',    'CAPTURED'),
    ('TXN-20260418-0052', '2026-04-18', 'VISA',       '20.00',    'CAPTURED'),
    ('TXN-20260418-0053', '2026-04-18', 'MASTERCARD', '58.99',    'CAPTURED');

-- Late and early items on the neighbouring business dates.
INSERT INTO card_transactions (id, business_date, scheme, amount, status) VALUES
    ('TXN-20260417-0051', '2026-04-17', 'VISA',       '18.40',    'CAPTURED'),
    ('TXN-20260417-0052', '2026-04-17', 'AMEX',       '310.00',   'CAPTURED'),
    ('TXN-20260417-0053', '2026-04-17', 'MASTERCARD', '7.99',     'CAPTURED'),
    ('TXN-20260419-0001', '2026-04-19', 'MASTERCARD', '62.15',    'CAPTURED'),
    ('TXN-20260419-0002', '2026-04-19', 'VISA',       '24.60',    'CAPTURED');

-- Totals each scheme reported in its settlement file for 2026-04-18.
INSERT INTO scheme_settlements (business_date, scheme, gross, fees, net) VALUES
    ('2026-04-18', 'VISA',       '5430.24',  '79.71',  '5350.53'),
    ('2026-04-18', 'MASTERCARD', '2977.97',  '46.97',  '2931.00'),
    ('2026-04-18', 'AMEX',       '5645.15',  '156.41', '5488.74');
