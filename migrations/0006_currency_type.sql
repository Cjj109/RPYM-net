-- Add currency_type, payment_method, and exchange_rate to customer_transactions
ALTER TABLE customer_transactions ADD COLUMN currency_type TEXT NOT NULL DEFAULT 'divisas';
ALTER TABLE customer_transactions ADD COLUMN payment_method TEXT;
ALTER TABLE customer_transactions ADD COLUMN exchange_rate REAL;

-- Index for balance queries grouped by currency_type
CREATE INDEX IF NOT EXISTS idx_transactions_currency_type ON customer_transactions(currency_type);
