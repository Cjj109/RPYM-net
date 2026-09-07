/**
 * Desde cuándo se cobra una tasa del BCV.
 *
 * Dos fechas que no son la misma:
 *
 *   fecha valor  desde cuándo rige para el BCV
 *   desde        desde cuándo la cobramos aquí
 *
 * El sitio no tenía ninguna de las dos: cobraba con la tasa nueva desde el
 * momento en que el BCV la colgaba. El 7 de septiembre de 2026, de noche,
 * rpym.net facturaba a 814,69 cuando lo que regía ese día era 813,74.
 *
 * Y las dos fechas se separan los fines de semana. El BCV publica el viernes
 * por la tarde con fecha valor del LUNES, pero la regla del negocio —la dio
 * el dueño— es que se cobra desde el día siguiente a que se publica, o sea el
 * SÁBADO. Ese es el caso que estos tests protegen, porque es el que un
 * arreglo "a ojo" se salta.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { aplicarVigencia, desdeCuandoSeCobra } from '../bcv-fuentes';
import { hoyEnCaracas, dmyAIso } from '../format';
import type { TasaBCV } from '../bcv-oficial';

interface Fila { date: string; usd_rate: number; desde?: string }

/** D1 de mentira: entiende las dos consultas de vigencia */
function dbCon(filas: Fila[]) {
  const desdeDe = (f: Fila) => f.desde ?? f.date;

  return {
    prepare: (sql: string) => ({
      // MAX(date) no lleva parámetros: el .first() cuelga del prepare
      first: async () => {
        if (!sql.includes('MAX(date)')) return null;
        const fechas = filas.map((f) => f.date).sort();
        return { date: fechas.length ? fechas[fechas.length - 1] : null };
      },
      bind: (hoy: string) => ({
        first: async () => {
          if (!sql.includes('FROM bcv_rates')) return null;
          const haciaAtras = sql.includes('<= ?');
          const candidatas = filas
            .filter((f) => (haciaAtras ? desdeDe(f) <= hoy : desdeDe(f) > hoy))
            .sort((a, b) =>
              haciaAtras ? desdeDe(b).localeCompare(desdeDe(a)) : desdeDe(a).localeCompare(desdeDe(b))
            );
          const f = candidatas[0];
          return f ? { usd_rate: f.usd_rate, desde: desdeDe(f) } : null;
        },
        run: async () => ({}),
      }),
    }),
  } as any;
}

const leida = (rate: number, date: string): TasaBCV => ({ rate, date, source: 'BCV' });

describe('desdeCuandoSeCobra', () => {
  it('el viernes: fecha valor del lunes, pero se cobra desde el sábado', () => {
    // El BCV publica el viernes 11 con fecha valor del lunes 14
    expect(desdeCuandoSeCobra('2026-09-14', '2026-09-11')).toBe('2026-09-12');
  });

  it('con el lunes feriado tampoco espera: sigue siendo el sábado', () => {
    // Fecha valor del martes 15 porque el lunes 14 es feriado
    expect(desdeCuandoSeCobra('2026-09-15', '2026-09-11')).toBe('2026-09-12');
  });

  it('entre semana coincide con la fecha valor', () => {
    expect(desdeCuandoSeCobra('2026-09-08', '2026-09-07')).toBe('2026-09-08');
  });

  it('si se ve tarde manda la fecha valor: nunca más tarde que lo oficial', () => {
    // El sitio estuvo caído el viernes y el sábado; se ve el lunes 14
    expect(desdeCuandoSeCobra('2026-09-14', '2026-09-14')).toBe('2026-09-14');
    // Y si se ve aún más tarde, tampoco se adelanta a mañana
    expect(desdeCuandoSeCobra('2026-09-14', '2026-09-16')).toBe('2026-09-14');
  });
});

