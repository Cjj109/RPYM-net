/**
 * El orden de respaldo de la tasa oficial.
 *
 * No habia tests de esto, y es justo donde duele equivocarse: si la cadena de
 * respaldos se rompe en silencio, el sitio sigue cobrando con una tasa vieja
 * y nadie se entera. Ya pasó una vez.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTasaBCVOficial } from '../bcv-oficial';

const HTML_BCV = `
  <div class="pull-right dinpro center"> Fecha Valor:
    <span class="date-display-single" content="2026-09-07T00:00:00-04:00">Lunes, 07 Septiembre 2026</span>
  </div>
  <div id="dolar" class="col-sm-12">
    <div class="col-sm-6"><span> USD</span></div>
    <div class="col-sm-6 centrado textp"><strong class="strong-tb">813,73610000</strong></div>
  </div>`;

const TEXTO_JINA = ') USD\n\n**799,50000000**\n\nFecha Valor: Lunes, 07 Septiembre 2026';

const ok = (cuerpo: string) => ({ ok: true, text: async () => cuerpo, json: async () => JSON.parse(cuerpo) });
const falla = () => { throw new Error('UNABLE_TO_VERIFY_LEAF_SIGNATURE'); };

/** Responde según la URL, simulando qué camino está vivo */
function fetchFingido(rutas: Record<string, () => unknown>) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('https://www.bcv.org.ve')) return rutas.directa?.() ?? falla();
    if (url.startsWith('https://bcv-puente')) return rutas.puente?.() ?? falla();
    if (url.startsWith('https://r.jina.ai')) return rutas.jina?.() ?? falla();
    throw new Error(`URL inesperada: ${url}`);
  });
}

describe('fetchTasaBCVOficial', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('usa el BCV directo cuando responde, sin tocar los respaldos', async () => {
    const fetch = fetchFingido({ directa: () => ok(HTML_BCV) });
    vi.stubGlobal('fetch', fetch);

    expect(await fetchTasaBCVOficial()).toEqual({
      rate: 813.74,
      date: '07/09/2026',
      source: 'BCV',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cae al puente si el directo falla, y traduce la fecha ISO', async () => {
    // Es lo que pasa en local: el certificado del BCV no valida
    const fetch = fetchFingido({
      puente: () => ok('{"usd":813.7361,"eur":945.65085917,"fecha":"2026-09-07"}'),
    });
    vi.stubGlobal('fetch', fetch);

    expect(await fetchTasaBCVOficial()).toEqual({
      rate: 813.74,
      date: '07/09/2026',
      source: 'BCV',
    });
  });

  it('solo llega a Jina si el directo y el puente fallan', async () => {
    const fetch = fetchFingido({ jina: () => ok(TEXTO_JINA) });
    vi.stubGlobal('fetch', fetch);

    const tasa = await fetchTasaBCVOficial('clave');
    expect(tasa?.rate).toBe(799.5);

    const pedidas = fetch.mock.calls.map(([url]) => String(url));
    expect(pedidas[0]).toContain('bcv.org.ve');
    expect(pedidas[1]).toContain('bcv-puente');
    expect(pedidas[2]).toContain('r.jina.ai');
  });

  it('devuelve null si se cae todo, en vez de inventarse una tasa', async () => {
    vi.stubGlobal('fetch', fetchFingido({}));
    expect(await fetchTasaBCVOficial()).toBeNull();
  });

  it('descarta una cifra absurda del puente y sigue al siguiente respaldo', async () => {
    // Si el formato cambia y se lee cualquier cosa, mejor el respaldo que
    // publicar un disparate: con esa tasa se cobra de verdad.
    vi.stubGlobal('fetch', fetchFingido({
      puente: () => ok('{"usd":0,"fecha":"2026-09-07"}'),
      jina: () => ok(TEXTO_JINA),
    }));

    expect((await fetchTasaBCVOficial('clave'))?.rate).toBe(799.5);
  });
});

describe('el puente como fuente visible del panel', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('aparece en la lista de fuentes, detrás de la oficial', async () => {
    const { TODAS_LAS_FUENTES, FUENTE_META } = await import('../bcv-fuentes');

    expect(TODAS_LAS_FUENTES).toContain('puente');
    // Detrás de la oficial: leen la misma página, así que la directa manda
    expect(TODAS_LAS_FUENTES.indexOf('puente')).toBe(TODAS_LAS_FUENTES.indexOf('oficial') + 1);
    // Sin clave: es lo que la hace útil como respaldo frente a Jina o Cotizave
    expect(FUENTE_META.puente.requiereClave).toBe(false);
  });

  it('leerFuente("puente") lee el puente y nada más', async () => {
    const { leerFuente } = await import('../bcv-fuentes');
    const fetch = fetchFingido({
      puente: () => ok('{"usd":813.7361,"eur":945.65085917,"fecha":"2026-09-07"}'),
    });
    vi.stubGlobal('fetch', fetch);

    expect(await leerFuente('puente')).toEqual({ rate: 813.74, date: '07/09/2026', source: 'BCV' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
