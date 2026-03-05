-- Proveedores informales (sin RIF, sin retenciones — solo para registro de pagos sin factura)
CREATE TABLE IF NOT EXISTS proveedores_informales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    notas TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Pagos a proveedores informales
CREATE TABLE IF NOT EXISTS pagos_proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER NOT NULL,
    monto_usd REAL NOT NULL,
    producto TEXT NOT NULL,
    fecha TEXT NOT NULL,
    metodo_pago TEXT NOT NULL DEFAULT 'pago_movil',
    cuenta TEXT NOT NULL DEFAULT 'pa',
    imagen_key TEXT,
    notas TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (proveedor_id) REFERENCES proveedores_informales(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proveedores_informales_nombre ON proveedores_informales(nombre);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_proveedor ON pagos_proveedores(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_fecha ON pagos_proveedores(fecha);
