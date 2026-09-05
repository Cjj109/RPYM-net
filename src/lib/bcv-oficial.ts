/**
 * Lectura de la tasa publicada por el BCV, que es la fuente oficial.
 *
 * Por que hizo falta: el 5 de septiembre de 2026 el sitio mostraba 807 (la
 * tasa del viernes) mientras el BCV ya publicaba 813,7361. Al revisarlo,
 * api.exchangedyn.com y bcvapi.tech ya no resolvian, pydolarve.org habia
 * desaparecido y ve.dolarapi.com seguia sirviendo la tasa del dia anterior.
 *
 * Por que no se lee bcv.org.ve directamente: su servidor entrega la cadena
 * de certificados incompleta (le falta el intermedio). curl en macOS lo
 * tolera, pero ni Node ni el motor de Cloudflare lo aceptan — comprobado en
 * workerd, que es lo que corre en produccion. Por eso se lee a traves del
 * lector de Jina, que si presenta un certificado valido y devuelve el
 * contenido del BCV en texto. Si algun dia el BCV arregla su cadena, basta
 * con apuntar URL_BCV a https://www.bcv.org.ve/ y ajustar el parseo al HTML.
 */

export interface TasaBCV {
  rate: number;
  date: string;
  source: string;
}

const URL_DIRECTA = 'https://www.bcv.org.ve/';
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
function buscarEnHtml(html: string): RegExpMatchArray | null {
  const inicio = html.indexOf('id="dolar"');
  if (inicio === -1) return null;
  return html.slice(inicio, inicio + 600).match(/<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/);
}

export async function fetchTasaBCVOficial(): Promise<TasaBCV | null> {
  const directa = await intentarLectura(URL_DIRECTA);
  if (directa) return directa;

  const porProxy = await intentarLectura(URL_PROXY);
  if (porProxy) return porProxy;

  await new Promise((r) => setTimeout(r, 600));
  return intentarLectura(URL_PROXY);
}

async function intentarLectura(url: string): Promise<TasaBCV | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html, text/plain, text/markdown',
        'User-Agent': 'Mozilla/5.0 (compatible; RPYM/1.0; +https://rpym.net)',
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
      date: aFecha(
        texto.match(/Fecha Valor:\s*([^\n<]+)/)?.[1] ??
          texto.match(/date-display-single[^>]*>([^<]+)</)?.[1]
      ),
      source: 'BCV',
    };
  } catch (error) {
    clearTimeout(timeout);
    console.error('[BCV] Error leyendo la tasa oficial:', error);
    return null;
  }
}
