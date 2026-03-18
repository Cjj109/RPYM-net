/**
 * RPYM - Tipos para módulo de pagos a proveedores informales
 * Pagos sin factura con comprobante de pago móvil/transferencia
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
