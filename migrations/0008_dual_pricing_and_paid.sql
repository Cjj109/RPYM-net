-- Migration: Dual presupuesto pricing + Customer transaction paid marking
-- 1. Add total_usd_divisa to presupuestos for dual-mode (BCV + Divisa) quotes
-- 2. Add is_paid, paid_method, paid_date to customer_transactions for marking purchases as paid

-- Dual presupuesto
ALTER TABLE presupuestos ADD COLUMN total_usd_divisa REAL;

-- Customer pagado marking
ALTER TABLE customer_transactions ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_transactions ADD COLUMN paid_method TEXT;
ALTER TABLE customer_transactions ADD COLUMN paid_date TEXT;

-- Index for balance queries that exclude paid purchases
CREATE INDEX IF NOT EXISTS idx_transactions_is_paid ON customer_transactions(is_paid);
