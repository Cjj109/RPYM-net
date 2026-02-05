-- Add dual amount field for transactions from dual presupuestos
ALTER TABLE customer_transactions ADD COLUMN amount_usd_divisa REAL;
