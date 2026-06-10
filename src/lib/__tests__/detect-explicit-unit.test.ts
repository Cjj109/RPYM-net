import { describe, it, expect } from 'vitest';
import { detectExplicitUnit } from '../detect-explicit-unit';

describe('detectExplicitUnit', () => {
  const items = [
    { requestedName: 'camarón', productName: 'Camarón 41/50' },
    { requestedName: 'cajas de camarón 41/50', productName: 'Caja de Camarón 41/50' },
    { requestedName: 'pulpo', productName: 'Pulpo' },
  ];

  it('detecta unidades en lista separada por comas', () => {
    const text = '1kg camarón, 2 cajas de camarón 41/50, 3kg de pulpo';
    expect(detectExplicitUnit(items[0], text)).toBe('kg');
    expect(detectExplicitUnit(items[1], text)).toBe('caja');
    expect(detectExplicitUnit(items[2], text)).toBe('kg');
  });

  it('detecta unidades en lista escrita línea por línea (sin comas)', () => {
    const text = '1kg camarón\n2 cajas de camarón 41/50\n3kg de pulpo';
    expect(detectExplicitUnit(items[0], text)).toBe('kg');
    expect(detectExplicitUnit(items[1], text)).toBe('caja');
    expect(detectExplicitUnit(items[2], text)).toBe('kg');
  });

  it('detecta unidades en texto corrido sin separadores (dictado)', () => {
    const text = '1kg camarón 2 cajas de camarón 41/50 3kg de pulpo';
    expect(detectExplicitUnit(items[0], text)).toBe('kg');
    expect(detectExplicitUnit(items[1], text)).toBe('caja');
    expect(detectExplicitUnit(items[2], text)).toBe('kg');
  });

  it('no propaga "caja" a productos que no la mencionan', () => {
    const text = '2 cajas de camarón 51/60 y camarón vivito';
    const vivito = { requestedName: 'camarón vivito', productName: 'Camarón Vivito' };
    expect(detectExplicitUnit(vivito, text)).toBeNull();
  });

  it('detecta caja explícita en requestedName', () => {
    const item = { requestedName: '1 caja de pepitona', productName: 'Caja de Pepitona' };
    expect(detectExplicitUnit(item, 'lo que sea')).toBe('caja');
  });

  it('detecta kg explícito en requestedName', () => {
    const item = { requestedName: '1kg pepitona', productName: 'Pepitona' };
    expect(detectExplicitUnit(item, '1kg pepitona')).toBe('kg');
  });

  it('detecta medio kilo', () => {
    const item = { requestedName: 'pulpo', productName: 'Pulpo' };
    expect(detectExplicitUnit(item, '2 cajas de calamar, medio kilo de pulpo')).toBe('kg');
  });

  it('devuelve null sin unidad explícita (usar catálogo)', () => {
    const item = { requestedName: 'pulpo', productName: 'Pulpo' };
    expect(detectExplicitUnit(item, 'pulpo para Delcy')).toBeNull();
  });

  it('precios "a X" no rompen la segmentación', () => {
    const text = '2kg cuerpo de calamar a 12 y 1 caja de pepitona, medio kilo de pulpo';
    expect(detectExplicitUnit({ requestedName: 'cuerpo de calamar', productName: 'Cuerpo de Calamar' }, text)).toBe('kg');
    expect(detectExplicitUnit({ requestedName: 'caja de pepitona', productName: 'Caja de Pepitona' }, text)).toBe('caja');
    expect(detectExplicitUnit({ requestedName: 'pulpo', productName: 'Pulpo' }, text)).toBe('kg');
  });
});
