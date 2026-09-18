import { describe, it, expect } from 'vitest';
import {
  transformCompraProveedor,
  estaPagada,
  sigueDebiendo,
  tieneSaldoAFavor,
  esCuentaEnDivisas,
  CUENTA_LABELS,
  type D1CompraProveedorWithNombre,
  type D1AbonoProveedor,
} from '../pagos-proveedores-types';

/**
 * El saldo de una compra sale de restar dos números con decimales, y en las
 * compras a tasa paralela cada abono se reconvierte dividiendo bolívares entre
 * la tasa. Eso deja sobras de milésimas: la pantalla decía "Pendiente: $0.00" y
 * la compra no se marcaba pagada porque por dentro quedaba un pelo mayor que
 * cero. Estas pruebas fijan ese comportamiento.
 */

const compraBase = (extra: Partial<D1CompraProveedorWithNombre> = {}): D1CompraProveedorWithNombre => ({
  id: 1,
  proveedor_id: 7,
  producto: 'Camarones',
  monto_total: 100,
  monto_total_bs: null,
  tasa_referencia: null,
  tasa_referencia_paralela: null,
  modo_precio: 'bcv',
  fecha: '2026-09-18',
  tiene_factura: 0,
  pagada_manual: 0,
  nota_pagada: null,
  nota_entrega_key: null,
  notas: null,
  is_active: 1,
  created_at: '2026-09-18 10:00:00',
  updated_at: '2026-09-18 10:00:00',
  proveedor_nombre: 'Vizcaino',
  total_abonado: 0,
  ...extra,
});

const abonoBase = (extra: Partial<D1AbonoProveedor> = {}): D1AbonoProveedor => ({
  id: 1,
  compra_id: 1,
  monto_usd: 0,
  monto_bs: null,
  tasa_cambio: null,
  tasa_paralela: null,
  fecha: '2026-09-18',
  metodo_pago: 'pago_movil',
  cuenta: 'pa',
  imagen_key: null,
  notas: null,
  is_active: 1,
  created_at: '2026-09-18 10:00:00',
  updated_at: '2026-09-18 10:00:00',
  ...extra,
});

describe('saldo pendiente y redondeo', () => {
  it('da por saldada una compra cuyo resto es basura de coma flotante', () => {
    // 0.7 + 0.3 no da 1 en coma flotante: da 0.9999999999999999
    const compra = transformCompraProveedor(
      compraBase({ monto_total: 1, total_abonado: 0.7 + 0.3 }),
      []
    );

    expect(compra.saldoPendiente).toBe(0);
    expect(estaPagada(compra)).toBe(true);
    expect(sigueDebiendo(compra)).toBe(false);
  });

  it('no inventa saldo a favor cuando la suma se pasa por milésimas', () => {
    const tasa = 30;
    const abonos = [1, 2, 3].map(id =>
      abonoBase({ id, monto_usd: 33.33, monto_bs: 1000, tasa_paralela: tasa })
    );

    // 1000/30 tres veces se pasa de 100 por un pelo
    const compra = transformCompraProveedor(
      compraBase({ monto_total: 100, modo_precio: 'paralelo', total_abonado: 99.99 }),
      abonos
    );

    expect(compra.saldoPendiente).toBe(0);
    expect(tieneSaldoAFavor(compra)).toBe(false);
    expect(estaPagada(compra)).toBe(true);
  });

  it('sigue viendo la deuda cuando falta plata de verdad', () => {
    const compra = transformCompraProveedor(
      compraBase({ monto_total: 500, total_abonado: 300 }),
      []
    );

    expect(compra.saldoPendiente).toBe(200);
    expect(sigueDebiendo(compra)).toBe(true);
    expect(estaPagada(compra)).toBe(false);
  });

  it('reconoce el saldo a favor cuando se pagó de más de verdad', () => {
    const compra = transformCompraProveedor(
      compraBase({ monto_total: 100, total_abonado: 120 }),
      []
    );

    expect(compra.saldoPendiente).toBe(-20);
    expect(tieneSaldoAFavor(compra)).toBe(true);
    expect(estaPagada(compra)).toBe(true);
  });

  it('respeta la marca manual aunque falte por abonar', () => {
    const compra = transformCompraProveedor(
      compraBase({ monto_total: 500, total_abonado: 490, pagada_manual: 1 }),
      []
    );

    expect(compra.saldoPendiente).toBe(10);
    expect(estaPagada(compra)).toBe(true);
    // Marcada a mano no es "sigue debiendo": ya se cerró a propósito
    expect(sigueDebiendo(compra)).toBe(false);
    expect(tieneSaldoAFavor(compra)).toBe(false);
  });

  it('un centavo que falta de verdad sigue contando como deuda', () => {
    const compra = transformCompraProveedor(
      compraBase({ monto_total: 100, total_abonado: 99.9 }),
      []
    );

    expect(compra.saldoPendiente).toBeCloseTo(0.1, 10);
    expect(sigueDebiendo(compra)).toBe(true);
  });
});

describe('cuentas', () => {
  it('Zelle es la cuenta en divisas; las venezolanas van en bolívares', () => {
    expect(esCuentaEnDivisas('zelle')).toBe(true);
    expect(esCuentaEnDivisas('pa')).toBe(false);
    expect(esCuentaEnDivisas('carlos')).toBe(false);
    expect(esCuentaEnDivisas('venezuela')).toBe(false);
  });

  it('toda cuenta tiene etiqueta: el selector se pinta a partir de aquí', () => {
    expect(Object.keys(CUENTA_LABELS)).toEqual(['pa', 'carlos', 'venezuela', 'zelle']);
  });
});
