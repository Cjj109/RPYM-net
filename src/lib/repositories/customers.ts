/**
 * RPYM - Customers repository
 * Acceso a datos de clientes (buscar, consultas raw)
 */

import type { D1Database } from '../d1-types';

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
 * Busca un cliente por nombre con normalización de acentos
 * Primero intenta con LIKE normal, si falla busca con normalización
 */
export async function findCustomerByName(
  db: D1Database,
  searchName: string
): Promise<{ id: number; name: string } | null> {
  if (!db) return null;

  // Primero intentar búsqueda normal con LIKE
  const customer = await db.prepare(`
    SELECT id, name FROM customers
    WHERE LOWER(name) LIKE ? AND is_active = 1
    ORDER BY CASE WHEN LOWER(name) = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(`%${searchName.toLowerCase()}%`, searchName.toLowerCase()).first<{ id: number; name: string }>();

  if (customer) return customer;

  // Si no encontró, buscar todos los clientes y comparar con normalización
  const allCustomers = await db.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all<{ id: number; name: string }>();
  const normalizedSearch = normalizeText(searchName);

  for (const c of allCustomers?.results || []) {
    const normalizedName = normalizeText(c.name);
    if (normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName)) {
      return { id: c.id, name: c.name };
    }
  }

  return null;
}