describe('aplicarVigencia', () => {
  afterEach(() => vi.useRealTimers());

  it('la publicada esta tarde no se cobra hasta mañana', async () => {
    vi.setSystemTime(new Date('2026-09-07T21:30:00Z')); // 17:30 en Caracas
    const db = dbCon([
      { date: '2026-09-07', usd_rate: 813.74, desde: '2026-09-07' },
      { date: '2026-09-08', usd_rate: 814.69, desde: '2026-09-08' },
    ]);

    expect(await aplicarVigencia(db, leida(814.69, '08/09/2026'))).toEqual({
      rate: 813.74,
      date: '07/09/2026',
      source: 'BCV',
      proxima: { rate: 814.69, date: '08/09/2026' },
    });
  });

  it('al día siguiente entra sola, sin releer ni desplegar nada', async () => {
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
    const db = dbCon([
      { date: '2026-09-07', usd_rate: 813.74, desde: '2026-09-07' },
      { date: '2026-09-08', usd_rate: 814.69, desde: '2026-09-08' },
    ]);

    expect(await aplicarVigencia(db, leida(814.69, '08/09/2026'))).toEqual({
      rate: 814.69, date: '08/09/2026', source: 'BCV', proxima: null,
    });
  });

  it('el sábado ya se cobra la del viernes, aunque el BCV siga diciendo "lunes"', async () => {
    /* El caso que importa. El viernes 11 se apuntó 830 con fecha valor del
       lunes 14 y desde el sábado 12. El sábado la página del BCV sigue
       enseñando exactamente lo mismo —fecha valor 14—, así que la lectura de
       ese día no basta: quien sabe que ya se cobra es la tabla. */
    const db = dbCon([
      { date: '2026-09-11', usd_rate: 820.0, desde: '2026-09-11' },
      { date: '2026-09-14', usd_rate: 830.0, desde: '2026-09-12' },
    ]);

    // Viernes 11 por la tarde: todavía la vieja, y se anuncia la del sábado
    vi.setSystemTime(new Date('2026-09-11T20:00:00Z'));
    const viernes = await aplicarVigencia(db, leida(830.0, '14/09/2026'));
    expect(viernes.rate).toBe(820.0);
    expect(viernes.proxima).toEqual({ rate: 830.0, date: '12/09/2026' });

    // Sábado 12 y domingo 13: ya la nueva
    for (const dia of ['2026-09-12T16:00:00Z', '2026-09-13T16:00:00Z']) {
      vi.setSystemTime(new Date(dia));
      const tasa = await aplicarVigencia(db, leida(830.0, '14/09/2026'));
      expect(tasa.rate).toBe(830.0);
      expect(tasa.proxima).toBeNull();
    }
  });

  it('el salto por feriado tampoco espera a la fecha valor', async () => {
    // Viernes 11, fecha valor martes 15 porque el lunes 14 es feriado.
    // Se cobra igual desde el sábado 12.
    const db = dbCon([
      { date: '2026-09-11', usd_rate: 820.0, desde: '2026-09-11' },
      { date: '2026-09-15', usd_rate: 830.0, desde: '2026-09-12' },
    ]);

    vi.setSystemTime(new Date('2026-09-12T16:00:00Z'));
    expect((await aplicarVigencia(db, leida(830.0, '15/09/2026'))).rate).toBe(830.0);
  });

  it('el salto ocurre a medianoche de Caracas, no de UTC', async () => {
    // 22:00 UTC del 7 son las 18:00 en Caracas: todavía es día 7 allá.
    // Con toISOString() aquí ya se leía "2026-09-08".
    vi.setSystemTime(new Date('2026-09-07T22:00:00Z'));
    expect(hoyEnCaracas()).toBe('2026-09-07');

    const db = dbCon([
      { date: '2026-09-07', usd_rate: 813.74, desde: '2026-09-07' },
      { date: '2026-09-08', usd_rate: 814.69, desde: '2026-09-08' },
    ]);
    expect((await aplicarVigencia(db, leida(814.69, '08/09/2026'))).rate).toBe(813.74);
  });

  it('no hacen falta filas para los días de en medio', async () => {
    // Semana santa: del 1 al 6 de abril no hay nada apuntado, y da igual.
    // La consulta mira hacia atrás, no día a día.
    const db = dbCon([
      { date: '2026-04-01', usd_rate: 500.0, desde: '2026-04-01' },
      { date: '2026-04-06', usd_rate: 510.0, desde: '2026-04-02' },
    ]);

    for (const dia of ['2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05']) {
      vi.setSystemTime(new Date(`${dia}T16:00:00Z`));
      expect((await aplicarVigencia(db, leida(510.0, '06/04/2026'))).rate).toBe(510.0);
    }
  });

  it('sin memoria se sigue con lo leído, que es lo único que hay', async () => {
    vi.setSystemTime(new Date('2026-09-07T21:30:00Z'));
    expect(await aplicarVigencia(dbCon([]), leida(814.69, '08/09/2026'))).toEqual({
      rate: 814.69, date: '08/09/2026', source: 'BCV', proxima: null,
    });
  });

  it('sin base de datos tampoco se cae', async () => {
    vi.setSystemTime(new Date('2026-09-07T14:00:00Z'));
    expect(await aplicarVigencia(null, leida(813.74, '07/09/2026'))).toEqual({
      rate: 813.74, date: '07/09/2026', source: 'BCV', proxima: null,
    });
  });

  it('si el BCV lleva días caído, manda la fuente que va por delante', async () => {
    // Lo último apuntado es del día 7; dolarapi trae ya la del 20, que es
    // vigente. Servir la vieja teniendo esa sería peor.
    vi.setSystemTime(new Date('2026-09-20T16:00:00Z'));
    const db = dbCon([{ date: '2026-09-07', usd_rate: 813.74, desde: '2026-09-07' }]);

    const tasa = await aplicarVigencia(db, { rate: 900.0, date: '20/09/2026', source: 'BCV' });
    expect(tasa.rate).toBe(900.0);
  });

  it('pero el fin de semana esa puerta queda cerrada', async () => {
    /* El domingo se cobra 830 —fecha valor del lunes 14, apuntada el viernes
       y en vigor aquí desde el sábado 12—. DolarAPI sigue con la oficial del
       viernes, 820, y la data el día en que responde: el domingo 13.

       Comparar eso contra `desde` (12/09) daba 13 > 12 y tumbaba la del
       sábado para volver a la de la semana pasada. Son dos magnitudes
       distintas. Comparando fecha valor contra fecha valor —13 contra el 14
       que ya tenemos apuntado— no entra, que es lo correcto. */
    vi.setSystemTime(new Date('2026-09-13T16:00:00Z'));
    const db = dbCon([
      { date: '2026-09-11', usd_rate: 820.0, desde: '2026-09-11' },
      { date: '2026-09-14', usd_rate: 830.0, desde: '2026-09-12' },
    ]);

    const porDolarapi = await aplicarVigencia(db, { rate: 820.0, date: '13/09/2026', source: 'BCV' });
    expect(porDolarapi.rate).toBe(830.0);
  });

  it('el parpadeo del BCV no confunde la vieja con la nueva', async () => {
    /* Al publicar, la página del BCV va y viene entre la vieja y la nueva.
       Como cada lectura se guarda en la fila de SU fecha valor, un parpadeo
       reescribe la fila que le toca y nunca la otra: la vieja cae en la fila
       del 11 y la nueva en la del 14. Lo que se cobra sale de la tabla, así
       que da igual cuál de las dos se leyó en el último instante. */
    const db = dbCon([
      { date: '2026-09-11', usd_rate: 820.0, desde: '2026-09-11' },
      { date: '2026-09-14', usd_rate: 830.0, desde: '2026-09-12' },
    ]);

    // Viernes: se lea la nueva o la vieja, hoy se cobra 820
    vi.setSystemTime(new Date('2026-09-11T20:00:00Z'));
    expect((await aplicarVigencia(db, leida(830.0, '14/09/2026'))).rate).toBe(820.0);
    expect((await aplicarVigencia(db, leida(820.0, '11/09/2026'))).rate).toBe(820.0);

    // Sábado: se lea la que se lea, se cobra 830
    vi.setSystemTime(new Date('2026-09-12T16:00:00Z'));
    expect((await aplicarVigencia(db, leida(830.0, '14/09/2026'))).rate).toBe(830.0);
    expect((await aplicarVigencia(db, leida(820.0, '11/09/2026'))).rate).toBe(830.0);
  });

  it('conserva la fuente de la que se leyó, no la de la fila guardada', async () => {
    vi.setSystemTime(new Date('2026-09-07T21:30:00Z'));
    const db = dbCon([{ date: '2026-09-07', usd_rate: 813.74, desde: '2026-09-07' }]);
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
