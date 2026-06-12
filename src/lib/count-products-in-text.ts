/**
 * Cuenta cuántos productos parece contener el texto de una anotación con IA.
 * Conteo heurístico independiente de la IA: sirve para verificar que la IA
 * capturó todos los productos de la lista (badge "3/4" en la confirmación).
 */

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Cantidad + unidad: "1kg", "2 cajas", "3 unidades", "500g", "medio kilo", "1/2 kg"
const qtyUnitRegex = /\d+(?:[.,]\d+)?\s*(?:kg|kilo|kilos|caja|cajas|cj|unidad|unidades|paquete|paquetes|bolsa|bolsas|g|gr|gramos)\b/i;
const halfKgRegex = /(?:medio|1\/2)\s*(?:kg|kilo)\b/i;
// Monto en dólares: "$20 de calamar", "20$ en camarón", "15 dolares de pulpo"
const dollarOfRegex = /(?:\$\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*\$|\d+(?:[.,]\d+)?\s*(?:d[oó]lares?|dollars?|usd))\s*(?:de|del|en)\s+\S/i;
// Segmentos que NO son productos aunque tengan cantidad
const notProductRegex = /\b(?:delivery|env[ií]o|flete)\b/i;

/**
 * Devuelve el número estimado de productos en el texto.
 * Es conservador: solo cuenta segmentos con cantidad explícita, por lo que puede
 * subestimar (productos sin cantidad). El caller debe combinarlo con lo que la IA
 * reportó, ej: Math.max(countProductsInText(text), items.length + unmatched.length).
 */
export function countProductsInText(text: string): number {
  if (!text || !text.trim()) return 0;
  const normalizedText = normalize(text);
  // Misma segmentación que detect-explicit-unit: comas, ';', saltos de línea, "y",
  // y límites de cantidad para texto corrido sin separadores. El lookahead exige
  // espacio previo y letra después para no cortar tallas como "41/50"
  const qtyBoundary = /(?=(?<=\s)\d+(?:[.,]\d+)?\s*(?:kg|kilo|kilos|caja|cajas|cj|unidad|unidades|paquete|paquetes|bolsa|bolsas)?\s+[a-z])/i;
  const segments = normalizedText
    .split(/[,;\n]|\s+y\s+/)
    .flatMap(seg => seg.split(qtyBoundary));

  let count = 0;
  for (const seg of segments) {
    if (notProductRegex.test(seg)) continue;
    if (qtyUnitRegex.test(seg) || halfKgRegex.test(seg) || dollarOfRegex.test(seg)) {
      count++;
    }
  }
  return count;
}
