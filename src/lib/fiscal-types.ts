/**
 * RPYM - TypeScript types for Fiscal Module
 * Venezuelan tax management: IVA, ISLR, IGTF, SUMAT
 */

// =====================
// Tax Constants
// =====================

export const FISCAL_CONSTANTS = {
  IVA_RATE: 0.08,           // 8% for food
  IGTF_RATE: 0.03,          // 3% on USD payments
  ISLR_ADVANCE_RATE: 0.01,  // 1% advance
  SUMAT_RATE: 0.025,        // 2.5% municipal tax
  RETENCION_IVA_75: 0.75,   // 75% retention
  RETENCION_IVA_100: 1.0,   // 100% retention (special contributors)
} as const;

// =====================
// D1 Row Types (snake_case)
// =====================

export interface D1FiscalProveedor {
  id: number;
  rif: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  retencion_iva_pct: number;
  islr_pct: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface D1FiscalFacturaCompra {
  id: number;
  proveedor_id: number;
  numero_factura: string;
  numero_control: string | null;
  fecha_factura: string;
  fecha_recepcion: string;
  subtotal_exento: number;
  subtotal_gravable: number;
  iva: number;
  total: number;
  retencion_iva: number;
  anticipo_islr: number;
  igtf: number | null;
  payment_currency: 'bs' | 'usd';
  exchange_rate: number | null;
  image_key: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface D1FiscalFacturaCompraWithProveedor extends D1FiscalFacturaCompra {
  proveedor_nombre?: string;
  proveedor_rif?: string;
}

export interface D1FiscalReporteZ {
  id: number;
  fecha: string;
  subtotal_exento: number;
  subtotal_gravable: number;
  iva_cobrado: number;
  base_imponible_igtf: number;  // Ventas cobradas en divisas (base para IGTF)
  igtf_ventas: number;          // IGTF cobrado (3% de base_imponible_igtf)
  total_ventas: number;
  numeracion_facturas: string | null;
  image_key: string | null;
  ocr_verified: number;
  ocr_raw_data: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface D1FiscalRetencionIva {
  id: number;
  factura_id: number;
  numero_comprobante: string;
  fecha_emision: string;
  periodo_fiscal: string;
  monto_retenido: number;
  pdf_key: string | null;
  created_at: string;
}

export interface D1FiscalRetencionIvaWithDetails extends D1FiscalRetencionIva {
  proveedor_nombre?: string;
  proveedor_rif?: string;
  numero_factura?: string;
  fecha_factura?: string;
}

// =====================
// API Response Types (camelCase)
// =====================

export interface FiscalProveedor {
  id: number;
  rif: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  retencionIvaPct: number;
  islrPct: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalFacturaCompra {
  id: number;
  proveedorId: number;
  proveedorNombre?: string;
  proveedorRif?: string;
  numeroFactura: string;
  numeroControl: string | null;
  fechaFactura: string;
  fechaRecepcion: string;
  subtotalExento: number;
  subtotalGravable: number;
  iva: number;
  total: number;
  retencionIva: number;
  anticipoIslr: number;
  igtf: number | null;
  paymentCurrency: 'bs' | 'usd';
  exchangeRate: number | null;
  imageUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalReporteZ {
  id: number;
  fecha: string;
  subtotalExento: number;
  subtotalGravable: number;
  ivaCobrado: number;
  baseImponibleIgtf: number;  // Ventas cobradas en divisas (base para IGTF)
  igtfVentas: number;          // IGTF cobrado (3% de base_imponible_igtf)
  totalVentas: number;
  numeracionFacturas: string | null;
  imageUrl: string | null;
  ocrVerified: boolean;
  ocrRawData: OcrZReportData | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalRetencionIva {
  id: number;
  facturaId: number;
  proveedorNombre?: string;
  proveedorRif?: string;
  numeroFactura?: string;
  fechaFactura?: string;
  numeroComprobante: string;
  fechaEmision: string;
  periodoFiscal: string;
  montoRetenido: number;
  pdfUrl: string | null;
  createdAt: string;
}

// =====================
// OCR Types
// =====================

export interface OcrZReportData {
  fecha?: string;
  subtotalExento?: number;
  subtotalGravable?: number;
  ivaCobrado?: number;
  baseImponibleIgtf?: number;  // BI IGTF - ventas en divisas
  igtfVentas?: number;         // IGTF cobrado (3%)
  totalVentas?: number;
  numeracionFacturas?: string;
  confidence: number;
  rawText?: string;
}

// =====================
// Dashboard Types
// =====================

export interface FiscalDashboardData {
  periodo: string; // YYYY-MM
  bcvRate: number;

  // Ventas (from Z reports)
  totalVentasBs: number;
  totalVentasUsd: number;
  ivaCobradoBs: number;
  ivaCobradoUsd: number;
  ventasExentas: number;
  ventasGravables: number;

  // Compras
  totalComprasBs: number;
  totalComprasUsd: number;
  ivaComprasBs: number;
  ivaComprasUsd: number;
  comprasExentas: number;
  comprasGravables: number;

  // Retenciones
  retencionIvaTotal: number;
  retencionIvaPendiente: number;
  anticipoIslrAcumulado: number;

  // Balance
  ivaBalance: number; // ivaCobrado - ivaCompras + retenciones

  // SUMAT (municipal)
  sumatPendiente: number; // 2.5% of gross income

  // IGTF
  igtfPagado: number;         // IGTF pagado en compras
  baseImponibleIgtfVentas: number;  // BI IGTF de ventas (ventas en divisas)
  igtfVentasCobrado: number;  // IGTF cobrado en ventas (3%)

  // Counts
  reportesZCount: number;
  facturasCount: number;
  retencionesCount: number;
}

// =====================
// Margin Simulator Types
// =====================

export interface MarginSimulatorInput {
  costo: number;
  precioVenta: number;
  cantidad: number;
  pagoEnUsd: boolean;
}

export interface MarginSimulatorResult {
  ingresosBrutos: number;
  costoTotal: number;
  margenBruto: number;
  margenBrutoPct: number;
  iva: number;
  islrEstimado: number;
  igtf: number;
  sumat: number;
  margenNeto: number;
  margenNetoPct: number;
}

// =====================
// Form Types
// =====================

export interface ProveedorFormData {
  rif: string;
  nombre: string;
  direccion: string;
  telefono: string;
  email: string;
  retencionIvaPct: number;
  islrPct: number;
}

export interface FacturaFormData {
  proveedorId: number;
  numeroFactura: string;
  numeroControl: string;
  fechaFactura: string;
  fechaRecepcion: string;
  subtotalExento: number;
  subtotalGravable: number;
  iva: number;
  paymentCurrency: 'bs' | 'usd';
  exchangeRate: number | null;
  notes: string;
}

export interface ReporteZFormData {
  fecha: string;
  subtotalExento: number;
  subtotalGravable: number;
  ivaCobrado: number;
  baseImponibleIgtf: number;  // Ventas cobradas en divisas
  igtfVentas: number;         // IGTF cobrado (3%)
  totalVentas: number;
  numeracionFacturas: string;
  notes: string;
}

// =====================
// Transform Functions
// =====================

export function transformProveedor(row: D1FiscalProveedor): FiscalProveedor {
  return {
    id: row.id,
    rif: row.rif,
    nombre: row.nombre,
    direccion: row.direccion,
    telefono: row.telefono,
    email: row.email,
    retencionIvaPct: row.retencion_iva_pct,
    islrPct: row.islr_pct,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transformFactura(row: D1FiscalFacturaCompraWithProveedor): FiscalFacturaCompra {
  return {
    id: row.id,
    proveedorId: row.proveedor_id,
    proveedorNombre: row.proveedor_nombre,
    proveedorRif: row.proveedor_rif,
    numeroFactura: row.numero_factura,
    numeroControl: row.numero_control,
    fechaFactura: row.fecha_factura,
    fechaRecepcion: row.fecha_recepcion,
    subtotalExento: row.subtotal_exento,
    subtotalGravable: row.subtotal_gravable,
    iva: row.iva,
    total: row.total,
    retencionIva: row.retencion_iva,
    anticipoIslr: row.anticipo_islr,
    igtf: row.igtf,
    paymentCurrency: row.payment_currency,
    exchangeRate: row.exchange_rate,
    imageUrl: row.image_key ? `/api/fiscal/invoice-image/${row.image_key}` : null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transformReporteZ(row: D1FiscalReporteZ): FiscalReporteZ {
  let ocrData: OcrZReportData | null = null;
  if (row.ocr_raw_data) {
    try {
      ocrData = JSON.parse(row.ocr_raw_data);
    } catch {
      ocrData = null;
    }
  }

  return {
    id: row.id,
    fecha: row.fecha,
    subtotalExento: row.subtotal_exento,
    subtotalGravable: row.subtotal_gravable,
    ivaCobrado: row.iva_cobrado,
    baseImponibleIgtf: row.base_imponible_igtf || 0,
    igtfVentas: row.igtf_ventas || 0,
    totalVentas: row.total_ventas,
    numeracionFacturas: row.numeracion_facturas,
    imageUrl: row.image_key ? `/api/fiscal/z-image/${row.image_key}` : null,
    ocrVerified: row.ocr_verified === 1,
    ocrRawData: ocrData,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transformRetencion(row: D1FiscalRetencionIvaWithDetails): FiscalRetencionIva {
  return {
    id: row.id,
    facturaId: row.factura_id,
    proveedorNombre: row.proveedor_nombre,
    proveedorRif: row.proveedor_rif,
    numeroFactura: row.numero_factura,
    fechaFactura: row.fecha_factura,
    numeroComprobante: row.numero_comprobante,
    fechaEmision: row.fecha_emision,
    periodoFiscal: row.periodo_fiscal,
    montoRetenido: row.monto_retenido,
    pdfUrl: row.pdf_key ? `/api/fiscal/retencion-pdf/${row.pdf_key}` : null,
    createdAt: row.created_at,
  };
}

// =====================
// Calculation Helpers
// =====================

export interface RetentionCalculation {
  retencionIva: number;
  anticipoIslr: number;
  igtf: number | null;
  total: number;
}

export function calculateRetentions(
  subtotalGravable: number,
  iva: number,
  retencionIvaPct: number,
  paymentCurrency: 'bs' | 'usd'
): RetentionCalculation {
  const retencionIva = iva * (retencionIvaPct / 100);
  const anticipoIslr = subtotalGravable * FISCAL_CONSTANTS.ISLR_ADVANCE_RATE;
  const igtf = paymentCurrency === 'usd'
    ? (subtotalGravable + iva) * FISCAL_CONSTANTS.IGTF_RATE
    : null;
  const total = subtotalGravable + iva;

  return { retencionIva, anticipoIslr, igtf, total };
}

export function calculateMarginSimulation(
  input: MarginSimulatorInput
): MarginSimulatorResult {
  const ingresosBrutos = input.precioVenta * input.cantidad;
  const costoTotal = input.costo * input.cantidad;
  const margenBruto = ingresosBrutos - costoTotal;
  const margenBrutoPct = ingresosBrutos > 0 ? (margenBruto / ingresosBrutos) * 100 : 0;

  // Tax calculations
  const iva = ingresosBrutos * FISCAL_CONSTANTS.IVA_RATE;
  const islrEstimado = margenBruto > 0 ? margenBruto * FISCAL_CONSTANTS.ISLR_ADVANCE_RATE : 0;
  const igtf = input.pagoEnUsd ? ingresosBrutos * FISCAL_CONSTANTS.IGTF_RATE : 0;
  const sumat = ingresosBrutos * FISCAL_CONSTANTS.SUMAT_RATE;

  // Net margin after taxes
  const totalTaxes = iva + islrEstimado + igtf + sumat;
  const margenNeto = margenBruto - totalTaxes;
  const margenNetoPct = ingresosBrutos > 0 ? (margenNeto / ingresosBrutos) * 100 : 0;

  return {
    ingresosBrutos,
    costoTotal,
    margenBruto,
    margenBrutoPct,
    iva,
    islrEstimado,
    igtf,
    sumat,
    margenNeto,
    margenNetoPct,
  };
}

// =====================
// Validation Helpers
// =====================

export function validateRif(rif: string): boolean {
  // Venezuelan RIF format: J-12345678-9 or V-12345678-9
  const rifPattern = /^[JVGEP]-?\d{8}-?\d$/i;
  return rifPattern.test(rif.replace(/\s/g, ''));
}

export function formatRif(rif: string): string {
  // Normalize RIF format to J-12345678-9
  const cleaned = rif.replace(/[\s-]/g, '').toUpperCase();
  if (cleaned.length === 10) {
    return `${cleaned[0]}-${cleaned.slice(1, 9)}-${cleaned[9]}`;
  }
  return rif;
}

export function generateComprobanteNumber(year: number, month: number, sequence: number): string {
  // Format: YYYYMM00000XXX (14 digits total, matching SENIAT/contable format)
  // Example: 20260200000270 for February 2026, sequence 270
  const monthStr = String(month).padStart(2, '0');
  const seqStr = String(sequence).padStart(8, '0');
  return `${year}${monthStr}${seqStr}`;
}
