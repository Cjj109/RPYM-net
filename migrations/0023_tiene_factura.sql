-- Agregar campo tiene_factura a pagos_proveedores (0 = sin factura, 1 = con factura)
ALTER TABLE pagos_proveedores ADD COLUMN tiene_factura INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_factura ON pagos_proveedores(tiene_factura);
