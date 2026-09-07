/**
 * Helpers de formato centralizados para RPYM
 * Moneda, cantidades, fechas
 */

// ── Moneda ──────────────────────────────────────────────

export const formatUSD = (amount: number): string =>
  `$${Number(amount).toFixed(2)}`;

export const formatBs = (amount: number): string =>
  `Bs. ${Number(amount).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatEUR = (amount: number): string =>
  `€${Number(amount).toFixed(2)}`;

/**
 * Precio compacto para etiquetas secundarias: "$9" en vez de "$9.00",
 * pero conserva los decimales cuando importan ("$4.50").
 */
export const formatUSDCompact = (amount: number): string =>
  `$${Number(amount).toFixed(2).replace(/\.00$/, '')}`;

// ── Cantidades ──────────────────────────────────────────

/** Hasta 3 decimales, trim trailing zeros. '' para qty === 0 */
export const formatQuantity = (qty: number): string => {
  if (qty === 0) return '';
  const rounded = Math.round(qty * 1000) / 1000;
  return rounded.toFixed(3).replace(/\.?0+$/, '');
};

// ── Fechas (manual parsing, timezone-safe) ──────────────

const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTHS_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_FULL_CAP = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Extrae [year, month, day] de "YYYY-MM-DD" o "YYYY-MM-DDT..." */
function parseDateParts(dateStr: string): [string, string, string] | null {
  const datePart = dateStr.split('T')[0];
  const parts = datePart.split('-');
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  return null;
}

/** "YYYY-MM-DD" → "14/02/2026" */
export const formatDateDMY = (dateStr: string): string => {
  if (!dateStr) return '-';
  const p = parseDateParts(dateStr);
  return p ? `${p[2]}/${p[1]}/${p[0]}` : dateStr;
};

/** "YYYY-MM-DD" → "14/02" */
export const formatDateShort = (dateStr: string): string => {
  const p = parseDateParts(dateStr);
  return p ? `${p[2]}/${p[1]}` : dateStr;
};

/** "YYYY-MM-DD" → "14/02/2026, 10:30" (usa toLocaleDateString para hora) */
export const formatDateWithTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

/** "YYYY-MM-DD" → "14 de febrero" */
export const formatDateReadable = (dateStr: string): string => {
  const p = parseDateParts(dateStr);
  if (!p) return dateStr;
  const day = parseInt(p[2]);
  const monthName = MONTHS_FULL[parseInt(p[1]) - 1];
  return `${day} de ${monthName}`;
};

/** "YYYY-MM-DD" → "14 Feb 2026" */
export const formatDateMonthShort = (dateStr: string): string => {
  const p = parseDateParts(dateStr);
  if (!p) return dateStr;
  const month = MONTHS_SHORT[parseInt(p[1]) - 1] || p[1];
  return `${p[2]} ${month} ${p[0]}`;
};

/** "YYYY-MM-DD" → "Febrero 2026" */
export const formatMonthYear = (dateStr: string): string => {
  const p = parseDateParts(dateStr);
  if (!p) return dateStr;
  const month = MONTHS_FULL_CAP[parseInt(p[1]) - 1] || p[1];
  return `${month} ${p[0]}`;
};

/** Fecha actual en formato display "DD/MM/YYYY" */
export const getCurrentDateDisplay = (): string => {
  const now = new Date();
  return now.toLocaleDateString('es-VE', {
    // El servidor corre en UTC: sin la zona, entre las 8 de la noche y la
    // medianoche de Caracas esto ya decía mañana.
    timeZone: 'America/Caracas',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
};

/**
 * Hoy en Caracas, "AAAA-MM-DD".
 *
 * El código estaba lleno de `new Date().toISOString().split('T')[0]`, que es
 * hoy en UTC: a partir de las 8 de la noche hora de Venezuela ya devuelve el
 * día siguiente. En la tasa del BCV eso importaba especialmente, porque las 8
 * de la noche es justo después de que el BCV publique.
 *
 * Venezuela no cambia la hora, así que el respaldo a mano (UTC-4) es exacto
 * si el runtime viniera sin datos de zonas horarias.
 */
export const hoyEnCaracas = (ahora: Date = new Date()): string => {
  const iso = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(ahora.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

/** "07/09/2026" -> "2026-09-07"; null si no encaja */
export const dmyAIso = (fecha: string | null | undefined): string | null => {
  const p = String(fecha ?? '').split('/');
  if (p.length !== 3) return null;
  const [dia, mes, ano] = p;
  if (dia.length > 2 || mes.length > 2 || ano.length !== 4) return null;
  const iso = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
};
