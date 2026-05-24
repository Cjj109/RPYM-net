/**
 * Utilidades de texto compartidas (normalización, redondeo).
 */

/** Quita acentos y pasa a minúsculas: "Camarón Jumbo" → "camaron jumbo" */
export const normalizeText = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Redondea a 2 decimales: 12.3456 → 12.35 */
export const round2 = (n: number): number =>
  Math.round(n * 100) / 100;
