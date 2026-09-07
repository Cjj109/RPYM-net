-- Desde cuando se COBRA cada tasa, que no es su fecha valor.
--
-- El BCV publica el viernes por la tarde con fecha valor del LUNES (o del
-- martes, si el lunes es feriado). En el negocio esa tasa se cobra desde el
-- dia siguiente a que se publica, o sea el sabado: no se pasa el fin de
-- semana cobrando la tasa de la semana pasada cuando el BCV ya la movio.
--
-- Por eso hacen falta las dos fechas, no una:
--
--   date   fecha valor del BCV. La oficial. Es la que consulta
--          bcv-rate-history.ts para los reportes Z, y no cambia de
--          significado con esto.
--   desde  desde cuando la cobramos aqui, que es
--          min(fecha valor, dia siguiente al primer avistamiento).
--
-- El min() es la red de seguridad. Lo normal es que la veamos la misma tarde
-- en que sale y entonces manda "manana"; si el sitio estuvo caido y la vemos
-- dos dias tarde, manda la fecha valor y la tasa no se retrasa mas alla de lo
-- que dice el BCV. Nunca mas tarde que lo oficial.
--
-- Ejemplos, con el BCV publicando 830 el viernes 11:
--
--   fecha valor lunes 14, vista el viernes  -> desde sabado 12
--   fecha valor martes 15 (lunes feriado)   -> desde sabado 12
--   fecha valor martes 15, vista el lunes   -> desde martes 15
--
-- Las filas viejas se rellenan con su propia fecha: es lo unico que se sabe
-- de ellas, y deja el comportamiento de antes para todo lo ya guardado.
--
--   npx wrangler d1 execute rpym-db --remote --file=./migrations/0038_bcv_desde.sql

ALTER TABLE bcv_rates ADD COLUMN desde TEXT;

UPDATE bcv_rates SET desde = date WHERE desde IS NULL;

CREATE INDEX IF NOT EXISTS idx_bcv_rates_desde ON bcv_rates (desde);
