-- Tabla para notas de la calculadora (globales, compartidas entre dispositivos)
CREATE TABLE IF NOT EXISTS calc_notes (
  id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

-- Fila inicial vacía
INSERT OR IGNORE INTO calc_notes (id, content) VALUES ('global', '');

-- Tabla para historial de sesiones de la calculadora
CREATE TABLE IF NOT EXISTS calc_sessions (
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_calc_sessions_created_at ON calc_sessions(created_at);
