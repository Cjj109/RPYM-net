-- Configuración del bot de WhatsApp
-- Permite guardar estados persistentes como override de horario

CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT,  -- NULL = no expira, fecha ISO = expira en esa fecha
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Valores iniciales
INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('negocio_abierto_override', 'null');
-- 'null' = usar regla automática (lunes cerrado, otros días abierto)
-- 'true' = forzar abierto
-- 'false' = forzar cerrado

INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('mensaje_cierre', '');
