export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';

/** GET /api/pagos-proveedores/pendientes?antes_de=YYYY-MM
 *  Devuelve cantidad y lista resumida de compras pendientes de meses anteriores al indicado */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const antesDe = url.searchParams.get('antes_de'); // YYYY-MM

    if (!antesDe) {
      return new Response(JSON.stringify({ success: false, error: 'Parámetro antes_de requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const totalAbonadoExpr = `COALESCE((SELECT SUM(
      CASE WHEN c.modo_precio = 'paralelo' AND a.monto_bs IS NOT NULL AND a.tasa_paralela IS NOT NULL AND a.tasa_paralela > 0
        THEN a.monto_bs / a.tasa_paralela
        ELSE a.monto_usd
      END
    ) FROM abonos_proveedores a WHERE a.compra_id = c.id AND a.is_active = 1), 0)`;

    const result = await db.prepare(`
      SELECT c.id, c.producto, c.monto_total, c.fecha, pi.nombre as proveedor_nombre,
        ${totalAbonadoExpr} as total_abonado,
        c.monto_total - ${totalAbonadoExpr} as saldo_pendiente
      FROM compras_proveedores c
      JOIN proveedores_informales pi ON c.proveedor_id = pi.id
      WHERE c.is_active = 1
        AND c.pagada_manual = 0
        AND c.fecha < ?
        AND ${totalAbonadoExpr} < c.monto_total
      ORDER BY c.fecha ASC
    `).bind(`${antesDe}-01`).all<{
      id: number;
      producto: string;
      monto_total: number;
      fecha: string;
      proveedor_nombre: string;
      total_abonado: number;
      saldo_pendiente: number;
    }>();

    return new Response(JSON.stringify({
      success: true,
      count: result.results.length,
      pendientes: result.results.map(r => ({
        id: r.id,
        producto: r.producto,
        proveedor: r.proveedor_nombre,
        montoTotal: r.monto_total,
        totalAbonado: r.total_abonado,
        saldoPendiente: r.saldo_pendiente,
        fecha: r.fecha,
        mes: r.fecha.substring(0, 7),
      })),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al buscar pendientes:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al buscar pendientes' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
