-- Agrega concepto específico de obligación y quincena a pagos SENIAT
-- concepto: 'retencion_iva' | 'retencion_islr' | 'igtf' | 'iva_neto' | 'sumat'
-- quincena: 1 (1-15) | 2 (16-31) | NULL (mensual)
ALTER TABLE fiscal_pagos_seniat ADD COLUMN concepto TEXT DEFAULT NULL;
ALTER TABLE fiscal_pagos_seniat ADD COLUMN quincena INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_pagos_seniat_concepto ON fiscal_pagos_seniat(concepto);
