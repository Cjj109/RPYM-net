/**
 * Emparejamiento de las recomendaciones de Chef José con productos del catálogo.
 *
 * José escribe en lenguaje natural ("calamar pota", "camarones") mientras que el
 * catálogo usa nombres propios ("Calamar Nacional", "Camaron Vivito (concha)").
 * La comparación se hace por palabras y no por el nombre completo: antes se
 * exigía que un texto contuviera al otro, así que una receta con varios
 * ingredientes solía emparejar solo el primero.
 */

import type { Product } from './sheets';

/** Lo que José devuelve en su bloque JSON de recomendaciones. */
export interface JoseProductRec {
  nombre: string;
  kg: number;
}

export interface MatchedProduct {
  product: Product;
  /** Cantidad en kg sugerida por José, si la indicó. */
  quantity?: number;
}

/** Minúsculas y sin acentos. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Pasa una palabra a singular (aproximado, suficiente para nombres de producto).
 * José recomienda en plural — "camarones", "calamares", "mejillones" — mientras
 * que los productos están en singular ("Camaron", "Calamar Nacional").
 */
export function singularizeWord(word: string): string {
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Normaliza y singulariza cada palabra, para comparar recomendación vs producto. */
export function normalizeForMatch(text: string): string {
  return normalize(text).split(/\s+/).map(singularizeWord).join(' ');
}

/** Palabras vacías que no aportan al emparejamiento de nombres de producto. */
const MATCH_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'a', 'al']);

/**
 * Parte un nombre en palabras comparables: quita el contenido entre paréntesis
 * ("Camaron Vivito (concha)"), normaliza, singulariza y descarta palabras vacías.
 */
export function tokenizeForMatch(text: string): string[] {
  return normalizeForMatch(text.replace(/\(.*?\)/g, ' '))
    .split(/\s+/)
    .filter(word => word.length > 0 && !MATCH_STOPWORDS.has(word));
}

/**
 * Empareja cada recomendación con el mejor producto disponible.
 * Ante empate gana el primero del catálogo. Si dos recomendaciones caen en el
 * mismo producto se conserva la primera: el render usa product.id como key de
 * React y duplicarla colapsaría los botones.
 */
export function matchRecommendationsToProducts(
  recommendations: JoseProductRec[],
  products: Product[]
): MatchedProduct[] {
  const matched: MatchedProduct[] = [];

  for (const rec of recommendations) {
    const normalizedRecName = normalizeForMatch(rec.nombre);
    const recTokens = tokenizeForMatch(rec.nombre);

    let bestProduct: Product | null = null;
    let bestScore = 0;

    for (const product of products) {
      if (!product.disponible || product.esCaja) continue;

      let score = 0;

      if (normalizeForMatch(product.nombre) === normalizedRecName) {
        score = 1000;
      } else {
        const productTokens = tokenizeForMatch(product.nombre);
        const shared = productTokens.filter(t => recTokens.includes(t) && t.length >= 4);
        if (shared.length === 0) continue;

        score = shared.length * 10;
        // El sustantivo principal suele ir primero ("Calamar Nacional" es
        // calamar; "Tinta de Calamar" es tinta), así que se prioriza.
        if (productTokens.length > 0 && recTokens.includes(productTokens[0])) {
          score += 5;
        }
      }

      if (score > bestScore) {
        bestProduct = product;
        bestScore = score;
        if (score === 1000) break;
      }
    }

    if (bestProduct && !matched.some(m => m.product.id === bestProduct!.id)) {
      matched.push({
        product: bestProduct,
        quantity: rec.kg > 0 ? rec.kg : undefined
      });
    }
  }

  return matched;
}
