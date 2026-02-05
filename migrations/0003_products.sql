-- Migration: Create products table
-- Migrates product catalog from Google Sheets to D1

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    categoria TEXT NOT NULL,
    precio_usd REAL NOT NULL,
    unidad TEXT NOT NULL DEFAULT 'kg',
    disponible INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_products_categoria ON products(categoria);

-- Index for availability filtering
CREATE INDEX IF NOT EXISTS idx_products_disponible ON products(disponible);

-- Index for sorting
CREATE INDEX IF NOT EXISTS idx_products_sort ON products(sort_order);
