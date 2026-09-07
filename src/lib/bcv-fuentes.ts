/**
 * Fuentes de la tasa BCV: registro, lectura y preferencia guardada.
 *
 * Existe porque las fuentes se caen y se retrasan sin avisar. En septiembre
 * de 2026 se cayeron dos APIs, desapareció una tercera y la que quedaba
 * publicaba la tasa un día tarde, y el sitio estuvo cobrando con la tasa
 * vieja sin que nadie lo notara. Aquí se pueden ver todas a la vez y elegir
 * cuál manda.
 */
import type { D1Database } from './d1-types';
import { fetchTasaBCVOficial, intentarPuente, type TasaBCV } from './bcv-oficial';
import { hoyEnCaracas, dmyAIso } from './format';

export type FuenteBCV = 'oficial' | 'puente' | 'cotizave' | 'dolarapi';

// El puente va detras de la oficial: leen la MISMA pagina, asi que dan el
// mismo numero. Se lista aparte para poder ver si esta vivo, que es justo
// para lo que existe este panel.
export const TODAS_LAS_FUENTES: FuenteBCV[] = ['oficial', 'puente', 'cotizave', 'dolarapi'];

export const FUENTE_META: Record<FuenteBCV, { label: string; detalle: string; requiereClave: boolean }> = {
  oficial: {
    label: 'BCV (página oficial)',
    detalle: 'Publica la tasa nueva el mismo día, apenas el BCV la cuelga.',
    requiereClave: false,
  },
  puente: {
    label: 'BCV (via puente propio)',
    detalle: 'La misma pagina del BCV, leida desde Vercel. Mismo numero, otro camino: sirve cuando el directo no valida el certificado.',
    requiereClave: false,
  },
  cotizave: {
    label: 'Cotizave',
    detalle: 'API con clave. Publica la tasa el día en que entra en vigor.',
    requiereClave: true,
  },
  dolarapi: {
    label: 'DolarAPI',
    detalle: 'Sin clave. Publica la tasa el día en que entra en vigor.',
    requiereClave: false,
  },
};

export function esFuenteBCV(valor: unknown): valor is FuenteBCV {
  return typeof valor === 'string' && (TODAS_LAS_FUENTES as string[]).includes(valor);
}

const TIMEOUT_MS = 8000;

async function fetchConTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function leerCotizave(clave?: string): Promise<TasaBCV | null> {
  if (!clave) return null;
  try {
    const respuesta = await fetchConTimeout('https://api.cotizave.com/v1/fx/rates', {
      headers: { 'X-API-Key': clave, Accept: 'application/json' },
    });
    if (!respuesta.ok) return null;

    const datos = await respuesta.json() as { rates?: Array<{ market: string; mid: number; updated_at: string }> };
    // El BCV viene como el mercado "reference"; "parallel" es otra cosa
    const bcv = datos.rates?.find((r) => r.market === 'reference');
    if (!bcv?.mid || bcv.mid <= 0) return null;

    return {
      rate: Math.round(bcv.mid * 100) / 100,
      date: new Date(bcv.updated_at).toLocaleDateString('es-VE', { timeZone: 'America/Caracas' }),
      source: 'BCV',
    };
  } catch (error) {
    console.error('[BCV] Error con cotizave:', error);
    return null;
  }
}

async function leerDolarApi(): Promise<TasaBCV | null> {
  try {
    const respuesta = await fetchConTimeout('https://ve.dolarapi.com/v1/dolares/oficial', {
      headers: { Accept: 'application/json' },
    });
    if (!respuesta.ok) return null;

    const datos = await respuesta.json() as { promedio?: number; fechaActualizacion?: string };
    if (!datos.promedio || datos.promedio <= 0) return null;

    return {
      rate: Math.round(datos.promedio * 100) / 100,
      date: datos.fechaActualizacion
        ? new Date(datos.fechaActualizacion).toLocaleDateString('es-VE', { timeZone: 'America/Caracas' })
        : new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas' }),
      source: 'BCV',
    };
  } catch (error) {
    console.error('[BCV] Error con dolarapi:', error);
    return null;
  }
}

