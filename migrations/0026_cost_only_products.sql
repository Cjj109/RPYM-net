-- Permite productos que solo existen para seguimiento de costos (no aparecen en la página pública)
ALTER TABLE products ADD COLUMN cost_only INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_cost_only ON products(cost_only);
