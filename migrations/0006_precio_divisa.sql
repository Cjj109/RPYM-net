-- Migration: Add precio_usd_divisa column to products table
-- Allows setting a different USD price for cash dollar payments (diferencial cambiario)
-- NULL = use same price as precio_usd (BCV price)

ALTER TABLE products ADD COLUMN precio_usd_divisa REAL;
