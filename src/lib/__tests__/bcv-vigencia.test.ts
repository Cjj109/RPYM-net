/**
 * Desde cuándo rige una tasa del BCV.
 *
 * El BCV publica por la tarde la del día SIGUIENTE, y el sitio cobraba con
 * ella desde el momento en que aparecía: el 7 de septiembre de 2026, de
 * noche, rpym.net facturaba a 814,69 cuando lo que regía ese día era
 * 813,7361. Aquí se fija la regla, que es la que dio el dueño: la tasa
 * publicada un día aplica a partir del siguiente, sea hábil o fin de semana.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { aplicarVigencia } from '../bcv-fuentes';
import { hoyEnCaracas, dmyAIso } from '../format';
import type { TasaBCV } from '../bcv-oficial';

/** D1 de mentira: solo sabe responder la consulta de la tasa vigente */
function dbCon(filas: Array<{ date: string; usd_rate: number }>) {
  return {
    prepare: (sql: string) => ({
      bind: (hasta: string) => ({
        first: async () => {
          if (!sql.includes('FROM bcv_rates')) return null;
          const candidatas = filas
            .filter((f) => f.date <= hasta)
            .sort((a, b) => (a.date < b.date ? 1 : -1));
          return candidatas[0] ?? null;
        },
        run: async () => ({}),
      }),
    }),
  } as any;
}

const publicada = (rate: number, date: string): TasaBCV => ({ rate, date, source: 'BCV' });

describe('aplicarVigencia', () => {
  afterEach(() => vi.useRealTimers());

  it('sirve la anterior mientras la publicada no haya entrado en vigor', async () => {
    vi.setSystemTime(new Date('2026-09-07T21:30:00Z')); // 17:30 en Caracas
    const db = dbCon([
      { date: '2026-09-07', usd_rate: 813.74 },
      { date: '2026-09-08', usd_rate: 814.69 },
    ]);

    expect(await aplicarVigencia(db, publicada(814.69, '08/09/2026'))).toEqual({
      rate: 813.74,
      date: '07/09/2026',
      source: 'BCV',
      proxima: { rate: 814.69, date: '08/09/2026' },
    });
  });

  it('al día siguiente la nueva pasa a regir sola, sin releer nada', async () => {
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z')); // ya es 8 en Caracas
    const db = dbCon([
      { date: '2026-09-07', usd_rate: 813.74 },
      { date: '2026-09-08', usd_rate: 814.69 },
    ]);

    const tasa = await aplicarVigencia(db, publicada(814.69, '08/09/2026'));
    expect(tasa).toEqual({ rate: 814.69, date: '08/09/2026', source: 'BCV', proxima: null });
  });

  it('el salto ocurre a medianoche de Caracas, no de UTC', async () => {
    // 22:00 UTC del 7 son las 18:00 en Caracas: todavía es día 7 allá, y la
    // tasa del 8 no debe entrar. Con toISOString() aquí ya se leía "2026-09-08".
    vi.setSystemTime(new Date('2026-09-07T22:00:00Z'));
    expect(hoyEnCaracas()).toBe('2026-09-07');

    const db = dbCon([{ date: '2026-09-07', usd_rate: 813.74 }]);
    const tasa = await aplicarVigencia(db, publicada(814.69, '08/09/2026'));
    expect(tasa.rate).toBe(813.74);
  });

  it('el fin de semana no es excepción: la del viernes rige el sábado', async () => {
    // El BCV publica el viernes 11 por la tarde con fecha valor del lunes 14;
    // el sábado 12 y el domingo 13 sigue rigiendo la del viernes.
    vi.setSystemTime(new Date('2026-09-12T16:00:00Z')); // sábado, mediodía en Caracas
    const db = dbCon([
      { date: '2026-09-11', usd_rate: 820.00 },
      { date: '2026-09-14', usd_rate: 825.00 },
    ]);

    const tasa = await aplicarVigencia(db, publicada(825.0, '14/09/2026'));
    expect(tasa.rate).toBe(820.0);
    expect(tasa.proxima).toEqual({ rate: 825.0, date: '14/09/2026' });
  });

  it('sin memoria de la anterior se sigue con la publicada, que es lo único que hay', async () => {
    vi.setSystemTime(new Date('2026-09-07T21:30:00Z'));
    const tasa = await aplicarVigencia(dbCon([]), publicada(814.69, '08/09/2026'));
    expect(tasa).toEqual({ rate: 814.69, date: '08/09/2026', source: 'BCV', proxima: null });
  });

  it('una tasa que ya rige pasa tal cual, sin tocar la base', async () => {
    vi.setSystemTime(new Date('2026-09-07T14:00:00Z'));
    const tasa = await aplicarVigencia(null, publicada(813.74, '07/09/2026'));
    expect(tasa).toEqual({ rate: 813.74, date: '07/09/2026', source: 'BCV', proxima: null });
  });

  it('conserva la fuente de la que se leyó, no la de la fila guardada', async () => {
    vi.setSystemTime(new Date('2026-09-07T21:30:00Z'));
    const db = dbCon([{ date: '2026-09-07', usd_rate: 813.74 }]);
    const tasa = await aplicarVigencia(db, { rate: 814.69, date: '08/09/2026', source: 'BCV (puente)' });
    expect(tasa.source).toBe('BCV (puente)');
  });
});

describe('dmyAIso', () => {
  it('convierte el formato venezolano al del historial', () => {
    expect(dmyAIso('07/09/2026')).toBe('2026-09-07');
    expect(dmyAIso('7/9/2026')).toBe('2026-09-07');
  });

  it('devuelve null en vez de inventar una fecha', () => {
    expect(dmyAIso('2026-09-07')).toBeNull();
    expect(dmyAIso('')).toBeNull();
    expect(dmyAIso(null)).toBeNull();
  });
});
