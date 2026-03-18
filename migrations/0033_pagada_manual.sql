-- Flag para marcar compras como pagadas manualmente
-- cuando el monto abonado no coincide exactamente con el total
ALTER TABLE compras_proveedores ADD COLUMN pagada_manual INTEGER NOT NULL DEFAULT 0;
