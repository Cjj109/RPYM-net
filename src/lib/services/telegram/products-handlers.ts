/**
 * RPYM - Telegram handlers para productos
 */

import type { D1Database } from '../../d1-types';
import { getProducts, getBCVRate } from '../../sheets';

export async function getProductsList(db: D1Database | null): Promise<string> {
  const bcvRate = await getBCVRate(db);
  const products = await getProducts(bcvRate.rate, db ?? undefined);
  let text = `📋 *Productos RPYM*\n💱 Tasa: Bs. ${bcvRate.rate.toFixed(2)}\n\n`;
  const categorias = new Map<string, typeof products>();
  products.forEach(p => {
    const existing = categorias.get(p.categoria) || [];
    categorias.set(p.categoria, [...existing, p]);
  });
  categorias.forEach((prods, cat) => {
    text += `*${cat}*\n`;
    prods.forEach(p => {
      const status = p.disponible ? '✅' : '❌';
      if (p.precioUSDDivisa && p.precioUSDDivisa !== p.precioUSD) {
        text += `${status} ${p.nombre}: $${p.precioUSD.toFixed(2)}/${p.precioUSDDivisa.toFixed(2)}\n`;
      } else {
        text += `${status} ${p.nombre}: $${p.precioUSD.toFixed(2)}\n`;
      }
    });
    text += '\n';
  });
  return text;
}

export async function updateProductPrice(
  db: D1Database | null,
  productName: string,
  priceBcv: number,
  priceDivisa?: number
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const product = await db.prepare(`SELECT id, nombre, precio_usd FROM products WHERE LOWER(nombre) LIKE ? LIMIT 1`).bind(`%${productName.toLowerCase()}%`).first<{ id: number; nombre: string; precio_usd: number }>();
    if (!product) return `❌ No encontré producto "${productName}"`;
    if (priceDivisa !== undefined) {
      await db.prepare(`UPDATE products SET precio_usd = ?, precio_usd_divisa = ? WHERE id = ?`).bind(priceBcv, priceDivisa, product.id).run();
    } else {
      await db.prepare(`UPDATE products SET precio_usd = ? WHERE id = ?`).bind(priceBcv, product.id).run();
    }
    return `✅ *${product.nombre}* actualizado a $${priceBcv.toFixed(2)}${priceDivisa ? `/$${priceDivisa.toFixed(2)}` : ''}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function updateProductAvailability(
  db: D1Database | null,
  productName: string,
  available: boolean
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const product = await db.prepare(`SELECT id, nombre FROM products WHERE LOWER(nombre) LIKE ? LIMIT 1`).bind(`%${productName.toLowerCase()}%`).first<{ id: number; nombre: string }>();
    if (!product) return `❌ No encontré producto "${productName}"`;
    await db.prepare(`UPDATE products SET disponible = ? WHERE id = ?`).bind(available ? 1 : 0, product.id).run();
    return `${available ? '✅' : '❌'} *${product.nombre}* ${available ? 'DISPONIBLE' : 'NO DISPONIBLE'}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}
