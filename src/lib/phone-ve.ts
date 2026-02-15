/**
 * Utilidades de teléfono venezolano para RPYM
 * Validación, normalización y formateo
 */

/** Prefijos de operadores móviles venezolanos (sin 0, sin 58) */
export const VALID_PREFIXES = ['412', '414', '416', '422', '424', '426'];

/** Strip non-digits */
export const normalizePhone = (phone: string): string =>
  phone.replace(/\D/g, '');

/**
 * Normaliza un teléfono venezolano al formato WhatsApp API: 58XXXXXXXXXX (12 dígitos)
 * Acepta: 0414XXXXXXX, 414XXXXXXX, 58414XXXXXXX
 * Retorna null si inválido
 */
export function formatVenezuelanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  let normalized: string;
  if (digits.startsWith('58') && digits.length === 12) {
    normalized = digits;
  } else if (digits.startsWith('0') && digits.length === 11) {
    normalized = '58' + digits.substring(1);
  } else if (digits.length === 10 && digits.startsWith('4')) {
    normalized = '58' + digits;
  } else {
    return null;
  }

  const prefix = normalized.substring(2, 5);
  if (!VALID_PREFIXES.includes(prefix)) {
    return null;
  }

  return normalized;
}

/**
 * Valida cualquier formato de teléfono venezolano aceptado por formatVenezuelanPhone
 * Acepta: 0414XXXXXXX, 414XXXXXXX, 58414XXXXXXX, +58414XXXXXXX
 */
export const isValidVenezuelanPhone = (value: string): boolean =>
  formatVenezuelanPhone(value) !== null;

/**
 * Normaliza a formato 0XXX y formatea para display: 0414-123-4567
 * Acepta: 0414..., 414..., 58414..., +58414...
 */
export const formatPhoneDisplay = (value: string): string => {
  const digits = value.replace(/\D/g, '');

  // Normalizar a 11 dígitos con 0 al inicio
  let local: string;
  if (digits.startsWith('58') && digits.length === 12) {
    local = '0' + digits.substring(2);
  } else if (digits.length === 10 && digits.startsWith('4')) {
    local = '0' + digits;
  } else {
    local = digits;
  }

  if (local.length <= 4) return local;
  if (local.length <= 7) return `${local.slice(0, 4)}-${local.slice(4)}`;
  return `${local.slice(0, 4)}-${local.slice(4, 7)}-${local.slice(7, 11)}`;
};
