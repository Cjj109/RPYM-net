-- Historial de conversación para Telegram bot
-- Permite que el bot recuerde contexto entre mensajes

CREATE TABLE IF NOT EXISTS telegram_chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL, -- 'user' o 'assistant'
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Índice para búsqueda rápida por chat_id
CREATE INDEX IF NOT EXISTS idx_telegram_history_chat ON telegram_chat_history(chat_id, created_at DESC);

-- Limpiar mensajes viejos (más de 24 horas) automáticamente no es posible en SQLite,
-- pero lo haremos desde el código
