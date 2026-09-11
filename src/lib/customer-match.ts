/**
 * Resolución del cliente en la anotación rápida con IA.
 *
 * La IA propone un cliente, pero la decisión final es determinista:
 * 1. Coincidencia exacta con el nombre escrito → se asigna.
 * 2. Coincidencia parcial con un solo cliente → se asigna si el nombre escrito
 *    es distintivo ("canastas" → "Canastas del Mar", "garcia" → "Jose Garcia").
 *    Si solo es un nombre de pila común ("jose" → "Jose Luis") puede ser otra
 *    persona: no se asigna y queda como sugerencia para elegirla con un clic.
 * 3. Varias coincidencias → no se asigna.
 */

export interface MatchCustomer {
  id: number;
  name: string;
}

export interface CustomerResolution {
  id: number | null;
  name: string;
  /** Cliente parecido que no se asignó solo (se ofrece como sugerencia) */
  suggestion: MatchCustomer | null;
}

export interface ResolveCustomerInput {
  /** Texto completo que escribió o dictó el usuario */
  text: string;
  /** Nombre del cliente tal cual lo escribió el usuario (lo devuelve la IA) */
  writtenName?: string | null;
  /** Cliente que eligió la IA (puede no existir) */
  aiCustomerId?: number | string | null;
  /** customerName de la IA: el de la lista si eligió uno, o el escrito si no */
  aiCustomerName?: string | null;
}

/**
 * Nombres de pila tan comunes que, solos, no identifican a nadie: "jose" puede
 * ser "Jose Luis" o cualquier otro José. Sin acentos y en minúsculas.
 */
const COMMON_FIRST_NAMES = new Set([
  // Masculinos
  'jose', 'luis', 'carlos', 'juan', 'pedro', 'jesus', 'miguel', 'angel', 'antonio',
  'manuel', 'francisco', 'rafael', 'david', 'daniel', 'alejandro', 'jorge', 'ricardo',
  'eduardo', 'fernando', 'roberto', 'andres', 'oscar', 'victor', 'pablo', 'javier',
  'gabriel', 'sergio', 'alberto', 'enrique', 'ramon', 'hector', 'raul', 'mario',
  'julio', 'cesar', 'orlando', 'freddy', 'wilmer', 'jhon', 'john', 'jean', 'nelson',
  'edgar', 'gustavo', 'alexis', 'richard', 'franklin', 'johan', 'kevin', 'diego',
  'felix', 'simon', 'samuel', 'adrian', 'arturo', 'ernesto', 'armando', 'rodolfo',
  'gregorio', 'humberto', 'ivan', 'leonardo', 'marcos', 'martin', 'nicolas', 'omar',
  'tomas', 'vicente', 'william', 'jonathan', 'yonathan', 'alexander', 'anderson',
  'jairo', 'jaime', 'joel', 'jhonny', 'johnny', 'junior', 'wilson', 'yorman', 'ronald',
  // Femeninos
  'maria', 'ana', 'carmen', 'rosa', 'luisa', 'isabel', 'elena', 'laura', 'andrea',
  'carolina', 'gabriela', 'daniela', 'alejandra', 'patricia', 'marta', 'martha', 'sofia',
  'valentina', 'paola', 'mariela', 'marisol', 'yolanda', 'gloria', 'beatriz', 'teresa',
  'julia', 'lucia', 'claudia', 'sandra', 'monica', 'veronica', 'adriana', 'diana',
  'jessica', 'karla', 'carla', 'yesenia', 'jenny', 'yenny', 'milagros', 'elizabeth',
  'fernanda', 'josefina', 'juana', 'mercedes', 'nancy', 'norma', 'silvia', 'susana',
  'victoria', 'maribel', 'marisela', 'yulimar', 'johana', 'yohana', 'rosario', 'esther',
  'alicia', 'angela', 'lourdes', 'margarita', 'mariana', 'natalia', 'raquel', 'irene',
]);

/** Palabras que no cuentan para comparar nombres */
const STOP_TOKENS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'a', 'sr', 'sra', 'don', 'dona',
  'senor', 'senora', 'cliente', 'para', 'con',
]);

/** Minúsculas, sin acentos ni puntuación, espacios simples */
export function normalizeCustomerName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalizeCustomerName(s).split(' ').filter(t => t && !STOP_TOKENS.has(t));
}

/** Clave fonética simple del español: "delsi" = "delcy", "bibiana" = "viviana" */
function phoneticKey(t: string): string {
  return t
    .replace(/h/g, '')
    .replace(/qu/g, 'k')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/ll/g, 'y')
    .replace(/y$/, 'i')
    .replace(/(.)\1+/g, '$1');
}

/**
 * ¿La palabra escrita corresponde a esta palabra del cliente?
 * Igual, igual al oído, o abreviada/plural sin cambiar de palabra
 * ("canasta" ~ "canastas"), pero "jose" no es "josefina" ni "mar" es "maria".
 */
