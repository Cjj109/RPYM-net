/**
 * Cache compartido del catálogo de productos para inferir unidades en QuickOps.
 * - Cache de módulo con TTL de 15 minutos.
 * - Una sola request en vuelo a la vez (deduplicación).
 */
import { normalizeText } from './text-utils';

export interface CatalogEntry {
  normalized: string;
  unidad: string;
}

const TTL_MS = 15 * 60 * 1000;

let cache: CatalogEntry[] | null = null;
let cachedAt = 0;
let inflight: Promise<CatalogEntry[]> | null = null;

async function fetchCatalog(): Promise<CatalogEntry[]> {
  const res = await fetch('/api/products');
  const data = await res.json();
  if (!data?.success || !Array.isArray(data.products)) return [];
  return data.products.map((p: any) => ({
    normalized: normalizeText(p.nombre),
    unidad: p.unidad || 'kg',
  }));
}

/** Devuelve el catálogo (cacheado si está vigente). Nunca tira excepción. */
export async function loadProductCatalog(): Promise<CatalogEntry[]> {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = fetchCatalog()
    .then(entries => {
      cache = entries;
      cachedAt = Date.now();
      return entries;
    })
    .catch(() => cache ?? [])
    .finally(() => { inflight = null; });

  return inflight;
}

/**
 * Infiere la unidad de un producto a partir de su nombre cruzando con el catálogo.
 * Default: 'kg' si no hay match.
 */
export function inferUnitFromCatalog(name: string, catalog: CatalogEntry[]): string {
  const n = normalizeText(name);
  const words = n.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return 'kg';

  const matches = catalog.filter(p => {
    const pWords = p.normalized.split(/\s+/);
    return words.every(w => p.normalized.includes(w)) || pWords.every(w => n.includes(w));
  });
  if (matches.length === 0) return 'kg';

  const units = [...new Set(matches.map(m => m.unidad))];
  if (units.length === 1) return units[0];

  // Ambigüedad → preferir coincidencia con más palabras comunes
  const best = matches
    .map(m => ({ m, score: m.normalized.split(/\s+/).filter(w => n.includes(w)).length }))
    .sort((a, b) => b.score - a.score)[0];
  return best.m.unidad;
}
