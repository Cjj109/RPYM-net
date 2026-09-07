/**
 * La tasa del BCV a lo largo del tiempo, con SQLite de verdad.
 *
 * Los otros tests usan un D1 de mentira que interpreta la consulta a ojo.
 * Este ejecuta el SQL real —el COALESCE, el ON CONFLICT, el ORDER BY— contra
 * una base en memoria, y entra por la puerta pública: se le da a leer un HTML
 * del BCV y se mira qué tasa acaba cobrando el sitio.
 *
 * Está escrito contra los tres casos que preocupaban al dueño:
 *
 *   1. El fin de semana. El BCV publica el viernes con fecha valor del lunes
 *      y aquí esa tasa se cobra desde el sábado.
 *   2. El feriado. La fecha valor salta dos días o más.
 *   3. EL PARPADEO. Al publicar, la página va y viene: enseña la nueva, vuelve
 *      a la vieja, otra vez la nueva. El miedo era que el sistema tomara la
 *      vieja por nueva y se quedara con ella.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { obtenerTasaSegunPreferencia } from '../bcv-fuentes';

const ESQUEMA = `
  CREATE TABLE bcv_rates (
    date TEXT PRIMARY KEY,
    usd_rate REAL NOT NULL,
    eur_rate REAL,
    created_at TEXT DEFAULT (datetime('now')),
    desde TEXT
  );
  CREATE TABLE site_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT
  );
`;

/** D1 mínimo sobre node:sqlite: ejecuta el SQL, no lo interpreta */
function nuevaD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(ESQUEMA);

  const envolver = (sql: string, params: unknown[] = []) => ({
    first: async () => sqlite.prepare(sql).get(...(params as any[])) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...(params as any[])) }),
    run: async () => sqlite.prepare(sql).run(...(params as any[])),
  });

  const db: any = {
    prepare: (sql: string) => ({ ...envolver(sql), bind: (...p: unknown[]) => envolver(sql, p) }),
    batch: async (stmts: any[]) => Promise.all(stmts.map((s) => s.run())),
  };
  db.filas = () => sqlite.prepare('SELECT date, usd_rate, desde FROM bcv_rates ORDER BY date').all();
  return db;
}

/** El HTML del BCV, con el formato real: coma decimal y fecha en el atributo */
const htmlBCV = (tasa: number, fechaValor: string) => `
  <div class="pull-right dinpro center"> Fecha Valor:
    <span class="date-display-single" content="${fechaValor}T00:00:00-04:00">x</span>
  </div>
  <div id="dolar" class="col-sm-12">
    <div class="col-sm-6"><span> USD</span></div>
    <div class="col-sm-6 centrado textp"><strong class="strong-tb">${tasa
      .toFixed(8)
      .replace('.', ',')}</strong></div>
  </div>`;

/** El BCV responde ese HTML; lo demás está caído */
function soloBCV(html: string) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).startsWith('https://www.bcv.org.ve')) {
      return { ok: true, text: async () => html };
    }
    throw new Error('caido');
  });
}

/** Un instante: son las `ahora` en Caracas y el BCV enseña esto */
async function momento(db: any, ahora: string, tasa: number, fechaValor: string) {
  vi.setSystemTime(new Date(`${ahora}-04:00`));
  soloBCV(htmlBCV(tasa, fechaValor));
  const r = await obtenerTasaSegunPreferencia(db);
  return r!.rate;
}

/** Qué se cobra en ese momento, sin que el BCV cambie nada */
const cobraHoy = (db: any, ahora: string, tasa: number, fechaValor: string) =>
  momento(db, ahora, tasa, fechaValor);

