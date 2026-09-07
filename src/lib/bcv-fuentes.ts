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

async function guardarUltimaOficial(db: D1Database | null | undefined, tasa: TasaBCV): Promise<void> {
  if (!db) return;
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

/* ── Desde cuándo rige cada tasa ──────────────────────────

   El BCV publica por la tarde la tasa del día SIGUIENTE, y su fecha valor
   viene en la propia página. Hasta ahora se cobraba con ella desde el momento
   en que aparecía: el 7 de septiembre por la noche el sitio ya facturaba a
   814,69, que no regía hasta el 8, y lo que regía ese día seguía siendo
   813,7361.

   La memoria no hace falta inventarla: bcv_rates ya es una tabla de tasa por
   fecha, la que usan los reportes Z para convertir con la tasa del día. Lo
   que estaba mal era la clave. Se guardaba bajo `toISOString()` —el día en
   que se leyó, y encima en UTC— en vez de bajo la fecha valor, así que cada
   fila acababa con la tasa que empezaba a regir al día siguiente. El
   historial fiscal iba corrido un día entero.

   Ahora se guarda bajo la fecha valor y se sirve la fila más reciente que ya
   haya llegado. Al pasar la medianoche de Caracas la de mañana pasa a ser la
   de hoy sola, sin releer ni desplegar nada.                                */

/** "2026-09-07" -> "07/09/2026" */
function isoADmy(iso: string): string {
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

/**
 * Apunta la tasa bajo SU fecha valor.
 *
 * Solo para lo que se lee de la página del BCV (directa o por el puente):
 * es la única fuente que publica la fecha desde la que rige. Las demás datan
 * con el día en que se actualizaron, que no es lo mismo, y meter eso en la
 * tabla que usan los reportes Z corrompería el histórico.
 *
 * El upsert conserva eur_rate: update-bcv.ts escribe el euro en la misma
 * fila, y un INSERT OR REPLACE lo habría borrado en cada lectura del dólar.
 */
async function guardarVigencia(db: D1Database | null | undefined, tasa: TasaBCV): Promise<void> {
  const iso = dmyAIso(tasa.date);
  if (!db || !iso || !(tasa.rate > 0)) return;

  try {
    await db
      .prepare(
        `INSERT INTO bcv_rates (date, usd_rate) VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET usd_rate = excluded.usd_rate`
      )
      .bind(iso, tasa.rate)
      .run();
  } catch (error) {
    console.error('[BCV] Error guardando la vigencia:', error);
  }
}

/** La tasa apuntada más reciente que ya haya entrado en vigor */
async function vigenteEn(db: D1Database | null | undefined, hoyISO: string): Promise<TasaBCV | null> {
  if (!db) return null;
  try {
    const fila = await db
      .prepare('SELECT date, usd_rate FROM bcv_rates WHERE date <= ? ORDER BY date DESC LIMIT 1')
      .bind(hoyISO)
      .first<{ date: string; usd_rate: number }>();

    return fila && fila.usd_rate > 0
      ? { rate: fila.usd_rate, date: isoADmy(fila.date), source: 'BCV' }
      : null;
  } catch (error) {
    console.error('[BCV] Error leyendo la vigencia:', error);
    return null;
  }
}

/**
 * Cambia una tasa adelantada por la que rige, y anuncia la otra en `proxima`.
 *
 * Se aplica al final y a TODA tasa, venga de donde venga: si no, la del BCV
 * se colaba igual por la puerta de al lado —leerUltimaOficial guarda lo
 * último leído, y esa comparación de "no retroceder" habría devuelto la
 * adelantada aunque dolarapi trajera la correcta.
 *
 * Si no hay memoria de la anterior se sigue con la publicada: es lo único que
 * hay, y es lo que se hacía antes. `date` sigue delatando que es futura.
 */
export async function aplicarVigencia(
  db: D1Database | null | undefined,
  tasa: TasaBCV
): Promise<TasaBCV> {
  const hoyISO = hoyEnCaracas();
  const iso = dmyAIso(tasa.date);
  if (!iso || iso <= hoyISO) return { ...tasa, proxima: null };

  const vigente = await vigenteEn(db, hoyISO);
  if (!vigente) return { ...tasa, proxima: null };

  return { ...vigente, source: tasa.source, proxima: { rate: tasa.rate, date: tasa.date } };
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
