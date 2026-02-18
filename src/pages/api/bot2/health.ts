import type { APIRoute } from 'astro';
import { requireBot2Auth } from '../../../lib/require-bot2-auth';

export const prerender = false;

/** Health check para Bot 2 — valida conectividad y acceso a D1 */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = requireBot2Auth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    await db.prepare('SELECT 1 FROM site_config LIMIT 1').first();

    return new Response(JSON.stringify({
      success: true,
      ok: true,
      timestamp: new Date().toISOString(),
      dbOk: true
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Bot2 Health] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      ok: false,
      timestamp: new Date().toISOString(),
      dbOk: false,
      error: 'Error al conectar con D1'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
