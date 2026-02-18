import type { APIRoute } from 'astro';
import { requireBot2Auth } from '../../../../lib/require-bot2-auth';

export const prerender = false;

/**
 * Búsqueda de presupuestos — read-only para Bot 2
 * Soporta filtros: cliente, estado, rango de fechas, producto
 * Ejemplo: ?customer=delcy&status=pagado&from=2025-01-01&to=2025-01-31&product=pulpo
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = requireBot2Auth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const customer = url.searchParams.get('customer');
    const status = url.searchParams.get('status');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const product = url.searchParams.get('product');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    let query = `
      SELECT
        p.id,
        p.fecha,
        p.customer_name,
        p.items,
        p.total_usd,
        p.total_bs,
        p.total_usd_divisa,
        p.modo_precio,
        p.delivery,
        p.estado,
        p.source,
        p.fecha_pago,
        p.created_at
      FROM presupuestos p
      WHERE 1=1
    `;

    const params: unknown[] = [];

    if (customer) {
      query += ` AND p.customer_name LIKE ?`;
      params.push(`%${customer}%`);
    }

    if (status === 'pendiente' || status === 'pagado') {
      query += ` AND p.estado = ?`;
      params.push(status);
    }

    if (from) {
      query += ` AND p.fecha >= ?`;
      params.push(from);
    }

    if (to) {
      query += ` AND p.fecha <= ?`;
      params.push(to);
    }

    if (product) {
      // Buscar dentro del JSON de items
      query += ` AND p.items LIKE ?`;
      params.push(`%${product}%`);
    }

    query += ` ORDER BY p.created_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);

    const results = await stmt.all();

    // Parsear items JSON para facilitar análisis
    const presupuestos = (results.results as any[]).map(p => ({
      ...p,
      items: (() => {
        try { return JSON.parse(p.items); }
        catch { return p.items; }
      })()
    }));

    return new Response(JSON.stringify({
      success: true,
      count: presupuestos.length,
      filters: { customer, status, from, to, product },
      presupuestos
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Bot2 Search] Error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al buscar presupuestos' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
