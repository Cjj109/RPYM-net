-- La tasa del BCV, guardada bajo la fecha desde la que RIGE.
--
-- No hay tabla nueva: bcv_rates ya era esto, una tasa por fecha, la que usan
-- los reportes Z para convertir con la tasa del dia. Lo que estaba mal era la
-- clave. Se escribia con `new Date().toISOString()` —el dia en que se leyo, y
-- encima en UTC— cuando el BCV publica por la tarde la tasa del dia
-- SIGUIENTE. Cada fila acababa guardando la tasa que empezaba a regir manana.
--
-- Se corrige el dia de hoy, que es el unico que se puede afirmar sin dudar
-- porque se comprobo contra bcv.org.ve en el momento:
--
--   fecha valor 07/09/2026 -> 813,7361  (lo que rige hoy)
--   fecha valor 08/09/2026 -> 814,6908  (publicado el 7 por la tarde)
--
-- Y la fila del 07/09 tenia 814,69, que es la de manana. Cualquier reporte Z
-- del 7 de septiembre convertido antes de esto uso una tasa un dia adelantada.
--
-- LO ANTERIOR AL 07/09 NO SE TOCA
--
-- Es tentador correr todas las filas un dia, pero seria inventar. La fecha
-- valor no se guardaba, asi que no esta; y el BCV no la mueve siempre un dia:
-- lo que publica el viernes por la tarde rige el LUNES, no el sabado. Con lo
-- que hay en la tabla no se puede distinguir un caso del otro. Reconstruir esa
-- serie hay que hacerlo con el historico oficial del BCV, no a ojo.
--
--   npx wrangler d1 execute rpym-db --remote --file=./migrations/0037_bcv_vigencia.sql

UPDATE bcv_rates SET usd_rate = 813.74 WHERE date = '2026-09-07';

INSERT INTO bcv_rates (date, usd_rate) VALUES ('2026-09-08', 814.69)
  ON CONFLICT(date) DO UPDATE SET usd_rate = excluded.usd_rate;
