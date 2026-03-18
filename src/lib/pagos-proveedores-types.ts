/**
 * RPYM - Tipos para módulo de pagos a proveedores informales
 * Modelo compra/abonos: cada compra puede tener múltiples pagos parciales
 */

// =====================
// D1 Row Types (snake_case)
// =====================

export interface D1ProveedorInformal {
  id: number;
  nombre: string;
  notas: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface D1CompraProveedor {
  id: number;
  proveedor_id: number;
  producto: string;
  monto_total: number;
  monto_total_bs: number | null;
  tasa_referencia: number | null;
  tasa_referencia_paralela: number | null;
  modo_precio: string;
  fecha: string;
  tiene_factura: number;
  pagada_manual: number;
  nota_pagada: string | null;
  nota_entrega_key: string | null;
  notas: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface D1CompraProveedorWithNombre extends D1CompraProveedor {
  proveedor_nombre: string;
  total_abonado: number;
}

export interface D1AbonoProveedor {
  id: number;
  compra_id: number;
  monto_usd: number;
  monto_bs: number | null;
  tasa_cambio: number | null;
  tasa_paralela: number | null;
  fecha: string;
  metodo_pago: string;
  cuenta: string;
  imagen_key: string | null;
  notas: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// Legacy types (kept for backward compat during transition)
export interface D1PagoProveedor {
  id: number;
  proveedor_id: number;
  monto_usd: number;
  producto: string;
  fecha: string;
  metodo_pago: string;
  cuenta: string;
  monto_bs: number | null;
  tasa_cambio: number | null;
  tasa_paralela: number | null;
  tiene_factura: number;
  imagen_key: string | null;
  notas: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface D1PagoProveedorWithNombre extends D1PagoProveedor {
  proveedor_nombre: string;
}

// =====================
// API Response Types (camelCase)
// =====================

export interface ProveedorInformal {
  id: number;
  nombre: string;
  notas: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MetodoPago = 'pago_movil' | 'transferencia' | 'efectivo';
export type CuentaPago = 'pa' | 'carlos' | 'venezuela';
export type ModoPrecioCompra = 'bcv' | 'paralelo' | 'bs' | 'efectivo_usd';

export interface AbonoProveedor {
  id: number;
  compraId: number;
  montoUsd: number;
  montoBs: number | null;
  tasaCambio: number | null;
  tasaParalela: number | null;
  montoUsdParalelo: number | null;
  fecha: string;
  metodoPago: MetodoPago;
  cuenta: CuentaPago;
  imagenUrl: string | null;
  notas: string | null;
  createdAt: string;
}

export interface CompraProveedor {
  id: number;
  proveedorId: number;
  proveedorNombre: string;
  producto: string;
  montoTotal: number;
  montoTotalBs: number | null;
  tasaReferencia: number | null;
  tasaReferenciaParalela: number | null;
  montoTotalUsdParalelo: number | null;
  modoPrecio: ModoPrecioCompra;
  totalAbonado: number;
  saldoPendiente: number;
  pagadaManual: boolean;
  notaPagada: string | null;
  fecha: string;
  tieneFactura: boolean;
  notaEntregaUrl: string | null;
  notas: string | null;
  abonos: AbonoProveedor[];
  createdAt: string;
}

// Legacy type
export interface PagoProveedor {
  id: number;
  proveedorId: number;
  proveedorNombre: string;
  montoUsd: number;
  montoBs: number | null;
  tasaCambio: number | null;
  tasaParalela: number | null;
  montoUsdParalelo: number | null;
  producto: string;
  fecha: string;
  metodoPago: MetodoPago;
  cuenta: CuentaPago;
  tieneFactura: boolean;
  imagenUrl: string | null;
  notas: string | null;
  createdAt: string;
}

export interface ResumenMensualProveedor {
  proveedorId: number;
  proveedorNombre: string;
  totalUsd: number;
  cantidadPagos: number;
}

export interface ResumenMensual {
  periodo: string;
  totalUsd: number;
  totalConFactura: number;
  totalSinFactura: number;
  totalCuentaPa: number;
  totalCuentaCarlos: number;
  totalCuentaVenezuela: number;
  cantidadTotal: number;
  cantidadConFactura: number;
  cantidadSinFactura: number;
  porProveedor: ResumenMensualProveedor[];
}

// =====================
// Labels para UI
// =====================

export const METODO_PAGO_LABELS: Record<MetodoPago, string> = {
  pago_movil: 'Pago Móvil',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
};

export const METODO_PAGO_SHORT: Record<MetodoPago, string> = {
  pago_movil: 'PM',
  transferencia: 'Transf',
  efectivo: 'Efect',
};

export const CUENTA_LABELS: Record<CuentaPago, string> = {
  pa: 'Cuenta PA',
  carlos: 'Cuenta Carlos',
  venezuela: 'Cuenta Venezuela',
};

export const CUENTA_SHORT: Record<CuentaPago, string> = {
  pa: 'PA',
  carlos: 'Carlos',
  venezuela: 'Vzla',
};

export const MODO_PRECIO_LABELS: Record<ModoPrecioCompra, string> = {
  bcv: 'BCV',
  paralelo: 'Paralelo',
  bs: 'Bolívares',
  efectivo_usd: 'Efectivo USD',
};

export const MODO_PRECIO_SHORT: Record<ModoPrecioCompra, string> = {
  bcv: 'BCV',
  paralelo: 'Paral.',
  bs: 'Bs',
  efectivo_usd: 'Efect.',
};

// =====================
// Transform Functions
// =====================

export function transformProveedorInformal(row: D1ProveedorInformal): ProveedorInformal {
  return {
    id: row.id,
    nombre: row.nombre,
    notas: row.notas,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transformAbonoProveedor(row: D1AbonoProveedor): AbonoProveedor {
  return {
    id: row.id,
    compraId: row.compra_id,
    montoUsd: row.monto_usd,
    montoBs: row.monto_bs,
    tasaCambio: row.tasa_cambio,
    tasaParalela: row.tasa_paralela,
    montoUsdParalelo: row.tasa_paralela && row.monto_bs
      ? row.monto_bs / row.tasa_paralela
      : null,
    fecha: row.fecha,
    metodoPago: row.metodo_pago as MetodoPago,
    cuenta: row.cuenta as CuentaPago,
    imagenUrl: row.imagen_key ? `/api/pagos-proveedores/imagen/${row.imagen_key}` : null,
    notas: row.notas,
    createdAt: row.created_at,
  };
}

export function transformCompraProveedor(
  row: D1CompraProveedorWithNombre,
  abonosRows: D1AbonoProveedor[]
): CompraProveedor {
  const abonos = abonosRows.map(transformAbonoProveedor);
  // Para compras 'paralelo', recalcular total abonado usando tasa paralela
  let totalAbonado = row.total_abonado || 0;
  if (row.modo_precio === 'paralelo' && abonosRows.length > 0) {
    totalAbonado = abonosRows.reduce((sum, a) => {
      if (a.monto_bs && a.tasa_paralela && a.tasa_paralela > 0) {
        return sum + (a.monto_bs / a.tasa_paralela);
      }
      return sum + a.monto_usd;
    }, 0);
  }
  return {
    id: row.id,
    proveedorId: row.proveedor_id,
    proveedorNombre: row.proveedor_nombre,
    producto: row.producto,
    montoTotal: row.monto_total,
    montoTotalBs: row.monto_total_bs,
    tasaReferencia: row.tasa_referencia,
    tasaReferenciaParalela: row.tasa_referencia_paralela,
    montoTotalUsdParalelo: row.monto_total_bs && row.tasa_referencia_paralela
      ? row.monto_total_bs / row.tasa_referencia_paralela
      : null,
    modoPrecio: (row.modo_precio || 'bcv') as ModoPrecioCompra,
    totalAbonado,
    saldoPendiente: row.monto_total - totalAbonado,
    pagadaManual: row.pagada_manual === 1,
    notaPagada: row.nota_pagada,
    fecha: row.fecha,
    tieneFactura: row.tiene_factura === 1,
    notaEntregaUrl: row.nota_entrega_key ? `/api/pagos-proveedores/nota-entrega/${row.nota_entrega_key}` : null,
    notas: row.notas,
    abonos,
    createdAt: row.created_at,
  };
}

// Legacy transform
export function transformPagoProveedor(row: D1PagoProveedorWithNombre): PagoProveedor {
  return {
    id: row.id,
    proveedorId: row.proveedor_id,
    proveedorNombre: row.proveedor_nombre,
    montoUsd: row.monto_usd,
    montoBs: row.monto_bs,
    tasaCambio: row.tasa_cambio,
    tasaParalela: row.tasa_paralela,
    montoUsdParalelo: row.tasa_paralela && row.monto_bs
      ? row.monto_bs / row.tasa_paralela
      : null,
    producto: row.producto,
    fecha: row.fecha,
    metodoPago: row.metodo_pago as MetodoPago,
    cuenta: row.cuenta as CuentaPago,
    tieneFactura: row.tiene_factura === 1,
    imagenUrl: row.imagen_key ? `/api/pagos-proveedores/imagen/${row.imagen_key}` : null,
    notas: row.notas,
    createdAt: row.created_at,
  };
}