/** Lee una fuente concreta. Devuelve null si falla o no da un valor usable. */
export async function leerFuente(
  fuente: FuenteBCV,
  claveCotizave?: string,
  claveJina?: string
): Promise<TasaBCV | null> {
  switch (fuente) {
    case 'oficial': return fetchTasaBCVOficial(claveJina);
    case 'puente': return intentarPuente();
    case 'cotizave': return leerCotizave(claveCotizave);
    case 'dolarapi': return leerDolarApi();
    default: return null;
  }
}

export interface EstadoFuente {
  id: FuenteBCV;
  label: string;
  detalle: string;
  disponible: boolean;
  rate: number | null;
  date: string | null;
  /** true cuando no respondio ahora y se muestra la ultima lectura guardada */
  guardada?: boolean;
}

/** Consulta todas las fuentes a la vez, para poder compararlas en el panel. */
export async function leerTodasLasFuentes(
  claveCotizave?: string,
  db?: D1Database | null,
  claveJina?: string
): Promise<EstadoFuente[]> {
  return Promise.all(
    TODAS_LAS_FUENTES.map(async (id) => {
      const disponible = !FUENTE_META[id].requiereClave || !!claveCotizave;
      const tasa = disponible ? await leerFuente(id, claveCotizave, claveJina) : null;

      // Si la oficial no responde ahora, se enseña la última que se le leyó.
      // Ojo: es lo último PUBLICADO, que no siempre es lo que se está
      // cobrando — si el BCV ya colgó la de mañana, el sitio sigue con la
      // anterior (aplicarVigencia). La fecha de la ficha lo delata.
      if (!tasa && id === 'oficial') {
        const guardada = await leerUltimaOficial(db);
        if (guardada) {
          return {
            id,
            label: FUENTE_META[id].label,
            detalle: FUENTE_META[id].detalle,
            disponible,
            rate: guardada.rate,
            date: guardada.date,
            guardada: true,
          };
        }
      }

      return {
        id,
        label: FUENTE_META[id].label,
        detalle: FUENTE_META[id].detalle,
        disponible,
        rate: tasa?.rate ?? null,
        date: tasa?.date ?? null,
      };
    })
  );
}

/**
 * Memoria de la ultima tasa oficial leida.
 *
 * Hace falta porque la pagina del BCV solo se alcanza a traves de un proxy
 * que a veces limita las peticiones desde Cloudflare. Sin esto, un tropiezo
 * del proxy tiraba el sitio a la tasa de las otras fuentes, que van un dia
 * por detras: el cliente veia 807 despues de haber visto 813,74.
 */
const CLAVE_OFICIAL_TASA = 'bcv_oficial_rate';
const CLAVE_OFICIAL_FECHA = 'bcv_oficial_fecha';

/** "07/09/2026" -> numero comparable; 0 si no se entiende */
function fechaComparable(fecha: string): number {
  const p = fecha.split('/');
  if (p.length !== 3) return 0;
  const [dia, mes, ano] = p.map((n) => parseInt(n, 10));
  if (!dia || !mes || !ano) return 0;
  return ano * 10000 + mes * 100 + dia;
}

/**
 * Guarda lo último leído de la página oficial, sin retroceder.
 *
 * El BCV parpadea al publicar: la página enseña la nueva, vuelve a la vieja,
 * otra vez la nueva. Sin la guarda, un parpadeo dejaba aquí apuntada la vieja
 * como si fuera lo último, y esta clave es justo la que usa la comparación de
 * "no retroceder" contra las otras fuentes. La tasa que se cobra ya no
 * depende de esto —manda bcv_rates, indexada por fecha valor, donde cada
 * lectura cae en SU fila y un parpadeo no puede confundirlas—, pero dejar un
 * dato malo puesto es dejar una trampa armada.
 *
 * Solo se rechaza una fecha valor ESTRICTAMENTE más vieja: si el BCV corrige
 * la cifra de la misma fecha, esa corrección sí tiene que entrar.
 */
