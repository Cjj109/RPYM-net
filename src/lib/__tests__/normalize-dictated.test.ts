import { describe, it, expect } from 'vitest';
import { normalizeDictatedText, palabrasANumero } from '../normalize-dictated';

describe('palabrasANumero', () => {
  it('convierte unidades y decenas', () => {
    expect(palabrasANumero('dos')).toBe(2);
    expect(palabrasANumero('quince')).toBe(15);
    expect(palabrasANumero('treinta y cinco')).toBe(35);
  });

  it('convierte centenas y miles', () => {
    expect(palabrasANumero('quinientos')).toBe(500);
    expect(palabrasANumero('doscientos cincuenta')).toBe(250);
    expect(palabrasANumero('mil')).toBe(1000);
    expect(palabrasANumero('dos mil')).toBe(2000);
  });

  it('ignora acentos y mayusculas', () => {
    expect(palabrasANumero('Dieciséis')).toBe(16);
  });

  it('devuelve null si no es un numero', () => {
    expect(palabrasANumero('camaron')).toBeNull();
    expect(palabrasANumero('')).toBeNull();
  });
});

describe('normalizeDictatedText — el caso del mostrador', () => {
  it('convierte medio kilo', () => {
    expect(normalizeDictatedText('delcy medio kilo de camaron vivito'))
      .toBe('delcy 0.5kg de camaron vivito');
  });

  it('convierte media caja', () => {
    expect(normalizeDictatedText('media caja de pepitona')).toBe('0.5 caja de pepitona');
  });

  it('convierte kilo y medio', () => {
    expect(normalizeDictatedText('kilo y medio de calamar')).toBe('1.5kg de calamar');
  });

  it('convierte cantidades con y medio', () => {
    expect(normalizeDictatedText('tres kilos y medio de jumbo')).toBe('3.5kg de jumbo');
    expect(normalizeDictatedText('dos kilos y medio')).toBe('2.5kg');
  });

  it('convierte cuarto de kilo', () => {
    expect(normalizeDictatedText('un cuarto de kilo de camaron')).toBe('0.25kg de camaron');
  });
});

describe('normalizeDictatedText — cantidades', () => {
  it('convierte numeros en palabras con unidad', () => {
    expect(normalizeDictatedText('dos kilos de calamar')).toBe('2kg de calamar');
    expect(normalizeDictatedText('tres cajas de pepitona')).toBe('3 caja de pepitona');
    expect(normalizeDictatedText('un kilo de camaron')).toBe('1kg de camaron');
  });

  it('convierte gramos', () => {
    expect(normalizeDictatedText('quinientos gramos de pulpo')).toBe('500g de pulpo');
    expect(normalizeDictatedText('doscientos cincuenta gramos')).toBe('250g');
  });

  it('convierte docenas a unidades', () => {
    expect(normalizeDictatedText('una docena')).toBe('12 unidad');
  });
});

describe('normalizeDictatedText — montos', () => {
  it('convierte dolares dictados', () => {
    expect(normalizeDictatedText('friteria chon abono diez dolares'))
      .toBe('friteria chon abono $10');
    expect(normalizeDictatedText('abono de veinte dólares')).toBe('abono de $20');
  });

  it('convierte dolares ya en cifra', () => {
    expect(normalizeDictatedText('abono 15 dolares')).toBe('abono $15');
  });
});

describe('normalizeDictatedText — no rompe lo que ya está bien', () => {
  it('deja intacto el texto escrito con cifras', () => {
    expect(normalizeDictatedText('Delcy 2kg calamar y 1kg camaron'))
      .toBe('Delcy 2kg calamar y 1kg camaron');
  });

  it('no toca nombres de productos', () => {
    expect(normalizeDictatedText('camaron 31/35 y calamar nacional'))
      .toBe('camaron 31/35 y calamar nacional');
  });

  it('no inventa cantidades donde no hay unidad', () => {
    expect(normalizeDictatedText('para dos personas')).toBe('para dos personas');
  });

  it('maneja texto vacio', () => {
    expect(normalizeDictatedText('')).toBe('');
  });

  it('procesa una lista completa dictada', () => {
    expect(normalizeDictatedText('delcy medio kilo de camaron vivito dos kilos de calamar y una caja de pepitona'))
      .toBe('delcy 0.5kg de camaron vivito 2kg de calamar y 1 caja de pepitona');
  });
});
