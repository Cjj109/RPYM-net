-- Permite productos que solo existen para seguimiento de costos (no aparecen en la página pública)
ALTER TABLE products ADD COLUMN solo_costos INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_solo_costos ON products(solo_costos);
