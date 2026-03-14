-- Migration: Cost management system
-- Replaces Excel "Precios RPYM.xlsx" with DB-backed cost tracking

-- Global cost settings (tasas, IVA, comisiones)
CREATE TABLE IF NOT EXISTS cost_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bcv_rate REAL NOT NULL,
    parallel_rate REAL NOT NULL,
    iva_rate REAL NOT NULL DEFAULT 0.08,
    debit_commission REAL NOT NULL DEFAULT 0.008,
    credit_commission REAL NOT NULL DEFAULT 0.032,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_settings_created ON cost_settings(created_at);

-- Product costs (costo de compra por producto)
-- Linked to existing products table
CREATE TABLE IF NOT EXISTS product_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL UNIQUE,
    cost_usd REAL NOT NULL,
    purchase_rate_type TEXT NOT NULL CHECK(purchase_rate_type IN ('BCV', 'PARALELO')),
    supplier TEXT,
    notes TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_costs_product ON product_costs(product_id);

-- Purchase price history (auto-generated when cost changes)
CREATE TABLE IF NOT EXISTS purchase_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    old_cost_usd REAL,
    new_cost_usd REAL NOT NULL,
    old_rate_type TEXT,
    new_rate_type TEXT NOT NULL,
    bcv_rate_at_change REAL NOT NULL,
    parallel_rate_at_change REAL NOT NULL,
    old_real_usd REAL,
    new_real_usd REAL NOT NULL,
    variation_nominal REAL,
    variation_real REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON purchase_price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON purchase_price_history(created_at);

-- Bag prices
CREATE TABLE IF NOT EXISTS bag_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bag_type TEXT NOT NULL,
    price_per_thousand_usd REAL NOT NULL,
    price_per_unit_usd REAL NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
);