function tokenMatches(written: string, customer: string): boolean {
  if (written === customer) return true;
  if (written.length >= 4 && customer.length >= 4 && phoneticKey(written) === phoneticKey(customer)) return true;
  const [short, long] = written.length <= customer.length ? [written, customer] : [customer, written];
  return short.length >= 4 && long.startsWith(short) && long.length - short.length <= 2;
}

/** El nombre escrito es solo nombre(s) de pila comunes: no basta para identificar */
export function isGenericFirstName(name: string): boolean {
  const t = tokens(name);
  return t.length > 0 && t.every(x => COMMON_FIRST_NAMES.has(x));
}

const found = (c: MatchCustomer): CustomerResolution => ({ id: c.id, name: c.name, suggestion: null });

/**
 * Valida contra el texto un cliente elegido por la IA cuando no hay nombre
 * escrito con qué comparar.
 */
function resolveByText(chosen: MatchCustomer, text: string, fallbackName: string): CustomerResolution {
  const textTokens = tokens(text);
  const customerWords = chosen.name.split(/\s+/).filter(w => {
    const t = normalizeCustomerName(w);
    return t.length >= 3 && !STOP_TOKENS.has(t);
  });
  const present = customerWords.filter(w => {
    const t = normalizeCustomerName(w);
    return textTokens.some(x => tokenMatches(x, t));
  });

  if (customerWords.length > 0 && present.length === customerWords.length) return found(chosen);
  if (present.length === 0) return { id: null, name: fallbackName, suggestion: null };
  // Solo aparece un nombre de pila ("jose" de "Jose Luis"): puede ser otra persona
  if (present.every(w => COMMON_FIRST_NAMES.has(normalizeCustomerName(w)))) {
    return { id: null, name: present.join(' '), suggestion: chosen };
  }
  return found(chosen);
}

function resolveByWrittenName(
  written: string,
  chosen: MatchCustomer | null,
  text: string,
  customers: MatchCustomer[]
): CustomerResolution {
  const w = normalizeCustomerName(written);
  const exact = customers.filter(c => normalizeCustomerName(c.name) === w);
  if (exact.length === 1) return found(exact[0]);
  if (exact.length > 1) return { id: null, name: written, suggestion: null };

  const wt = tokens(written);
  const candidates = wt.length
    ? customers.filter(c => {
        const ct = tokens(c.name);
        return wt.every(t => ct.some(x => tokenMatches(t, x)));
      })
    : [];

  if (candidates.length === 1) {
    return isGenericFirstName(written)
      ? { id: null, name: written, suggestion: candidates[0] }
      : found(candidates[0]);
  }
  if (candidates.length > 1) {
    const suggestion = chosen && candidates.some(c => c.id === chosen.id) ? chosen : null;
    return { id: null, name: written, suggestion };
  }

  // El nombre completo de un cliente está dentro de lo escrito ("friteria chon centro")
  const contained = customers.filter(c => {
    const ct = tokens(c.name);
    return ct.length > 0 && ct.every(t => wt.some(x => tokenMatches(x, t)));
  });
  if (contained.length === 1) {
    return isGenericFirstName(contained[0].name)
      ? { id: null, name: written, suggestion: contained[0] }
      : found(contained[0]);
  }

  // Ninguno se parece por nombre: la IA pudo reconocerlo por el texto completo
  if (chosen) {
    const r = resolveByText(chosen, text, written);
    return r.id !== null ? r : { id: null, name: written, suggestion: r.suggestion };
  }
  return { id: null, name: written, suggestion: null };
}

/** Nombre escrito en formatos "Delsy: ..." o "... para Delsy" */
function extractWrittenName(text: string): string {
  return (
    text.match(/^\s*([\p{L} .'-]{2,40}?)\s*:/u)?.[1]
    || text.match(/\bpara\s+([\p{L} .'-]{2,40}?)\s*(?:$|[,;\n.])/iu)?.[1]
    || ''
  ).trim();
}

/**
 * Decide el cliente de una anotación a partir de lo que escribió el usuario y
 * del cliente que propuso la IA. Ver reglas al inicio del archivo.
 */
export function resolveCustomer(input: ResolveCustomerInput, customers: MatchCustomer[]): CustomerResolution {
  const chosen = input.aiCustomerId != null && input.aiCustomerId !== ''
    ? customers.find(c => String(c.id) === String(input.aiCustomerId)) ?? null
    : null;
  // Si la IA no eligió a nadie, su customerName es el nombre tal cual lo escribió
  const written = (input.writtenName || '').trim() || (chosen ? '' : (input.aiCustomerName || '').trim());

  if (normalizeCustomerName(written) === 'cliente') return { id: null, name: 'Cliente', suggestion: null };
  if (written) return resolveByWrittenName(written, chosen, input.text, customers);
  if (chosen) return resolveByText(chosen, input.text, extractWrittenName(input.text) || 'Cliente');
  return { id: null, name: 'Cliente', suggestion: null };
}
