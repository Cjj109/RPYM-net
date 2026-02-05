-- RPYM D1 Database Schema
-- Run with: wrangler d1 execute rpym-db --file=./migrations/0001_initial.sql

-- Presupuestos table
CREATE TABLE IF NOT EXISTS presupuestos (
    id TEXT PRIMARY KEY,
    fecha TEXT NOT NULL,
    items TEXT NOT NULL,  -- JSON array of PresupuestoItem
    total_usd REAL NOT NULL,
    total_bs REAL NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',  -- 'pendiente' | 'pagado'
    customer_name TEXT,
    customer_address TEXT,
    client_ip TEXT,
    source TEXT DEFAULT 'cliente',  -- 'admin' | 'cliente'
    fecha_pago TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Site configuration table (key-value store)
CREATE TABLE IF NOT EXISTS site_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default config values
INSERT OR IGNORE INTO site_config (key, value) VALUES
    ('theme', 'ocean'),
    ('bcv_rate', '70.00'),
    ('bcv_rate_manual', 'false'),
    ('bcv_rate_updated_at', datetime('now'));

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha ON presupuestos(fecha);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado ON presupuestos(estado);
CREATE INDEX IF NOT EXISTS idx_presupuestos_created ON presupuestos(created_at);
