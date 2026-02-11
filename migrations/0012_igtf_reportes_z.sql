-- Add IGTF fields to fiscal_reportes_z table
-- BI IGTF = Base imponible del IGTF (ventas cobradas en divisas)
-- IGTF Ventas = Monto del IGTF cobrado (3% de la BI IGTF)

ALTER TABLE fiscal_reportes_z ADD COLUMN base_imponible_igtf REAL DEFAULT 0;
ALTER TABLE fiscal_reportes_z ADD COLUMN igtf_ventas REAL DEFAULT 0;
