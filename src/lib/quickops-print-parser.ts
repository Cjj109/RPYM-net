/**
 * Estrategias para extraer (nombre, cantidad, unidad, precio) de una entrada de QuickOps
 * al imprimir como nota de entrega.
 *
 * Orden de preferencia:
 * 1. Precio entre paréntesis:           "pulpo (25)" o "pulpo (25/kg)"
 * 2. Expresión de multiplicación:       "2*15" con nota "pulpo"
 * 3. Cantidad+unidad al inicio:         "1.72kg pulpo" / "1/2kg pepitona" / "500gr camarón"
 * 4. Solo nombre:                       "pulpo"
 */
import { round2 } from './text-utils';

export interface PrintItem {
  nombre: string;
  cantidad: number;
  unidad: string;
  precioUSD: number;
  subtotalUSD: number;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const normalizeUnit = (raw: string): string => {
  const u = raw.toLowerCase();
  if (/^kg|kilo/.test(u)) return 'kg';
  if (/^caja/.test(u)) return 'caja';
  if (/^paquete/.test(u)) return 'paquete';
  if (/^lt|litro/.test(u)) return 'lt';
  return 'und';
};

// Parses "1/2", "2 1/2", "1.72" — returns NaN if unparseable
function parseFractionalQty(raw: string): number {
  const mixed = raw.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const simple = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (simple) return parseInt(simple[1]) / parseInt(simple[2]);
  return parseFloat(raw.replace(',', '.'));
}

export function parsePriceInParens(
  note: string,
  amtUSD: number,
  inferUnit: (name: string) => string
): PrintItem | null {
  const m = note.match(/^(.*?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*(?:\/\s*(kg|caja|cajas|paquete|und|lt))?\s*\)\s*$/i);
  if (!m) return null;
  const nombre = cap(m[1].trim()) || 'Varios';
  const precioUSD = parseFloat(m[2].replace(',', '.'));
  const unidad = m[3] ? normalizeUnit(m[3]) : inferUnit(nombre);
  const cantidad = precioUSD > 0 ? round2(amtUSD / precioUSD) : 1;
  return { nombre, cantidad, unidad, precioUSD, subtotalUSD: round2(amtUSD) };
}

export function parseMultExpression(
  expression: string,
  note: string,
  amtUSD: number,
  inferUnit: (name: string) => string
): PrintItem | null {
  const m = expression.match(/^(\d+(?:[.,]\d+)?)\s*[\*xX×]\s*(\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const cantidad = parseFloat(m[1].replace(',', '.'));
  const precioUSD = parseFloat(m[2].replace(',', '.'));
  const nombre = note ? cap(note) : 'Varios';
  return { nombre, cantidad, unidad: inferUnit(nombre), precioUSD, subtotalUSD: round2(amtUSD) };
}

export function parseQuantityUnitPrefix(note: string, amtUSD: number): PrintItem | null {
  // Handles fractions (1/2, 2 1/2), decimals (1.72), integers (3), and grams (500g, 500gr, 500gramos)
  // Pattern: (mixed fraction | simple fraction | decimal) then unit
  const m = note.match(
    /^(\d+\s+\d+\/\d+|\d+(?:\s*\/\s*\d+)?(?:[.,]\d+)?)\s*(gramos?|gr|g|kg|kilos?|caja[s]?|paquetes?|unidad|und|lt|litros?)\s*/i
  );
  if (!m) return null;

  let cantidad = parseFractionalQty(m[1].trim());
  let unidad = normalizeUnit(m[2]);

  // Convert grams to kg
  if (/^g$|^gr$|^gramos?$/i.test(m[2].trim())) {
    cantidad = round2(cantidad / 1000);
    unidad = 'kg';
  }

  const rest = note.slice(m[0].length).trim().replace(/^de(?:l| la| los| las)?\s+/i, '');
  const nombre = rest ? cap(rest) : 'Varios';
  const precioUSD = cantidad > 0 ? round2(amtUSD / cantidad) : round2(amtUSD);
  return { nombre, cantidad, unidad, precioUSD, subtotalUSD: round2(amtUSD) };
}

export function parseNameOnly(
  note: string,
  amtUSD: number,
  inferUnit: (name: string) => string
): PrintItem {
  const nombre = note ? cap(note) : 'Varios';
  return {
    nombre,
    cantidad: 1,
    unidad: inferUnit(nombre),
    precioUSD: round2(amtUSD),
    subtotalUSD: round2(amtUSD),
  };
}

/**
 * Convierte una entrada de QuickOps en PrintItem aplicando las 4 estrategias en orden.
 */
export function parsePrintEntry(
  note: string,
  expression: string,
  amtUSD: number,
  inferUnit: (name: string) => string
): PrintItem {
  const cleanNote = (note || '').trim();
  const cleanExpr = (expression || '').trim();
  return (
    parsePriceInParens(cleanNote, amtUSD, inferUnit) ||
    parseMultExpression(cleanExpr, cleanNote, amtUSD, inferUnit) ||
    parseQuantityUnitPrefix(cleanNote, amtUSD) ||
    parseNameOnly(cleanNote, amtUSD, inferUnit)
  );
}
