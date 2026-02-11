-- Rate limiting para WhatsApp AI assistant
-- Limita mensajes por usuario por día para no agotar el tier gratuito

CREATE TABLE IF NOT EXISTS whatsapp_rate_limit (
    phone TEXT PRIMARY KEY,
    message_count INTEGER DEFAULT 0,
    last_reset TEXT DEFAULT (date('now')),
    created_at TEXT DEFAULT (datetime('now'))
);

-- Índice para limpieza periódica
CREATE INDEX IF NOT EXISTS idx_whatsapp_rate_limit_reset ON whatsapp_rate_limit(last_reset);
