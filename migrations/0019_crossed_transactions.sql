-- Migration: Add is_crossed column for visual strike-through (independent of is_paid)
-- is_crossed is purely visual - does NOT affect balance calculations
ALTER TABLE customer_transactions ADD COLUMN is_crossed INTEGER NOT NULL DEFAULT 0;
