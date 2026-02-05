import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';

export const prerender = false;

// GET /api/config/bcv-rate-history?date=YYYY-MM-DD
// Returns the BCV rate for a specific date (or the closest previous date)
export const GET: APIRoute = async ({ url, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'DB no disponible' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }

  const date = url.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ success: false, error: 'Fecha invalida (YYYY-MM-DD)' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Try exact date first, then fallback to the closest previous date
    const row = await db.prepare(`
      SELECT date, usd_rate, eur_rate FROM bcv_rates
      WHERE date <= ?
      ORDER BY date DESC
      LIMIT 1
    `).bind(date).first<{ date: string; usd_rate: number; eur_rate: number | null }>();

    if (!row) {
      return new Response(JSON.stringify({
        success: true,
        found: false,
        date,
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      found: true,
      date: row.date,
      requestedDate: date,
      exact: row.date === date,
      usdRate: row.usd_rate,
      eurRate: row.eur_rate,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching historical BCV rate:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al buscar tasa' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
