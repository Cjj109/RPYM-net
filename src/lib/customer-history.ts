/**
 * Historial de compras de un cliente resumido para el prompt de la IA de
 * anotaciones: sus productos habituales con la última cantidad y precio.
 * Se mantiene corto (tope de productos) para no volver más lenta la consulta.
 */
import { formatQuantity } from './format';

export interface ProductHabit {
  nombre: string;
  unidad: string;
  /** En cuántos de los pedidos recientes aparece */
  pedidos: number;
  ultimaCantidad: number;
  ultimoPrecio: number;
}

/**
 * Agrupa las líneas de los últimos presupuestos de un cliente por producto.
 * @param rows - items (JSON) de cada presupuesto, del más reciente al más antiguo
 */
export function summarizeProductHabits(rows: { items: string }[], max = 8): ProductHabit[] {
  const byName = new Map<string, ProductHabit>();

  for (const row of rows) {
    let items: any[];
    try {
      items = JSON.parse(row.items);
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;

    const seenInOrder = new Set<string>();
    for (const it of items) {
      const nombre = String(it?.nombre || '').trim();
      const key = nombre.toLowerCase();
      if (!nombre || seenInOrder.has(key)) continue;
      seenInOrder.add(key);

      const habit = byName.get(key);
      if (habit) {
        habit.pedidos++;
      } else {
        byName.set(key, {
          nombre,
          unidad: String(it?.unidad || 'kg'),
          pedidos: 1,
          ultimaCantidad: Number(it?.cantidad) || 0,
          ultimoPrecio: Number(it?.precioUSD) || 0,
        });
      }
    }
  }

  // Más pedidos primero; a igualdad, el más reciente (orden de inserción)
  return [...byName.values()].sort((a, b) => b.pedidos - a.pedidos).slice(0, max);
}

/**
 * Bloque para el prompt; vacío si el cliente no tiene historial
 * @param ordersCount - De cuántos pedidos sale el resumen
 */
export function formatHabitsForPrompt(customerName: string, habits: ProductHabit[], ordersCount?: number): string {
  if (habits.length === 0) return '';
  const lines = habits.map(h =>
    `- ${h.nombre}: ${h.pedidos} ${h.pedidos === 1 ? 'pedido' : 'pedidos'}, último ${formatQuantity(h.ultimaCantidad)} ${h.unidad} a $${h.ultimoPrecio.toFixed(2)}/${h.unidad}`
  );
  const source = ordersCount ? `sus últimos ${ordersCount} ${ordersCount === 1 ? 'pedido' : 'pedidos'}` : 'sus últimos pedidos';
  return `HISTORIAL RECIENTE DE "${customerName}" (solo referencia, ${source}):
${lines.join('\n')}
- Usalo SOLO para desambiguar: si el texto nombra un producto de forma genérica ("camaron", "calamar", "pulpo") y este cliente siempre pide una variante, preferí esa variante.
- NUNCA copies cantidades ni precios del historial, salvo que el usuario diga "lo mismo", "lo de siempre" o "igual que la vez pasada".
- Si el texto contradice el historial, manda el texto.
`;
}
