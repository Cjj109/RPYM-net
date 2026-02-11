-- Confirmación pendiente para acciones destructivas del bot Telegram
-- Run with: wrangler d1 execute rpym-db --file=./migrations/0018_telegram_pending_confirmations.sql
-- Permite pedir "¿Confirmas?" antes de ejecutar eliminar, revocar, etc.

CREATE TABLE IF NOT EXISTS telegram_pending_confirmations (
    chat_id INTEGER PRIMARY KEY,
    intent TEXT NOT NULL,
    params TEXT NOT NULL,
    chat_history_context TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Limpiar confirmaciones viejas (> 5 min) desde el código
CREATE INDEX IF NOT EXISTS idx_pending_confirm_created ON telegram_pending_confirmations(created_at);
