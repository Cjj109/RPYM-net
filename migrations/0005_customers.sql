-- RPYM D1 Database Schema - Customer Accounts & Ledger
-- Run with: wrangler d1 execute rpym-db --file=./migrations/0005_customers.sql

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    notes TEXT,
    rate_type TEXT NOT NULL DEFAULT 'dolar_bcv',
    custom_rate REAL,
    share_token TEXT UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Customer transactions (ledger entries)
CREATE TABLE IF NOT EXISTS customer_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_usd REAL NOT NULL DEFAULT 0,
    amount_bs REAL NOT NULL DEFAULT 0,
    presupuesto_id TEXT,
    invoice_image_key TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_share_token ON customers(share_token);
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON customer_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON customer_transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_presupuesto ON customer_transactions(presupuesto_id);
