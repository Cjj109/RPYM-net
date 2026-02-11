-- RPYM D1 Database Schema - Add hide_rate to presupuestos
-- Run with: wrangler d1 execute rpym-db --file=./migrations/0011_hide_rate.sql

-- Add hide_rate column to presupuestos
-- This differentiates between:
-- - hide_rate = 0/null: Normal mode, show BCV rate if totalBs > 0
-- - hide_rate = 1: BCV mode but hide rate in print (not the same as USD efectivo)
ALTER TABLE presupuestos ADD COLUMN hide_rate INTEGER DEFAULT 0;
