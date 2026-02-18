import type { APIRoute } from 'astro';
import { requireBot2Auth } from '../../../../lib/require-bot2-auth';

export const prerender = false;

/** Presupuestos pendientes vencidos — read-only para Bot 2 */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = requireBot2Auth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const minDays = parseInt(url.searchParams.get('days') || '15', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const results = await db.prepare(`
      SELECT
        p.id,
        p.fecha,
        p.customer_name,
        p.total_usd,
        p.total_bs,
        p.total_usd_divisa,
        p.modo_precio,
        p.delivery,
        p.source,
        p.created_at,
        p.items,
        CAST(julianday('now') - julianday(p.created_at) AS INTEGER) AS days_old,
        MAX(ct.customer_id) IS NOT NULL AS is_linked,
        MAX(ct.customer_id) AS linked_customer_id
      FROM presupuestos p
      LEFT JOIN customer_transactions ct ON ct.presupuesto_id = p.id
      WHERE p.estado = 'pendiente'
        AND julianday('now') - julianday(p.created_at) > ?
      GROUP BY p.id
      ORDER BY p.created_at ASC
      LIMIT ?
    `).bind(minDays, limit).all();

    // Parsear items JSON para facilitar análisis
    const presupuestos = (results.results as any[]).map(p => ({
      ...p,
      items: (() => {
        try { return JSON.parse(p.items); }
        catch { return p.items; }
      })()
    }));
    const totalOverdueUSD = presupuestos.reduce((sum: number, p: any) => sum + (p.total_usd || 0), 0);

    return new Response(JSON.stringify({
      success: true,
      count: presupuestos.length,
      totalOverdueUSD: Math.round(totalOverdueUSD * 100) / 100,
      minDays,
      presupuestos
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Bot2 Overdue] Error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al buscar presupuestos vencidos' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