async function guardarUltimaOficial(db: D1Database | null | undefined, tasa: TasaBCV): Promise<void> {
  if (!db) return;

  const previa = await leerUltimaOficial(db);
  if (previa && fechaComparable(previa.date) > fechaComparable(tasa.date)) return;

  try {
    await db.batch([
      db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind(CLAVE_OFICIAL_TASA, String(tasa.rate)),
      db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind(CLAVE_OFICIAL_FECHA, tasa.date),
    ]);
  } catch (error) {
    console.error('[BCV] Error guardando la ultima tasa oficial:', error);
  }
}

export async function leerUltimaOficial(db?: D1Database | null): Promise<TasaBCV | null> {
  if (!db) return null;
  try {
    const filas = await db
      .prepare('SELECT key, value FROM site_config WHERE key IN (?, ?)')
      .bind(CLAVE_OFICIAL_TASA, CLAVE_OFICIAL_FECHA)
      .all<{ key: string; value: string }>();

    const config: Record<string, string> = {};
    for (const fila of filas.results ?? []) config[fila.key] = fila.value;

    const rate = parseFloat(config[CLAVE_OFICIAL_TASA] ?? '');
    if (!Number.isFinite(rate) || rate <= 0) return null;

    return { rate, date: config[CLAVE_OFICIAL_FECHA] ?? '', source: 'BCV' };
  } catch (error) {
    console.error('[BCV] Error leyendo la ultima tasa oficial:', error);
    return null;
  }
}

/**
 * La casilla de tasa manual sigue a la última tasa conocida mientras nadie
 * escriba un valor a mano. Sin esto se quedaba congelada en lo último que se
 * hubiera tecleado — habia un 70 de una prueba vieja esperando a que alguien
 * activara el modo manual sin mirar.
 */
const CLAVE_MANUAL_OVERRIDE = 'bcv_rate_manual_override';

export async function haySobrescrituraManual(db?: D1Database | null): Promise<boolean> {
  if (!db) return false;
  try {
    const fila = await db
      .prepare('SELECT value FROM site_config WHERE key = ?')
      .bind(CLAVE_MANUAL_OVERRIDE)
      .first<{ value: string }>();
    return fila?.value === 'true';
  } catch {
    return false;
  }
}

export async function marcarSobrescrituraManual(db: D1Database, activa: boolean): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .bind(CLAVE_MANUAL_OVERRIDE, activa ? 'true' : 'false')
    .run();
}

/** Pone la casilla manual al dia con la tasa recien leida, si no hay override */
export async function sincronizarTasaManual(db: D1Database | null | undefined, rate: number): Promise<void> {
  if (!db || rate <= 0) return;
  try {
    if (await haySobrescrituraManual(db)) return;
    await db
      .prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate', ?, datetime('now'))")
      .bind(rate.toFixed(2))
      .run();
  } catch (error) {
    console.error('[BCV] Error sincronizando la tasa manual:', error);
  }
}

const CLAVE_PRINCIPAL = 'bcv_fuente_principal';
const CLAVE_RESPALDO = 'bcv_fuente_respaldo';

export async function getPreferenciaFuentes(
  db?: D1Database | null
): Promise<{ principal: FuenteBCV; respaldo: FuenteBCV }> {
  const porDefecto = { principal: 'oficial' as FuenteBCV, respaldo: 'dolarapi' as FuenteBCV };
  if (!db) return porDefecto;

  try {
    const filas = await db
      .prepare('SELECT key, value FROM site_config WHERE key IN (?, ?)')
      .bind(CLAVE_PRINCIPAL, CLAVE_RESPALDO)
      .all<{ key: string; value: string }>();

    const config: Record<string, string> = {};
    for (const fila of filas.results ?? []) config[fila.key] = fila.value;

    return {
      principal: esFuenteBCV(config[CLAVE_PRINCIPAL]) ? config[CLAVE_PRINCIPAL] : porDefecto.principal,
      respaldo: esFuenteBCV(config[CLAVE_RESPALDO]) ? config[CLAVE_RESPALDO] : porDefecto.respaldo,
    };
  } catch (error) {
    console.error('[BCV] Error leyendo la preferencia de fuentes:', error);
    return porDefecto;
  }
}

