/**
 * RPYM - WhatsApp product cache
 * Evita recargar productos en cada mensaje
 */

import { getProducts, getBCVRate } from '../../sheets';
import type { Product } from '../../sheets';

export interface ProductCacheEntry {
  products: Product[];
  bcvRate: number;
  productosTexto: string;
  cachedAt: number;
}

let productCache: ProductCacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Formatea la lista de productos para el contexto de Gemini
 */
export function formatProductsForAI(products: Product[], bcvRate: number): string {
  const categorias = new Map<string, Product[]>();

  products.forEach(p => {
    if (!p.disponible) return;
    const existing = categorias.get(p.categoria) || [];
    categorias.set(p.categoria, [...existing, p]);
  });

  let texto = `LISTA DE PRODUCTOS Y PRECIOS (Tasa BCV: Bs. ${bcvRate.toFixed(2)} por dólar)\n\n`;

  categorias.forEach((prods, categoria) => {
    texto += `═══ ${categoria.toUpperCase()} ═══\n`;
    prods.forEach(p => {
      const precioBs = (p.precioUSD * bcvRate).toFixed(2);
      texto += `• ${p.nombre}: $${p.precioUSD.toFixed(2)} / Bs. ${precioBs} por ${p.unidad}\n`;
    });
    texto += '\n';
  });

  return texto;
}

/**
 * Obtiene productos con cache de 5 minutos
 */
export async function getCachedProducts(db: any): Promise<{ products: Product[]; bcvRate: number; productosTexto: string }> {
  const now = Date.now();

  if (productCache && (now - productCache.cachedAt) < CACHE_TTL_MS) {
    return {
      products: productCache.products,
      bcvRate: productCache.bcvRate,
      productosTexto: productCache.productosTexto
    };
  }

  const bcvRateData = await getBCVRate();
  const products = await getProducts(bcvRateData.rate, db || undefined);
  const productosTexto = formatProductsForAI(products, bcvRateData.rate);

  productCache = {
    products,
    bcvRate: bcvRateData.rate,
    productosTexto,
    cachedAt: now
  };

  console.log(`[WhatsApp] Products cache refreshed (${products.length} products, BCV: ${bcvRateData.rate})`);

  return { products, bcvRate: bcvRateData.rate, productosTexto };
}

/**
 * Limpia el cache de productos (para comandos admin)
 */
export function clearProductCache(): void {
  productCache = null;
}
