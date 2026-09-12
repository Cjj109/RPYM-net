import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      // Return empty stats when D1 is not configured
      return new Response(JSON.stringify({
        totalHoy: 0,
        vendidoHoyUSD: '0.00',
        vendidoHoyBs: '0.00',
        pendientes: 0,
        totalGeneral: 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get today's date in ISO format (YYYY-MM-DD)
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

    // Una sola pasada por la tabla. Antes eran cuatro consultas y tres de ellas
    // la recorrían entera en cada refresco del panel: con el panel abierto todo
    // el día eso rozaba el límite diario de filas leídas de D1.
    const row = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END), 0) AS pendientes,
        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS hoy,
        COALESCE(SUM(CASE WHEN estado = 'pagado' AND created_at >= ? AND created_at < ? THEN total_usd ELSE 0 END), 0) AS vendido_usd,
        COALESCE(SUM(CASE WHEN estado = 'pagado' AND created_at >= ? AND created_at < ? THEN total_bs ELSE 0 END), 0) AS vendido_bs
      FROM presupuestos
    `).bind(todayStart, tomorrowStart, todayStart, tomorrowStart, todayStart, tomorrowStart)
      .first<{ total: number; pendientes: number; hoy: number; vendido_usd: number; vendido_bs: number }>();

    const todayCount = row?.hoy || 0;
    const todaySales = { total_usd: row?.vendido_usd || 0, total_bs: row?.vendido_bs || 0 };
    const pendingCount = row?.pendientes || 0;
    const totalCount = row?.total || 0;

    return new Response(JSON.stringify({
      totalHoy: todayCount,
      vendidoHoyUSD: Number(todaySales.total_usd || 0).toFixed(2),
      vendidoHoyBs: Number(todaySales.total_bs || 0).toFixed(2),
      pendientes: pendingCount,
      totalGeneral: totalCount
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    return new Response(JSON.stringify({
      totalHoy: 0,
      vendidoHoyUSD: '0.00',
      vendidoHoyBs: '0.00',
      pendientes: 0,
      totalGeneral: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
