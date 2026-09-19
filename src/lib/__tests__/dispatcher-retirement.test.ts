import { describe, it, expect, beforeEach } from 'vitest';
import { migrateToDispatchers } from '../../components/calculator/migration';
import { LS_KEYS, DISPATCHERS, RETIRED_DISPATCHERS } from '../../components/calculator/constants';
import type { DispatcherTab } from '../../components/calculator/types';

/** localStorage mínimo en memoria, que en Node no existe */
function stubLocalStorage() {
  const mapa = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mapa.has(k) ? mapa.get(k)! : null),
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
  };
  return mapa;
}

const subcliente = (nombre: string, conApuntes: boolean) => ({
  id: crypto.randomUUID(),
  name: nombre,
  entries: conApuntes
    ? [{ id: crypto.randomUUID(), description: 'merluza', amountUSD: 12, amountBs: 1200, isNegative: false }]
    : [],
});

const pestana = (despachador: string, clientes: any[]): DispatcherTab => ({
  id: crypto.randomUUID(),
  dispatcher: despachador,
  clients: clientes,
});

describe('retirar a un despachador', () => {
  let mapa: Map<string, string>;
  beforeEach(() => { mapa = stubLocalStorage(); });

  const guardado = (): DispatcherTab[] => JSON.parse(mapa.get(LS_KEYS.DISPATCHERS)!);

  it('quita del localStorage la pestaña de un retirado', () => {
    const retirado = [...RETIRED_DISPATCHERS][0];
    mapa.set(LS_KEYS.DISPATCHERS, JSON.stringify([
      pestana('Carlos', [subcliente('Cliente 1', false)]),
      pestana(retirado, [subcliente('Cliente 1', false)]),
      pestana('Pedro', [subcliente('Cliente 1', false)]),
    ]));

    migrateToDispatchers();

    expect(guardado().map(t => t.dispatcher)).not.toContain(retirado);
  });

  it('rescata los sub-clientes CON apuntes en vez de borrarlos', () => {
    const retirado = [...RETIRED_DISPATCHERS][0];
    mapa.set(LS_KEYS.DISPATCHERS, JSON.stringify([
      pestana('Carlos', [subcliente('Cliente 1', false)]),
      pestana(retirado, [subcliente('A medias', true), subcliente('Vacío', false)]),
    ]));

    migrateToDispatchers();

    const nombres = guardado().flatMap(t => t.clients.map(c => c.name));
    expect(nombres).toContain('A medias');   // tenía apuntes: se rescata
    expect(nombres).not.toContain('Vacío');  // vacío: se descarta
  });

  it('no toca a los despachadores que siguen', () => {
    mapa.set(LS_KEYS.DISPATCHERS, JSON.stringify(
      DISPATCHERS.map(d => pestana(d.name, [subcliente('Cliente 1', false)]))
    ));

    migrateToDispatchers();

    expect(guardado().map(t => t.dispatcher)).toEqual(DISPATCHERS.map(d => d.name));
  });
});
