-- Tracking de pagos SENIAT (retenciones, IVA, IGTF, SUMAT)
CREATE TABLE fiscal_pagos_seniat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo TEXT NOT NULL,           -- YYYY-MM
  tipo_pago TEXT NOT NULL,         -- 'pago1' | 'pago2' | 'sumat'
  fecha_pago TEXT NOT NULL,        -- YYYY-MM-DD
  monto REAL NOT NULL,
  numero_planilla TEXT,
  referencia_bancaria TEXT,
  banco TEXT,
  image_key TEXT,                  -- R2 key del comprobante
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_fiscal_pagos_seniat_periodo ON fiscal_pagos_seniat(periodo);
CREATE INDEX idx_fiscal_pagos_seniat_tipo ON fiscal_pagos_seniat(tipo_pago);
