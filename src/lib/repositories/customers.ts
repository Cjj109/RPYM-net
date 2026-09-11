/**
 * RPYM - Customers repository
 * Acceso a datos de clientes (buscar, consultas raw)
 */

import type { D1Database } from '../d1-types';
import { resolveCustomer } from '../customer-match';

/**
 * Normaliza texto removiendo acentos/tildes para búsqueda fuzzy
 * "Raúl" → "raul", "José" → "jose"
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Busca un cliente por nombre con las reglas de resolveCustomer: exacto, o
 * parcial único con un nombre distintivo ("canastas" → "Canastas del Mar").
 * Un nombre de pila común que solo coincide en parte ("jose" → "José Luis")
 * devuelve null, y el bot muestra sugerencias en vez de elegir a otra persona.
 */
export async function findCustomerByName(
  db: D1Database,
  searchName: string
): Promise<{ id: number; name: string } | null> {
  if (!db || !searchName?.trim()) return null;

  const all = await db.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all<{ id: number; name: string }>();
  const match = resolveCustomer({ text: searchName, writtenName: searchName }, all?.results || []);
  return match.id !== null ? { id: match.id, name: match.name } : null;
}

/**
 * Calcula similitud simple entre dos strings normalizados (0 = nada similar, 1 = iguales)
 */
function similarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    return minLen / maxLen;
  }
  let matches = 0;
  const aChars = new Set(a);
  for (const c of b) {
    if (aChars.has(c)) matches++;
  }
  return matches / Math.max(a.length, b.length);
}

/**
 * Busca clientes similares al nombre dado (fuzzy con sugerencias)
 * Útil cuando findCustomerByName retorna null - ofrece alternativas
 */
export async function findCustomerSuggestions(
  db: D1Database,
  searchName: string,
  limit: number = 5
): Promise<{ id: number; name: string; score: number }[]> {
  if (!db || !searchName.trim()) return [];

  const all = await db.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all<{ id: number; name: string }>();
  const normalizedSearch = normalizeText(searchName.trim());
  const results: { id: number; name: string; score: number }[] = [];

  for (const c of all?.results || []) {
    const normalizedName = normalizeText(c.name);
    let score = 0;

    if (normalizedName === normalizedSearch) score = 1;
    else if (normalizedName.startsWith(normalizedSearch) || normalizedSearch.startsWith(normalizedName)) score = 0.9;
    else if (normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName)) score = 0.7;
    else score = similarityScore(normalizedSearch, normalizedName);

    if (score >= 0.3) results.push({ id: c.id, name: c.name, score });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
