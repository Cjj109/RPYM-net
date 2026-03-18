-- Agregar modo de precio a compras: BCV, Paralelo, Bs, Efectivo USD
ALTER TABLE compras_proveedores ADD COLUMN modo_precio TEXT NOT NULL DEFAULT 'bcv';

-- Campos para compras en bolívares (modo = 'bs')
ALTER TABLE compras_proveedores ADD COLUMN monto_total_bs REAL;
ALTER TABLE compras_proveedores ADD COLUMN tasa_referencia REAL;
