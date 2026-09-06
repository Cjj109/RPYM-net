/**
 * Lectura de la tasa publicada por el BCV, que es la fuente oficial.
 *
 * Por que hizo falta: el 5 de septiembre de 2026 el sitio mostraba 807 (la
 * tasa del viernes) mientras el BCV ya publicaba 813,7361. Al revisarlo,
 * api.exchangedyn.com y bcvapi.tech ya no resolvian, pydolarve.org habia
 * desaparecido y ve.dolarapi.com seguia sirviendo la tasa del dia anterior.
 *
 * EL CERTIFICADO DE bcv.org.ve
 *
 * Aqui decia que el servidor "entrega la cadena de certificados incompleta
 * (le falta el intermedio)". Dos cosas mal, y las dos importan:
 *
 * 1. No falta un eslabon: el que manda es EQUIVOCADO. El certificado de
 *    *.bcv.org.ve lo emite "Sectigo Public Server Authentication CA DV R36",
 *    pero el servidor entrega "Sectigo RSA Domain Validation Secure Server
 *    CA", que es otra CA — un sobrante de un certificado anterior. El
 *    intermedio bueno no viaja en la conexion.
 *
 * 2. "Ni Node ni el motor de Cloudflare lo aceptan — comprobado en workerd,
 *    que es lo que corre en produccion." Esto es falso, y por eso hubo que
 *    montar el proxy. Lo que se probo fue workerd EN LOCAL, que usa otro
 *    almacen de confianza que la red real de Cloudflare. La red de
 *    Cloudflare SI lo acepta, porque hace AIA fetching: lee la extension
 *    "CA Issuers" del certificado, se baja el intermedio que falta y cierra
 *    la cadena sola. Comprobado en produccion.
 *
 * Node no hace AIA fetching, y de ahi el UNABLE_TO_VERIFY_LEAF_SIGNATURE que
 * se ve en local.
 *
 * En consecuencia, el orden de intentos:
 *
 *   1. bcv.org.ve directo. En produccion funciona; en local falla.
 *   2. El puente de Vercel, que completa la cadena a mano con el intermedio
 *      empotrado. Es nuestro, no tiene limite de peticiones y lee el mismo
 *      HTML. Reemplaza a Jina como primer respaldo.
 *   3. El lector de Jina, ya solo como ultimo recurso. Es un tercero
 *      gratuito que limita por IP y necesita clave para no rechazar a
 *      Cloudflare.
 *
 * El certificado del BCV caduca el 20/11/2026: al renovarlo puede que
 * arreglen la cadena, o que la rompan de otra forma.
 */

export interface TasaBCV {
  rate: number;
  date: string;
  source: string;
}

const URL_DIRECTA = 'https://www.bcv.org.ve/';
const URL_PUENTE = 'https://bcv-puente.vercel.app/api/bcv';
const URL_PROXY = 'https://r.jina.ai/https://www.bcv.org.ve/';
const TIMEOUT_MS = 8000;

const MESES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

/** "Lunes, 07 Septiembre 2026" -> "07/09/2026"; si no encaja, devuelve hoy */
function aFecha(texto: string | undefined): string {
  const hoy = new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas' });
  if (!texto) return hoy;

  const encontrado = texto.match(/(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})/);
  if (!encontrado) return hoy;

  const mes = MESES[encontrado[2].toLowerCase()];
  if (!mes) return hoy;

  return `${encontrado[1].padStart(2, '0')}/${mes}/${encontrado[3]}`;
}

/**
 * Se intenta primero la pagina del BCV directamente. En local falla por la
 * cadena de certificados incompleta, pero la red de Cloudflare tiene otro
 * almacen de confianza y puede que si la acepte; si funciona, se acaba la
 * dependencia del proxy. Si no, se cae al proxy, que a veces limita las
 * peticiones desde Cloudflare, y por eso se reintenta una vez.
 */
/**
 * La fecha de vigencia. En el HTML del BCV viene exacta en un atributo
 * (content="2026-09-07T00:00:00-04:00"); en el texto del proxy solo queda
 * escrita como "Fecha Valor: Lunes, 07 Septiembre 2026".
 */
