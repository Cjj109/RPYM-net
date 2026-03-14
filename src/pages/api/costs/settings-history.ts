/**
 * API: Cost settings history (tasas de cambio histórico)
 * GET: Returns all past cost settings records
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
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const { results } = await db.prepare(
      'SELECT * FROM cost_settings ORDER BY id DESC LIMIT ?'
    ).bind(limit).all();

    return new Response(JSON.stringify({ success: true, history: results }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error cargando historial de tasas:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar historial de tasas' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
