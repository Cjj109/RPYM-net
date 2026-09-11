import { describe, it, expect } from 'vitest';
import { summarizeProductHabits, formatHabitsForPrompt } from '../customer-history';

const pedido = (items: Array<{ nombre: string; cantidad: number; unidad: string; precioUSD: number }>) =>
  ({ items: JSON.stringify(items) });

describe('summarizeProductHabits', () => {
  it('cuenta en cuántos pedidos aparece cada producto y guarda lo más reciente', () => {
    const habits = summarizeProductHabits([
      pedido([
        { nombre: 'Jaiba', cantidad: 0.5, unidad: 'kg', precioUSD: 5 },
        { nombre: 'Camaron Desvenado', cantidad: 2, unidad: 'kg', precioUSD: 14 },
      ]),
      pedido([{ nombre: 'Jaiba', cantidad: 1, unidad: 'kg', precioUSD: 4.5 }]),
    ]);
    expect(habits[0]).toEqual({ nombre: 'Jaiba', unidad: 'kg', pedidos: 2, ultimaCantidad: 0.5, ultimoPrecio: 5 });
    expect(habits[1].nombre).toBe('Camaron Desvenado');
    expect(habits[1].pedidos).toBe(1);
  });

  it('un producto repetido en el mismo pedido cuenta una vez', () => {
    const habits = summarizeProductHabits([
      pedido([
        { nombre: 'Pulpo', cantidad: 1, unidad: 'kg', precioUSD: 12 },
        { nombre: 'pulpo', cantidad: 2, unidad: 'kg', precioUSD: 12 },
      ]),
    ]);
    expect(habits).toHaveLength(1);
    expect(habits[0].pedidos).toBe(1);
  });

  it('ignora filas con JSON roto y respeta el tope', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({ nombre: `Producto ${i}`, cantidad: 1, unidad: 'kg', precioUSD: 1 }));
    const habits = summarizeProductHabits([{ items: 'no-json' }, pedido(muchos)], 8);
    expect(habits).toHaveLength(8);
  });
});

describe('formatHabitsForPrompt', () => {
  it('sin historial no agrega nada al prompt', () => {
    expect(formatHabitsForPrompt('Pollino', [])).toBe('');
  });

  it('resume cada producto y deja claro que no se copian precios ni cantidades', () => {
    const texto = formatHabitsForPrompt('Pollino', [
      { nombre: 'Jaiba', unidad: 'kg', pedidos: 2, ultimaCantidad: 0.5, ultimoPrecio: 5 },
    ]);
    expect(texto).toContain('HISTORIAL RECIENTE DE "Pollino"');
    expect(texto).toContain('- Jaiba: 2 pedidos, último 0.5 kg a $5.00/kg');
    expect(texto).toContain('NUNCA copies cantidades ni precios');
  });

  it('dice de cuántos pedidos sale el resumen', () => {
    const texto = formatHabitsForPrompt('Pollino', [
      { nombre: 'Jaiba', unidad: 'kg', pedidos: 12, ultimaCantidad: 1, ultimoPrecio: 5 },
    ], 15);
    expect(texto).toContain('sus últimos 15 pedidos');
    expect(texto).toContain('- Jaiba: 12 pedidos');
  });
});
