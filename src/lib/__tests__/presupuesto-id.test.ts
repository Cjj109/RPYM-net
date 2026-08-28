import { describe, it, expect, vi } from 'vitest';
import {
  generatePresupuestoId,
  generateUniquePresupuestoId,
  isDuplicateIdError,
} from '../presupuesto-id';

/** D1 simulado: `usados` son los ids que ya existen en la tabla. */
function fakeDb(usados: string[]) {
  const consultados: string[] = [];
  const db = {
    prepare: () => ({
      bind: (id: string) => {
        consultados.push(id);
        return { first: async () => (usados.includes(id) ? { id } : null) };
      },
    }),
  };
  return { db: db as any, consultados };
}

describe('generatePresupuestoId', () => {
  it('genera siempre 5 cifras dentro del rango', () => {
    for (let i = 0; i < 500; i++) {
      const id = generatePresupuestoId();
      expect(id).toMatch(/^\d{5}$/);
      const n = Number(id);
      expect(n).toBeGreaterThanOrEqual(10000);
      expect(n).toBeLessThanOrEqual(99999);
    }
  });
});

describe('isDuplicateIdError', () => {
  it('reconoce el choque de clave primaria', () => {
    expect(isDuplicateIdError(new Error('UNIQUE constraint failed: presupuestos.id'))).toBe(true);
    expect(isDuplicateIdError('UNIQUE constraint failed')).toBe(true);
  });

  it('no confunde otros errores', () => {
    expect(isDuplicateIdError(new Error('no such table: presupuestos'))).toBe(false);
    expect(isDuplicateIdError(new Error('network error'))).toBe(false);
    expect(isDuplicateIdError(null)).toBe(false);
  });
});

describe('generateUniquePresupuestoId', () => {
  it('devuelve el id a la primera cuando no hay choque', async () => {
    const { db, consultados } = fakeDb([]);
    const id = await generateUniquePresupuestoId(db);
    expect(id).toMatch(/^\d{5}$/);
    expect(consultados).toHaveLength(1);
  });

  it('reintenta cuando el id ya existe y devuelve uno libre', async () => {
    // Los dos primeros ids generados ya estan usados; el tercero esta libre.
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0) // 10000
      .mockReturnValueOnce(0) // 10000 otra vez
      .mockReturnValueOnce(0.5); // 55000

    const { db, consultados } = fakeDb(['10000']);
    const id = await generateUniquePresupuestoId(db);

    expect(id).toBe('55000');
    expect(consultados).toEqual(['10000', '10000', '55000']);
    vi.restoreAllMocks();
  });

  it('no se queda colgado si todos chocan: devuelve un id tras agotar intentos', async () => {
    // Todos los ids posibles del mock estan ocupados.
    vi.spyOn(Math, 'random').mockReturnValue(0); // siempre 10000
    const { db, consultados } = fakeDb(['10000']);

    const id = await generateUniquePresupuestoId(db);

    expect(id).toBe('10000');
    expect(consultados).toHaveLength(8); // MAX_ID_ATTEMPTS
    vi.restoreAllMocks();
  });
});
