-- RPYM D1 Database Schema - Fiscal Module
-- Run with: wrangler d1 execute rpym-db --file=./migrations/0010_fiscal.sql

-- Proveedores (Suppliers with IVA retention info)
CREATE TABLE IF NOT EXISTS fiscal_proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rif TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    retencion_iva_pct INTEGER NOT NULL DEFAULT 75,  -- 75 or 100
    islr_pct REAL NOT NULL DEFAULT 1.0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Facturas de Compra (Purchase Invoices)
CREATE TABLE IF NOT EXISTS fiscal_facturas_compra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER NOT NULL,
    numero_factura TEXT NOT NULL,
    numero_control TEXT,
    fecha_factura TEXT NOT NULL,
    fecha_recepcion TEXT NOT NULL,
    subtotal_exento REAL NOT NULL DEFAULT 0,
    subtotal_gravable REAL NOT NULL DEFAULT 0,
    iva REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    retencion_iva REAL NOT NULL DEFAULT 0,
    anticipo_islr REAL NOT NULL DEFAULT 0,
    igtf REAL,
    payment_currency TEXT NOT NULL DEFAULT 'bs',
    exchange_rate REAL,
    image_key TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (proveedor_id) REFERENCES fiscal_proveedores(id)
);

-- Reportes Z (Daily Fiscal Closure Reports)
CREATE TABLE IF NOT EXISTS fiscal_reportes_z (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL UNIQUE,
    subtotal_exento REAL NOT NULL DEFAULT 0,
    subtotal_gravable REAL NOT NULL DEFAULT 0,
    iva_cobrado REAL NOT NULL DEFAULT 0,
    total_ventas REAL NOT NULL DEFAULT 0,
    numeracion_facturas TEXT,
    image_key TEXT,
    ocr_verified INTEGER NOT NULL DEFAULT 0,
    ocr_raw_data TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Comprobantes de Retencion IVA (IVA Retention Vouchers)
CREATE TABLE IF NOT EXISTS fiscal_retenciones_iva (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER NOT NULL,
    numero_comprobante TEXT NOT NULL,
    fecha_emision TEXT NOT NULL,
    periodo_fiscal TEXT NOT NULL,
    monto_retenido REAL NOT NULL,
    pdf_key TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (factura_id) REFERENCES fiscal_facturas_compra(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proveedores_rif ON fiscal_proveedores(rif);
CREATE INDEX IF NOT EXISTS idx_proveedores_nombre ON fiscal_proveedores(nombre);
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor ON fiscal_facturas_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha ON fiscal_facturas_compra(fecha_factura);
CREATE INDEX IF NOT EXISTS idx_reportes_z_fecha ON fiscal_reportes_z(fecha);
CREATE INDEX IF NOT EXISTS idx_retenciones_factura ON fiscal_retenciones_iva(factura_id);
CREATE INDEX IF NOT EXISTS idx_retenciones_periodo ON fiscal_retenciones_iva(periodo_fiscal);
