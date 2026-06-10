/** Detección de unidad explícita en texto de anotación con IA (calculadora y clientes) */

const explicitUnitRegex = /\d+(?:\.\d+)?\s*(kg|kilo|kilos)\b/i;
const halfKgRegex = /(?:medio|1\/2)\s*(?:kg|kilo)?\b/i;
const cajaRegex = /\b(?:caja|cajas|cj)\b/i;

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ExplicitUnitItem {
  requestedName?: string | null;
  productName?: string | null;
}

/**
 * Detecta la unidad explícita que el usuario escribió para UN producto
 * (ej: "1kg pepitona" → "kg", "2 cajas de camarón" → "caja").
 * Si el usuario escribe "kg" explícitamente, NO usar la unidad del catálogo (podría ser "caja").
 * Devuelve null si no hay unidad explícita — el caller debe usar la unidad del catálogo.
 */
export function detectExplicitUnit(item: ExplicitUnitItem, userText: string): 'kg' | 'caja' | null {
  // Revisar en requestedName
  if (item.requestedName) {
    if (cajaRegex.test(item.requestedName)) return 'caja';
    if (explicitUnitRegex.test(item.requestedName) || halfKgRegex.test(item.requestedName)) {
      return 'kg';
    }
  }
  // Revisar en el texto original, acotado al segmento de ESTE producto
  if (userText) {
    // Preferir requestedName (lo que escribió el usuario) sobre productName (catálogo):
    // localiza mejor el segmento correcto cuando el nombre del catálogo comparte
    // palabras con otro segmento (ej: "1kg camarón" matcheado a "Camarón 41/50")
    const prodName = item.requestedName || item.productName || '';
    const normalizedProd = normalize(prodName);
    const normalizedText = normalize(userText);
    const words = normalizedProd.split(/\s+/).filter((w: string) => w.length > 3);
    // Buscar 'caja' solo en el segmento del texto que corresponde a ESTE producto,
    // no en todo el texto (evita asignar 'caja' a productos que no la mencionan)
    if (words.length > 0) {
      // Separar también por saltos de línea y punto y coma: listas dictadas o
      // escritas línea por línea no llevan comas, y sin esto todo el texto
      // queda como un solo segmento y 'caja' se propaga a todos los productos.
      // Además sub-dividir en límites de cantidad ("2 cajas...", "3kg...") para
      // textos corridos sin ningún separador entre productos. El lookahead exige
      // espacio previo y letra después para no cortar tallas como "41/50"
      const qtyBoundary = /(?=(?<=\s)\d+(?:[.,]\d+)?\s*(?:kg|kilo|kilos|caja|cajas|cj|unidad|unidades|paquete|paquetes|bolsa|bolsas)?\s+[a-z])/i;
      const segments = normalizedText
        .split(/[,;\n]|\s+y\s+/)
        .flatMap(seg => seg.split(qtyBoundary));
      // Usar el segmento con MÁS palabras del producto en común (evita tomar un segmento de
      // otro producto con nombre similar, ej: "cajas de camarón 51/60" vs "camarón vivito")
      const bestSegment = segments
        .map(seg => ({ seg, score: words.filter(w => seg.includes(w)).length }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.seg;
      if (bestSegment) {
        if (cajaRegex.test(bestSegment)) return 'caja';
        // kg explícito dentro del segmento de ESTE producto
        if (explicitUnitRegex.test(bestSegment) || halfKgRegex.test(bestSegment)) return 'kg';
      }
    }
    // Buscar patrón: "Xkg productoNombre" o "X kg productoNombre"
    for (const word of words) {
      const escaped = escapeRegex(word);
      const pattern = new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:kg|kilo|kilos)\\s+[^,\\n]*?${escaped}`, 'i');
      if (pattern.test(normalizedText)) return 'kg';
      const patternHalf = new RegExp(`(?:medio|1\\/2)\\s*(?:kg|kilo)?\\s+[^,\\n]*?${escaped}`, 'i');
      if (patternHalf.test(normalizedText)) return 'kg';
    }
  }
  return null;
}
