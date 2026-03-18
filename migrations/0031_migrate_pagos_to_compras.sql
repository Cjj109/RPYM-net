-- Migrar datos existentes de pagos_proveedores al nuevo modelo compra/abonos
-- Cada pago existente se convierte en una compra con un único abono por el total

-- 1. Crear compras a partir de pagos existentes
INSERT INTO compras_proveedores (id, proveedor_id, producto, monto_total, fecha, tiene_factura, notas, is_active, created_at, updated_at)
SELECT id, proveedor_id, producto, monto_usd, fecha, tiene_factura, notas, is_active, created_at, updated_at
FROM pagos_proveedores;

-- 2. Crear abonos correspondientes (uno por cada pago, cubriendo el monto total)
INSERT INTO abonos_proveedores (compra_id, monto_usd, monto_bs, tasa_cambio, tasa_paralela, fecha, metodo_pago, cuenta, imagen_key, notas, is_active, created_at, updated_at)
SELECT id, monto_usd, monto_bs, tasa_cambio, tasa_paralela, fecha, metodo_pago, cuenta, imagen_key, NULL, is_active, created_at, updated_at
FROM pagos_proveedores;