export async function guardarPreferenciaFuentes(
  db: D1Database,
  principal: FuenteBCV,
  respaldo: FuenteBCV
): Promise<void> {
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind(CLAVE_PRINCIPAL, principal),
    db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind(CLAVE_RESPALDO, respaldo),
  ]);
}

/* ── Desde cuándo se cobra cada tasa ──────────────────────

   Dos fechas distintas, y confundirlas es lo que estaba roto:

     fecha valor  desde cuándo rige para el BCV. Viene en su página.
     desde        desde cuándo la cobramos aquí.

   El fallo original era no tener ninguna de las dos. Se guardaba la tasa bajo
   `toISOString()` —el día en que se leía, y encima en UTC— así que cada fila
   acababa con la tasa que empezaba a regir al día siguiente, y el sitio
   cobraba con la nueva desde el momento en que el BCV la colgaba: el 7 de
   septiembre por la noche rpym.net facturaba a 814,69 cuando lo que regía ese
   día era 813,74.

   Y las dos fechas no coinciden los fines de semana. El BCV publica el
   viernes por la tarde con fecha valor del LUNES —o del martes, si el lunes
   es feriado—, pero en el negocio esa tasa se cobra desde el día siguiente a
   que se publica, o sea el SÁBADO: no se pasa el fin de semana entero
   cobrando la tasa de la semana pasada cuando el BCV ya la movió.

   De ahí la regla:

     desde = min(fecha valor, día siguiente al primer avistamiento)

   El min() es la red de seguridad. Lo normal es verla la misma tarde en que
   sale, y entonces manda "mañana"; si el sitio estuvo caído y la vemos dos
   días tarde, manda la fecha valor y la tasa no se retrasa más allá de lo que
   dice el BCV. Nunca más tarde que lo oficial.

   `date` sigue siendo la fecha valor, intacta, porque es el dato oficial y
   conviene no perderlo. Pero lo que convierte a USD —bcv-rate-history.ts y
   los reportes Z— busca por `desde`: tiene que usar la tasa que se COBRÓ ese
   día, o el total en USD no cuadra con los tickets de la caja.             */

