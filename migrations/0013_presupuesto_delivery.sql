-- Add delivery and modo_precio columns to presupuestos table
ALTER TABLE presupuestos ADD COLUMN delivery REAL DEFAULT 0;
ALTER TABLE presupuestos ADD COLUMN modo_precio TEXT DEFAULT 'bcv';
