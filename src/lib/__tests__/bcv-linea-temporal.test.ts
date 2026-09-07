/**
 * La tasa del BCV a lo largo del tiempo, con SQLite de verdad.
 *
 * Los otros tests usan un D1 de mentira que interpreta la consulta a ojo.
 * Este ejecuta el SQL real —el COALESCE, el ON CONFLICT, el ORDER BY— contra
 * una base en memoria, y entra por la puerta pública: se le da a leer un HTML
 * del BCV y se mira qué tasa acaba cobrando el sitio.
 *
 * Los casos son los que preocupaban al dueño:
 *
 *   1. El fin de semana. El BCV publica el viernes con fecha valor del lunes
 *      y aquí esa tasa se cobra desde el sábado.
 *   2. El feriado. La fecha valor salta dos días o más.
 *   3. EL PARPADEO. Al publicar, la página va y viene: enseña la nueva, vuelve
 *      a la vieja, otra vez la nueva. El miedo era que el sistema tomara la
 *      vieja por nueva y se quedara con ella.
 *
 * Cada caso está comprobado por mutación: si se rompe a propósito la línea que
 * protege, el test que lo cubre falla. Una primera versión de este archivo
 * pasaba entera con cuatro de esas mutaciones puestas.
 *
 * Requiere Node 22.13 o más nuevo, por node:sqlite (ver `engines`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { obtenerTasaSegunPreferencia, adelantar, deshacerAdelanto, proximaSinEntrar } from '../bcv-fuentes';

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
  db.config = (clave: string) =>
    (sqlite.prepare('SELECT value FROM site_config WHERE key = ?').get(clave) as any)?.value ?? null;
  // Cerrar es lo que evita ir dejando una base y sus sentencias abiertas por
  // cada test; el afterEach lo llama.
  db.cerrar = () => sqlite.close();
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
    if (String(url).startsWith('https://www.bcv.org.ve')) return { ok: true, text: async () => html };
    throw new Error('caido');
  });
}

/** Solo responde DolarAPI, con esa tasa y esa fecha */
function soloDolarApi(promedio: number, fecha: string) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('dolarapi.com/v1/dolares/oficial')) {
      return { ok: true, json: async () => ({ promedio, fechaActualizacion: `${fecha}T00:00:00-04:00` }) };
    }
    throw new Error('caido');
  });
}

/** Todo caído */
const nadaResponde = () => vi.stubGlobal('fetch', async () => { throw new Error('caido'); });

const enCaracas = (ahora: string) => vi.setSystemTime(new Date(`${ahora}-04:00`));

/**
 * Pide la tasa dejando correr el reintento de 600 ms del último respaldo.
 *
 * Con los timers falsos ese sleep no avanza solo, y con `shouldAdvanceTime`
 * corría en tiempo real: 650 ms de espera de verdad en cada test que agota
 * las fuentes. Aquí se adelanta el reloj a mano.
 */
async function pedirTasa(db: any) {
  const promesa = obtenerTasaSegunPreferencia(db);
  await vi.advanceTimersByTimeAsync(1000);
  return promesa;
}

/** Un instante: son las `ahora` en Caracas y el BCV enseña esto */
async function momento(db: any, ahora: string, tasa: number, fechaValor: string) {
  enCaracas(ahora);
  soloBCV(htmlBCV(tasa, fechaValor));
  return (await pedirTasa(db))!.rate;
}

