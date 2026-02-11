-- Historial de conversación para WhatsApp bot
-- Permite que el bot recuerde contexto entre mensajes de cada cliente

CREATE TABLE IF NOT EXISTS whatsapp_chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,  -- Número de WhatsApp del cliente
    role TEXT NOT NULL,   -- 'user' o 'assistant'
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Índice para búsqueda rápida por teléfono
CREATE INDEX IF NOT EXISTS idx_whatsapp_history_phone ON whatsapp_chat_history(phone, created_at DESC);