describe('línea temporal de la tasa', () => {
  let db: any;
  beforeEach(() => {
    db = nuevaD1();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('un fin de semana completo, con el BCV parpadeando al publicar', async () => {
    // Jueves 10: rige 820, publicada el miércoles con fecha valor del jueves
    expect(await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10')).toBe(820);

    // Viernes 11 por la mañana: sigue 820
    expect(await cobraHoy(db, '2026-09-11T09:00:00', 820, '2026-09-10')).toBe(820);

    // Viernes 16:02 — sale la nueva, 830, con fecha valor del LUNES 14
    expect(await momento(db, '2026-09-11T16:02:00', 830, '2026-09-14')).toBe(820);

    // 16:04 — la página vuelve a la vieja. AQUÍ estaba el miedo.
    expect(await momento(db, '2026-09-11T16:04:00', 820, '2026-09-10')).toBe(820);

    // 16:07 — otra vez la nueva
    expect(await momento(db, '2026-09-11T16:07:00', 830, '2026-09-14')).toBe(820);

    // 16:09 — y otra vez la vieja
    expect(await momento(db, '2026-09-11T16:09:00', 820, '2026-09-10')).toBe(820);

    // 16:15 — se estabiliza en la nueva
    expect(await momento(db, '2026-09-11T16:15:00', 830, '2026-09-14')).toBe(820);

    // Sábado 12: entra la nueva, aunque el BCV siga diciendo "fecha valor 14"
    expect(await cobraHoy(db, '2026-09-12T08:00:00', 830, '2026-09-14')).toBe(830);
    // Domingo 13
    expect(await cobraHoy(db, '2026-09-13T08:00:00', 830, '2026-09-14')).toBe(830);
    // Lunes 14
    expect(await cobraHoy(db, '2026-09-14T08:00:00', 830, '2026-09-14')).toBe(830);

    // Y cada tasa quedó en SU fila: el parpadeo no las mezcló
    expect(db.filas()).toEqual([
      { date: '2026-09-10', usd_rate: 820, desde: '2026-09-10' },
      { date: '2026-09-14', usd_rate: 830, desde: '2026-09-12' },
    ]);
  });

  it('el parpadeo justo al cruzar la medianoche no adelanta ni atrasa nada', async () => {
    // Viernes 16:00, se publica 830 para el lunes -> se cobra desde el sábado
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');

    // 23:58 del viernes: todavía 820
    expect(await momento(db, '2026-09-11T23:58:00', 820, '2026-09-10')).toBe(820);
    // 00:01 del sábado, y encima leyendo la VIEJA por un parpadeo: ya 830
    expect(await momento(db, '2026-09-12T00:01:00', 820, '2026-09-10')).toBe(830);
  });

  it('el feriado: la fecha valor salta al martes y se cobra igual desde el sábado', async () => {
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');
    // Viernes por la tarde: fecha valor MARTES 15, porque el lunes 14 es feriado
    expect(await momento(db, '2026-09-11T16:30:00', 830, '2026-09-15')).toBe(820);

    for (const dia of ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']) {
      expect(await cobraHoy(db, `${dia}T10:00:00`, 830, '2026-09-15')).toBe(830);
    }
  });

  it('una corrección del BCV sobre la misma fecha valor sí entra', async () => {
    // Publica 830 para el lunes y al rato lo corrige a 831: es la misma
    // vigencia, así que manda la corrección, no la primera cifra.
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');
    await momento(db, '2026-09-11T18:00:00', 831, '2026-09-14');

    expect(await cobraHoy(db, '2026-09-12T10:00:00', 831, '2026-09-14')).toBe(831);
    expect(db.filas().find((f: any) => f.date === '2026-09-14').usd_rate).toBe(831);
  });

  it('una tasa disparatada se descarta antes de llegar a la base', async () => {
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');

    // El HTML cambia de formato y se lee un número absurdo
    vi.setSystemTime(new Date('2026-09-11T16:00:00-04:00'));
    soloBCV(htmlBCV(9_999_999, '2026-09-14'));
    expect(await obtenerTasaSegunPreferencia(db)).toEqual(
      expect.objectContaining({ rate: 820 })
    );
    expect(db.filas().map((f: any) => f.date)).toEqual(['2026-09-10']);
  });

  it('si el BCV se cae, se sigue cobrando lo apuntado, no la última que se vio', async () => {
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');

    // Sábado con todo caído
    vi.setSystemTime(new Date('2026-09-12T10:00:00-04:00'));
    vi.stubGlobal('fetch', async () => { throw new Error('caido'); });
    expect((await obtenerTasaSegunPreferencia(db))!.rate).toBe(830);
  });

  it('la próxima se anuncia con el día en que entra, no con la fecha valor', async () => {
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');

    vi.setSystemTime(new Date('2026-09-11T16:00:00-04:00'));
    soloBCV(htmlBCV(830, '2026-09-14'));
    const tasa = await obtenerTasaSegunPreferencia(db);

    expect(tasa!.rate).toBe(820);
    expect(tasa!.proxima).toEqual({ rate: 830, date: '12/09/2026' });
  });
});
