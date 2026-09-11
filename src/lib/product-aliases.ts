/**
 * Sinónimos de productos propios del negocio, que la IA no puede adivinar:
 * - "botones" son vieras.
 * - "camarón pelado" es el camarón desvenado (con su variante jumbo o mediano).
 * - "caja de camarón desvenado/pelado" sin talla es la caja de Camaron 41/50.
 *   El desvenado se vende por kg: sin esto quedaba "1 caja" a precio de kilo.
 */

export interface AliasProduct {
  id: string | number;
  nombre: string;
  unidad: string;
}

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Devuelve el producto del catálogo que corresponde a lo que pidió el usuario
 * según los sinónimos del negocio, o null si no aplica ninguno.
 * @param unit - Unidad que dio el usuario para ese producto ("caja" si dijo caja)
 */
export function resolveProductAlias<P extends AliasProduct>(
  requested: string,
  products: P[],
  opts: { unit?: string | null } = {}
): P | null {
  const r = norm(requested);
  if (!r) return null;
  const named = (re: RegExp) => products.filter(p => re.test(norm(p.nombre)));

  // "botones" = vieras; si hay varias, la de nombre más simple ("Vieras")
  if (/\bbotone?s?\b/.test(r)) {
    const vieras = named(/\bviei?ras?\b/).sort((a, b) => a.nombre.length - b.nombre.length);
    return vieras[0] ?? null;
  }

  const saysPeeled = /\bpelad[oa]s?\b/.test(r);
  const saysDeveined = /\bdesvenad[oa]s?\b/.test(r);
  if (!(saysDeveined || (saysPeeled && /\bcamar/.test(r)))) return null;

  const hasSize = /\b\d{2}\s*\/\s*\d{2}\b/.test(r);
  const saysJumbo = /\bjumbo\b/.test(r);
  const saysBox = opts.unit === 'caja' || /\b(cajas?|cj)\b/.test(r);

  // Caja de desvenado/pelado sin talla → la caja de 41/50
  if (saysBox && !hasSize && !saysJumbo) {
    const box = products.find(p => p.unidad === 'caja' && /\b41\s*\/\s*50\b/.test(norm(p.nombre)));
    if (box) return box;
  }

  // Con talla o solo "desvenado" ya lo resuelven la IA y sus correcciones
  if (hasSize || !saysPeeled) return null;

  // "pelado" = desvenado, respetando jumbo / mediano
  const deveined = named(/\bdesvenad/);
  if (saysJumbo) return deveined.find(p => /\bjumbo\b/.test(norm(p.nombre))) ?? null;
  if (/\bmedian[oa]s?\b/.test(r)) return deveined.find(p => /\bmedian/.test(norm(p.nombre))) ?? null;
  return deveined.find(p => !/\b(jumbo|median[oa])\b/.test(norm(p.nombre))) ?? null;
}

/** Nombres que no son un producto sino una anotación por monto ("mariscos varios $20") */
const GENERIC_NOTE_NAMES = new Set([
  'mariscos varios', 'marisco varios', 'mariscos', 'varios', 'productos varios',
  'pedido', 'compra', 'mercancia', 'surtido', 'mariscos surtidos',
]);

/**
 * ¿Es una anotación por monto y no un producto? "mariscos varios $20" se anota
 * como nota simple (o como 1 unidad a ese precio), nunca como $20/kg.
 */
export function isGenericNoteName(name: string): boolean {
  const cleaned = norm(name)
    .replace(/[$\d.,/]+/g, ' ')
    .replace(/\b(de|del|en|los|las|unos|unas|kg|kilos?|dolares?|usd|bs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return GENERIC_NOTE_NAMES.has(cleaned);
}
