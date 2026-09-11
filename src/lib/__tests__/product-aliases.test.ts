import { describe, it, expect } from 'vitest';
import { resolveProductAlias } from '../product-aliases';

/** Catálogo real (nombres, unidades) de los productos involucrados */
const CATALOGO = [
  { id: 39, nombre: 'Camaron Desvenado Mediano', unidad: 'kg' },
  { id: 1, nombre: 'Camaron Vivito (concha)', unidad: 'kg' },
  { id: 2, nombre: 'Camaron Jumbo', unidad: 'kg' },
  { id: 3, nombre: 'Camaron Pelado', unidad: 'kg' },
  { id: 4, nombre: 'Camaron Desvenado', unidad: 'kg' },
  { id: 5, nombre: 'Camarón Desvenado Jumbo', unidad: 'kg' },
  { id: 10, nombre: 'Camaron 61/70', unidad: 'caja' },
  { id: 12, nombre: 'Camaron 41/50', unidad: 'caja' },
  { id: 13, nombre: 'Camaron 36/40', unidad: 'caja' },
  { id: 26, nombre: 'Vieras', unidad: 'kg' },
  { id: 27, nombre: 'Vieras Verdaderas', unidad: 'kg' },
  { id: 29, nombre: 'Pepitona (Caja de 10kg)', unidad: 'caja' },
  { id: 40, nombre: 'Mejillones Pelados', unidad: 'kg' },
];

const alias = (req: string, unit?: string) => resolveProductAlias(req, CATALOGO, { unit })?.nombre ?? null;

describe('resolveProductAlias', () => {
  it('"botones" son Vieras', () => {
    expect(alias('2kg botones')).toBe('Vieras');
    expect(alias('boton')).toBe('Vieras');
  });

  it('"camarón pelado" es Camaron Desvenado', () => {
    expect(alias('1kg camarón pelado')).toBe('Camaron Desvenado');
    expect(alias('camarones pelados')).toBe('Camaron Desvenado');
  });

  it('respeta la variante: pelado jumbo y pelado mediano', () => {
    expect(alias('camaron pelado jumbo')).toBe('Camarón Desvenado Jumbo');
    expect(alias('camaron pelado mediano')).toBe('Camaron Desvenado Mediano');
  });

  it('"una caja de camarones desvenados" es la caja de 41/50', () => {
    expect(alias('una caja de camarones desvenados')).toBe('Camaron 41/50');
    expect(alias('2 cajas de camaron pelado')).toBe('Camaron 41/50');
    expect(alias('1 cj desvenado')).toBe('Camaron 41/50');
  });

  it('también cuando la palabra "caja" solo viene en la unidad', () => {
    expect(alias('camarones desvenados', 'caja')).toBe('Camaron 41/50');
  });

  it('con talla explícita no se toca (lo resuelve la IA)', () => {
    expect(alias('caja de camaron desvenado 61/70')).toBe(null);
    expect(alias('camaron pelado 36/40')).toBe(null);
  });

  it('"desvenado" por kg no se toca (ya lo resuelven la IA y sus correcciones)', () => {
    expect(alias('2kg camaron desvenado')).toBe(null);
  });

  it('no afecta otros productos', () => {
    expect(alias('1kg mejillones pelados')).toBe(null);
    expect(alias('2kg jumbo')).toBe(null);
    expect(alias('caja de pepitona')).toBe(null);
    expect(alias('1kg vieras')).toBe(null);
  });
});
