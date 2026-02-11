import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import type { FiscalDashboardData } from '../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/dashboard - Get fiscal dashboard data for a period
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const periodo = url.searchParams.get('periodo') || getCurrentPeriodo();

    // Get current BCV rate
    const bcvConfig = await db.prepare(
      "SELECT value FROM site_config WHERE key = 'bcv_rate'"
    ).first<{ value: string }>();
    const bcvRate = bcvConfig ? parseFloat(bcvConfig.value) : 1;

    // Get Z reports totals for the period
    const zTotals = await db.prepare(`
      SELECT
        COALESCE(SUM(subtotal_exento), 0) as ventas_exentas,
        COALESCE(SUM(subtotal_gravable), 0) as ventas_gravables,
        COALESCE(SUM(iva_cobrado), 0) as iva_cobrado,
        COALESCE(SUM(base_imponible_igtf), 0) as bi_igtf_ventas,
        COALESCE(SUM(igtf_ventas), 0) as igtf_ventas_cobrado,
        COALESCE(SUM(total_ventas), 0) as total_ventas,
        COUNT(*) as reportes_count
      FROM fiscal_reportes_z
      WHERE fecha LIKE ?
    `).bind(`${periodo}%`).first<{
      ventas_exentas: number;
      ventas_gravables: number;
      iva_cobrado: number;
      bi_igtf_ventas: number;
      igtf_ventas_cobrado: number;
      total_ventas: number;
      reportes_count: number;
    }>();

    // Get purchase invoices totals for the period
    const facturaTotals = await db.prepare(`
      SELECT
        COALESCE(SUM(subtotal_exento), 0) as compras_exentas,
        COALESCE(SUM(subtotal_gravable), 0) as compras_gravables,
        COALESCE(SUM(iva), 0) as iva_compras,
        COALESCE(SUM(total), 0) as total_compras,
        COALESCE(SUM(retencion_iva), 0) as retencion_iva_total,
        COALESCE(SUM(anticipo_islr), 0) as anticipo_islr_total,
        COALESCE(SUM(CASE WHEN igtf IS NOT NULL THEN igtf ELSE 0 END), 0) as igtf_total,
        COUNT(*) as facturas_count
      FROM fiscal_facturas_compra
      WHERE fecha_factura LIKE ?
    `).bind(`${periodo}%`).first<{
      compras_exentas: number;
      compras_gravables: number;
      iva_compras: number;
      total_compras: number;
      retencion_iva_total: number;
      anticipo_islr_total: number;
      igtf_total: number;
      facturas_count: number;
    }>();

    // Get retenciones count for the period
    const retencionesCount = await db.prepare(`
      SELECT COUNT(*) as count
      FROM fiscal_retenciones_iva
      WHERE periodo_fiscal = ?
    `).bind(periodo).first<{ count: number }>();

    // Calculate dashboard data
    const totalVentasBs = zTotals?.total_ventas || 0;
    const ivaCobradoBs = zTotals?.iva_cobrado || 0;
    const totalComprasBs = facturaTotals?.total_compras || 0;
    const ivaComprasBs = facturaTotals?.iva_compras || 0;
    const retencionIvaTotal = facturaTotals?.retencion_iva_total || 0;
    const anticipoIslrAcumulado = facturaTotals?.anticipo_islr_total || 0;
    const igtfPagado = facturaTotals?.igtf_total || 0;

    // IVA Balance = IVA Cobrado - IVA Pagado + Retenciones realizadas
    const ivaBalance = ivaCobradoBs - ivaComprasBs + retencionIvaTotal;

    // SUMAT = 2.5% of gross income (total ventas)
    const sumatPendiente = totalVentasBs * 0.025;

    const dashboard: FiscalDashboardData = {
      periodo,
      bcvRate,

      // Ventas
      totalVentasBs,
      totalVentasUsd: bcvRate > 0 ? totalVentasBs / bcvRate : 0,
      ivaCobradoBs,
      ivaCobradoUsd: bcvRate > 0 ? ivaCobradoBs / bcvRate : 0,
      ventasExentas: zTotals?.ventas_exentas || 0,
      ventasGravables: zTotals?.ventas_gravables || 0,

      // Compras
      totalComprasBs,
      totalComprasUsd: bcvRate > 0 ? totalComprasBs / bcvRate : 0,
      ivaComprasBs,
      ivaComprasUsd: bcvRate > 0 ? ivaComprasBs / bcvRate : 0,
      comprasExentas: facturaTotals?.compras_exentas || 0,
      comprasGravables: facturaTotals?.compras_gravables || 0,

      // Retenciones
      retencionIvaTotal,
      retencionIvaPendiente: retencionIvaTotal, // Simplified: all pending
      anticipoIslrAcumulado,

      // Balance
      ivaBalance,

      // Municipal
      sumatPendiente,

      // IGTF
      igtfPagado,
      baseImponibleIgtfVentas: zTotals?.bi_igtf_ventas || 0,
      igtfVentasCobrado: zTotals?.igtf_ventas_cobrado || 0,

      // Counts
      reportesZCount: zTotals?.reportes_count || 0,
      facturasCount: facturaTotals?.facturas_count || 0,
      retencionesCount: retencionesCount?.count || 0,
    };

    return new Response(JSON.stringify({
      success: true,
      dashboard,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar dashboard' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

function getCurrentPeriodo(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
