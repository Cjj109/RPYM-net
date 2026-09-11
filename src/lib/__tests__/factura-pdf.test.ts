import { describe, it, expect } from 'vitest';
import { generateFacturaPDF, type FacturaPDFData } from '../factura-pdf';

/** jsPDF no comprime por defecto: el texto queda legible en el PDF crudo */
const pdfText = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(new Uint8Array(buf));
const pageCount = (buf: ArrayBuffer) => (pdfText(buf).match(/\/Type \/Page\b(?!s)/g) || []).length;

const base: FacturaPDFData = {
  facturaId: '482913',
  customerName: 'Maria Perez',
  items: [
    { producto: 'Camarón jumbo', cantidad: 2, unidad: 'kg', precioUnit: 12, subtotal: 24, precioUnitDivisa: 10, subtotalDivisa: 20 },
    { producto: 'Pulpo', cantidad: 0.5, unidad: 'kg', precioUnit: 12, subtotal: 6, precioUnitDivisa: 11, subtotalDivisa: 5.5 },
  ],
  subtotal: 30,
  total: 30,
  totalBs: 30 * 150,
  exchangeRate: 150,
  date: '10/09/2026',
  modoPrecio: 'bcv',
};

describe('generateFacturaPDF', () => {
  it('BCV con Bs visibles: incluye tasa y equivalente en bolívares', () => {
    const text = pdfText(generateFacturaPDF(base));
    expect(text).toContain('PRESUPUESTO');
    expect(text).toContain('TOTAL A PAGAR');
    expect(text).toContain('Tasa aplicada');
    expect(text).toContain('Equivalente en bol');
    expect(text).toContain('Maria Perez');
  });

  it('BCV con hideRate: no muestra tasa ni bolívares', () => {
    const text = pdfText(generateFacturaPDF({ ...base, hideRate: true }));
    expect(text).toContain('TOTAL A PAGAR');
    expect(text).not.toContain('Tasa aplicada');
    expect(text).not.toContain('Equivalente en bol');
  });

  it('sin exchangeRate deduce la tasa desde totalBs (llamada del bot de Telegram)', () => {
    const text = pdfText(generateFacturaPDF({ ...base, exchangeRate: undefined }));
    expect(text).toContain('Tasa aplicada');
  });

  it('divisa: una sola página y sin bolívares', () => {
    const buf = generateFacturaPDF({ ...base, modoPrecio: 'divisa', totalBs: 0, totalUSDDivisa: 25.5 });
    expect(pageCount(buf)).toBe(1);
    expect(pdfText(buf)).not.toContain('Equivalente en bol');
  });

  it('dual: dos páginas (BCV y divisa)', () => {
    const buf = generateFacturaPDF({ ...base, modoPrecio: 'dual', totalUSDDivisa: 25.5 });
    expect(pageCount(buf)).toBe(2);
  });

  it('muchos productos: continúa la tabla en otra página', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      producto: `Producto ${i + 1}`, cantidad: 1, unidad: 'kg', precioUnit: 5, subtotal: 5,
    }));
    const buf = generateFacturaPDF({ ...base, items, total: 200, subtotal: 200, totalBs: 200 * 150 });
    expect(pageCount(buf)).toBeGreaterThan(1);
  });

  it('cliente genérico "Cliente" no se imprime', () => {
    const text = pdfText(generateFacturaPDF({ ...base, customerName: 'Cliente' }));
    expect(text).not.toContain('(Cliente)');
  });
});
