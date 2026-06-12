import { describe, it, expect } from 'vitest';
import { countProductsInText } from '../count-products-in-text';

describe('countProductsInText', () => {
  it('cuenta lista separada por comas', () => {
    expect(countProductsInText('1kg calamar, 2kg mejillon pelado, 3kg vieras, 4kg mejillon concha')).toBe(4);
  });

  it('cuenta lista línea por línea', () => {
    expect(countProductsInText('1kg calamar\n2kg mejillon pelado\n3kg vieras\n4kg mejillon concha')).toBe(4);
  });

  it('cuenta texto corrido sin separadores (dictado)', () => {
    expect(countProductsInText('1kg calamar 2kg mejillon pelado 3kg vieras 4kg mejillon concha')).toBe(4);
  });

  it('cuenta cajas y mezcla de unidades', () => {
    expect(countProductsInText('1kg camarón, 2 cajas de camarón 41/50, 3kg de pulpo')).toBe(3);
  });

  it('no cuenta el nombre del cliente ni el delivery', () => {
    expect(countProductsInText('para Delcy, 2kg calamar y 1kg jumbo, mas $5 de delivery')).toBe(2);
  });

  it('cuenta montos en dólares como producto', () => {
    expect(countProductsInText('$20 de calamar y 1kg pulpo para Maria')).toBe(2);
  });

  it('cuenta medio kilo', () => {
    expect(countProductsInText('medio kilo de pulpo y 2 cajas de pepitona')).toBe(2);
  });

  it('no cuenta precios "a X el kilo" como producto extra', () => {
    expect(countProductsInText('2kg cuerpo de calamar a 12 el kilo, 1 caja de pepitona')).toBe(2);
  });

  it('no cuenta fechas', () => {
    expect(countProductsInText('1kg calamar del 04/02 para Delcy')).toBe(1);
  });

  it('devuelve 0 para texto vacío o sin cantidades', () => {
    expect(countProductsInText('')).toBe(0);
    expect(countProductsInText('calamar y pulpo para Delcy')).toBe(0);
  });
});
