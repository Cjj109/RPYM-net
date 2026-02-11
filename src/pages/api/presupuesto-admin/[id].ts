/**
 * RPYM - Admin Presupuesto API (token-protected)
 * GET /api/presupuesto-admin/[id]?token=XXX
 */
import type { APIRoute } from 'astro';
import { validateAdminToken } from '../../../lib/admin-token';

export const prerender = false;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const id = params.id;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!id || !token) {
    return new Response(JSON.stringify({ success: false, error: 'Missing id or token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get secret from environment
  const runtime = locals.runtime as { env?: { ADMIN_SECRET?: string } } | undefined;
  const secret = runtime?.env?.ADMIN_SECRET || 'rpym-default-secret-2024';

  // Validate token
  const isValid = await validateAdminToken(id, token, secret);
  if (!isValid) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get presupuesto from D1
  const db = runtime?.env?.DB as any;
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const row = await db.prepare(`
      SELECT id, fecha, items, total_usd, total_bs, total_usd_divisa, hide_rate, delivery, modo_precio,
             estado, customer_name, customer_address, fecha_pago, source
      FROM presupuestos WHERE id = ?
    `).bind(id).first();

    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Presupuesto not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const presupuesto = {
      id: row.id,
      fecha: row.fecha,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
      totalUSD: row.total_usd,
      totalBs: row.total_bs,
      totalUSDDivisa: row.total_usd_divisa,
      hideRate: row.hide_rate === 1,
      delivery: row.delivery || 0,
      modoPrecio: row.modo_precio || 'bcv',
      estado: row.estado,
      customerName: row.customer_name,
      customerAddress: row.customer_address,
      fechaPago: row.fecha_pago,
      source: row.source
    };

    return new Response(JSON.stringify({ success: true, presupuesto }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
