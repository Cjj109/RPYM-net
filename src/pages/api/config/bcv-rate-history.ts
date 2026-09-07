import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';

export const prerender = false;

// GET /api/config/bcv-rate-history?date=YYYY-MM-DD
// Devuelve la tasa que se estaba COBRANDO ese dia (o la del dia anterior mas
// cercano).
//
// Se busca por `desde`, no por la fecha valor del BCV, y la diferencia
// aparece los fines de semana: el BCV publica el viernes con fecha valor del
// lunes, pero aqui esa tasa entra el sabado. Buscando por fecha valor, un
// sabado devolvia la tasa de la semana pasada mientras el negocio cobraba la
// nueva, y el importe en USD no cuadraba con los tickets de ese dia.
//
// Lo consultan el panel fiscal y el de clientes para convertir a USD.
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
    // COALESCE por las filas anteriores a la migracion 0038 y por las que
    // escribe update-bcv.ts desde fuera: para esas la fecha valor es lo unico
    // que hay.
    const row = await db.prepare(`
      SELECT COALESCE(desde, date) AS date, usd_rate, eur_rate FROM bcv_rates
      WHERE COALESCE(desde, date) <= ?
      ORDER BY COALESCE(desde, date) DESC
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
