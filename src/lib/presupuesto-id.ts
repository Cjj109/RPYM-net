/**
 * Generación del id de presupuesto.
 *
 * El id es un número aleatorio de 5 cifras y es la clave primaria de la tabla,
 * así que el espacio es de solo 90.000 valores. A medida que se acumulan
 * presupuestos, una parte de las creaciones choca con un id ya usado: el INSERT
 * falla con UNIQUE constraint y el usuario ve "Error al crear presupuesto" sin
 * motivo aparente. Con ~1.200 presupuestos eso era ~1 de cada 73 intentos.
 */

import type { D1Database } from './d1-types';

/** Rango del id: 10000–99999 (5 cifras, legible para compartir por WhatsApp). */
export function generatePresupuestoId(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

/** Intentos antes de rendirse. Con 8, fallar es practicamente imposible. */
export const MAX_ID_ATTEMPTS = 8;

/** Detecta el choque de clave primaria (id repetido) de SQLite/D1. */
export function isDuplicateIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed');
}

/**
 * Devuelve un id que aún no existe en la tabla.
 * Consulta antes de insertar, así que no elimina por completo la carrera entre
 * dos creaciones simultáneas, pero reduce el fallo de ~1 de cada 73 a algo
 * despreciable. Donde se controla el INSERT conviene además reintentar ante
 * isDuplicateIdError, que sí es inmune a la carrera.
 */
export async function generateUniquePresupuestoId(db: D1Database): Promise<string> {
  let lastId = '';

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    lastId = generatePresupuestoId();
    const existing = await db
      .prepare('SELECT id FROM presupuestos WHERE id = ?')
      .bind(lastId)
      .first();

    if (!existing) return lastId;
  }

  // Agotados los intentos se devuelve el último: es preferible arriesgar el
  // choque a bloquear la creación del presupuesto.
  console.warn('[presupuesto-id] No se hallo un id libre en', MAX_ID_ATTEMPTS, 'intentos');
  return lastId;
}