describe('línea temporal de la tasa', () => {
  let db: any;
  beforeEach(() => {
    db = nuevaD1();
    vi.useFakeTimers();
  });
  afterEach(() => {
    db.cerrar();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('un fin de semana completo, con el BCV parpadeando al publicar', async () => {
    // Jueves 10: rige 820, publicada el miércoles con fecha valor del jueves
    expect(await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10')).toBe(820);
    // Viernes 11 por la mañana: sigue 820
    expect(await momento(db, '2026-09-11T09:00:00', 820, '2026-09-10')).toBe(820);

    // Viernes 16:02 — sale la nueva, 830, con fecha valor del LUNES 14
    expect(await momento(db, '2026-09-11T16:02:00', 830, '2026-09-14')).toBe(820);
    // 16:04 — la página vuelve a la vieja. AQUÍ estaba el miedo.
    expect(await momento(db, '2026-09-11T16:04:00', 820, '2026-09-10')).toBe(820);
    // 16:07 — otra vez la nueva
    expect(await momento(db, '2026-09-11T16:07:00', 830, '2026-09-14')).toBe(820);
    // 16:09 — y otra vez la vieja
    expect(await momento(db, '2026-09-11T16:09:00', 820, '2026-09-10')).toBe(820);

    /* Y aquí, con la ÚLTIMA lectura siendo la vieja, la memoria de "la última
       oficial" tiene que seguir en la nueva. Esa llave no decide lo que se
       cobra, pero alimenta la comparación de "no retroceder" contra las otras
       fuentes: dejarla con la vieja es dejar una trampa armada para el día en
       que el BCV no responda. Comprobar esto después de que se estabilice no
       vale de nada —entonces la última lectura ya es la buena. */
    expect(db.config('bcv_oficial_fecha')).toBe('14/09/2026');
    expect(db.config('bcv_oficial_rate')).toBe('830');

    // 16:15 — se estabiliza en la nueva
    expect(await momento(db, '2026-09-11T16:15:00', 830, '2026-09-14')).toBe(820);

    // Sábado 12: entra la nueva, aunque el BCV siga diciendo "fecha valor 14"
    expect(await momento(db, '2026-09-12T08:00:00', 830, '2026-09-14')).toBe(830);
    expect(await momento(db, '2026-09-13T08:00:00', 830, '2026-09-14')).toBe(830);
    expect(await momento(db, '2026-09-14T08:00:00', 830, '2026-09-14')).toBe(830);

    // Cada tasa quedó en SU fila: el parpadeo no las mezcló
    expect(db.filas()).toEqual([
      { date: '2026-09-10', usd_rate: 820, desde: '2026-09-10' },
      { date: '2026-09-14', usd_rate: 830, desde: '2026-09-12' },
    ]);
  });

  it('el parpadeo justo al cruzar la medianoche no adelanta ni atrasa nada', async () => {
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');
    // 23:58 del viernes: todavía 820... salvo que no hay 820 apuntado aún
    await momento(db, '2026-09-11T16:01:00', 820, '2026-09-10');
    expect(await momento(db, '2026-09-11T23:58:00', 830, '2026-09-14')).toBe(820);
    // 00:01 del sábado, leyendo la VIEJA por un parpadeo: ya 830
    expect(await momento(db, '2026-09-12T00:01:00', 820, '2026-09-10')).toBe(830);
  });

  it('el feriado: la fecha valor salta al martes y se cobra igual desde el sábado', async () => {
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');
    expect(await momento(db, '2026-09-11T16:30:00', 830, '2026-09-15')).toBe(820);
    for (const dia of ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']) {
      expect(await momento(db, `${dia}T10:00:00`, 830, '2026-09-15')).toBe(830);
    }
  });

  it('una corrección del BCV sobre la misma fecha valor sí entra', async () => {
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');
    await momento(db, '2026-09-11T18:00:00', 831, '2026-09-14');
    expect(await momento(db, '2026-09-12T10:00:00', 831, '2026-09-14')).toBe(831);
    expect(db.filas().find((f: any) => f.date === '2026-09-14').usd_rate).toBe(831);
  });

  it('una tasa disparatada se descarta antes de llegar a la base', async () => {
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');
    enCaracas('2026-09-11T16:00:00');
    soloBCV(htmlBCV(9_999_999, '2026-09-14'));
    expect((await pedirTasa(db))!.rate).toBe(820);
    expect(db.filas().map((f: any) => f.date)).toEqual(['2026-09-10']);
  });

  it('con todo caído se cobra lo VIGENTE, no la última que se vio', async () => {
    /* La distinción importa el viernes por la tarde, que es cuando las dos
       cosas son distintas: lo último leído es 830 —la de la semana que viene—
       y lo vigente sigue siendo 820. Un apagón no puede adelantar la tasa. */
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');

    enCaracas('2026-09-11T20:00:00');
    nadaResponde();
    expect((await pedirTasa(db))!.rate).toBe(820);
  });

  it('un domingo, DolarAPI datando su tasa vieja ese mismo día no manda', async () => {
    /* DolarAPI publica el día en que la tasa entra oficialmente, así que el
       fin de semana sigue con la del viernes y puede fecharla el día en que
       responde. Aquí ya se cobra la nueva desde el sábado: dejar que DolarAPI
       la tumbe sería volver a la tasa de la semana pasada.

       Se lee por el PUENTE a propósito. Con la página directa, la memoria de
       "la última oficial" guarda la del 14 y la comparación de "no
       retroceder" intercepta a DolarAPI antes de llegar aquí; el puente
       apunta la vigencia sin escribir esa llave, que es lo que deja el camino
       libre hasta la comparación que este test vigila. También es una
       configuración real: el panel deja elegir el puente como principal. */
    await db.batch([
      db.prepare("INSERT INTO site_config (key, value) VALUES ('bcv_fuente_principal', 'puente')"),
      db.prepare("INSERT INTO site_config (key, value) VALUES ('bcv_fuente_respaldo', 'dolarapi')"),
    ]);

    enCaracas('2026-09-11T16:00:00');
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).startsWith('https://bcv-puente')) {
        return { ok: true, json: async () => ({ usd: 830, fecha: '2026-09-14' }) };
      }
      throw new Error('caido');
    });
    await pedirTasa(db);
    expect(db.filas()).toEqual([{ date: '2026-09-14', usd_rate: 830, desde: '2026-09-12' }]);
    expect(db.config('bcv_oficial_fecha')).toBeNull();

    enCaracas('2026-09-13T10:00:00');
    soloDolarApi(820, '2026-09-13');
    expect((await pedirTasa(db))!.rate).toBe(830);
  });

  it('si el BCV lleva semanas caído, DolarAPI sí manda', async () => {
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');

    enCaracas('2026-09-30T10:00:00');
    soloDolarApi(900, '2026-09-30');
    expect((await pedirTasa(db))!.rate).toBe(900);
  });

  it('la próxima es la primera que entra, no la última apuntada', async () => {
    /* Con dos futuras a la vez se distingue el orden. Con una sola, dar la
       primera o la última es lo mismo y el test no prueba nada. */
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');

    // Se apunta a mano una segunda futura, más lejana
    await db
      .prepare('INSERT INTO bcv_rates (date, usd_rate, desde) VALUES (?, ?, ?)')
      .bind('2026-09-16', 840, '2026-09-16')
      .run();

    enCaracas('2026-09-11T17:00:00');
    soloBCV(htmlBCV(830, '2026-09-14'));
    const tasa = await pedirTasa(db);
    expect(tasa!.rate).toBe(820);
    expect(tasa!.proxima).toEqual({ rate: 830, date: '12/09/2026' });
  });

  it('adelantar la tasa nueva mueve el dato, no pone un interruptor', async () => {
    /* Adelantar significa "esta tasa empieza a cobrarse hoy", y eso se escribe
       en `desde`. Es lo que hace que lo vean igual el catálogo, el histórico y
       los reportes Z, sin que ninguno tenga que enterarse de nada: si fuera un
       interruptor aparte, la caja cobraría 830 y el Z convertiría a 820. */
    await momento(db, '2026-09-10T09:00:00', 820, '2026-09-10');
    await momento(db, '2026-09-11T16:00:00', 830, '2026-09-14');

    enCaracas('2026-09-11T17:00:00');
    const proxima = await proximaSinEntrar(db);
    expect(proxima).toEqual({ rate: 830, date: '2026-09-14', desde: '2026-09-12' });

    await adelantar(db, proxima!);
    expect(db.filas().find((f: any) => f.date === '2026-09-14').desde).toBe('2026-09-11');
    expect(await momento(db, '2026-09-11T17:05:00', 830, '2026-09-14')).toBe(830);

    // Y deshacerlo devuelve la fila a su día
    await deshacerAdelanto(db);
    expect(db.filas().find((f: any) => f.date === '2026-09-14').desde).toBe('2026-09-12');
    expect(await momento(db, '2026-09-11T17:10:00', 830, '2026-09-14')).toBe(820);
  });
});
