-- ───────────────────────────────────────────────────────────────────
-- Limpieza de pagos SENIAT registrados por el bot ANTES del fix de
-- detección 1er/2do pago y quincena (2026-05-23).
--
-- USO:
--   1. Inspeccionar primero qué se borrará:
--      wrangler d1 execute rpym-db --command="$(grep -A2 'SELECT' scripts/cleanup-bot-seniat-orphans.sql | head -3)"
--   2. Borrar (descomenta el DELETE de abajo):
--      wrangler d1 execute rpym-db --file=scripts/cleanup-bot-seniat-orphans.sql
--   3. Reenvía las fotos SENIAT al bot — quedarán correctamente clasificadas.
-- ───────────────────────────────────────────────────────────────────

-- 1) INSPECCIÓN — ver qué registros están huérfanos (no aparecen en el dashboard)
SELECT id, periodo, tipo_pago, concepto, quincena, monto, numero_planilla, created_at
FROM fiscal_pagos_seniat
WHERE notes LIKE '%bot Telegram%'
  AND (
    tipo_pago = 'otro'  -- mapping viejo de ISLR
    OR (
      concepto IN ('igtf', 'retencion_islr', 'retencion_iva')
      AND quincena IS NULL  -- los conceptos por quincena necesitan quincena no nula
    )
  )
ORDER BY created_at DESC;

-- 2) BORRADO — descomenta cuando hayas revisado el SELECT de arriba
-- DELETE FROM fiscal_pagos_seniat
-- WHERE notes LIKE '%bot Telegram%'
--   AND (
--     tipo_pago = 'otro'
--     OR (
--       concepto IN ('igtf', 'retencion_islr', 'retencion_iva')
--       AND quincena IS NULL
--     )
--   );
