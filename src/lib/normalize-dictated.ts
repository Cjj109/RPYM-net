/**
 * Normaliza cantidades dictadas a la forma que ya entienden los prompts.
 *
 * Al hablar uno dice "medio kilo de camarón", no "0.5kg camarón". Pedirle al
 * modelo que haga esa conversión funciona a veces; hacerla en código funciona
 * siempre, y "medio kilo" es justo el caso que más se usa en el mostrador.
 *
 * Solo se convierten números que van pegados a una unidad o a un monto, para
 * no tocar el resto del texto ni los nombres de productos.
 */

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};

const DECENAS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90,
};

const CENTENAS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300,
  cuatrocientos: 400, quinientos: 500, seiscientos: 600,
  setecientos: 700, ochocientos: 800, novecientos: 900,
};

/** Unidades de venta que pueden seguir a un número */
const UNIDADES_VENTA = 'kilos?|kilogramos?|kg|gramos?|cajas?|bolsas?|paquetes?|unidades?|docenas?';

const quitarAcentos = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Convierte una secuencia de palabras-número en cifra.
 * Devuelve null si la secuencia no es un número válido.
 */
export function palabrasANumero(texto: string): number | null {
  const palabras = quitarAcentos(texto.toLowerCase())
    .split(/\s+/)
    .filter(p => p && p !== 'y');

  if (palabras.length === 0) return null;

  let total = 0;
  let actual = 0;
  let vioAlgo = false;

  for (const palabra of palabras) {
    if (palabra === 'mil') {
      // "mil" solo = 1000; "dos mil" = 2000
      total += (actual === 0 ? 1 : actual) * 1000;
      actual = 0;
      vioAlgo = true;
    } else if (CENTENAS[palabra] !== undefined) {
      actual += CENTENAS[palabra];
      vioAlgo = true;
    } else if (DECENAS[palabra] !== undefined) {
      actual += DECENAS[palabra];
      vioAlgo = true;
    } else if (UNIDADES[palabra] !== undefined) {
      actual += UNIDADES[palabra];
      vioAlgo = true;
    } else {
      return null; // una palabra que no es número invalida la secuencia
    }
  }

  return vioAlgo ? total + actual : null;
}

/** Formatea sin decimales sobrantes: 2 en vez de 2.0, 2.5 tal cual */
const fmt = (n: number) => String(n);

/** Normaliza la unidad al token corto que usan los prompts */
function unidadCorta(unidad: string): string {
  const u = quitarAcentos(unidad.toLowerCase());
  if (/^(kilos?|kilogramos?|kg)$/.test(u)) return 'kg';
  if (/^gramos?$/.test(u)) return 'g';
  return ' ' + u.replace(/s$/, ''); // caja, bolsa, paquete, unidad
}

export function normalizeDictatedText(texto: string): string {
  if (!texto) return texto;
  let out = texto;

  // Una palabra-número suelta
  const W = '(?:uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|'
    + 'once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|'
    + 'veinti(?:un|uno|d[oó]s|tr[eé]s|cuatro|cinco|s[eé]is|siete|ocho|nueve)|veinte|'
    + 'treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|'
    + 'cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|'
    + 'seiscientos|setecientos|ochocientos|novecientos|mil)';

  // Secuencia de palabras-número. El "y" solo puede ir ENTRE dos números
  // ("treinta y cinco"): si se permite al inicio, el patrón se traga el "y"
  // que separa un producto del siguiente.
  const NUM = `${W}(?:\\s+(?:y\\s+)?${W})*`;

  const num = (s: string) => palabrasANumero(s);

  // "cuarto de kilo" → 0.25kg
  out = out.replace(/\b(?:un\s+)?cuarto\s+de\s+(kilos?|kilogramos?|kg)\b/gi, '0.25kg');

  // "tres kilos y medio" → 3.5kg
  out = out.replace(
    new RegExp(`\\b(${NUM})\\s+(${UNIDADES_VENTA})\\s+y\\s+medi[oa]\\b`, 'gi'),
    (m, n: string, unidad: string) => {
      const v = num(n);
      return v === null ? m : `${fmt(v + 0.5)}${unidadCorta(unidad)}`;
    }
  );

  // "2 kilos y medio" → 2.5kg
  out = out.replace(
    new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${UNIDADES_VENTA})\\s+y\\s+medi[oa]\\b`, 'gi'),
    (_m, n: string, unidad: string) =>
      `${fmt(parseFloat(n.replace(',', '.')) + 0.5)}${unidadCorta(unidad)}`
  );

  // "kilo y medio" sin número delante → 1.5kg
  out = out.replace(
    new RegExp(`\\b(${UNIDADES_VENTA})\\s+y\\s+medi[oa]\\b`, 'gi'),
    (_m, unidad: string) => `1.5${unidadCorta(unidad)}`
  );

  // "medio kilo" / "media caja" → 0.5kg / 0.5 caja
  out = out.replace(
    new RegExp(`\\bmedi[oa]\\s+(${UNIDADES_VENTA})\\b`, 'gi'),
    (_m, unidad: string) => `0.5${unidadCorta(unidad)}`
  );

  // "dos kilos" → 2kg, "quinientos gramos" → 500g, "tres cajas" → 3 caja
  out = out.replace(
    new RegExp(`\\b(${NUM})\\s+(${UNIDADES_VENTA})\\b`, 'gi'),
    (m, n: string, unidad: string) => {
      const v = num(n);
      return v === null ? m : `${fmt(v)}${unidadCorta(unidad)}`;
    }
  );

  // Docenas a piezas. Va después de la conversión general, que ya dejó
  // "una docena" como "1 docena".
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*docenas?\b/gi,
    (_m, n: string) => `${fmt(parseFloat(n) * 12)} unidad`);
  out = out.replace(/\bdocenas?\b/gi, '12 unidad');

  // "diez dólares" → $10
  out = out.replace(
    new RegExp(`\\b(${NUM})\\s+d[oó]lar(?:es)?\\b`, 'gi'),
    (m, n: string) => {
      const v = num(n);
      return v === null ? m : `$${fmt(v)}`;
    }
  );

  // "10 dólares" → $10
  out = out.replace(/\b(\d+(?:[.,]\d+)?)\s*d[oó]lar(?:es)?\b/gi,
    (_m, n: string) => `$${n.replace(',', '.')}`);

  return out.replace(/\s{2,}/g, ' ').trim();
}
