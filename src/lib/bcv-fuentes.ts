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
import { fetchTasaBCVOficial, type TasaBCV } from './bcv-oficial';

export type FuenteBCV = 'oficial' | 'cotizave' | 'dolarapi';

export const TODAS_LAS_FUENTES: FuenteBCV[] = ['oficial', 'cotizave', 'dolarapi'];

export const FUENTE_META: Record<FuenteBCV, { label: string; detalle: string; requiereClave: boolean }> = {
  oficial: {
    label: 'BCV (página oficial)',
    detalle: 'Publica la tasa nueva el mismo día, apenas el BCV la cuelga.',
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
export async function leerFuente(fuente: FuenteBCV, claveCotizave?: string): Promise<TasaBCV | null> {
  switch (fuente) {
    case 'oficial': return fetchTasaBCVOficial();
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
}

/** Consulta todas las fuentes a la vez, para poder compararlas en el panel. */
export async function leerTodasLasFuentes(claveCotizave?: string): Promise<EstadoFuente[]> {
  const lecturas = await Promise.all(
    TODAS_LAS_FUENTES.map(async (id) => {
      const disponible = !FUENTE_META[id].requiereClave || !!claveCotizave;
      const tasa = disponible ? await leerFuente(id, claveCotizave) : null;
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
  return lecturas;
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

/**
 * Obtiene la tasa respetando la preferencia: primero la principal, luego la
 * de respaldo, y si las dos fallan se recorre el resto antes de rendirse.
 */
export async function obtenerTasaSegunPreferencia(
  db?: D1Database | null,
  claveCotizave?: string
): Promise<TasaBCV | null> {
  const { principal, respaldo } = await getPreferenciaFuentes(db);
  const orden = [principal, respaldo, ...TODAS_LAS_FUENTES].filter(
    (fuente, i, lista) => lista.indexOf(fuente) === i
  );

  for (const fuente of orden) {
    const tasa = await leerFuente(fuente, claveCotizave);
    if (tasa) return tasa;
  }
  return null;
}
