import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import type { ResumenMensual, ResumenMensualProveedor } from '../../../lib/pagos-proveedores-types';

export const prerender = false;

// GET /api/pagos-proveedores/resumen?mes=YYYY-MM - Monthly summary by supplier
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const now = new Date();
    const mes = url.searchParams.get('mes') ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const results = await db.prepare(`
      SELECT
        p.proveedor_id,
        pi.nombre as proveedor_nombre,
        SUM(p.monto_usd) as total_usd,
        COUNT(*) as cantidad_pagos
      FROM pagos_proveedores p
      JOIN proveedores_informales pi ON p.proveedor_id = pi.id
      WHERE p.fecha LIKE ? AND p.is_active = 1
      GROUP BY p.proveedor_id
      ORDER BY total_usd DESC
    `).bind(`${mes}%`).all<{
      proveedor_id: number;
      proveedor_nombre: string;
      total_usd: number;
      cantidad_pagos: number;
    }>();

    // Desglose por factura y cuenta
    const breakdown = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tiene_factura = 1 THEN monto_usd ELSE 0 END), 0) as total_con_factura,
        COALESCE(SUM(CASE WHEN tiene_factura = 0 THEN monto_usd ELSE 0 END), 0) as total_sin_factura,
        COALESCE(SUM(CASE WHEN cuenta = 'pa' THEN monto_usd ELSE 0 END), 0) as total_cuenta_pa,
        COALESCE(SUM(CASE WHEN cuenta = 'carlos' THEN monto_usd ELSE 0 END), 0) as total_cuenta_carlos,
        COALESCE(SUM(CASE WHEN cuenta = 'venezuela' THEN monto_usd ELSE 0 END), 0) as total_cuenta_venezuela,
        COUNT(*) as cantidad_total,
        COALESCE(SUM(CASE WHEN tiene_factura = 1 THEN 1 ELSE 0 END), 0) as cantidad_con_factura,
        COALESCE(SUM(CASE WHEN tiene_factura = 0 THEN 1 ELSE 0 END), 0) as cantidad_sin_factura
      FROM pagos_proveedores
      WHERE fecha LIKE ? AND is_active = 1
    `).bind(`${mes}%`).first<{
      total_con_factura: number;
      total_sin_factura: number;
      total_cuenta_pa: number;
      total_cuenta_carlos: number;
      total_cuenta_venezuela: number;
      cantidad_total: number;
      cantidad_con_factura: number;
      cantidad_sin_factura: number;
    }>();

    const porProveedor: ResumenMensualProveedor[] = results.results.map(r => ({
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre,
      totalUsd: r.total_usd,
      cantidadPagos: r.cantidad_pagos,
    }));

    const resumen: ResumenMensual = {
      periodo: mes,
      totalUsd: porProveedor.reduce((sum, p) => sum + p.totalUsd, 0),
      totalConFactura: breakdown?.total_con_factura || 0,
      totalSinFactura: breakdown?.total_sin_factura || 0,
      totalCuentaPa: breakdown?.total_cuenta_pa || 0,
      totalCuentaCarlos: breakdown?.total_cuenta_carlos || 0,
      totalCuentaVenezuela: breakdown?.total_cuenta_venezuela || 0,
      cantidadTotal: breakdown?.cantidad_total || 0,
      cantidadConFactura: breakdown?.cantidad_con_factura || 0,
      cantidadSinFactura: breakdown?.cantidad_sin_factura || 0,
      porProveedor,
    };

    return new Response(JSON.stringify({
      success: true,
      resumen,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting resumen pagos:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al obtener resumen' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
