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

    // Execute all stats queries in parallel using batch
    const [
      todayCountResult,
      todaySalesResult,
      pendingResult,
      totalResult
    ] = await db.batch([
      // Count today's presupuestos
      db.prepare(`
        SELECT COUNT(*) as count
        FROM presupuestos
        WHERE created_at >= ? AND created_at < ?
      `).bind(todayStart, tomorrowStart),

      // Sum today's paid presupuestos
      db.prepare(`
        SELECT
          COALESCE(SUM(total_usd), 0) as total_usd,
          COALESCE(SUM(total_bs), 0) as total_bs
        FROM presupuestos
        WHERE estado = 'pagado'
        AND created_at >= ? AND created_at < ?
      `).bind(todayStart, tomorrowStart),

      // Count pending presupuestos
      db.prepare(`
        SELECT COUNT(*) as count
        FROM presupuestos
        WHERE estado = 'pendiente'
      `),

      // Count total presupuestos
      db.prepare(`
        SELECT COUNT(*) as count
        FROM presupuestos
      `)
    ]);

    const todayCount = (todayCountResult.results[0] as any)?.count || 0;
    const todaySales = todaySalesResult.results[0] as any || { total_usd: 0, total_bs: 0 };
    const pendingCount = (pendingResult.results[0] as any)?.count || 0;
    const totalCount = (totalResult.results[0] as any)?.count || 0;

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
