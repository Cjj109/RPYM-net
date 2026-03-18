-- Permite sobreescribir la tasa BCV usada para calcular USD en un reporte Z
ALTER TABLE fiscal_reportes_z ADD COLUMN bcv_rate_override REAL DEFAULT NULL;
