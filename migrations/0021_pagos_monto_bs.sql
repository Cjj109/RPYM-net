-- Campos opcionales para registrar pagos en Bs con tasa de cambio
ALTER TABLE pagos_proveedores ADD COLUMN monto_bs REAL;
ALTER TABLE pagos_proveedores ADD COLUMN tasa_cambio REAL;
