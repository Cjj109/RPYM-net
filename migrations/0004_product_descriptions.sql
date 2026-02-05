-- Agregar columnas para descripciones editables
-- descripcion_corta: Para la lista de precios (1-2 oraciones)
-- descripcion_home: Ultra-corta para cards en home (5-7 palabras)

ALTER TABLE products ADD COLUMN descripcion_corta TEXT;
ALTER TABLE products ADD COLUMN descripcion_home TEXT;