/** "2026-09-07" -> "07/09/2026" */
function isoADmy(iso: string): string {
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

/** "2026-09-11" -> "2026-09-12"; suma días de calendario, sin zonas de por medio */
function diaSiguiente(iso: string): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * La regla del negocio: min(fecha valor, día siguiente a hoy).
 *
 * Suelta y exportada porque es LA regla, y conviene poder mirarla y probarla
 * sin una base de datos delante. `hoyISO` es el día en que se ve la tasa por
 * primera vez.
 */
export function desdeCuandoSeCobra(fechaValorISO: string, hoyISO: string): string {
  const manana = diaSiguiente(hoyISO);
  return fechaValorISO < manana ? fechaValorISO : manana;
}

/**
 * Apunta la tasa con su fecha valor y desde cuándo se cobra.
 *
 * Solo para lo que se lee de la página del BCV (directa o por el puente): es
 * la única fuente que publica la fecha valor. Las demás datan con el día en
 * que se actualizaron, que no es lo mismo, y meter eso en la tabla que usan
 * los reportes Z corrompería el histórico.
 *
 * Al reencontrar una fila ya conocida se actualiza la tasa pero NO `desde`:
 * ese se calculó la primera vez que se vio, y recalcularlo cada día lo
 * empujaría hacia adelante para siempre —el sábado daría "domingo", el
 * domingo "lunes"— y la tasa no entraría nunca.
 *
 * El upsert conserva eur_rate: update-bcv.ts escribe el euro en la misma
 * fila, y un INSERT OR REPLACE lo habría borrado en cada lectura del dólar.
 */
async function guardarVigencia(db: D1Database | null | undefined, tasa: TasaBCV): Promise<void> {
  const iso = dmyAIso(tasa.date);
  if (!db || !iso || !(tasa.rate > 0)) return;

  const desde = desdeCuandoSeCobra(iso, hoyEnCaracas());

  try {
    await db
      .prepare(
        `INSERT INTO bcv_rates (date, usd_rate, desde) VALUES (?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           usd_rate = excluded.usd_rate,
           desde = COALESCE(bcv_rates.desde, excluded.desde)`
      )
      .bind(iso, tasa.rate, desde)
      .run();
  } catch (error) {
    console.error('[BCV] Error guardando la vigencia:', error);
  }
}

/*  COALESCE(desde, date) en las dos consultas: las filas anteriores a la
    migración 0038, y las que escribe update-bcv.ts desde fuera, no traen
    `desde`. Para esas la fecha valor es lo único que hay.                   */

/** La tasa apuntada más reciente que ya se esté cobrando */
async function vigenteEn(
  db: D1Database | null | undefined,
  hoyISO: string
): Promise<{ rate: number; desde: string } | null> {
  if (!db) return null;
  try {
    const fila = await db
      .prepare(
        `SELECT usd_rate, COALESCE(desde, date) AS desde FROM bcv_rates
         WHERE COALESCE(desde, date) <= ? ORDER BY COALESCE(desde, date) DESC LIMIT 1`
      )
      .bind(hoyISO)
      .first<{ usd_rate: number; desde: string }>();

    return fila && fila.usd_rate > 0 ? { rate: fila.usd_rate, desde: fila.desde } : null;
  } catch (error) {
    console.error('[BCV] Error leyendo la vigencia:', error);
    return null;
  }
}

/** La siguiente que entrará, con el día en que empieza a cobrarse */
async function proximaTras(
  db: D1Database | null | undefined,
  hoyISO: string
): Promise<{ rate: number; date: string } | null> {
  if (!db) return null;
  try {
    const fila = await db
      .prepare(
        `SELECT usd_rate, COALESCE(desde, date) AS desde FROM bcv_rates
         WHERE COALESCE(desde, date) > ? ORDER BY COALESCE(desde, date) ASC LIMIT 1`
      )
      .bind(hoyISO)
      .first<{ usd_rate: number; desde: string }>();

    return fila && fila.usd_rate > 0 ? { rate: fila.usd_rate, date: isoADmy(fila.desde) } : null;
  } catch (error) {
    console.error('[BCV] Error leyendo la próxima tasa:', error);
    return null;
  }
}

/* ── Adelantar la tasa que viene ──────────────────────────

   A veces hay que pagarle a un proveedor que ya cobra a la tasa que entra
   mañana. El panel tiene un botón para eso.

   POR QUÉ ESTO CAMBIA EL DATO Y NO PONE UN INTERRUPTOR

   El primer intento fue una llave en site_config y un `limite` que
   aplicarVigencia miraba en vez de hoy. Funcionaba para el catálogo y estaba
   mal, porque la tasa que se cobra no la lee solo el catálogo: los reportes Z
   y el histórico de tasas la consultan por su cuenta contra bcv_rates. Con el
   interruptor puesto, la caja cobraba 830 y el Z de ese día convertía a 820
   —exactamente el descuadre contra los tickets que se acababa de arreglar—, y
   cada consumidor nuevo habría tenido que acordarse del interruptor.

   Así que adelantar es lo que de verdad significa: esa tasa empieza a
   cobrarse HOY. Se escribe en `desde`, que es el campo que quiere decir eso,
   y entonces todo el sistema ve la misma verdad sin que nadie propague nada.

   Lo único que se guarda aparte es cómo deshacerlo: qué fila se tocó y qué
   `desde` tenía antes.                                                      */

const CLAVE_ADELANTO = 'bcv_adelanto';

export interface Adelanto {
  /** La fecha valor de la fila adelantada */
  date: string;
  /** El `desde` que tenía antes, para poder devolverlo */
  desdeAnterior: string;
}

async function leerRegistroAdelanto(db?: D1Database | null): Promise<Adelanto | null> {
  if (!db) return null;
  try {
    const fila = await db
      .prepare('SELECT value FROM site_config WHERE key = ?')
      .bind(CLAVE_ADELANTO)
      .first<{ value: string }>();
    if (!fila?.value) return null;

    const datos = JSON.parse(fila.value) as Partial<Adelanto>;
    return datos.date && datos.desdeAnterior
      ? { date: datos.date, desdeAnterior: datos.desdeAnterior }
      : null;
  } catch {
    return null;
  }
}

/**
 * El adelanto en curso, o null.
 *
 * Se considera terminado cuando el día en que la tasa iba a entrar por su
 * cuenta ya llegó: a partir de ahí adelantarla no significa nada, y dejar el
 * panel diciendo "adelantada" para siempre sería mentir. No hace falta
 * borrarlo: deshacerlo entonces devolvería un `desde` que ya pasó, que es
 * exactamente lo mismo que hay.
 */
export async function adelantoEnCurso(db?: D1Database | null): Promise<Adelanto | null> {
  const registro = await leerRegistroAdelanto(db);
  return registro && registro.desdeAnterior > hoyEnCaracas() ? registro : null;
}

/** La siguiente tasa apuntada que todavía no se cobra */
export async function proximaSinEntrar(
  db: D1Database
): Promise<{ rate: number; date: string; desde: string } | null> {
  const hoyISO = hoyEnCaracas();
  try {
    const fila = await db
      .prepare(
        `SELECT date, usd_rate, COALESCE(desde, date) AS desde FROM bcv_rates
         WHERE COALESCE(desde, date) > ? ORDER BY COALESCE(desde, date) ASC LIMIT 1`
      )
      .bind(hoyISO)
      .first<{ date: string; usd_rate: number; desde: string }>();

    return fila && fila.usd_rate > 0
      ? { rate: fila.usd_rate, date: fila.date, desde: fila.desde }
      : null;
  } catch (error) {
    console.error('[BCV] Error buscando la próxima tasa:', error);
    return null;
  }
}

/** Adelanta esa fila a hoy y apunta cómo deshacerlo */
export async function adelantar(db: D1Database, fila: { date: string; desde: string }): Promise<void> {
  const registro: Adelanto = { date: fila.date, desdeAnterior: fila.desde };
  await db.batch([
    db.prepare('UPDATE bcv_rates SET desde = ? WHERE date = ?').bind(hoyEnCaracas(), fila.date),
    db
      .prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .bind(CLAVE_ADELANTO, JSON.stringify(registro)),
  ]);
}

/** Devuelve la fila adelantada a su día de entrada */
export async function deshacerAdelanto(db: D1Database): Promise<void> {
  const registro = await leerRegistroAdelanto(db);
  if (!registro) return;

  await db.batch([
    db.prepare('UPDATE bcv_rates SET desde = ? WHERE date = ?').bind(registro.desdeAnterior, registro.date),
    db
      .prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .bind(CLAVE_ADELANTO, ''),
  ]);
}

/** La fecha valor más alta apuntada, incluidas las que aún no han entrado */
async function ultimaFechaValor(db: D1Database | null | undefined): Promise<string | null> {
  if (!db) return null;
  try {
    const fila = await db
      .prepare('SELECT MAX(date) AS date FROM bcv_rates')
      .first<{ date: string | null }>();
    return fila?.date ?? null;
  } catch {
    return null;
  }
}

/**
 * Devuelve la tasa que se cobra hoy, y aparte la que ya viene.
 *
 * Manda la tabla, no la lectura de ahora: lo que el BCV enseña un sábado
 * sigue siendo la fecha valor del lunes, pero aquí esa tasa ya se cobra desde
 * el sábado porque así quedó apuntada el viernes. Preguntar a la tabla es lo
 * único que sabe eso.
 *
 * Se aplica al final y a TODA tasa, venga de donde venga: si no, la del BCV
 * se colaba por la puerta de al lado —leerUltimaOficial guarda lo último
 * leído, y esa comparación de "no retroceder" habría devuelto la adelantada
 * aunque dolarapi trajera la correcta.
 */
export async function aplicarVigencia(
  db: D1Database | null | undefined,
  tasa: TasaBCV
): Promise<TasaBCV> {
  const hoyISO = hoyEnCaracas();
  const vigente = await vigenteEn(db, hoyISO);

  // Sin memoria se sigue con lo leído: es lo único que hay.
  if (!vigente) return { ...tasa, proxima: null };

  /* Si el BCV lleva días sin responder, otra fuente puede traer una tasa más
     nueva que todo lo apuntado. Entonces manda ella: servir una vieja
     teniendo una más nueva y ya vigente sería el fallo que este archivo dice
     en su cabecera que vino a evitar.

     Se compara contra la última FECHA VALOR, no contra `desde`. Son dos
     magnitudes distintas y mezclarlas rompía el fin de semana: el sábado
     `desde` vale 12/09 mientras dolarapi data su tasa el 11 o el 12, y bastaba
     que la datara un día más adelante para tumbar la del sábado y volver a la
     de la semana pasada. La fecha valor del BCV y la fecha de dolarapi sí son
     lo mismo —desde cuándo rige oficialmente—, así que compararlas es legítimo.  */
  const suya = dmyAIso(tasa.date);
  if (suya && suya <= hoyISO) {
    // La consulta va aquí dentro y no fuera: por el camino normal —la página
    // del BCV, cuya fecha valor casi siempre es futura— esto ni se ejecuta,
    // y esta función corre en cada renderizado del catálogo.
    const ultimaOficial = await ultimaFechaValor(db);
    if (!ultimaOficial || suya > ultimaOficial) return { ...tasa, proxima: null };
  }

  return {
    rate: vigente.rate,
    date: isoADmy(vigente.desde),
    source: tasa.source,
    proxima: await proximaTras(db, hoyISO),
  };
}

/**
 * Obtiene la tasa respetando la preferencia: primero la principal, luego la
 * de respaldo, y si las dos fallan se recorre el resto antes de rendirse.
 */
export async function obtenerTasaSegunPreferencia(
  db?: D1Database | null,
  claveCotizave?: string,
  claveJina?: string
): Promise<TasaBCV | null> {
  const { principal, respaldo } = await getPreferenciaFuentes(db);
  const orden = [principal, respaldo, ...TODAS_LAS_FUENTES].filter(
    (fuente, i, lista) => lista.indexOf(fuente) === i
  );

  for (const fuente of orden) {
    const tasa = await leerFuente(fuente, claveCotizave, claveJina);
    if (!tasa) continue;

    // La pagina del BCV es la unica que trae fecha valor: solo de ahi se
    // apunta desde cuando rige cada tasa.
    if (fuente === 'oficial' || fuente === 'puente') {
      await guardarVigencia(db, tasa);
    }

    if (fuente === 'oficial') {
      await guardarUltimaOficial(db, tasa);
      return aplicarVigencia(db, tasa);
    }

    // Esta fuente respondio, pero puede ir por detras de la ultima oficial
    // que ya conocemos. En ese caso manda la que tenga la fecha mas nueva:
    // nunca se retrocede a una tasa mas vieja de la que ya se mostro.
    const guardada = await leerUltimaOficial(db);
    if (guardada && fechaComparable(guardada.date) > fechaComparable(tasa.date)) {
      return aplicarVigencia(db, guardada);
    }
    return aplicarVigencia(db, tasa);
  }

  // Ninguna fuente respondio: al menos la ultima oficial conocida
  const ultima = await leerUltimaOficial(db);
  return ultima ? aplicarVigencia(db, ultima) : null;
}

