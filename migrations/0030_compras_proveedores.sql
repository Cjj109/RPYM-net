-- Modelo padre-hijo: Compras (purchases) con Abonos (payments)
-- Cada compra agrupa uno o más abonos de distintas cuentas/métodos

-- Tabla padre: Compras a proveedores
CREATE TABLE IF NOT EXISTS compras_proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER NOT NULL,
    producto TEXT NOT NULL,
    monto_total REAL NOT NULL,
    fecha TEXT NOT NULL,
    tiene_factura INTEGER NOT NULL DEFAULT 0,
    nota_entrega_key TEXT,
    notas TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (proveedor_id) REFERENCES proveedores_informales(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_compras_proveedores_proveedor ON compras_proveedores(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_compras_proveedores_fecha ON compras_proveedores(fecha);

-- Tabla hija: Abonos (pagos parciales) contra una compra
CREATE TABLE IF NOT EXISTS abonos_proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER NOT NULL,
    monto_usd REAL NOT NULL,
    monto_bs REAL,
    tasa_cambio REAL,
    tasa_paralela REAL,
    fecha TEXT NOT NULL,
    metodo_pago TEXT NOT NULL DEFAULT 'pago_movil',
    cuenta TEXT NOT NULL DEFAULT 'pa',
    imagen_key TEXT,
    notas TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (compra_id) REFERENCES compras_proveedores(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_abonos_proveedores_compra ON abonos_proveedores(compra_id);
CREATE INDEX IF NOT EXISTS idx_abonos_proveedores_fecha ON abonos_proveedores(fecha);
CREATE INDEX IF NOT EXISTS idx_abonos_proveedores_cuenta ON abonos_proveedores(cuenta);
