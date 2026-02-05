-- Store daily BCV rates for historical lookups
CREATE TABLE IF NOT EXISTS bcv_rates (
    date TEXT PRIMARY KEY,          -- YYYY-MM-DD
    usd_rate REAL NOT NULL,         -- Bs per USD
    eur_rate REAL,                  -- Bs per EUR (if available)
    created_at TEXT DEFAULT (datetime('now'))
);