function extraerFecha(texto: string): string {
  const iso = texto.match(/date-display-single[^>]*content="(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  return aFecha(
    texto.match(/Fecha Valor:\s*([^\n<]+)/)?.[1] ??
      texto.match(/date-display-single[^>]*>([^<]+)</)?.[1]
  );
}

function buscarEnHtml(html: string): RegExpMatchArray | null {
  const inicio = html.indexOf('id="dolar"');
  if (inicio === -1) return null;
  return html.slice(inicio, inicio + 600).match(/<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/);
}

/**
 * Lee la tasa del BCV por el puente de Vercel.
 *
 * Devuelve JSON, no HTML, asi que no pasa por intentarLectura: ese parsea
 * paginas. El puente ya hizo el trabajo sucio de completar la cadena de
 * certificados y sacar el numero.
 */
async function intentarPuente(): Promise<TasaBCV | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(URL_PUENTE, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 900, cacheEverything: true },
    } as RequestInit);

    clearTimeout(timeout);
    if (!respuesta.ok) return null;

    const datos = await respuesta.json() as { usd?: number | null; fecha?: string | null };
    const valor = Number(datos.usd);
    if (!Number.isFinite(valor) || valor <= 0 || valor > 1_000_000) return null;

    // El puente da la fecha en ISO (2026-09-07); aqui se usa dd/mm/aaaa
    const iso = datos.fecha?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    return {
      rate: Math.round(valor * 100) / 100,
      date: iso
        ? `${iso[3]}/${iso[2]}/${iso[1]}`
        : new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas' }),
      source: 'BCV',
    };
  } catch (error) {
    clearTimeout(timeout);
    console.error('[BCV] Error leyendo por el puente:', error);
    return null;
  }
}

export async function fetchTasaBCVOficial(claveJina?: string): Promise<TasaBCV | null> {
  // 1. El BCV directo. En produccion funciona; en local falla por el
  //    certificado, y ahi entra el puente.
  const directa = await intentarLectura(URL_DIRECTA);
  if (directa) return directa;

  // 2. El puente propio: mismo HTML, sin limites de peticiones ni clave.
  const porPuente = await intentarPuente();
  if (porPuente) return porPuente;

  // 3. Jina, ya solo como ultimo recurso. Limita por IP, y sin clave rechaza
  //    a Cloudflare; por eso el reintento.
  const porProxy = await intentarLectura(URL_PROXY, claveJina);
  if (porProxy) return porProxy;

  await new Promise((r) => setTimeout(r, 600));
  return intentarLectura(URL_PROXY, claveJina);
}

async function intentarLectura(url: string, claveJina?: string): Promise<TasaBCV | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html, text/plain, text/markdown',
        'User-Agent': 'Mozilla/5.0 (compatible; RPYM/1.0; +https://rpym.net)',
        // Sin clave, el proxy limita por IP y rechaza a Cloudflare
        ...(claveJina ? { Authorization: `Bearer ${claveJina}` } : {}),
      },
      // La pagina del BCV cambia una vez al dia: se cachea en el borde para
      // no descargarla en cada visita.
      cf: { cacheTtl: 900, cacheEverything: true },
    } as RequestInit);

    clearTimeout(timeout);
    if (!respuesta.ok) return null;

    const texto = await respuesta.text();

    // Dos formatos posibles:
    //   proxy (texto):  ) USD\n\n**813,73610000**
    //   BCV (HTML):     <div id="dolar"> ... <strong>813,73610000</strong>
    const encontrado =
      texto.match(/USD\s*\*\*\s*([\d.,]+)\s*\*\*/) ?? buscarEnHtml(texto);
    if (!encontrado) return null;

    // "813,73610000" -> 813.7361
    const valor = parseFloat(encontrado[1].replace(/\./g, '').replace(',', '.'));

    // Salvaguarda: si el formato cambia y se lee cualquier cosa, se descarta
    // y quien llama se va al respaldo en vez de publicar una tasa absurda.
    if (!Number.isFinite(valor) || valor <= 0 || valor > 1_000_000) return null;

    return {
      rate: Math.round(valor * 100) / 100,
      date: extraerFecha(texto),
      source: 'BCV',
    };
  } catch (error) {
    clearTimeout(timeout);
    console.error('[BCV] Error leyendo la tasa oficial:', error);
    return null;
  }
}
