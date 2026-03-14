/**
 * API: Purchase price history
 * GET: Returns history with optional filters (product_id, date range)
 */
import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get('product_id');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = parseInt(url.searchParams.get('limit') || '100');

    let sql = 'SELECT * FROM purchase_price_history WHERE 1=1';
    const binds: any[] = [];

    if (productId) {
      sql += ' AND product_id = ?';
      binds.push(parseInt(productId));
    }
    if (from) {
      sql += ' AND created_at >= ?';
      binds.push(from);
    }
    if (to) {
      sql += ' AND created_at <= ?';
      binds.push(to);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    binds.push(limit);

    const stmt = db.prepare(sql);
    const { results } = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all();

    return new Response(JSON.stringify({ success: true, history: results }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error cargando historial de precios:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar historial' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
